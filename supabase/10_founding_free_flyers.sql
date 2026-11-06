-- NHYIAMU — Founding suppliers' free Featured places also make their flyers free.
create or replace function has_paid_plan(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_user <> auth.uid() and not is_staff() then null else exists (
    select 1 from featured_slots f join listings l on l.id = f.listing_id
    where l.owner_id = p_user and current_date between f.starts_on and f.ends_on) end
$$;
