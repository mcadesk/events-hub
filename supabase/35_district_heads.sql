-- 35: District heads.
-- A district head is a coordinator for one district (municipality) instead of a whole region. They do the
-- same work as a regional coordinator, only inside their district: recruit agents, assign towns, check new
-- listings, handle reports, manage towns, accept agent applications.
-- The regional coordinator supervises them and appoints or removes them (the admin can too).
-- Pay: the coordinator share stays 15% of each district's income. Where a district has a head, the head gets
-- 10% and the regional coordinator 5%; where it has none, the regional coordinator keeps the full 15%.

insert into app_settings (key, value) values ('district_head_rate', '10') on conflict (key) do nothing;

create table if not exists coordinator_districts (
  coordinator_id uuid references profiles(id) on delete cascade,
  district_id    int references districts(id) on delete cascade,
  primary key (coordinator_id, district_id)
);
alter table coordinator_districts enable row level security;
grant select, insert, delete on coordinator_districts to authenticated;
drop policy if exists "read" on coordinator_districts;
drop policy if exists "admin write" on coordinator_districts;
create policy "read" on coordinator_districts for select using (
  coordinator_id = auth.uid() or is_staff()
  or coord_region((select region_id from districts d where d.id = district_id)));
create policy "admin write" on coordinator_districts for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Region of a town (helper)
create or replace function town_region(p_town int) returns smallint
language sql stable security definer set search_path = public as $$
  select d.region_id from towns t join districts d on d.id = t.district_id where t.id = p_town
$$;

-- Town / district checks now also cover district heads (coord_region stays regional only)
create or replace function coord_town(p_town int) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'coordinator' and exists (
    select 1 from towns t join districts d on d.id = t.district_id
    where t.id = p_town and (
      exists (select 1 from coordinator_regions c where c.region_id = d.region_id and c.coordinator_id = auth.uid())
      or exists (select 1 from coordinator_districts c where c.district_id = d.id and c.coordinator_id = auth.uid())))
$$;
create or replace function coord_district(p_district int) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'coordinator' and exists (
    select 1 from districts d
    where d.id = p_district and (
      exists (select 1 from coordinator_regions c where c.region_id = d.region_id and c.coordinator_id = auth.uid())
      or exists (select 1 from coordinator_districts c where c.district_id = d.id and c.coordinator_id = auth.uid())))
$$;

-- Appoint / remove a district head (regional coordinator of that region, or admin)
create or replace function appoint_district_head(p_user uuid, p_district int) returns text
language plpgsql security definer set search_path = public as $$
declare v_region smallint; v_role user_role; v_name text;
begin
  select region_id, name into v_region, v_name from districts where id = p_district;
  if v_region is null then raise exception 'District not found'; end if;
  if not (my_role() = 'admin' or coord_region(v_region)) then raise exception 'Only the regional coordinator or the admin can appoint a district head'; end if;
  if p_user = auth.uid() and my_role() <> 'admin' then raise exception 'You cannot appoint yourself'; end if;
  select role into v_role from profiles where id = p_user;
  if v_role is null then raise exception 'Person not found'; end if;
  if v_role in ('admin', 'partner', 'moderator') then raise exception 'This account already has another staff role'; end if;
  if v_role = 'coordinator' and exists (select 1 from coordinator_regions where coordinator_id = p_user) then
    raise exception 'This person is already a regional coordinator';
  end if;
  update profiles set role = 'coordinator' where id = p_user;
  insert into coordinator_districts (coordinator_id, district_id) values (p_user, p_district) on conflict do nothing;
  return 'Now district head for ' || v_name || '.';
end $$;

create or replace function remove_district_head(p_user uuid, p_district int) returns void
language plpgsql security definer set search_path = public as $$
declare v_region smallint;
begin
  select region_id into v_region from districts where id = p_district;
  if not (my_role() = 'admin' or coord_region(v_region)) then raise exception 'Not allowed'; end if;
  delete from coordinator_districts where coordinator_id = p_user and district_id = p_district;
  if not exists (select 1 from coordinator_districts where coordinator_id = p_user)
     and not exists (select 1 from coordinator_regions where coordinator_id = p_user) then
    update profiles set role = case when exists (select 1 from agent_towns where agent_id = p_user) then 'agent'::user_role else 'host'::user_role end
    where id = p_user and role = 'coordinator';
  end if;
