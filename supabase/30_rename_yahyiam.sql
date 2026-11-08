-- 30: the site is renamed YAHYIAM (another Ghana events platform already uses the name Nhyiamu).
-- Text messages now say YAHYIAM and link to yahyiam.mcadesk.org.
update app_settings set value = 'YAHYIAM' where key = 'sms_sender' and value = 'NHYIAMU';

create or replace function sms_on_quote() returns trigger
language plpgsql security definer set search_path = public as $$
declare l listings;
begin
  select * into l from listings where id = new.listing_id;
  perform send_sms(l.phone, 'YAHYIAM: ' || new.name || ' wants a quote'
    || coalesce(' for ' || new.event_type, '') || coalesce(' on ' || to_char(new.event_date, 'DD Mon'), '')
    || '. See it and reply: yahyiam.mcadesk.org/#/me/quotes', 'quote');
  return new;
exception when others then return new;
end $$;

create or replace function sms_on_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and old.status is distinct from 'live' then
    perform send_sms(new.phone, 'YAHYIAM: ' || left(new.business_name, 40)
      || ' is now live. Customers can find you at yahyiam.mcadesk.org/#/l/' || new.slug, 'listing_live');
  end if;
  return new;
exception when others then return new;
end $$;
