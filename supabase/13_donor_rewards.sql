-- NHYIAMU — donor rewards
--   GH₵ 50+ donated in the last 12 months  → "Supporter": badge, ranked right after paid places, recommended on town pages
--   GH₵ 100+ donated in the last 12 months → also posts event flyers free
-- Donations are recorded by the admin after the MoMo payment is received. Amounts stay private; only the badge is public.

insert into app_settings (key, value) values ('supporter_min', '50'), ('donor_flyer_min', '100')
on conflict (key) do nothing;

create table if not exists donations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0),
  donated_on  date not null default current_date,
  payment_ref text,
  note        text,
  recorded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists donations_user on donations(user_id, donated_on);
alter table donations enable row level security;
drop policy if exists "admin manages donations" on donations;
create policy "admin manages donations" on donations for all using (my_role() = 'admin') with check (my_role() = 'admin');
drop policy if exists "donor reads own" on donations;
create policy "donor reads own" on donations for select using (user_id = auth.uid());

create or replace function setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value, '')::numeric from app_settings where key = p_key), p_default)
$$;

-- Date until which a donor keeps a level: the newest donations that add up to the threshold, oldest of them + 1 year
create or replace function donor_until(p_user uuid, p_min numeric) returns date
language sql stable security definer set search_path = public as $$
  select case when sum(amount) >= p_min then (
    select (min(donated_on) + 365) from (
      select donated_on, amount, sum(amount) over (order by donated_on desc, created_at desc) as cum
      from donations where user_id = p_user and donated_on > current_date - 365) x
    where x.cum - x.amount < p_min) end
  from donations where user_id = p_user and donated_on > current_date - 365
$$;

-- Public yes/no (no amounts): is this account a Supporter right now?
create or replace function is_supporter(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from donations where user_id = p_user and donated_on > current_date - 365), 0)
         >= setting_num('supporter_min', 50)
$$;
grant execute on function is_supporter(uuid) to anon, authenticated;

-- For the donor's own dashboard (or staff)
create or replace function my_donor_status(p_user uuid default null)
returns table (total_12m numeric, supporter_until date, free_flyers_until date, supporter_min numeric, flyer_min numeric)
language sql stable security definer set search_path = public as $$
  with u as (select coalesce(p_user, auth.uid()) as id)
  select coalesce((select sum(amount) from donations d, u where d.user_id = u.id and d.donated_on > current_date - 365), 0),
         donor_until((select id from u), setting_num('supporter_min', 50)),
         donor_until((select id from u), setting_num('donor_flyer_min', 100)),
         setting_num('supporter_min', 50), setting_num('donor_flyer_min', 100)
  from u where (select id from u) = auth.uid() or is_staff()
$$;
grant execute on function my_donor_status(uuid) to authenticated;

