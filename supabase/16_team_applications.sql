-- NHYIAMU — "Join our team" applications (field agents, moderators, regional coordinators).
-- Priority for unemployed people. Every applicant needs EITHER a recommendation from their pastor
-- OR a parent/guardian who stands as guarantor. The regional coordinator checks and hires field agents and
-- moderators in their region; coordinator applications (and regions without a coordinator) go to the admin.

create table if not exists team_applications (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references profiles(id) on delete cascade,
  full_name             text not null check (char_length(full_name) between 3 and 80),
  phone                 text not null check (phone ~ '^\+233[0-9]{9}$'),
  town_id               int  not null references towns(id),
  role_wanted           text not null check (role_wanted in ('agent', 'moderator', 'coordinator')),
  work_status           text not null check (work_status in ('unemployed', 'student', 'part_time', 'employed')),
  education             text,
  has_smartphone        boolean not null default true,
  languages             text,
  motivation            text check (char_length(motivation) <= 600),
  endorsement_type      text not null check (endorsement_type in ('pastor', 'guarantor')),
  endorser_name         text not null check (char_length(endorser_name) between 3 and 80),
  endorser_phone        text not null check (endorser_phone ~ '^\+233[0-9]{9}$'),
  endorser_church       text,          -- pastor: church name and town
  endorser_relationship text,          -- guarantor: mother / father / guardian
  endorser_town         text,
  endorser_occupation   text,
  letter_path           text,          -- optional photo of the pastor's letter or signed guarantor form
  is_adult              boolean not null check (is_adult),
  consent               boolean not null check (consent),
  status                text not null default 'new' check (status in ('new', 'checking', 'accepted', 'declined')),
  staff_note            text,
  reviewed_by           uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (endorsement_type <> 'pastor' or endorser_church is not null),
  check (endorsement_type <> 'guarantor' or endorser_relationship is not null)
);
create index if not exists team_applications_status on team_applications(status, created_at);

alter table team_applications enable row level security;
grant select, insert, update on team_applications to authenticated;

drop policy if exists "apply as self" on team_applications;
create policy "apply as self" on team_applications for insert with check (user_id = auth.uid());

drop policy if exists "see own or staff" on team_applications;
create policy "see own or staff" on team_applications for select using (
  user_id = auth.uid() or my_role() = 'admin'
  or (role_wanted <> 'coordinator' and coord_town(town_id)));

drop policy if exists "edit own or staff" on team_applications;
create policy "edit own or staff" on team_applications for update using (
  user_id = auth.uid() or my_role() = 'admin'
  or (role_wanted <> 'coordinator' and coord_town(town_id)));

-- Applicants can edit their details until a decision; only staff change the status and notes.
create or replace function protect_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  staff boolean := my_role() = 'admin' or (old.role_wanted <> 'coordinator' and coord_town(old.town_id));
  r team_applications;
begin
  if staff and old.user_id <> auth.uid() then
    -- staff only decide; they don't rewrite the applicant's answers
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
drop trigger if exists protect_application on team_applications;
create trigger protect_application before update on team_applications for each row execute function protect_application();

-- Accept: marks the application accepted and gives the role.
--   agent      → field agent for the applicant's own town (more towns can be added after)
--   moderator  → moderator
--   coordinator→ regional coordinator for the applicant's region (admin only)
create or replace function accept_application(p_id uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a team_applications; r user_role; v_region smallint;
begin
  select * into a from team_applications where id = p_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not (my_role() = 'admin' or (a.role_wanted <> 'coordinator' and coord_town(a.town_id))) then raise exception 'Not allowed'; end if;
  if a.user_id = auth.uid() then raise exception 'You cannot accept your own application'; end if;
  select role into r from profiles where id = a.user_id;
  if r in ('admin', 'partner') then raise exception 'This account already has a staff role'; end if;
  if a.role_wanted = 'agent' then
    update profiles set role = 'agent' where id = a.user_id and role in ('host', 'supplier');
    insert into agent_towns (agent_id, town_id) values (a.user_id, a.town_id) on conflict do nothing;
  elsif a.role_wanted = 'moderator' then
    update profiles set role = 'moderator' where id = a.user_id;
  else
    select d.region_id into v_region from towns t join districts d on d.id = t.district_id where t.id = a.town_id;
    update profiles set role = 'coordinator' where id = a.user_id;
    insert into coordinator_regions (coordinator_id, region_id) values (a.user_id, v_region) on conflict do nothing;
  end if;
  update team_applications set status = 'accepted', staff_note = coalesce(p_note, staff_note), reviewed_by = auth.uid(), updated_at = now() where id = p_id;
  return case a.role_wanted when 'agent' then 'Accepted as a field agent for ' || (select name from towns where id = a.town_id) || '.'
    when 'moderator' then 'Accepted as a moderator.' else 'Accepted as regional coordinator.' end;
end $$;
grant execute on function accept_application(uuid, text) to authenticated;

-- Staff need the applicant's town names (towns are already public) — nothing else to grant.
