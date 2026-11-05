-- Events Hub — search functions (part 3)

-- Fix: anonymous visitors need table access to agent_towns for the listings rule to evaluate (rows stay hidden by its own rule)
grant select on agent_towns to anon;

-- Distance in km between two points (null if either is missing)
create or replace function km_between(lat1 double precision, lng1 double precision,
                                      lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case when lat1 is null or lat2 is null then null else
    6371 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))) end
$$;

-- Main search. p_scope: 'area' | 'region' | 'all'
create or replace function search_listings(
  p_town      int,
  p_scope     text default 'area',
  p_category  int  default null,
  p_q         text default null,
  p_verified  boolean default false,
  p_limit     int  default 20,
  p_offset    int  default 0)
returns table (
  id uuid, business_name text, slug text, town_name text, district_name text,
  price_min numeric, price_max numeric, price_unit price_unit,
  negotiable boolean, discounts boolean, verified boolean, founding boolean,
  whatsapp text, phone text, description text,
  travels boolean, featured boolean, photo text,
  rating numeric, review_count bigint, distance_km double precision)
language sql stable security invoker set search_path = public as $$
  with here as (
    select t.id, t.lat, t.lng, t.district_id, d.region_id
    from towns t join districts d on d.id = t.district_id where t.id = p_town
  ),
  cats as (
    select id from categories where p_category is not null and (id = p_category or parent_id = p_category)
  )
  select l.id, l.business_name, l.slug, bt.name, bd.name,
         l.price_min, l.price_max, l.price_unit,
         l.negotiable, l.discounts, l.verified, l.founding,
         l.whatsapp, l.phone, l.description,
         (l.base_town_id <> h.id) as travels,
         exists (select 1 from featured_slots f
                 where f.listing_id = l.id and f.town_id = h.id
                   and current_date between f.starts_on and f.ends_on
                   and (p_category is null or f.category_id in (select id from cats))) as featured,
         (select p.path from listing_photos p where p.listing_id = l.id order by p.sort, p.created_at limit 1),
         (select round(avg(r.rating)::numeric, 1) from reviews r where r.listing_id = l.id and not r.hidden),
         (select count(*) from reviews r where r.listing_id = l.id and not r.hidden),
         km_between(h.lat, h.lng, bt.lat, bt.lng)
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
  order by featured desc, l.verified desc,
           km_between(h.lat, h.lng, bt.lat, bt.lng) asc nulls last,
           l.founding desc, l.created_at
  limit p_limit offset p_offset
$$;

-- Number of live listings per top-level category reachable from a town (area scope)
create or replace function town_category_counts(p_town int)
returns table (category_id int, n bigint)
language sql stable security invoker set search_path = public as $$
  with here as (
    select t.id, t.district_id, d.region_id
    from towns t join districts d on d.id = t.district_id where t.id = p_town
  )
  select coalesce(c.parent_id, c.id), count(distinct l.id)
  from listings l
  join towns bt on bt.id = l.base_town_id
  join districts bd on bd.id = bt.district_id
  join listing_categories lc on lc.listing_id = l.id
  join categories c on c.id = lc.category_id
  cross join here h
  where l.status = 'live'
    and (l.base_town_id = h.id
         or (l.coverage = 'district' and bt.district_id = h.district_id)
         or (l.coverage = 'region' and bd.region_id = h.region_id)
         or l.coverage = 'nationwide')
  group by 1
$$;

grant execute on function km_between(double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function search_listings(int, text, int, text, boolean, int, int) to anon, authenticated;
grant execute on function town_category_counts(int) to anon, authenticated;
