-- =====================================================================
-- Events Hub — database setup (part 1: tables, security, rules)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
-- =====================================================================

-- ---------- Types ----------------------------------------------------
create type user_role       as enum ('host','supplier','agent','moderator','partner','admin');
create type coverage_level  as enum ('town','district','region','nationwide');
create type listing_status  as enum ('draft','pending','live','rejected','suspended');
create type price_unit      as enum ('per_event','per_head','per_item','per_day','per_night','per_hour');
create type category_tier   as enum ('standard','premium');
create type report_status   as enum ('open','resolved','dismissed');
create type enquiry_status  as enum ('new','contacted','closed');
create type tap_kind        as enum ('view','whatsapp','call','share');

-- ---------- Places ---------------------------------------------------
create table regions (
  id    smallserial primary key,
  name  text not null unique,
  slug  text not null unique
);

create table districts (
  id         serial primary key,
  region_id  smallint not null references regions(id),
  name       text not null,
  slug       text not null unique
);

create table towns (
  id           serial primary key,
  district_id  int not null references districts(id),
  name         text not null,
  slug         text not null unique,
  lat          double precision,
  lng          double precision,
  active       boolean not null default true
);
create index on towns(district_id);

-- ---------- Categories -----------------------------------------------
create table categories (
  id         serial primary key,
  parent_id  int references categories(id),
  name       text not null,
  slug       text not null unique,
  tier       category_tier not null default 'standard',
  sort       int not null default 0,
  active     boolean not null default true
);

-- ---------- People ---------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  role        user_role not null default 'host',
  created_at  timestamptz not null default now()
);

-- Field agents are assigned to towns
create table agent_towns (
  agent_id  uuid references profiles(id) on delete cascade,
  town_id   int  references towns(id) on delete cascade,
  primary key (agent_id, town_id)
);

-- ---------- Listings -------------------------------------------------
create table listings (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references profiles(id),
  registered_by      uuid references profiles(id),          -- field agent who brought the supplier in
  business_name      text not null,
  slug               text not null unique,
  contact_name       text not null,
  phone              text not null check (phone ~ '^\+233[0-9]{9}$'),
  whatsapp           text not null check (whatsapp ~ '^\+233[0-9]{9}$'),
  base_town_id       int  not null references towns(id),
  landmark           text not null,
  lat                double precision,
  lng                double precision,
  coverage           coverage_level not null default 'town',
  description        text not null check (char_length(description) <= 500),
  price_min          numeric(10,2),
  price_max          numeric(10,2),
  price_unit         price_unit,
  negotiable         boolean not null default false,
  discounts          boolean not null default false,
  discount_note      text,
  working_days       text,
  years_in_business  smallint,
  socials            jsonb not null default '{}',           -- {facebook, instagram, tiktok}
  extra              jsonb not null default '{}',           -- category-specific fields
  status             listing_status not null default 'draft',
  reject_reason      text,
  verified           boolean not null default false,
  verified_by        uuid references profiles(id),
  verified_at        timestamptz,
  founding           boolean not null default false,        -- first 10 per town
  last_confirmed_at  timestamptz not null default now(),
  consent_given      boolean not null default false,        -- supplier agreed to be listed (agent registrations)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (price_min is null or price_max is null or price_min <= price_max)
);
create index on listings(base_town_id, status);
create index on listings(owner_id);
create index on listings(registered_by);

create table listing_categories (
  listing_id   uuid references listings(id) on delete cascade,
  category_id  int  references categories(id),
  primary key (listing_id, category_id)
);

create table listing_photos (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  path        text not null,                 -- path in the 'listing-photos' storage bucket
  sort        smallint not null default 0,
  created_at  timestamptz not null default now()
);
create index on listing_photos(listing_id);

-- At most 3 categories and 10 photos per listing
create function check_listing_limits() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'listing_categories' and
     (select count(*) from listing_categories where listing_id = new.listing_id) >= 3 then
    raise exception 'A listing can be in at most 3 categories';
  end if;
  if tg_table_name = 'listing_photos' and
     (select count(*) from listing_photos where listing_id = new.listing_id) >= 10 then
    raise exception 'A listing can have at most 10 photos';
  end if;
  return new;
end $$;
create trigger limit_categories before insert on listing_categories for each row execute function check_listing_limits();
create trigger limit_photos     before insert on listing_photos     for each row execute function check_listing_limits();

-- ---------- Reviews and reports --------------------------------------
create table reviews (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (char_length(comment) <= 500),
  event_type  text,
  event_month date,
  reply       text check (char_length(reply) <= 500),
  replied_at  timestamptz,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (listing_id, author_id)
);

create table reports (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid references listings(id) on delete cascade,
  review_id    uuid references reviews(id) on delete cascade,
  reporter_id  uuid not null references profiles(id) on delete cascade,
  reason       text not null check (reason in ('fake','wrong_number','closed','offensive','scam','other')),
  note         text,
  status       report_status not null default 'open',
  resolved_by  uuid references profiles(id),
  created_at   timestamptz not null default now(),
  check (listing_id is not null or review_id is not null)
);

