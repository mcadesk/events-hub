-- 32: editable text messages, a welcome text, and greetings/broadcasts from the admin.
-- Wording lives in app_settings so the admin can change it on the "Text messages" page.
-- Tags filled in automatically: {name} {event} {date} {business} {link}

insert into app_settings (key, value) values
  ('sms_tpl_quote',   'YAHYIAM: {name} wants a quote{event}{date}. See it and reply: {link}'),
  ('sms_tpl_live',    'YAHYIAM: {business} is now live. Customers can find you at {link}'),
  ('sms_tpl_welcome', 'Welcome to YAHYIAM, {name}! Thank you for joining. Find event suppliers or list your business free at yahyiam.mcadesk.org'),
  ('sms_welcome_on',  '1'),
  ('sms_optout_line', 'To stop these texts: My details on yahyiam.mcadesk.org')
on conflict (key) do nothing;

-- People can say no to greetings and news (alerts about their own listing still come)
alter table profiles add column if not exists sms_news boolean not null default true;

create or replace function sms_tpl(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from app_settings where key = p_key
$$;

create or replace function sms_fill(p_tpl text, p_vals jsonb) returns text
language plpgsql immutable as $$
declare k text; r text := coalesce(p_tpl, '');
begin
  for k in select jsonb_object_keys(p_vals) loop
    r := replace(r, '{' || k || '}', coalesce(p_vals->>k, ''));
  end loop;
  return btrim(regexp_replace(r, '\s+', ' ', 'g'));
end $$;

-- Quote request alert
create or replace function sms_on_quote() returns trigger
language plpgsql security definer set search_path = public as $$
declare l listings;
begin
  select * into l from listings where id = new.listing_id;
  perform send_sms(l.phone, sms_fill(sms_tpl('sms_tpl_quote'), jsonb_build_object(
    'name', new.name,
    'event', coalesce(' for ' || new.event_type, ''),
    'date', coalesce(' on ' || to_char(new.event_date, 'DD Mon'), ''),
    'business', l.business_name,
    'link', 'yahyiam.mcadesk.org/#/me/quotes')), 'quote');
  return new;
exception when others then return new;
end $$;

-- Listing live alert
create or replace function sms_on_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and old.status is distinct from 'live' then
    perform send_sms(new.phone, sms_fill(sms_tpl('sms_tpl_live'), jsonb_build_object(
      'business', left(new.business_name, 40),
      'name', left(new.business_name, 40),
      'link', 'yahyiam.mcadesk.org/#/l/' || new.slug)), 'listing_live');
  end if;
  return new;
exception when others then return new;
end $$;

-- Welcome text: the first time a person's account gets a phone number
create or replace function sms_on_welcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if setting_num('sms_welcome_on', 0) = 1 and new.phone is not null
     and (tg_op = 'INSERT' or old.phone is null)
     and not exists (select 1 from sms_log where phone = new.phone and reason = 'welcome') then
    perform send_sms(new.phone, sms_fill(sms_tpl('sms_tpl_welcome'), jsonb_build_object(
      'name', split_part(coalesce(nullif(new.full_name, ''), 'friend'), ' ', 1),
      'link', 'yahyiam.mcadesk.org')), 'welcome');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists sms_on_welcome on profiles;
create trigger sms_on_welcome after insert or update of phone on profiles for each row execute function sms_on_welcome();

-- Who a greeting would go to (one text per phone number, only people who have not opted out)
create or replace function sms_audience(p_audience text, p_town int default null)
returns table (phone text, name text)
language sql stable security definer set search_path = public as $$
  with people as (
    select p.phone, p.full_name as name, p.id from profiles p
    where p.sms_news and p.phone ~ '^\+233[0-9]{9}$' and p_audience = 'all'
    union
    select l.phone, coalesce(p.full_name, l.business_name), p.id from listings l
    left join profiles p on p.id = l.owner_id
    where l.status = 'live' and l.phone ~ '^\+233[0-9]{9}$' and coalesce(p.sms_news, true)
      and p_audience in ('all', 'suppliers', 'town')
      and (p_audience <> 'town' or l.base_town_id = p_town)
  )
  select distinct on (phone) phone, name from people order by phone, name
$$;
revoke all on function sms_audience(text, int) from public, anon;

create or replace function sms_audience_count(p_audience text, p_town int default null) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then raise exception 'Admin only'; end if;
  return (select count(*) from sms_audience(p_audience, p_town));
end $$;
grant execute on function sms_audience_count(text, int) to authenticated;

-- Send a greeting to many people at once (admin only). {name} is filled in per person,
-- so with {name} each text is sent separately; without it they go in batches of 100.
create or replace function sms_broadcast(p_message text, p_audience text, p_town int default null, p_optout boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_key text; v_msg text; v_sent int := 0; v_failed int := 0; v_res record; v_batch text[]; r record; v_total int;
begin
  if my_role() <> 'admin' then raise exception 'Admin only'; end if;
  if length(btrim(coalesce(p_message, ''))) < 5 then raise exception 'Write a message first'; end if;
  if setting_num('sms_enabled', 0) <> 1 then raise exception 'Text messages are switched off'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sms_arkesel' limit 1;
  if v_key is null then raise exception 'The SMS key is missing'; end if;
  v_msg := btrim(p_message) || case when p_optout then ' ' || coalesce(sms_tpl('sms_optout_line'), '') else '' end;
  select count(*) into v_total from sms_audience(p_audience, p_town);
  if v_total = 0 then raise exception 'Nobody to send to'; end if;
  if v_total > 2000 then raise exception 'More than 2,000 people; contact support to send in parts'; end if;
  perform set_config('http.timeout_msec', '20000', true);

  if position('{name}' in v_msg) > 0 then
    for r in select * from sms_audience(p_audience, p_town) loop
      if send_sms(r.phone, sms_fill(v_msg, jsonb_build_object('name', split_part(coalesce(nullif(r.name, ''), 'friend'), ' ', 1))), 'greeting') = 'sent'
        then v_sent := v_sent + 1; else v_failed := v_failed + 1; end if;
    end loop;
  else
    for r in select array_agg(substr(phone, 2)) as nums, array_agg(phone) as phones
             from (select phone, (row_number() over (order by phone) - 1) / 100 as grp from sms_audience(p_audience, p_town)) x group by grp loop
      begin
        select status, content into v_res from extensions.http((
          'POST', 'https://sms.arkesel.com/api/v2/sms/send',
          array[extensions.http_header('api-key', btrim(v_key))], 'application/json',
          jsonb_build_object('sender', coalesce(sms_tpl('sms_sender'), 'YAHYIAM'), 'message', left(v_msg, 459),
                             'recipients', to_jsonb(r.nums))::text)::extensions.http_request);
        if v_res.status between 200 and 299 then v_sent := v_sent + cardinality(r.nums); else v_failed := v_failed + cardinality(r.nums); end if;
        insert into sms_log (phone, message, reason, status, detail)
          select ph, v_msg, 'greeting', case when v_res.status between 200 and 299 then 'sent' else 'failed' end, left(v_res.content, 300)
          from unnest(r.phones) ph;
      exception when others then
        v_failed := v_failed + cardinality(r.nums);
        insert into sms_log (phone, message, reason, status, detail) select ph, v_msg, 'greeting', 'failed', left(sqlerrm, 300) from unnest(r.phones) ph;
      end;
    end loop;
  end if;
  return jsonb_build_object('sent', v_sent, 'failed', v_failed);
end $$;
grant execute on function sms_broadcast(text, text, int, boolean) to authenticated;
