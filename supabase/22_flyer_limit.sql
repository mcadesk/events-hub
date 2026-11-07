-- NHYIAMU — flyer limit: apart from event hosts (live listing as Event centre/venue or Event planner),
-- suppliers with an active paid/Founding place, GH₵100+ donors and staff, an account may post
-- 3 flyers in any rolling 2 months. Both numbers are settings the admin can change.
insert into app_settings (key, value) values ('flyer_limit_count', '3'), ('flyer_limit_days', '60')
on conflict (key) do nothing;

create or replace function is_event_host(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from listings l
    join listing_categories lc on lc.listing_id = l.id
    join categories c on c.id = lc.category_id
    left join categories p on p.id = c.parent_id
    where l.owner_id = p_user and l.status = 'live'
      and coalesce(p.slug, c.slug) in ('venues', 'planners'))
$$;

create or replace function limit_flyers() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_count int; v_limit int := setting_num('flyer_limit_count', 3)::int; v_days int := setting_num('flyer_limit_days', 60)::int;
begin
  if is_staff() or is_event_host(new.owner_id) then return new; end if;
  if exists (select 1 from featured_slots f join listings l on l.id = f.listing_id
             where l.owner_id = new.owner_id and current_date between f.starts_on and f.ends_on) then return new; end if;
  if coalesce((select sum(amount) from donations where user_id = new.owner_id and donated_on > current_date - 365), 0)
     >= setting_num('donor_flyer_min', 100) then return new; end if;
  select count(*) into v_count from flyers where owner_id = new.owner_id and created_at > now() - make_interval(days => v_days);
  if v_count >= v_limit then
    raise exception 'You can post % flyers every % days. Event centres, event planners, paid-place holders and donors have no limit.', v_limit, v_days;
  end if;
  return new;
end $$;
drop trigger if exists flyer_limit on flyers;
create trigger flyer_limit before insert on flyers for each row execute function limit_flyers();