-- ---------- Featured spots -------------------------------------------
create table featured_prices (
  tier    category_tier not null,
  months  smallint not null,
  amount  numeric(10,2) not null,
  primary key (tier, months)
);

create table featured_slots (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  category_id  int  not null references categories(id),
  town_id      int  not null references towns(id),
  months       smallint not null,
  amount       numeric(10,2) not null default 0,
  is_free      boolean not null default false,       -- founding supplier offer
  starts_on    date not null,
  ends_on      date not null,
  payment_ref  text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index on featured_slots(town_id, category_id, ends_on);

-- ---------- Event loans ----------------------------------------------
create table loan_partners (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references profiles(id),
  name        text not null,
  logo_path   text,
  phone       text,
  email       text,
  towns       text,                               -- branch towns, free text
  products    jsonb not null default '[]',        -- [{name, min, max, months, requirements}]
  active      boolean not null default true,
  brought_by  uuid references profiles(id),       -- agent who brought the partner in
  created_at  timestamptz not null default now()
);

create table loan_enquiries (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references loan_partners(id),
  name        text not null,
  phone       text not null,
  town_id     int references towns(id),
  event_type  text,
  event_date  date,
  amount      numeric(12,2),
  consent     boolean not null check (consent),
  status      enquiry_status not null default 'new',
  created_at  timestamptz not null default now()
);

-- ---------- Stats ----------------------------------------------------
create table listing_taps (
  id          bigserial primary key,
  listing_id  uuid not null references listings(id) on delete cascade,
  kind        tap_kind not null,
  created_at  timestamptz not null default now()
);
create index on listing_taps(listing_id, created_at);

create table search_misses (
  id           bigserial primary key,
  town_id      int references towns(id),
  category_id  int references categories(id),
  term         text,
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- Helper functions
-- =====================================================================
create function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'host'::user_role)
$$;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() in ('moderator','admin')
$$;

-- Create a profile automatically when someone signs in for the first time
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Keep updated_at fresh; stop non-staff from changing protected fields
create function protect_listing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if not is_staff() and coalesce(current_setting('eventshub.agent_verify', true), '') <> 'on' then
    new.verified      := old.verified;
    new.verified_by   := old.verified_by;
    new.verified_at   := old.verified_at;
    new.founding      := old.founding;
    new.registered_by := old.registered_by;
    new.owner_id      := old.owner_id;
    -- owners may only move their listing between draft and pending
    if new.status is distinct from old.status
       and not (new.status = 'pending' and old.status in ('draft','rejected','live'))
       and not (new.status = 'draft' and old.status = 'pending') then
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;
create trigger listing_guard before update on listings
  for each row execute function protect_listing();

-- Agents mark a visited listing as verified (separate, controlled path)
create function agent_verify(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_staff() or (my_role() = 'agent' and exists (
      select 1 from listings l join agent_towns a on a.town_id = l.base_town_id
      where l.id = p_listing and a.agent_id = auth.uid()))) then
    raise exception 'Not allowed';
  end if;
  perform set_config('eventshub.agent_verify', 'on', true);
  update listings set verified = true, verified_by = auth.uid(), verified_at = now()
  where id = p_listing;
  perform set_config('eventshub.agent_verify', 'off', true);
end $$;

-- Users becoming suppliers when they create their first listing
create function promote_to_supplier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set role = 'supplier' where id = new.owner_id and role = 'host';
  return new;
end $$;
create trigger listing_owner_role after insert on listings
  for each row execute function promote_to_supplier();

-- Auto-hide a listing with 3+ open reports from different people
create function auto_hide_reported() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.listing_id is not null and (
     select count(distinct reporter_id) from reports
     where listing_id = new.listing_id and status = 'open') >= 3 then
    update listings set status = 'suspended', reject_reason = 'Hidden pending review (3+ reports)'
    where id = new.listing_id and status = 'live';
  end if;
  return new;
end $$;
create trigger reports_auto_hide after insert on reports
  for each row execute function auto_hide_reported();

-- =====================================================================
-- Access: grants (tables are not exposed automatically) + row rules
-- =====================================================================
grant usage on schema public to anon, authenticated;

grant select on regions, districts, towns, categories, featured_prices to anon, authenticated;
grant select on listings, listing_categories, listing_photos, reviews, featured_slots, loan_partners to anon, authenticated;
grant insert on listing_taps, search_misses to anon, authenticated;
grant insert on loan_enquiries to anon, authenticated;
grant usage on sequence listing_taps_id_seq, search_misses_id_seq to anon, authenticated;

grant select, update on profiles to authenticated;
grant insert, update, delete on listings, listing_categories, listing_photos to authenticated;
grant insert, update, delete on reviews to authenticated;
grant select, insert, update on reports to authenticated;
grant select, update on loan_enquiries to authenticated;
grant select on listing_taps, search_misses to authenticated;
grant insert, update, delete on regions, districts, towns, categories, featured_prices,
                                featured_slots, loan_partners, agent_towns to authenticated;
grant select on agent_towns to authenticated;
grant execute on function agent_verify(uuid) to authenticated;

alter table regions            enable row level security;
alter table districts          enable row level security;
alter table towns              enable row level security;
alter table categories         enable row level security;
alter table profiles           enable row level security;
alter table agent_towns        enable row level security;
alter table listings           enable row level security;
alter table listing_categories enable row level security;
alter table listing_photos     enable row level security;
alter table reviews            enable row level security;
alter table reports            enable row level security;
alter table featured_prices    enable row level security;
alter table featured_slots     enable row level security;
alter table loan_partners      enable row level security;
alter table loan_enquiries     enable row level security;
alter table listing_taps       enable row level security;
alter table search_misses      enable row level security;

-- Reference data: everyone reads, admin writes
create policy "read" on regions         for select using (true);
create policy "read" on districts       for select using (true);
create policy "read" on towns           for select using (true);
create policy "read" on categories      for select using (true);
create policy "read" on featured_prices for select using (true);
create policy "admin write" on regions         for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "admin write" on districts       for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "admin write" on towns           for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "admin write" on categories      for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "admin write" on featured_prices for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Profiles: you see and edit your own; staff see all; only admin changes roles
create policy "own or staff read" on profiles for select using (id = auth.uid() or is_staff());
create policy "own update"        on profiles for update using (id = auth.uid() or my_role() = 'admin')
  with check (my_role() = 'admin' or role = my_role());

-- Agent towns: agents see their own, admin manages
create policy "read" on agent_towns for select using (agent_id = auth.uid() or is_staff());
create policy "admin write" on agent_towns for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Listings: public sees live ones; owners and the agent who registered see their own; staff see all
create policy "public read live" on listings for select using (
  status = 'live' or owner_id = auth.uid() or registered_by = auth.uid() or is_staff()
  or (my_role() = 'agent' and exists (select 1 from agent_towns a where a.agent_id = auth.uid() and a.town_id = base_town_id)));
create policy "create own" on listings for insert with check (
  owner_id = auth.uid() and status in ('draft','pending') and verified = false and founding = false
  and (registered_by is null or (registered_by = auth.uid() and my_role() = 'agent' and consent_given)));
create policy "edit own" on listings for update using (owner_id = auth.uid() or is_staff());
create policy "staff delete" on listings for delete using (is_staff() or (owner_id = auth.uid() and status = 'draft'));

-- Categories and photos of a listing follow the listing's rules
create policy "read" on listing_categories for select using (
  exists (select 1 from listings l where l.id = listing_id));
create policy "write own" on listing_categories for all using (
  is_staff() or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()))
  with check (is_staff() or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "read" on listing_photos for select using (
  exists (select 1 from listings l where l.id = listing_id));
create policy "write own" on listing_photos for all using (
  is_staff() or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()))
  with check (is_staff() or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));

