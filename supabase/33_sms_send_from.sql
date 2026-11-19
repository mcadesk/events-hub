-- 33: "Send from" for greetings and appeals.
-- Alerts (quotes, live listings, welcome) always go from the main sender (sms_sender = YAHYIAM).
-- Broadcasts can go from any name listed in sms_senders, e.g. MCASOREBA for the mission's
-- festive greetings and donation appeals, so YAHYIAM stays an alerts-only name.

insert into app_settings (key, value) values ('sms_senders', 'YAHYIAM,MCASOREBA')
on conflict (key) do nothing;

alter table sms_log add column if not exists sender text;

drop function if exists send_sms(text, text, text);
create or replace function send_sms(p_phone text, p_message text, p_reason text, p_sender text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_key text; v_status text; v_detail text; v_res record; v_sender text;
begin
  if p_phone is null or p_phone !~ '^\+233[0-9]{9}$' then return 'bad_phone'; end if;
  v_sender := coalesce(nullif(btrim(p_sender), ''), (select value from app_settings where key = 'sms_sender'), 'YAHYIAM');
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
          array[extensions.http_header('api-key', btrim(v_key))], 'application/json',
          jsonb_build_object('sender', v_sender,
                             'message', left(p_message, 459),
                             'recipients', jsonb_build_array(substr(p_phone, 2)))::text)::extensions.http_request);
        v_status := case when v_res.status between 200 and 299 then 'sent' else 'failed' end;
        v_detail := left(v_res.content, 300);
      exception when others then
        v_status := 'failed'; v_detail := left(sqlerrm, 300);
      end;
    end if;
  end if;
  insert into sms_log (phone, message, reason, status, detail, sender) values (p_phone, p_message, p_reason, v_status, v_detail, v_sender);
  return v_status;
end $$;
revoke all on function send_sms(text, text, text, text) from public, anon, authenticated;

drop function if exists sms_broadcast(text, text, int, boolean);
create or replace function sms_broadcast(p_message text, p_audience text, p_town int default null, p_optout boolean default true, p_sender text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_key text; v_msg text; v_sent int := 0; v_failed int := 0; v_res record; r record; v_total int; v_sender text;
begin
  if my_role() <> 'admin' then raise exception 'Admin only'; end if;
  if length(btrim(coalesce(p_message, ''))) < 5 then raise exception 'Write a message first'; end if;
  if setting_num('sms_enabled', 0) <> 1 then raise exception 'Text messages are switched off'; end if;
  v_sender := coalesce(nullif(btrim(p_sender), ''), sms_tpl('sms_sender'), 'YAHYIAM');
  if v_sender <> coalesce(sms_tpl('sms_sender'), 'YAHYIAM')
     and not (v_sender = any (string_to_array(replace(coalesce(sms_tpl('sms_senders'), ''), ' ', ''), ','))) then
    raise exception 'That sender name is not on the list';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sms_arkesel' limit 1;
  if v_key is null then raise exception 'The SMS key is missing'; end if;
  v_msg := btrim(p_message) || case when p_optout then ' ' || coalesce(sms_tpl('sms_optout_line'), '') else '' end;
  select count(*) into v_total from sms_audience(p_audience, p_town);
  if v_total = 0 then raise exception 'Nobody to send to'; end if;
  if v_total > 2000 then raise exception 'More than 2,000 people; contact support to send in parts'; end if;
  perform set_config('http.timeout_msec', '20000', true);

  if position('{name}' in v_msg) > 0 then
    for r in select * from sms_audience(p_audience, p_town) loop
      if send_sms(r.phone, sms_fill(v_msg, jsonb_build_object('name', split_part(coalesce(nullif(r.name, ''), 'friend'), ' ', 1))), 'greeting', v_sender) = 'sent'
        then v_sent := v_sent + 1; else v_failed := v_failed + 1; end if;
    end loop;
  else
    for r in select array_agg(substr(phone, 2)) as nums, array_agg(phone) as phones
             from (select phone, (row_number() over (order by phone) - 1) / 100 as grp from sms_audience(p_audience, p_town)) x group by grp loop
      begin
        select status, content into v_res from extensions.http((
          'POST', 'https://sms.arkesel.com/api/v2/sms/send',
          array[extensions.http_header('api-key', btrim(v_key))], 'application/json',
          jsonb_build_object('sender', v_sender, 'message', left(v_msg, 459),
                             'recipients', to_jsonb(r.nums))::text)::extensions.http_request);
        if v_res.status between 200 and 299 then v_sent := v_sent + cardinality(r.nums); else v_failed := v_failed + cardinality(r.nums); end if;
        insert into sms_log (phone, message, reason, status, detail, sender)
          select ph, v_msg, 'greeting', case when v_res.status between 200 and 299 then 'sent' else 'failed' end, left(v_res.content, 300), v_sender
          from unnest(r.phones) ph;
      exception when others then
        v_failed := v_failed + cardinality(r.nums);
        insert into sms_log (phone, message, reason, status, detail, sender) select ph, v_msg, 'greeting', 'failed', left(sqlerrm, 300), v_sender from unnest(r.phones) ph;
      end;
    end loop;
  end if;
  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'sender', v_sender);
end $$;
grant execute on function sms_broadcast(text, text, int, boolean, text) to authenticated;
