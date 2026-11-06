-- NHYIAMU — bug fixes from the full check (6 Nov 2026)

-- 1) Moderator work log broke every status change except approve/reject:
--    moderators and admins could not suspend or restore listings, or close reports.
--    Cause: comparing a listing/report status to words from another list (e.g. 'approved').
create or replace function log_moderation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_old text := old.status::text;
  v_new text := new.status::text;
  v_action text;
begin
  if auth.uid() is null or my_role() not in ('moderator', 'admin') then return new; end if;
  if v_kind = 'listing' and v_old = 'pending' and v_new in ('live', 'rejected') then
    v_action := v_new;
  elsif v_kind = 'flyer' and v_old = 'pending' and v_new in ('approved', 'rejected') then
    v_action := v_new;
  elsif v_kind = 'report' and v_old = 'open' and v_new <> 'open' then
    v_action := v_new;
  else
    return new;
  end if;
  insert into moderation_log (moderator_id, kind, ref_id, action) values (auth.uid(), v_kind, new.id, v_action);
  return new;
end $$;

-- 2) Listings never auto-hid after 3 reports: the listing protection rule undid the change
--    because the person filing the 3rd report is not a moderator. Let the auto-hide through.
create or replace function auto_hide_reported() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.listing_id is not null and (
     select count(distinct reporter_id) from reports
     where listing_id = new.listing_id and status = 'open') >= 3 then
    perform set_config('eventshub.auto_hide', 'on', true);
    update listings set status = 'suspended', reject_reason = 'Hidden pending review (3+ reports)'
    where id = new.listing_id and status = 'live';
    perform set_config('eventshub.auto_hide', 'off', true);
  end if;
  return new;
end $$;

create or replace function protect_listing() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status listing_status;
begin
  new.updated_at := now();
  -- automatic hide after 3 reports: only the status and reason may change
  if coalesce(current_setting('eventshub.auto_hide', true), '') = 'on' then
    v_status := new.status;
    new := old;
    new.status := v_status;
    new.reject_reason := 'Hidden pending review (3+ reports)';
    new.updated_at := now();
    return new;
  end if;
  if not is_staff() and coalesce(current_setting('eventshub.agent_verify', true), '') <> 'on' then
    if my_role() = 'coordinator' and coord_town(old.base_town_id) and old.owner_id <> auth.uid() then
      -- coordinator on someone else's listing: only live <-> suspended may change
      v_status := case when old.status in ('live', 'suspended') and new.status in ('live', 'suspended') then new.status else old.status end;
      new := old;
      new.status := v_status;
      new.updated_at := now();
      return new;
    end if;
    new.verified      := old.verified;
    new.verified_by   := old.verified_by;
    new.verified_at   := old.verified_at;
    new.founding      := old.founding;
    new.registered_by := old.registered_by;
    new.owner_id      := old.owner_id;
    new.reject_reason := old.reject_reason;
    if new.status is distinct from old.status
       and not (new.status = 'pending' and old.status in ('draft','rejected','live'))
       and not (new.status = 'draft' and old.status = 'pending') then
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;