-- Flyers are free with an active place (paid or Founding) OR GH₵ 100+ donated in the last 12 months
create or replace function has_paid_plan(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_user <> auth.uid() and not is_staff() then null else (
    exists (select 1 from featured_slots f join listings l on l.id = f.listing_id
            where l.owner_id = p_user and current_date between f.starts_on and f.ends_on)
    or coalesce((select sum(amount) from donations where user_id = p_user and donated_on > current_date - 365), 0)
       >= setting_num('donor_flyer_min', 100)) end
$$;

-- Search: Supporters come right after Top spot and Featured places, rotating daily among themselves
drop function if exists search_listings(int, text, int, text, boolean, int, int);
create function search_listings(
  p_town int, p_scope text default 'area', p_category int default null, p_q text default null,
  p_verified boolean default false, p_limit int default 20, p_offset int default 0)
returns table (
  id uuid, business_name text, slug text, town_name text, district_name text,
  price_min numeric, price_max numeric, price_unit price_unit,
  negotiable boolean, discounts boolean, verified boolean, founding boolean,
  whatsapp text, phone text, description text,
  travels boolean, featured boolean, featured_level int, photo text,
  rating numeric, review_count bigint, distance_km double precision, supporter boolean)
language sql stable security invoker set search_path = public as $$
  with here as (
    select t.id, t.lat, t.lng, t.district_id, d.region_id
    from towns t join districts d on d.id = t.district_id where t.id = p_town
  ),
  cats as (
    select id from categories where p_category is not null and (id = p_category or parent_id = p_category)
  ),
  topcat as (
    select coalesce(parent_id, id) as id from categories where id = p_category
  ),
  base as (
    select l.*, bt.name as town_name, bd.name as district_name, bt.lat as blat, bt.lng as blng, h.lat as hlat, h.lng as hlng,
      (l.base_town_id <> h.id) as travels,
      coalesce((select max(case f.position when 'top' then 2 else 1 end) from featured_slots f
                where f.listing_id = l.id and f.town_id = h.id
                  and current_date between f.starts_on and f.ends_on
                  and (p_category is null or f.category_id in (select id from topcat))), 0) as featured_level,
      is_supporter(l.owner_id) as supporter
    from listings l
    join towns bt on bt.id = l.base_town_id
    join districts bd on bd.id = bt.district_id
    cross join here h
    where l.status = 'live'
      and (p_category is null or exists (
            select 1 from listing_categories lc where lc.listing_id = l.id and lc.category_id in (select id from cats)))
      and (not p_verified or l.verified)
      and (p_q is null or l.business_name ilike '%' || p_q || '%' or l.description ilike '%' || p_q || '%')
      and case p_scope
            when 'all' then true
            when 'region' then bd.region_id = h.region_id or l.coverage = 'nationwide'
            else l.base_town_id = h.id
                 or (l.coverage = 'district' and bt.district_id = h.district_id)
                 or (l.coverage = 'region' and bd.region_id = h.region_id)
                 or l.coverage = 'nationwide'
          end
  )
  select b.id, b.business_name, b.slug, b.town_name, b.district_name,
         b.price_min, b.price_max, b.price_unit, b.negotiable, b.discounts, b.verified, b.founding,
         b.whatsapp, b.phone, b.description, b.travels, b.featured_level > 0, b.featured_level,
         (select p.path from listing_photos p where p.listing_id = b.id order by p.sort, p.created_at limit 1),
         (select round(avg(r.rating)::numeric, 1) from reviews r where r.listing_id = b.id and not r.hidden),
         (select count(*) from reviews r where r.listing_id = b.id and not r.hidden),
         km_between(b.hlat, b.hlng, b.blat, b.blng), b.supporter
  from base b
  order by b.featured_level desc,
           case when b.featured_level > 0 then md5(b.id::text || current_date::text) end,
           b.supporter desc,
           case when b.supporter then md5(b.id::text || current_date::text) end,
           b.verified desc,
           km_between(b.hlat, b.hlng, b.blat, b.blng) asc nulls last,
           b.founding desc, b.created_at
  limit p_limit offset p_offset
$$;
grant execute on function search_listings(int, text, int, text, boolean, int, int) to anon, authenticated;

-- Recommended Supporters for a town page: live listings of Supporters in the same district (then region), rotating daily
create or replace function town_supporters(p_town int, p_limit int default 8)
returns table (id uuid, business_name text, slug text, town_name text, photo text, category text)
language sql stable security definer set search_path = public as $$
  with h as (select t.id, t.district_id, d.region_id from towns t join districts d on d.id = t.district_id where t.id = p_town)
  select l.id, l.business_name, l.slug, bt.name,
         (select p.path from listing_photos p where p.listing_id = l.id order by p.sort, p.created_at limit 1),
         (select coalesce(pc.name, c.name) from listing_categories lc join categories c on c.id = lc.category_id
            left join categories pc on pc.id = c.parent_id where lc.listing_id = l.id order by coalesce(pc.sort, c.sort) limit 1)
  from listings l
  join towns bt on bt.id = l.base_town_id
  join districts bd on bd.id = bt.district_id
  cross join h
  where l.status = 'live' and is_supporter(l.owner_id)
    and (bt.district_id = h.district_id or bd.region_id = h.region_id or l.coverage = 'nationwide')
  order by (bt.district_id = h.district_id) desc, md5(l.id::text || current_date::text)
  limit p_limit
$$;
grant execute on function town_supporters(int, int) to anon, authenticated;
