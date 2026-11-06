-- NHYIAMU — moderator pay: 10% of all monthly income, shared among moderators by work done.
-- Work = listings approved/rejected, flyers approved/rejected, reports closed. Logged automatically from now on.
-- Donations are never counted.

insert into app_settings (key, value) values ('moderator_rate', '10') on conflict (key) do nothing;

create table if not exists moderation_log (
  id           bigserial primary key,
  moderator_id uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('listing', 'flyer', 'report')),
  ref_id       uuid not null,
  action       text not null,
  created_at   timestamptz not null default now()
);
create index if not exists moderation_log_when on moderation_log(created_at, moderator_id);
alter table moderation_log enable row level security;
drop policy if exists "admin or own" on moderation_log;
create policy "admin or own" on moderation_log for select using (my_role() = 'admin' or moderator_id = auth.uid());

create or replace function log_moderation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text := tg_argv[0]; v_action text;
begin
  if auth.uid() is null or my_role() not in ('moderator', 'admin') then return new; end if;
  if v_kind = 'listing' and old.status = 'pending' and new.status in ('live', 'rejected') then
    v_action := new.status::text;
  elsif v_kind = 'flyer' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    v_action := new.status;
  elsif v_kind = 'report' and old.status = 'open' and new.status <> 'open' then
    v_action := new.status::text;
  else
    return new;
  end if;
  insert into moderation_log (moderator_id, kind, ref_id, action) values (auth.uid(), v_kind, new.id, v_action);
  return new;
end $$;

drop trigger if exists log_listing_moderation on listings;
create trigger log_listing_moderation after update of status on listings for each row execute function log_moderation('listing');
drop trigger if exists log_flyer_moderation on flyers;
create trigger log_flyer_moderation after update of status on flyers for each row execute function log_moderation('flyer');
drop trigger if exists log_report_moderation on reports;
create trigger log_report_moderation after update of status on reports for each row execute function log_moderation('report');

-- Monthly pay: pool = 10% of the month's income; each moderator's share = their work / all moderators' work.
-- Work done by the admin is not paid and does not reduce the moderators' shares.
create or replace function moderator_earnings(p_from date, p_to date)
returns table (moderator_id uuid, moderator_name text, moderator_email text,
               listings bigint, flyers bigint, reports bigint, work bigint,
               month_income numeric, pool numeric, earnings numeric)
language sql stable security definer set search_path = public as $$
  with income as (
    select coalesce((select sum(amount) from featured_slots where not is_free and created_at::date between p_from and p_to), 0)
         + coalesce((select sum(amount) from flyers where status = 'approved' and starts_on between p_from and p_to), 0) as total
  ),
  work as (
    select p.id, p.full_name, p.email,
      count(*) filter (where m.kind = 'listing') as listings,
      count(*) filter (where m.kind = 'flyer')   as flyers,
      count(*) filter (where m.kind = 'report')  as reports,
      count(m.id) as work
    from profiles p
    left join moderation_log m on m.moderator_id = p.id and m.created_at::date between p_from and p_to
    where p.role = 'moderator'
    group by p.id, p.full_name, p.email
  ),
  tot as (select sum(work) as all_work from work)
  select w.id, w.full_name, w.email, w.listings, w.flyers, w.reports, w.work,
         i.total, round(i.total * setting_num('moderator_rate', 10) / 100, 2),
         case when coalesce(t.all_work, 0) = 0 then 0
              else round(i.total * setting_num('moderator_rate', 10) / 100 * w.work / t.all_work, 2) end
  from work w cross join income i cross join tot t
  where my_role() = 'admin' or w.id = auth.uid()
  order by w.work desc, w.full_name
$$;
grant execute on function moderator_earnings(date, date) to authenticated;
