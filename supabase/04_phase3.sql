-- Events Hub — phase 3 (accounts, moderation, founding suppliers, stats)

-- ---------- Email on profiles (so admin can find people) -------------
alter table profiles add column if not exists email text;
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, phone, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'phone',
          new.email);
  return new;
end $$;

-- ---------- Approve / reject (staff only) ----------------------------
-- Approving makes the listing live. The first 10 approved listings in a town become
-- Founding suppliers and get 3 months featured free in their main category,
-- as long as that category still has fewer than 3 active featured spots in the town.
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
        where town_id = l.base_town_id and category_id = v_cat and current_date between starts_on and ends_on) < 3 then
      insert into featured_slots (listing_id, category_id, town_id, months, amount, is_free, starts_on, ends_on, created_by)
      values (p_id, v_cat, l.base_town_id, 3, 0, true, current_date, (current_date + interval '3 months')::date, auth.uid());
      v_note := 'Approved as a Founding supplier, with 3 months featured free.';
    end if;
  end if;
  return v_note;
end $$;

create or replace function reject_listing(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update listings set status = 'rejected', reject_reason = p_reason where id = p_id;
end $$;

-- ---------- Agent tally (for commission) -----------------------------
create or replace function agent_stats(p_from date, p_to date)
returns table (agent_id uuid, agent_name text, agent_email text, registered bigint, verified bigint, live bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email,
    (select count(*) from listings l where l.registered_by = p.id and l.created_at::date between p_from and p_to),
    (select count(*) from listings l where l.verified_by = p.id and l.verified_at::date between p_from and p_to),
    (select count(*) from listings l where l.registered_by = p.id and l.status = 'live')
  from profiles p
  where p.role = 'agent' and (my_role() = 'admin' or p.id = auth.uid())
  order by p.full_name
$$;

-- ---------- Admin overview -------------------------------------------
create or replace function admin_overview()
returns json language sql stable security definer set search_path = public as $$
  select case when not is_staff() then null else json_build_object(
    'live',      (select count(*) from listings where status = 'live'),
    'pending',   (select count(*) from listings where status = 'pending'),
    'verified',  (select count(*) from listings where verified),
    'reports',   (select count(*) from reports where status = 'open'),
    'enquiries', (select count(*) from loan_enquiries),
    'taps30',    (select count(*) from listing_taps where kind in ('whatsapp','call') and created_at > now() - interval '30 days'),
    'misses',    (select coalesce(json_agg(m), '[]'::json) from (
                    select t.name as town, c.name as category, count(*) as n
                    from search_misses s left join towns t on t.id = s.town_id left join categories c on c.id = s.category_id
                    where s.created_at > now() - interval '30 days'
                    group by 1, 2 order by 3 desc limit 10) m)
  ) end
$$;

-- ---------- Listing owners may only change the reply on reviews -----
create or replace function protect_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_staff() then return new; end if;
  if new.author_id = auth.uid() then
    new.reply := old.reply; new.replied_at := old.replied_at; new.hidden := old.hidden;
    return new;
  end if;
  -- listing owner replying
  new.rating := old.rating; new.comment := old.comment; new.event_type := old.event_type;
  new.event_month := old.event_month; new.hidden := old.hidden; new.author_id := old.author_id;
  new.replied_at := now();
  return new;
end $$;
drop trigger if exists review_guard on reviews;
create trigger review_guard before update on reviews for each row execute function protect_review();

-- ---------- Featured match on the main category ----------------------
create or replace function search_listings(
  p_town int, p_scope text default 'area', p_category int default null, p_q text default null,
  p_verified boolean default false, p_limit int default 20, p_offset int default 0)
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
  ),
  topcat as (
    select coalesce(parent_id, id) as id from categories where id = p_category
  )
  select l.id, l.business_name, l.slug, bt.name, bd.name,
         l.price_min, l.price_max, l.price_unit,
         l.negotiable, l.discounts, l.verified, l.founding,
         l.whatsapp, l.phone, l.description,
         (l.base_town_id <> h.id) as travels,
         exists (select 1 from featured_slots f
                 where f.listing_id = l.id and f.town_id = h.id
                   and current_date between f.starts_on and f.ends_on
                   and (p_category is null or f.category_id in (select id from topcat))) as featured,
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

grant execute on function approve_listing(uuid), reject_listing(uuid, text), agent_stats(date, date), admin_overview() to authenticated;
