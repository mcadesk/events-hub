-- NHYIAMU — helper pay worked out in cedis, and a record of every payout.
--   Agent commission (also for suppliers a coordinator registers personally):
--     a supplier's FIRST paid place: 50% of one month's value + 20% of the rest of that payment
--     every later payment from that supplier: 20%
--   Coordinator: 15% (setting) of the region's income, leaving out suppliers they registered themselves.
--   Income = confirmed online payments + places the admin recorded by hand. Free places and donations never count.
-- The admin sends the money by MoMo and records it here; each helper sees their own earnings and payouts.

insert into app_settings (key, value) values ('agent_first_rate', '50'), ('agent_later_rate', '20') on conflict (key) do nothing;

-- Every paid-place payment, one row each (online payments, plus places recorded by hand)
create or replace view place_income_events with (security_invoker = on) as
  select p.listing_id, p.amount, p.months, p.paid_at as at, p.reference
  from payments p where p.kind = 'place' and p.status = 'paid' and p.listing_id is not null
  union all
  select f.listing_id, f.amount, f.months, f.created_at, coalesce(f.payment_ref, 'manual')
  from featured_slots f
  where not f.is_free and f.amount > 0 and (f.payment_ref is null or f.payment_ref not like '%NHY-%');
revoke all on place_income_events from anon, authenticated;

-- Commission lines for agents (and coordinators on their own registrations) in a period
create or replace function commission_lines(p_from date, p_to date)
returns table (person_id uuid, listing_name text, paid_on date, amount numeric, first_payment boolean, commission numeric)
language sql stable security definer set search_path = public as $$
  with ev as (
    select e.*, l.registered_by, l.business_name,
      row_number() over (partition by e.listing_id order by e.at, e.reference) = 1 as is_first
    from place_income_events e join listings l on l.id = e.listing_id
    where l.registered_by is not null
  )
  select ev.registered_by, ev.business_name, ev.at::date, ev.amount, ev.is_first,
    round(case when ev.is_first then
      (ev.amount / greatest(ev.months, 1)) * setting_num('agent_first_rate', 50) / 100
      + (ev.amount - ev.amount / greatest(ev.months, 1)) * setting_num('agent_later_rate', 20) / 100
    else ev.amount * setting_num('agent_later_rate', 20) / 100 end, 2)
  from ev
  join profiles pr on pr.id = ev.registered_by and pr.role in ('agent', 'coordinator')
  where ev.at::date between p_from and p_to
    and (my_role() = 'admin' or ev.registered_by = auth.uid())
  order by ev.at
$$;
grant execute on function commission_lines(date, date) to authenticated;

-- Coordinator pay now uses the same payment events (so renewals and extensions count too)
drop function if exists coordinator_earnings(date, date);
create function coordinator_earnings(p_from date, p_to date)
returns table (region_id smallint, region_name text, coordinator_id uuid, coordinator_name text, coordinator_email text,
               place_income numeric, flyer_income numeric, total_income numeric, earnings numeric,
               self_registered bigint, agents_registered bigint)
language sql stable security definer set search_path = public as $$
  with rows as (
    select r.id as region_id, r.name as region_name, cr.coordinator_id, p.full_name, p.email,
      count(cr.coordinator_id) over (partition by r.id) as n_coord,
      coalesce((select sum(e.amount) from place_income_events e
                join listings l on l.id = e.listing_id
                join towns t on t.id = l.base_town_id join districts d on d.id = t.district_id
                where d.region_id = r.id and e.at::date between p_from and p_to
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
              else round((place_income + flyer_income) * setting_num('coordinator_rate', 15) / 100 / greatest(n_coord, 1), 2) end,
         self_registered, agents_registered
  from rows
  where (my_role() = 'admin' and (coordinator_id is not null or place_income + flyer_income > 0))
     or (coordinator_id = auth.uid())
  order by place_income + flyer_income desc, region_name
$$;
grant execute on function coordinator_earnings(date, date) to authenticated;

-- Record of money actually sent
create table if not exists payouts (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references profiles(id) on delete cascade,
  month       date not null,                 -- first day of the month the pay is for
  amount      numeric(10,2) not null check (amount >= 0),
  momo_ref    text not null,
  note        text,
  paid_by     uuid references profiles(id),
  paid_at     timestamptz not null default now(),
  unique (person_id, month)
);
alter table payouts enable row level security;
drop policy if exists "admin manages payouts" on payouts;
create policy "admin manages payouts" on payouts for all using (my_role() = 'admin') with check (my_role() = 'admin');
drop policy if exists "helper reads own payouts" on payouts;
create policy "helper reads own payouts" on payouts for select using (person_id = auth.uid());
grant select, insert, update, delete on payouts to authenticated;

-- What each helper earned in a month, and whether it has been paid
create or replace function month_earnings(p_month date)
returns table (person_id uuid, full_name text, email text, phone text, role text,
               commission numeric, coordinator_pay numeric, total numeric,
               paid_amount numeric, momo_ref text, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  with m as (select date_trunc('month', p_month)::date as f, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as t),
  com as (select c.person_id, sum(c.commission) as v from m, commission_lines(m.f, m.t) c group by c.person_id),
  crd as (select c.coordinator_id as person_id, sum(c.earnings) as v from m, coordinator_earnings(m.f, m.t) c where c.coordinator_id is not null group by c.coordinator_id),
  ppl as (select person_id from com union select person_id from crd
          union select person_id from payouts, m where payouts.month = m.f)
  select p.id, p.full_name, p.email, p.phone, p.role::text,
    coalesce(com.v, 0), coalesce(crd.v, 0), coalesce(com.v, 0) + coalesce(crd.v, 0),
    po.amount, po.momo_ref, po.paid_at
  from ppl join profiles p on p.id = ppl.person_id
  cross join m
  left join com on com.person_id = p.id
  left join crd on crd.person_id = p.id
  left join payouts po on po.person_id = p.id and po.month = m.f
  where (my_role() = 'admin' or p.id = auth.uid())
    and (coalesce(com.v, 0) + coalesce(crd.v, 0) > 0 or po.id is not null)
  order by coalesce(com.v, 0) + coalesce(crd.v, 0) desc, p.full_name
$$;
grant execute on function month_earnings(date) to authenticated;
