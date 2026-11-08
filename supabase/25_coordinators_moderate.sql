-- NHYIAMU — no separate moderators: each regional coordinator checks new listings, flyers, number changes,
-- reports and reviews for their own region (the admin covers regions without a coordinator).
-- A coordinator can't approve a listing they own or registered themselves — the admin does.
-- Coordinator pay rises to 15% of their region's income. The moderator role stays in the system but is not used.

update app_settings set value = '15' where key = 'coordinator_rate';
insert into app_settings (key, value) values ('coordinator_rate', '15') on conflict (key) do nothing;
update app_settings set value = '0' where key = 'moderator_rate';

-- staff, or the coordinator of that town's region acting on someone else's item
create or replace function can_moderate(p_town int, p_owner uuid, p_registered uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff() or (my_role() = 'coordinator' and coord_town(p_town)
                        and p_owner is distinct from auth.uid() and p_registered is distinct from auth.uid())
$$;
grant execute on function can_moderate(int, uuid, uuid) to authenticated;

create or replace function protect_listing() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status listing_status;
begin
  new.updated_at := now();
  -- a moderation action already checked by approve/reject functions (coordinators in their region)
  if coalesce(current_setting('eventshub.moderate', true), '') = 'on' then return new; end if;
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
    -- phone / WhatsApp changes on a live (or suspended) listing wait for a moderator;
    -- the old numbers stay on the listing until then
    new.pending_contact := old.pending_contact;
    if old.status in ('live', 'suspended') and (new.phone is distinct from old.phone or new.whatsapp is distinct from old.whatsapp) then
      new.pending_contact := jsonb_build_object('phone', new.phone, 'whatsapp', new.whatsapp, 'at', now());
      new.phone := old.phone;
      new.whatsapp := old.whatsapp;
    end if;
    if new.status is distinct from old.status
       and not (new.status = 'pending' and old.status in ('draft','rejected','live'))
       and not (new.status = 'draft' and old.status = 'pending') then
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;


create or replace function approve_listing(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype;
  v_cat int;
  v_note text := 'Approved.';
begin
  select * into l from listings where id = p_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if not can_moderate(l.base_town_id, l.owner_id, l.registered_by) then
    raise exception 'Not allowed%', case when my_role() = 'coordinator' and coord_town(l.base_town_id) then ' — you registered this listing, so the admin approves it' else '' end;
  end if;
  perform set_config('eventshub.moderate', 'on', true);

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
  perform set_config('eventshub.moderate', 'off', true);
  return v_note;
end $$;


create or replace function reject_listing(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare l listings%rowtype;
begin
  select * into l from listings where id = p_id;
  if not found then raise exception 'Listing not found'; end if;
  if not can_moderate(l.base_town_id, l.owner_id, l.registered_by) then raise exception 'Not allowed'; end if;
  perform set_config('eventshub.moderate', 'on', true);
  update listings set status = 'rejected', reject_reason = p_reason where id = p_id;
  perform set_config('eventshub.moderate', 'off', true);
end $$;

create or replace function approve_flyer(p_id uuid, p_amount numeric, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare f flyers%rowtype; pay payments%rowtype; v_amount numeric; v_ref text;
begin
  select * into f from flyers where id = p_id;
  if not found then raise exception 'Flyer not found'; end if;
  if not can_moderate(f.town_id, f.owner_id, null) then raise exception 'Not allowed'; end if;
  select * into pay from payments where flyer_id = p_id and status = 'paid' order by paid_at desc limit 1;
  if pay.id is not null then
    v_amount := pay.amount; v_ref := pay.reference;
  elsif has_paid_plan(f.owner_id) then
    v_amount := 0; v_ref := 'FREE (paid place, Founding place or GH₵ 100+ donor)';
  elsif my_role() = 'admin' and coalesce(p_ref, '') <> '' then
    v_amount := p_amount; v_ref := 'MANUAL: ' || p_ref;
  else
    raise exception 'This flyer has not been paid for yet';
  end if;
  perform set_config('eventshub.moderate', 'on', true);
  update flyers set status = 'approved', reject_reason = null, starts_on = current_date,
    ends_on = current_date + 6, amount = v_amount, payment_ref = v_ref, approved_by = auth.uid()
  where id = p_id;
  perform set_config('eventshub.moderate', 'off', true);
end $$;


create or replace function reject_flyer(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare f flyers%rowtype;
begin
  select * into f from flyers where id = p_id;
  if not found then raise exception 'Flyer not found'; end if;
  if not can_moderate(f.town_id, f.owner_id, null) then raise exception 'Not allowed'; end if;
  perform set_config('eventshub.moderate', 'on', true);
  update flyers set status = 'rejected', reject_reason = p_reason where id = p_id;
  perform set_config('eventshub.moderate', 'off', true);
end $$;

create or replace function protect_flyer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('eventshub.moderate', true), '') = 'on' then return new; end if;
  if not is_staff() then
    new.status := case when old.status = 'rejected' then 'pending' else old.status end;
    new.starts_on := old.starts_on; new.ends_on := old.ends_on;
    new.approved_by := old.approved_by;
    new.owner_id := old.owner_id;
    if coalesce(current_setting('eventshub.payment', true), '') <> 'on' then
      new.amount := old.amount; new.payment_ref := old.payment_ref;
    end if;
  end if;
  return new;
end $$;

create or replace function has_paid_plan(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_user <> auth.uid() and not is_staff() and my_role() is distinct from 'coordinator' then null else (
    exists (select 1 from featured_slots f join listings l on l.id = f.listing_id
            where l.owner_id = p_user and current_date between f.starts_on and f.ends_on)
    or coalesce((select sum(amount) from donations where user_id = p_user and donated_on > current_date - 365), 0)
       >= setting_num('donor_flyer_min', 100)) end
$$;


create or replace function approve_contact_change(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l listings%rowtype;
begin
  select * into l from listings where id = p_id;
  if not found or l.pending_contact is null then raise exception 'No number change waiting'; end if;
  if not can_moderate(l.base_town_id, l.owner_id, l.registered_by) then raise exception 'Not allowed'; end if;
  perform set_config('eventshub.moderate', 'on', true);
  update listings set phone = l.pending_contact->>'phone', whatsapp = l.pending_contact->>'whatsapp', pending_contact = null where id = p_id;
  perform set_config('eventshub.moderate', 'off', true);
  insert into moderation_log (moderator_id, kind, ref_id, action) values (auth.uid(), 'listing', p_id, 'contact_approved');
end $$;

create or replace function reject_contact_change(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l listings%rowtype;
begin
  select * into l from listings where id = p_id;
  if not found then raise exception 'Listing not found'; end if;
  if not can_moderate(l.base_town_id, l.owner_id, l.registered_by) then raise exception 'Not allowed'; end if;
  perform set_config('eventshub.moderate', 'on', true);
  update listings set pending_contact = null where id = p_id and pending_contact is not null;
  perform set_config('eventshub.moderate', 'off', true);
end $$;

-- coordinators see flyers in their region and can hide reviews on listings in their region
drop policy if exists "coordinator read flyers" on flyers;
create policy "coordinator read flyers" on flyers for select using (my_role() = 'coordinator' and coord_town(town_id));
drop policy if exists "coordinator read reviews" on reviews;
create policy "coordinator read reviews" on reviews for select using (
  my_role() = 'coordinator' and exists (select 1 from listings l where l.id = listing_id and coord_town(l.base_town_id)));
drop policy if exists "coordinator hide reviews" on reviews;
create policy "coordinator hide reviews" on reviews for update using (
  my_role() = 'coordinator' and exists (select 1 from listings l where l.id = listing_id and coord_town(l.base_town_id)));

create or replace function protect_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hidden boolean;
begin
  if is_staff() then return new; end if;
  if my_role() = 'coordinator' and new.author_id <> auth.uid()
     and exists (select 1 from listings l where l.id = new.listing_id and coord_town(l.base_town_id) and l.owner_id <> auth.uid()) then
    -- coordinator may only hide or un-hide
    v_hidden := new.hidden; new := old; new.hidden := v_hidden; return new;
  end if;
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
