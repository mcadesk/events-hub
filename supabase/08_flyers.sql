-- NHYIAMU — event flyers: one-week paid adverts for programmes, shown in the town and its municipality.

-- Admin-editable settings (flyer price, MoMo details for payment)
create table if not exists app_settings (
  key    text primary key,
  value  text not null
);
insert into app_settings (key, value) values
  ('flyer_price', '25'),
  ('momo_number', ''),
  ('momo_name', '')
on conflict (key) do nothing;
alter table app_settings enable row level security;
grant select on app_settings to anon, authenticated;
grant insert, update on app_settings to authenticated;
drop policy if exists "read" on app_settings;
drop policy if exists "admin write" on app_settings;
create policy "read" on app_settings for select using (true);
create policy "admin write" on app_settings for all using (my_role() = 'admin') with check (my_role() = 'admin');

create table if not exists flyers (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles(id) on delete cascade,
  town_id        int  not null references towns(id),
  title          text not null check (char_length(title) <= 90),
  event_date     date not null,
  event_time     text,
  venue_name     text not null,
  landmark       text not null,
  map_link       text,
  description    text check (char_length(description) <= 400),
  contact_phone  text not null check (contact_phone ~ '^\+233[0-9]{9}$'),
  image_path     text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason  text,
  starts_on      date,
  ends_on        date,
  amount         numeric(10,2),
  payment_ref    text,
  approved_by    uuid references profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists flyers_town_idx on flyers(town_id, status, ends_on);

alter table flyers enable row level security;
grant select on flyers to anon, authenticated;
grant insert, update, delete on flyers to authenticated;

drop policy if exists "public read live" on flyers;
drop policy if exists "post own" on flyers;
drop policy if exists "edit own pending" on flyers;
drop policy if exists "delete own" on flyers;
create policy "public read live" on flyers for select using (
  (status = 'approved' and current_date between starts_on and ends_on and event_date >= current_date)
  or owner_id = auth.uid() or is_staff());
create policy "post own" on flyers for insert with check (owner_id = auth.uid() and status = 'pending' and starts_on is null);
create policy "edit own pending" on flyers for update using ((owner_id = auth.uid() and status in ('pending', 'rejected')) or is_staff());
create policy "delete own" on flyers for delete using (owner_id = auth.uid() or is_staff());

-- Owners can't approve themselves or change payment fields
create or replace function protect_flyer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then
    new.status := case when old.status = 'rejected' then 'pending' else old.status end;
    new.starts_on := old.starts_on; new.ends_on := old.ends_on;
    new.amount := old.amount; new.payment_ref := old.payment_ref; new.approved_by := old.approved_by;
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
drop trigger if exists flyer_guard on flyers;
create trigger flyer_guard before update on flyers for each row execute function protect_flyer();

-- Moderator approves after confirming payment: runs 7 days from today
create or replace function approve_flyer(p_id uuid, p_amount numeric, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update flyers set status = 'approved', reject_reason = null, starts_on = current_date,
    ends_on = current_date + 6, amount = p_amount, payment_ref = p_ref, approved_by = auth.uid()
  where id = p_id;
end $$;

create or replace function reject_flyer(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update flyers set status = 'rejected', reject_reason = p_reason where id = p_id;
end $$;

-- Live flyers for a town and the other towns in its municipality, soonest event first
create or replace function town_flyers(p_town int)
returns table (id uuid, title text, event_date date, event_time text, venue_name text, image_path text, town_name text)
language sql stable security invoker set search_path = public as $$
  select f.id, f.title, f.event_date, f.event_time, f.venue_name, f.image_path, t.name
  from flyers f join towns t on t.id = f.town_id
  where f.status = 'approved' and current_date between f.starts_on and f.ends_on and f.event_date >= current_date
    and t.district_id = (select district_id from towns where id = p_town)
  order by (f.town_id = p_town) desc, f.event_date, f.created_at
  limit 12
$$;

grant execute on function approve_flyer(uuid, numeric, text), reject_flyer(uuid, text) to authenticated;
grant execute on function town_flyers(int) to anon, authenticated;
