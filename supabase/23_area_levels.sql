-- NHYIAMU — paid places at four levels, stacked in results:
--   ★ National  (shows in every town in Ghana)
--   ★ Regional  (every town in the supplier's region)
--   ★ District  (every town in the supplier's district)
--   ★ Town      (the supplier's own town)
-- Each level has Top spots and Featured places. Big towns (e.g. Kumasi) have more town places at +20%.
-- A supplier can only buy a level their listing actually covers (coverage: town < district < region < nationwide).

alter table towns add column if not exists size text not null default 'normal' check (size in ('normal', 'big'));

alter table featured_slots add column if not exists level text not null default 'town' check (level in ('town', 'district', 'region', 'national'));
alter table featured_slots add column if not exists district_id int references districts(id);
alter table featured_slots add column if not exists region_id smallint references regions(id);
update featured_slots f set district_id = t.district_id, region_id = d.region_id
  from towns t join districts d on d.id = t.district_id
  where t.id = f.town_id and (f.district_id is null or f.region_id is null);
create index if not exists featured_slots_area on featured_slots (category_id, level, ends_on);

-- Monthly prices and number of places for each level (admin can change these)
create table if not exists place_prices (
  level    text not null check (level in ('town', 'town_big', 'district', 'region', 'national')),
  position text not null check (position in ('top', 'featured')),
  monthly  numeric(10,2) not null check (monthly > 0),
  slots    int not null check (slots >= 0),
  primary key (level, position)
);
alter table place_prices enable row level security;
drop policy if exists "anyone reads prices" on place_prices;
create policy "anyone reads prices" on place_prices for select using (true);
drop policy if exists "admin edits prices" on place_prices;
create policy "admin edits prices" on place_prices for all using (my_role() = 'admin') with check (my_role() = 'admin');
grant select on place_prices to anon, authenticated;
grant insert, update, delete on place_prices to authenticated;
insert into place_prices (level, position, monthly, slots) values
  ('national', 'top', 1500, 1), ('national', 'featured', 900, 2),
  ('region',   'top',  600, 1), ('region',   'featured', 360, 2),
  ('district', 'top',  250, 2), ('district', 'featured', 150, 3),
  ('town',     'top',  100, 2), ('town',     'featured',  50, 3),
  ('town_big', 'top',  120, 3), ('town_big', 'featured',  60, 5)
on conflict (level, position) do nothing;

-- Longer plans cost less per month (same discounts as before: 3 months = 2.7x, 6 = 4.8x, 12 = 8.4x)
create or replace function place_price(p_level text, p_position text, p_months int, p_town int) returns numeric
language sql stable security definer set search_path = public as $$
  select round(pp.monthly * case p_months when 1 then 1 when 3 then 2.7 when 6 then 4.8 when 12 then 8.4 end, 2)
  from place_prices pp
  where pp.position = p_position
    and pp.level = case when p_level = 'town' and (select size from towns where id = p_town) = 'big' then 'town_big' else p_level end
$$;
grant execute on function place_price(text, text, int, int) to anon, authenticated;

-- Places left at a level for the area around a town
create or replace function places_left_at(p_category int, p_level text, p_position text, p_town int) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_district int; v_region smallint; v_slots int; v_used int;
begin
  select t.district_id, d.region_id into v_district, v_region from towns t join districts d on d.id = t.district_id where t.id = p_town;
  select slots into v_slots from place_prices
    where position = p_position
      and level = case when p_level = 'town' and (select size from towns where id = p_town) = 'big' then 'town_big' else p_level end;
  select count(*) into v_used from featured_slots f
    where f.category_id = p_category and f.level = p_level and coalesce(f.position, 'featured') = p_position
      and current_date between f.starts_on and f.ends_on
      and case p_level when 'town' then f.town_id = p_town when 'district' then f.district_id = v_district
                       when 'region' then f.region_id = v_region else true end;
  return greatest(0, coalesce(v_slots, 0) - v_used);
end $$;
grant execute on function places_left_at(int, text, text, int) to anon, authenticated;

-- old helper keeps working for town level
create or replace function places_left(p_category int, p_town int, p_position text) returns int
language sql stable security definer set search_path = public as $$
  select places_left_at(p_category, 'town', p_position, p_town)
$$;

create or replace function level_allowed(p_coverage coverage_level, p_level text) returns boolean
language sql immutable as $$
  select case p_level
    when 'town' then true
    when 'district' then p_coverage in ('district', 'region', 'nationwide')
    when 'region' then p_coverage in ('region', 'nationwide')
    when 'national' then p_coverage = 'nationwide'
    else false end
$$;

alter table payments add column if not exists level text not null default 'town' check (level in ('town', 'district', 'region', 'national'));

drop function if exists start_payment(text, uuid, int, text, int, uuid);
create function start_payment(
  p_kind text, p_listing uuid default null, p_category int default null,
  p_position text default null, p_months int default null, p_flyer uuid default null, p_level text default 'town')
returns table (reference text, amount_pesewas int, email text)
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype; f flyers%rowtype; v_amount numeric; v_ref text; v_email text; v_has_own boolean;
  v_district int; v_region smallint;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  select coalesce(p.email, u.email) into v_email from profiles p left join auth.users u on u.id = p.id where p.id = auth.uid();
  if v_email is null or v_email = '' then raise exception 'Your account has no email address'; end if;
  v_ref := 'NHY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));

  if p_kind = 'place' then
    select * into l from listings where id = p_listing;
    if not found or l.owner_id <> auth.uid() then raise exception 'You can only pay for your own listing'; end if;
    if l.status <> 'live' then raise exception 'Your listing must be approved and live first'; end if;
    if p_position not in ('top', 'featured') or p_months not in (1, 3, 6, 12) or p_level not in ('town', 'district', 'region', 'national') then
      raise exception 'Choose a level, a place and a plan';
    end if;
    if not level_allowed(l.coverage, p_level) then
      raise exception 'Your listing only covers %. Update the areas you serve to buy a wider place.', l.coverage;
    end if;
    if not exists (select 1 from listing_categories lc join categories c on c.id = lc.category_id
                   where lc.listing_id = l.id and coalesce(c.parent_id, c.id) = p_category) then
      raise exception 'Choose one of your listing''s own categories';
    end if;
    v_amount := place_price(p_level, p_position, p_months, l.base_town_id);
    if v_amount is null then raise exception 'Price not found'; end if;
    select t.district_id, d.region_id into v_district, v_region from towns t join districts d on d.id = t.district_id where t.id = l.base_town_id;
    v_has_own := exists (select 1 from featured_slots where listing_id = l.id and category_id = p_category and level = p_level
                          and coalesce(position, 'featured') = p_position and current_date between starts_on and ends_on);
    if not v_has_own and places_left_at(p_category, p_level, p_position, l.base_town_id) = 0 then
      raise exception 'Sorry, all those places are taken right now';
    end if;
    insert into payments (reference, user_id, kind, listing_id, category_id, town_id, position, months, amount, level)
      values (v_ref, auth.uid(), 'place', l.id, p_category, l.base_town_id, p_position, p_months, v_amount, p_level);

  elsif p_kind = 'flyer' then
    select * into f from flyers where id = p_flyer;
    if not found or f.owner_id <> auth.uid() then raise exception 'You can only pay for your own flyer'; end if;
    if f.status = 'approved' then raise exception 'This flyer is already live'; end if;
    if has_paid_plan(auth.uid()) then raise exception 'Your flyers are free — no payment needed'; end if;
    if exists (select 1 from payments where flyer_id = f.id and status = 'paid') then raise exception 'This flyer is already paid for'; end if;
    v_amount := setting_num('flyer_price', 20);
    insert into payments (reference, user_id, kind, flyer_id, amount) values (v_ref, auth.uid(), 'flyer', f.id, v_amount);
  else
    raise exception 'Unknown payment';
  end if;

  return query select v_ref, (v_amount * 100)::int, v_email;
end $$;
grant execute on function start_payment(text, uuid, int, text, int, uuid, text) to authenticated;

create or replace function confirm_payment(p_ref text) returns text
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype; v jsonb; d jsonb; v_start date; v_end date; v_slot uuid; v_district int; v_region smallint;
  v_label text;
begin
  select * into p from payments where reference = p_ref for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.user_id <> auth.uid() and not is_staff() then raise exception 'Not allowed'; end if;
  if p.status = 'paid' then return 'Already confirmed.'; end if;
  if p.status = 'needs_attention' then return 'Paid — the admin will contact you.'; end if;

  v := paystack_verify(p_ref);
  d := v->'data';
  if coalesce((v->>'status')::boolean, false) is not true or d is null then
    return 'Payment not found at Paystack yet.';
  end if;
  if d->>'status' <> 'success' then
    if d->>'status' in ('failed', 'abandoned', 'reversed') and p.created_at < now() - interval '1 hour' then
      update payments set status = 'failed', note = d->>'status' where id = p.id;
    end if;
    return 'Not paid yet (' || coalesce(d->>'status', 'unknown') || ').';
  end if;
  if (d->>'amount')::int <> (p.amount * 100)::int or upper(d->>'currency') <> 'GHS' then
    update payments set status = 'needs_attention', note = 'Amount or currency did not match: ' || (d->>'amount') || ' ' || (d->>'currency') where id = p.id;
    return 'Paid, but the amount did not match. The admin will check it.';
  end if;

  if p.kind = 'place' then
    select t.district_id, dd.region_id into v_district, v_region from towns t join districts dd on dd.id = t.district_id where t.id = p.town_id;
    select id, ends_on into v_slot, v_start from featured_slots
      where listing_id = p.listing_id and category_id = p.category_id and level = p.level
        and coalesce(position, 'featured') = p.position and current_date between starts_on and ends_on
      order by ends_on desc limit 1;
    if v_slot is not null then
      v_end := (v_start + make_interval(months => p.months))::date;
      update featured_slots set ends_on = v_end, months = months + p.months, amount = amount + p.amount,
        payment_ref = coalesce(payment_ref || ', ', '') || p.reference where id = v_slot;
    elsif places_left_at(p.category_id, p.level, p.position, p.town_id) > 0 then
      v_end := (current_date + make_interval(months => p.months))::date;
      insert into featured_slots (listing_id, category_id, town_id, months, amount, is_free, starts_on, ends_on, payment_ref, created_by, position, level, district_id, region_id)
        values (p.listing_id, p.category_id, p.town_id, p.months, p.amount, false, current_date, v_end, p.reference, p.user_id, p.position, p.level, v_district, v_region);
    else
      update payments set status = 'needs_attention', paid_at = now(), channel = d->>'channel',
        note = 'Paid but the places filled up before confirmation — offer the next free place or a refund' where id = p.id;
      return 'Paid, but the places filled up meanwhile. The admin will contact you.';
    end if;
    update payments set status = 'paid', paid_at = now(), channel = d->>'channel' where id = p.id;
    v_label := case p.level when 'national' then ' across Ghana' when 'region' then ' in your region' when 'district' then ' in your district' else '' end;
    return (case p.position when 'top' then 'Your Top spot' else 'Your Featured place' end) || v_label || ' is live until ' || to_char(v_end, 'DD Mon YYYY') || '.';
  else
    update payments set status = 'paid', paid_at = now(), channel = d->>'channel' where id = p.id;
    perform set_config('eventshub.payment', 'on', true);
    update flyers set amount = p.amount, payment_ref = p.reference where id = p.flyer_id;
    perform set_config('eventshub.payment', 'off', true);
    return 'Paid. A moderator will check your flyer, then it goes live for 7 days.';
  end if;
end $$;

-- Search: paid places from all levels that reach this town, stacked National > Regional > District > Town,
-- Top before Featured within a level, rotating daily within each group; then Supporters, verified, distance.
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
  rating numeric, review_count bigint, distance_km double precision, supporter boolean, place_level text)
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
      (select f.level || ':' || coalesce(f.position, 'featured') from featured_slots f
        where f.listing_id = l.id and current_date between f.starts_on and f.ends_on
          and (p_category is null or f.category_id in (select id from topcat))
          and case f.level when 'town' then f.town_id = h.id when 'district' then f.district_id = h.district_id
                           when 'region' then f.region_id = h.region_id else true end
        order by (case f.level when 'national' then 40 when 'region' then 30 when 'district' then 20 else 10 end)
               + (case coalesce(f.position, 'featured') when 'top' then 2 else 1 end) desc
        limit 1) as slot,
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
  ),
  ranked as (
    select b.*,
      coalesce((case split_part(b.slot, ':', 1) when 'national' then 40 when 'region' then 30 when 'district' then 20 when 'town' then 10 end)
             + (case split_part(b.slot, ':', 2) when 'top' then 2 when 'featured' then 1 end), 0) as score
    from base b
  )
  select b.id, b.business_name, b.slug, b.town_name, b.district_name,
         b.price_min, b.price_max, b.price_unit, b.negotiable, b.discounts, b.verified, b.founding,
         b.whatsapp, b.phone, b.description, b.travels, b.score > 0,
         case split_part(b.slot, ':', 2) when 'top' then 2 when 'featured' then 1 else 0 end,
         (select p.path from listing_photos p where p.listing_id = b.id order by p.sort, p.created_at limit 1),
         (select round(avg(r.rating)::numeric, 1) from reviews r where r.listing_id = b.id and not r.hidden),
         (select count(*) from reviews r where r.listing_id = b.id and not r.hidden),
         km_between(b.hlat, b.hlng, b.blat, b.blng), b.supporter, nullif(split_part(b.slot, ':', 1), '')
  from ranked b
  order by b.score desc,
           case when b.score > 0 then md5(b.id::text || current_date::text) end,
           b.supporter desc,
           case when b.supporter then md5(b.id::text || current_date::text) end,
           b.verified desc,
           km_between(b.hlat, b.hlng, b.blat, b.blng) asc nulls last,
           b.founding desc, b.created_at
  limit p_limit offset p_offset
$$;
grant execute on function search_listings(int, text, int, text, boolean, int, int) to anon, authenticated;

-- Keep district/region filled for places recorded by hand (admin form) or free Founding places
create or replace function fill_slot_area() returns trigger
language plpgsql as $$
begin
  if new.district_id is null or new.region_id is null then
    select t.district_id, d.region_id into new.district_id, new.region_id
    from towns t join districts d on d.id = t.district_id where t.id = new.town_id;
  end if;
  return new;
end $$;
drop trigger if exists fill_slot_area on featured_slots;
create trigger fill_slot_area before insert or update of town_id on featured_slots for each row execute function fill_slot_area();
