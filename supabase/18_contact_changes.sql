-- NHYIAMU — a supplier's new phone / WhatsApp number on a live listing waits for a moderator.
-- The listing stays visible with the old numbers until the change is approved.

alter table listings add column if not exists pending_contact jsonb;

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

create or replace function approve_contact_change(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pc jsonb;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select pending_contact into pc from listings where id = p_id;
  if pc is null then raise exception 'No number change waiting'; end if;
  update listings set phone = pc->>'phone', whatsapp = pc->>'whatsapp', pending_contact = null where id = p_id;
  insert into moderation_log (moderator_id, kind, ref_id, action) values (auth.uid(), 'listing', p_id, 'contact_approved');
end $$;

create or replace function reject_contact_change(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update listings set pending_contact = null where id = p_id and pending_contact is not null;
  if found then
    insert into moderation_log (moderator_id, kind, ref_id, action) values (auth.uid(), 'listing', p_id, 'contact_rejected');
  end if;
end $$;
grant execute on function approve_contact_change(uuid) to authenticated;
grant execute on function reject_contact_change(uuid) to authenticated;
