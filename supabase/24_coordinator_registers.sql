-- NHYIAMU — regional coordinators may also register suppliers (like a field agent) and earn agent commission on them.
-- To avoid being paid twice on the same money, payments from suppliers a coordinator registered themselves are
-- left out of that coordinator's 10% regional pay. The admin sees how many suppliers each coordinator registered
-- themselves compared with their agents.

drop function if exists agent_stats(date, date);
create function agent_stats(p_from date, p_to date)
returns table (agent_id uuid, agent_name text, agent_email text, registered bigint, verified bigint, live bigint, is_coordinator boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email,
    (select count(*) from listings l where l.registered_by = p.id and l.created_at::date between p_from and p_to),
    (select count(*) from listings l where l.verified_by = p.id and l.verified_at::date between p_from and p_to),
    (select count(*) from listings l where l.registered_by = p.id and l.status = 'live'),
    p.role = 'coordinator'
  from profiles p
  where p.role in ('agent', 'coordinator')
    and (my_role() = 'admin' or p.id = auth.uid()
         or (p.role = 'agent' and exists (select 1 from agent_towns a where a.agent_id = p.id and coord_town(a.town_id))))
  order by p.role = 'coordinator' desc, p.full_name
$$;
grant execute on function agent_stats(date, date) to authenticated;

drop function if exists coordinator_earnings(date, date);
create function coordinator_earnings(p_from date, p_to date)
returns table (region_id smallint, region_name text, coordinator_id uuid, coordinator_name text, coordinator_email text,
               place_income numeric, flyer_income numeric, total_income numeric, earnings numeric,
               self_registered bigint, agents_registered bigint)
language sql stable security definer set search_path = public as $$
  with rows as (
    select r.id as region_id, r.name as region_name, cr.coordinator_id, p.full_name, p.email,
      count(cr.coordinator_id) over (partition by r.id) as n_coord,
      -- place payments in the region, except from suppliers this coordinator registered (they earn agent commission on those)
      coalesce((select sum(f.amount) from featured_slots f
                join towns t on t.id = f.town_id join districts d on d.id = t.district_id
                join listings l on l.id = f.listing_id
                where d.region_id = r.id and not f.is_free and f.created_at::date between p_from and p_to
                  and l.registered_by is distinct from cr.coordinator_id), 0) as place_income,
      coalesce((select sum(fl.amount) from flyers fl join towns t on t.id = fl.town_id join districts d on d.id = t.district_id
                where d.region_id = r.id and fl.status = 'approved' and fl.starts_on between p_from and p_to), 0) as flyer_income,
      (select count(*) from listings l join towns t on t.id = l.base_town_id join districts d on d.id = t.district_id
        where d.region_id = r.id and l.status = 'live' and cr.coordinator_id is not null and l.registered_by = cr.coordinator_id) as self_registered,
      (select count(*) from listings l join towns t on t.id = l.base_town_id join districts d on d.id = t.district_id
        join profiles ap on ap.id = l.registered_by
        where d.region_id = r.id and l.status = 'live' and ap.role = 'agent') as agents_registered
    from regions r
    left join coordinator_regions cr on cr.region_id = r.id
    left join profiles p on p.id = cr.coordinator_id
  )
  select region_id, region_name, coordinator_id, full_name, email,
         place_income, flyer_income, place_income + flyer_income,
         case when coordinator_id is null then 0
              else round((place_income + flyer_income) * setting_num('coordinator_rate', 10) / 100 / greatest(n_coord, 1), 2) end,
         self_registered, agents_registered
  from rows
  where (my_role() = 'admin' and (coordinator_id is not null or place_income + flyer_income > 0))
     or (coordinator_id = auth.uid())
  order by place_income + flyer_income desc, region_name
$$;
grant execute on function coordinator_earnings(date, date) to authenticated;

-- let coordinators register suppliers (same consent rule as agents)
drop policy if exists "create own" on listings;
create policy "create own" on listings for insert with check (
  owner_id = auth.uid() and status in ('draft','pending') and verified = false and founding = false
  and (registered_by is null or (registered_by = auth.uid() and my_role() in ('agent', 'coordinator') and consent_given)));