-- Reviews: public reads visible ones; signed-in users write their own; listing owner replies
create policy "read visible" on reviews for select using (not hidden or author_id = auth.uid() or is_staff());
create policy "write own" on reviews for insert with check (
  author_id = auth.uid() and not exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "edit own or reply" on reviews for update using (
  author_id = auth.uid() or is_staff()
  or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "delete own" on reviews for delete using (author_id = auth.uid() or is_staff());

-- Reports: anyone signed in reports; staff handle
create policy "file report" on reports for insert with check (reporter_id = auth.uid());
create policy "staff read"  on reports for select using (is_staff() or reporter_id = auth.uid());
create policy "staff update" on reports for update using (is_staff());

-- Featured: everyone reads; admin manages
create policy "read" on featured_slots for select using (true);
create policy "admin write" on featured_slots for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Loan partners: everyone reads active; partner edits own page; admin manages
create policy "read" on loan_partners for select using (active or owner_id = auth.uid() or is_staff());
create policy "partner edit" on loan_partners for update using (owner_id = auth.uid() or my_role() = 'admin');
create policy "admin insert" on loan_partners for insert with check (my_role() = 'admin');
create policy "admin delete" on loan_partners for delete using (my_role() = 'admin');

-- Loan enquiries: anyone sends; only that partner and admin read
create policy "send" on loan_enquiries for insert with check (consent);
create policy "partner read" on loan_enquiries for select using (
  my_role() = 'admin' or exists (select 1 from loan_partners p where p.id = partner_id and p.owner_id = auth.uid()));
create policy "partner update" on loan_enquiries for update using (
  my_role() = 'admin' or exists (select 1 from loan_partners p where p.id = partner_id and p.owner_id = auth.uid()));

-- Taps and search misses: anyone records; owners see their own listing stats; staff see all
create policy "record" on listing_taps for insert with check (true);
create policy "owner read" on listing_taps for select using (
  is_staff() or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "record" on search_misses for insert with check (true);
create policy "staff read" on search_misses for select using (is_staff());

-- =====================================================================
-- Photo storage bucket (public read, owners upload into their own folder)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 1048576, array['image/jpeg','image/webp','image/png']);

create policy "photos public read" on storage.objects for select
  using (bucket_id = 'listing-photos');
create policy "photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and ((storage.foldername(name))[1] = auth.uid()::text or is_staff()));
