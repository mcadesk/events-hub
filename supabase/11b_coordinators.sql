-- NHYIAMU — step 2 of 2: Regional coordinators recruit agents, assign towns, see their region's tally,
-- handle reports, verify listings and manage towns — only inside the region(s) the admin gives them.

create table if not exists coordinator_regions (
  coordinator_id uuid references profiles(id) on delete cascade,
  region_id      smallint references regions(id) on delete cascade,
  primary key (coordinator_id, region_id)
);
alter table coordinator_regions enable row level security;
grant select on coordinator_regions to authenticated;
grant insert, delete on coordinator_regions to authenticated;
drop policy if exists "read" on coordinator_regions;
drop policy if exists "admin write" on coordinator_regions;
create policy "read" on coordinator_regions for select using (coordinator_id = auth.uid() or is_staff());
create policy "admin write" on coordinator_regions for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Helpers: is the signed-in user the coordinator for this town / region?
create or replace function coord_region(p_region int) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'coordinator' and exists (select 1 from coordinator_regions where coordinator_id = auth.uid() and region_id = p_region)
$$;
create or replace function coord_town(p_town int) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'coordinator' and exists (
    select 1 from towns t join districts d on d.id = t.district_id
    join coordinator_regions c on c.region_id = d.region_id and c.coordinator_id = auth.uid()
    where t.id = p_town)
$$;
create or replace function coord_district(p_district int) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'coordinator' and exists (
    select 1 from districts d join coordinator_regions c on c.region_id = d.region_id and c.coordinator_id = auth.uid()
    where d.id = p_district)
$$;

-- Profiles: coordinators can look up non-staff members (to recruit agents)
drop policy if exists "coordinator read" on profiles;
create policy "coordinator read" on profiles for select using (my_role() = 'coordinator' and role in ('host', 'supplier', 'agent'));

-- Make someone an agent (or back to a member) — coordinators can only do this for non-staff accounts
create or replace function coordinator_set_agent(p_user uuid, p_agent boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r user_role;
begin
  if my_role() not in ('coordinator', 'admin') then raise exception 'Not allowed'; end if;
  select role into r from profiles where id = p_user;
  if r not in ('host', 'supplier', 'agent') then raise exception 'Only members and suppliers can be made agents here'; end if;
  if p_agent then
    update profiles set role = 'agent' where id = p_user;
  else
    update profiles set role = case when exists (select 1 from listings where owner_id = p_user) then 'supplier'::user_role else 'host'::user_role end where id = p_user;
    delete from agent_towns a where a.agent_id = p_user and (my_role() = 'admin' or coord_town(a.town_id));
  end if;
end $$;

-- Agent towns: coordinators manage assignments for towns in their region
drop policy if exists "coordinator read" on agent_towns;
drop policy if exists "coordinator write" on agent_towns;
create policy "coordinator read" on agent_towns for select using (coord_town(town_id));
create policy "coordinator write" on agent_towns for all using (coord_town(town_id))
  with check (coord_town(town_id) and exists (select 1 from profiles p where p.id = agent_id and p.role = 'agent'));

-- Towns: coordinators add towns and show/hide towns in their region
drop policy if exists "coordinator write" on towns;
drop policy if exists "coordinator update" on towns;
create policy "coordinator write" on towns for insert with check (coord_district(district_id));
create policy "coordinator update" on towns for update using (coord_district(district_id)) with check (coord_district(district_id));

-- Listings: coordinators see listings in their region
drop policy if exists "coordinator read" on listings;
drop policy if exists "coordinator update" on listings;
create policy "coordinator read" on listings for select using (coord_town(base_town_id));
create policy "coordinator update" on listings for update using (coord_town(base_town_id));

-- Listing guard: coordinators may only suspend / restore (live <-> suspended) in their region
create or replace function protect_listing() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status listing_status;
begin
  new.updated_at := now();
  if not is_staff() and coalesce(current_setting('eventshub.agent_verify', true), '') <> 'on' then
    if my_role() = 'coordinator' and coord_town(old.base_town_id) and old.owner_id <> auth.uid() then
      -- coordinator on someone else's listing: only live <-> suspended may change
      v_status := case when old.status in ('live', 'suspended') and new.status in ('live', 'suspended') then new.status else old.status end;
      new := old;
      new.status := v_status;
      new.updated_at := now();
      return new;
    end if;
    new.verified      := old.verified;
    new.verified_by   := old.verified_by;
    new.verified_at   := old.verified_at;
    new.founding      := old.founding;
    new.registered_by := old.registered_by;
    new.owner_id      := old.owner_id;
    if new.status is distinct from old.status
       and not (new.status = 'pending' and old.status in ('draft','rejected','live'))
       and not (new.status = 'draft' and old.status = 'pending') then
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;

-- Verify: coordinators can verify listings in their region
create or replace function agent_verify(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_staff()
          or (my_role() = 'agent' and exists (select 1 from listings l join agent_towns a on a.town_id = l.base_town_id where l.id = p_listing and a.agent_id = auth.uid()))
          or exists (select 1 from listings l where l.id = p_listing and coord_town(l.base_town_id))) then
    raise exception 'Not allowed';
  end if;
  perform set_config('eventshub.agent_verify', 'on', true);
  update listings set verified = true, verified_by = auth.uid(), verified_at = now() where id = p_listing;
  perform set_config('eventshub.agent_verify', 'off', true);
end $$;

-- Reports: coordinators handle reports about listings in their region
drop policy if exists "coordinator read" on reports;
drop policy if exists "coordinator update" on reports;
create policy "coordinator read" on reports for select using (
  exists (select 1 from listings l where l.id = listing_id and coord_town(l.base_town_id)));
create policy "coordinator update" on reports for update using (
  exists (select 1 from listings l where l.id = listing_id and coord_town(l.base_town_id)));

-- Tally: coordinators see agents working in their region
create or replace function agent_stats(p_from date, p_to date)
returns table (agent_id uuid, agent_name text, agent_email text, registered bigint, verified bigint, live bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email,
    (select count(*) from listings l where l.registered_by = p.id and l.created_at::date between p_from and p_to),
    (select count(*) from listings l where l.verified_by = p.id and l.verified_at::date between p_from and p_to),
    (select count(*) from listings l where l.registered_by = p.id and l.status = 'live')
  from profiles p
  where p.role = 'agent' and (my_role() = 'admin' or p.id = auth.uid()
        or exists (select 1 from agent_towns a where a.agent_id = p.id and coord_town(a.town_id)))
  order by p.full_name
$$;

grant execute on function coord_region(int), coord_town(int), coord_district(int), coordinator_set_agent(uuid, boolean) to authenticated;
