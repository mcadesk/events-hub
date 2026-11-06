-- NHYIAMU — flyers cost GH₵ 20 a week, and are free for accounts with an active PAID Top spot or Featured plan
-- (free Founding-supplier places don't count as paid).
update app_settings set value = '20' where key = 'flyer_price';

create or replace function has_paid_plan(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_user <> auth.uid() and not is_staff() then null else exists (
    select 1 from featured_slots f join listings l on l.id = f.listing_id
    where l.owner_id = p_user and not f.is_free and current_date between f.starts_on and f.ends_on) end
$$;
grant execute on function has_paid_plan(uuid) to authenticated;
