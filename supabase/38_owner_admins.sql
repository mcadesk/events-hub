-- 38: Only the owner can make or remove admins.
-- The owner is the main MEYE CATHOLIC ASOREBA account (setting owner_id). Other admins can do everything else,
-- but cannot give anyone the admin role, take it away, or change the owner's role.
-- Changes made directly in the Supabase dashboard (no signed-in user) are not blocked, so the owner can always recover.

insert into app_settings (key, value)
select 'owner_id', coalesce(
  (select id::text from profiles where role = 'admin' and lower(email) = 'meyecatholicasoreba@gmail.com' limit 1),
  (select id::text from profiles where role = 'admin' order by created_at limit 1))
where not exists (select 1 from app_settings where key = 'owner_id');

create or replace function protect_admin_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := nullif((select value from app_settings where key = 'owner_id'), '')::uuid;
begin
  if new.role is distinct from old.role
     and (old.role = 'admin' or new.role = 'admin' or old.id = v_owner)
     and auth.uid() is not null
     and auth.uid() is distinct from v_owner then
    raise exception 'Only the owner can make or remove admins.';
  end if;
  return new;
end $$;

drop trigger if exists protect_admin_role on profiles;
create trigger protect_admin_role before update of role on profiles
  for each row execute function protect_admin_role();

-- Nobody but the owner (or the dashboard) can change who the owner is
create or replace function protect_owner_setting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (coalesce(new.key, old.key)) = 'owner_id' and auth.uid() is not null
     and auth.uid()::text is distinct from (select value from app_settings where key = 'owner_id') then
    raise exception 'Only the owner can change this.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists protect_owner_setting on app_settings;
create trigger protect_owner_setting before insert or update or delete on app_settings
  for each row execute function protect_owner_setting();

-- Let the site know who the owner is (to show the right message)
create or replace function am_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid()::text = (select value from app_settings where key = 'owner_id')
$$;
grant execute on function am_owner() to authenticated;

select p.full_name, p.email from profiles p where p.id::text = (select value from app_settings where key = 'owner_id');
