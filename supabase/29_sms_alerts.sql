-- 29: SMS alerts (ready, switched off until an SMS account is set up).
-- Provider: Arkesel (arkesel.com). To switch on:
--   1. Create an Arkesel account, buy SMS credit, and register the sender name YAHYIAM.
--   2. In Supabase → Vault, add a secret named  sms_arkesel  with the Arkesel API key.
--   3. Run: update app_settings set value = '1' where key = 'sms_enabled';
-- Messages sent:  supplier gets a text for each new quote request, and when their listing goes live.
-- Every message is logged in sms_log (admin can read it), whether it was sent or not.

insert into app_settings (key, value) values ('sms_enabled', '0'), ('sms_sender', 'NHYIAMU')
on conflict (key) do nothing;

create table if not exists sms_log (
  id         bigserial primary key,
  phone      text not null,
  message    text not null,
  reason     text not null,
  status     text not null,      -- sent / failed / off / no_key
  detail     text,
  created_at timestamptz not null default now()
);
alter table sms_log enable row level security;
grant select on sms_log to authenticated;
drop policy if exists "admin read" on sms_log;
create policy "admin read" on sms_log for select using (my_role() = 'admin');

create or replace function send_sms(p_phone text, p_message text, p_reason text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_key text; v_status text; v_detail text; v_res record;
begin
  if p_phone is null or p_phone !~ '^\+233[0-9]{9}$' then return 'bad_phone'; end if;
  if setting_num('sms_enabled', 0) <> 1 then
    v_status := 'off';
  else
    begin
      select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sms_arkesel' limit 1;
    exception when others then v_key := null; end;
    if v_key is null then
      v_status := 'no_key';
    else
      begin
        perform set_config('http.timeout_msec', '5000', true);
        select status, content into v_res from extensions.http((
          'POST', 'https://sms.arkesel.com/api/v2/sms/send',
          array[extensions.http_header('api-key', v_key)], 'application/json',
          jsonb_build_object('sender', coalesce((select value from app_settings where key = 'sms_sender'), 'YAHYIAM'),
                             'message', left(p_message, 300),
                             'recipients', jsonb_build_array(substr(p_phone, 2)))::text)::extensions.http_request);
        v_status := case when v_res.status between 200 and 299 then 'sent' else 'failed' end;
        v_detail := left(v_res.content, 300);
      exception when others then
        v_status := 'failed'; v_detail := left(sqlerrm, 300);
      end;
    end if;
  end if;
  insert into sms_log (phone, message, reason, status, detail) values (p_phone, p_message, p_reason, v_status, v_detail);
  return v_status;
end $$;
revoke all on function send_sms(text, text, text) from public, anon, authenticated;

-- New quote request → text the supplier
create or replace function sms_on_quote() returns trigger
language plpgsql security definer set search_path = public as $$
declare l listings;
begin
  select * into l from listings where id = new.listing_id;
  perform send_sms(l.phone, 'NHYIAMU: ' || new.name || ' wants a quote'
    || coalesce(' for ' || new.event_type, '') || coalesce(' on ' || to_char(new.event_date, 'DD Mon'), '')
    || '. See it and reply: nhyiamu.mcadesk.org/#/me/quotes', 'quote');
  return new;
exception when others then return new;   -- never block the request because of SMS
end $$;
drop trigger if exists sms_on_quote on quote_requests;
create trigger sms_on_quote after insert on quote_requests for each row execute function sms_on_quote();

-- Listing goes live → text the supplier
create or replace function sms_on_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and old.status is distinct from 'live' then
    perform send_sms(new.phone, 'NHYIAMU: ' || left(new.business_name, 40)
      || ' is now live. Customers can find you at nhyiamu.mcadesk.org/#/l/' || new.slug, 'listing_live');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists sms_on_live on listings;
create trigger sms_on_live after update of status on listings for each row execute function sms_on_live();
