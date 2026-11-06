-- NHYIAMU — two paid positions per category per town:
--   Top spot  (2 places, the very top, higher price  = featured_prices tier 'premium')
--   Featured  (3 places, just below,   lower price   = featured_prices tier 'standard')
-- Any business can buy either. Within each level, places rotate daily so everyone gets time first.

alter table featured_slots add column if not exists position text not null default 'featured'
  check (position in ('top', 'featured'));

-- Founding suppliers get a free Featured place (if one of the 3 is free)
create or replace function approve_listing(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype;
  v_cat int;
  v_note text := 'Approved.';
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select * into l from listings where id = p_id for update;
  if not found then raise exception 'Listing not found'; end if;

  update listings set status = 'live', reject_reason = null where id = p_id;

  if not l.founding and (select count(*) from listings where base_town_id = l.base_town_id and founding) < 10 then
    update listings set founding = true where id = p_id;
    v_note := 'Approved as a Founding supplier.';
    select coalesce(c.parent_id, c.id) into v_cat
      from listing_categories lc join categories c on c.id = lc.category_id
      where lc.listing_id = p_id order by c.sort limit 1;
    if v_cat is not null and (
        select count(*) from featured_slots
        where town_id = l.base_town_id and category_id = v_cat and position = 'featured'
          and current_date between starts_on and ends_on) < 3 then
      insert into featured_slots (listing_id, category_id, town_id, months, amount, is_free, starts_on, ends_on, created_by, position)
      values (p_id, v_cat, l.base_town_id, 3, 0, true, current_date, (current_date + interval '3 months')::date, auth.uid(), 'featured');
      v_note := 'Approved as a Founding supplier, with 3 months featured free.';
    end if;
  end if;
  return v_note;
end $$;

-- Search now returns the paid level (2 = Top spot, 1 = Featured, 0 = none)
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
  rating numeric, review_count bigint, distance_km double precision)
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
                  and (p_category is null or f.category_id in (select id from topcat))), 0) as featured_level
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
         km_between(b.hlat, b.hlng, b.blat, b.blng)
  from base b
  order by b.featured_level desc,
           case when b.featured_level > 0 then md5(b.id::text || current_date::text) end,  -- daily rotation among paid places
           b.verified desc,
           km_between(b.hlat, b.hlng, b.blat, b.blng) asc nulls last,
           b.founding desc, b.created_at
  limit p_limit offset p_offset
$$;
grant execute on function search_listings(int, text, int, text, boolean, int, int) to anon, authenticated;
