-- NHYIAMU — regional coordinator pay: 10% of the region's income each month
-- (Top spot / Featured payments recorded for towns in the region + flyer fees for events in the region).
-- Donations are never counted. Deals a coordinator brings in (partners, sponsors, adverts) are added by hand.

insert into app_settings (key, value) values ('coordinator_rate', '10') on conflict (key) do nothing;

create or replace function coordinator_earnings(p_from date, p_to date)
returns table (region_id smallint, region_name text, coordinator_id uuid, coordinator_name text, coordinator_email text,
               place_income numeric, flyer_income numeric, total_income numeric, earnings numeric)
language sql stable security definer set search_path = public as $$
  with inc as (
    select r.id as region_id, r.name as region_name,
      coalesce((select sum(f.amount) from featured_slots f join towns t on t.id = f.town_id join districts d on d.id = t.district_id
                where d.region_id = r.id and not f.is_free and f.created_at::date between p_from and p_to), 0) as place_income,
      coalesce((select sum(fl.amount) from flyers fl join towns t on t.id = fl.town_id join districts d on d.id = t.district_id
                where d.region_id = r.id and fl.status = 'approved' and fl.starts_on between p_from and p_to), 0) as flyer_income
    from regions r
  ),
  rows as (
    select i.*, cr.coordinator_id, p.full_name, p.email,
           count(cr.coordinator_id) over (partition by i.region_id) as n_coord
    from inc i
    left join coordinator_regions cr on cr.region_id = i.region_id
    left join profiles p on p.id = cr.coordinator_id
  )
  select region_id, region_name, coordinator_id, full_name, email,
         place_income, flyer_income, place_income + flyer_income,
         case when coordinator_id is null then 0
              else round((place_income + flyer_income) * setting_num('coordinator_rate', 10) / 100 / greatest(n_coord, 1), 2) end
  from rows
  where (my_role() = 'admin' and (coordinator_id is not null or place_income + flyer_income > 0))
     or (coordinator_id = auth.uid())
  order by place_income + flyer_income desc, region_name
$$;
grant execute on function coordinator_earnings(date, date) to authenticated;