end $$;

-- District heads in the caller's region(s) (all for the admin), with districts that have none
create or replace function my_district_heads()
returns table (district_id int, district_name text, region_name text, person_id uuid, full_name text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, r.name, p.id, p.full_name, p.email, p.phone
  from districts d join regions r on r.id = d.region_id
  left join coordinator_districts cd on cd.district_id = d.id
  left join profiles p on p.id = cd.coordinator_id
  where my_role() = 'admin' or coord_region(d.region_id)
  order by r.name, d.name, p.full_name
$$;

revoke all on function appoint_district_head(uuid, int), remove_district_head(uuid, int), my_district_heads(), town_region(int) from public, anon;
grant execute on function appoint_district_head(uuid, int), remove_district_head(uuid, int), my_district_heads(), town_region(int) to authenticated;

-- Applications: people can apply to be a district head; the regional coordinator (or admin) decides.
-- Agent and moderator applications go to whoever covers the town (district head or regional coordinator).
alter table team_applications drop constraint if exists team_applications_role_wanted_check;
alter table team_applications add constraint team_applications_role_wanted_check
  check (role_wanted in ('agent', 'moderator', 'coordinator', 'district_head'));

create or replace function app_staff(p_role text, p_town int) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin'
    or (p_role in ('agent', 'moderator') and coord_town(p_town))
    or (p_role = 'district_head' and coord_region(town_region(p_town)))
$$;
grant execute on function app_staff(text, int) to authenticated;

drop policy if exists "see own or staff" on team_applications;
create policy "see own or staff" on team_applications for select using (user_id = auth.uid() or app_staff(role_wanted, town_id));
drop policy if exists "edit own or staff" on team_applications;
create policy "edit own or staff" on team_applications for update using (user_id = auth.uid() or app_staff(role_wanted, town_id));

create or replace function protect_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  staff boolean := app_staff(old.role_wanted, old.town_id);
  r team_applications;
begin
  if staff and old.user_id <> auth.uid() then
    r := old;
    r.status := new.status; r.staff_note := new.staff_note;
    r.reviewed_by := auth.uid(); r.updated_at := now();
    return r;
  end if;
  new.updated_at := now();
  new.user_id := old.user_id;
  if old.status in ('accepted', 'declined') then raise exception 'This application has already been decided.'; end if;
  new.status := old.status; new.staff_note := old.staff_note; new.reviewed_by := old.reviewed_by;
  return new;
end $$;

create or replace function accept_application(p_id uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a team_applications; r user_role; v_region smallint; v_district int; v_msg text;
begin
  select * into a from team_applications where id = p_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not app_staff(a.role_wanted, a.town_id) then raise exception 'Not allowed'; end if;
  if a.user_id = auth.uid() then raise exception 'You cannot accept your own application'; end if;
  select role into r from profiles where id = a.user_id;
  if r in ('admin', 'partner') then raise exception 'This account already has a staff role'; end if;
  if a.role_wanted = 'agent' then
    update profiles set role = 'agent' where id = a.user_id and role in ('host', 'supplier');
    insert into agent_towns (agent_id, town_id) values (a.user_id, a.town_id) on conflict do nothing;
    v_msg := 'Accepted as a field agent for ' || (select name from towns where id = a.town_id) || '.';
  elsif a.role_wanted = 'moderator' then
    update profiles set role = 'moderator' where id = a.user_id;
    v_msg := 'Accepted as a moderator.';
  elsif a.role_wanted = 'district_head' then
    select district_id into v_district from towns where id = a.town_id;
    v_msg := appoint_district_head(a.user_id, v_district);
    v_msg := 'Accepted. ' || v_msg;
  else
    v_region := town_region(a.town_id);
    update profiles set role = 'coordinator' where id = a.user_id;
    insert into coordinator_regions (coordinator_id, region_id) values (a.user_id, v_region) on conflict do nothing;
    v_msg := 'Accepted as regional coordinator.';
  end if;
  update team_applications set status = 'accepted', staff_note = coalesce(p_note, staff_note), reviewed_by = auth.uid(), updated_at = now() where id = p_id;
  return v_msg;
end $$;
grant execute on function accept_application(uuid, text) to authenticated;

-- Coordinator pay, worked out per district.
-- One row per person per area: a district head gets a row for their district; a regional coordinator one
-- row for their region (all its districts added up). The admin also sees regions with income but no coordinator.
drop function if exists coordinator_earnings(date, date);
create function coordinator_earnings(p_from date, p_to date)
returns table (region_id smallint, region_name text, level text, coordinator_id uuid, coordinator_name text, coordinator_email text,
               place_income numeric, flyer_income numeric, total_income numeric, earnings numeric,
               self_registered bigint, agents_registered bigint)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.id as district_id, d.name as district_name, d.region_id, r.name as region_name,
      (select count(*) from coordinator_districts cd where cd.district_id = d.id) as n_heads,
      (select count(*) from coordinator_regions cr where cr.region_id = d.region_id) as n_reg
    from districts d join regions r on r.id = d.region_id
  ),
  people as (   -- who is paid from which district, and at what rate
    select d.*, cd.coordinator_id, 'district'::text as level,
      setting_num('district_head_rate', 10) / greatest(d.n_heads, 1) as rate
    from d join coordinator_districts cd on cd.district_id = d.district_id
    union all
    select d.*, cr.coordinator_id, 'region',
      (case when d.n_heads > 0 then greatest(setting_num('coordinator_rate', 15) - setting_num('district_head_rate', 10), 0)
            else setting_num('coordinator_rate', 15) end) / greatest(d.n_reg, 1)
    from d join coordinator_regions cr on cr.region_id = d.region_id
    union all
    select d.*, null::uuid, 'region', 0 from d where d.n_reg = 0
  ),
  lines as (
    select p.*,
      coalesce((select sum(e.amount) from place_income_events e
                join listings l on l.id = e.listing_id join towns t on t.id = l.base_town_id
                where t.district_id = p.district_id and e.at::date between p_from and p_to
                  and l.registered_by is distinct from p.coordinator_id), 0) as place_inc,
      coalesce((select sum(fl.amount) from flyers fl join towns t on t.id = fl.town_id
                where t.district_id = p.district_id and fl.status = 'approved' and fl.starts_on between p_from and p_to), 0) as flyer_inc,
      (select count(*) from listings l join towns t on t.id = l.base_town_id
        where t.district_id = p.district_id and l.status = 'live' and p.coordinator_id is not null and l.registered_by = p.coordinator_id) as self_reg,
      (select count(*) from listings l join towns t on t.id = l.base_town_id join profiles ap on ap.id = l.registered_by
        where t.district_id = p.district_id and l.status = 'live' and ap.role = 'agent') as agents_reg
    from people p
  ),
  grouped as (
    select l.region_id, case when l.level = 'district' then l.district_name else l.region_name end as area, l.level, l.coordinator_id,
      sum(l.place_inc) as place_income, sum(l.flyer_inc) as flyer_income,
      round(sum((l.place_inc + l.flyer_inc) * l.rate / 100), 2) as earnings,
      sum(l.self_reg) as self_registered, sum(l.agents_reg) as agents_registered
    from lines l
    group by l.region_id, case when l.level = 'district' then l.district_name else l.region_name end, l.level, l.coordinator_id
  )
  select g.region_id, g.area, g.level, g.coordinator_id, p.full_name, p.email,
         g.place_income, g.flyer_income, g.place_income + g.flyer_income,
         case when g.coordinator_id is null then 0 else g.earnings end,
         g.self_registered::bigint, g.agents_registered::bigint
  from grouped g left join profiles p on p.id = g.coordinator_id
  where (my_role() = 'admin' and (g.coordinator_id is not null or g.place_income + g.flyer_income > 0))
     or g.coordinator_id = auth.uid()
  order by g.place_income + g.flyer_income desc, g.area
$$;
grant execute on function coordinator_earnings(date, date) to authenticated;
