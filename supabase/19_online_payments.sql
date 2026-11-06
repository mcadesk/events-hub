-- NHYIAMU — online payments with Paystack (MoMo and cards). Clients pay NHYIAMU directly, so no
-- agent or helper ever handles money.
--   1. start_payment()   : the site asks for a payment. Price and availability are worked out HERE
--                          (never trusted from the phone). Returns a reference for the Paystack window.
--   2. Client pays in the Paystack window.
--   3. confirm_payment() : asks Paystack directly whether that reference was paid, the right amount, in
--                          cedis. Only then is the Top spot / Featured place switched on, or the flyer
--                          marked paid. Safe to call more than once.
-- The Paystack SECRET key lives only in Supabase Vault (name: paystack_secret). Nobody can read it from the site.

create extension if not exists http with schema extensions;

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  user_id      uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('place', 'flyer')),
  listing_id   uuid references listings(id) on delete set null,
  category_id  int references categories(id),
  town_id      int references towns(id),
  position     text check (position in ('top', 'featured')),
  months       smallint,
  flyer_id     uuid references flyers(id) on delete set null,
  amount       numeric(10,2) not null check (amount > 0),
  status       text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'needs_attention')),
  channel      text,
  note         text,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists payments_user on payments(user_id, created_at desc);
create index if not exists payments_flyer on payments(flyer_id);
alter table payments enable row level security;
drop policy if exists "own or admin read" on payments;
create policy "own or admin read" on payments for select using (user_id = auth.uid() or is_staff());
-- no insert/update policies: rows are only written by the functions below

insert into app_settings (key, value) values ('online_payments', 'on') on conflict (key) do nothing;

-- How many places of a level are left in a category in a town
create or replace function places_left(p_category int, p_town int, p_position text) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, (case p_position when 'top' then 2 else 3 end) - (
    select count(*)::int from featured_slots
    where category_id = p_category and town_id = p_town and coalesce(position, 'featured') = p_position
      and current_date between starts_on and ends_on))
$$;
grant execute on function places_left(int, int, text) to anon, authenticated;

create or replace function start_payment(
  p_kind text, p_listing uuid default null, p_category int default null,
  p_position text default null, p_months int default null, p_flyer uuid default null)
returns table (reference text, amount_pesewas int, email text)
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype; f flyers%rowtype; v_amount numeric; v_ref text; v_email text; v_has_own boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  select coalesce(p.email, u.email) into v_email from profiles p left join auth.users u on u.id = p.id where p.id = auth.uid();
  if v_email is null or v_email = '' then raise exception 'Your account has no email address'; end if;
  v_ref := 'NHY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));

  if p_kind = 'place' then
    select * into l from listings where id = p_listing;
    if not found or l.owner_id <> auth.uid() then raise exception 'You can only pay for your own listing'; end if;
    if l.status <> 'live' then raise exception 'Your listing must be approved and live first'; end if;
    if p_position not in ('top', 'featured') or p_months not in (1, 3, 6, 12) then raise exception 'Choose a place and a plan'; end if;
    if not exists (select 1 from listing_categories lc join categories c on c.id = lc.category_id
                   where lc.listing_id = l.id and coalesce(c.parent_id, c.id) = p_category) then
      raise exception 'Choose one of your listing''s own categories';
    end if;
    select amount into v_amount from featured_prices
      where tier = (case p_position when 'top' then 'premium' else 'standard' end)::category_tier and months = p_months;
    if v_amount is null then raise exception 'Price not found'; end if;
    v_has_own := exists (select 1 from featured_slots where listing_id = l.id and category_id = p_category and town_id = l.base_town_id
                          and coalesce(position, 'featured') = p_position and current_date between starts_on and ends_on);
    if not v_has_own and places_left(p_category, l.base_town_id, p_position) = 0 then
      raise exception 'Sorry, all those places are taken in your town right now';
    end if;
    insert into payments (reference, user_id, kind, listing_id, category_id, town_id, position, months, amount)
      values (v_ref, auth.uid(), 'place', l.id, p_category, l.base_town_id, p_position, p_months, v_amount);

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
grant execute on function start_payment(text, uuid, int, text, int, uuid) to authenticated;

-- Ask Paystack about a reference (kept separate so it can be tested without real calls)
create or replace function paystack_verify(p_ref text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_res record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret' limit 1;
  if v_secret is null then raise exception 'Online payments are not set up yet (missing Paystack key)'; end if;
  select status, content into v_res from extensions.http((
    'GET', 'https://api.paystack.co/transaction/verify/' || p_ref,
    array[extensions.http_header('Authorization', 'Bearer ' || v_secret)], null, null)::extensions.http_request);
  return v_res.content::jsonb;
end $$;
revoke all on function paystack_verify(text) from public, anon, authenticated;

create or replace function confirm_payment(p_ref text) returns text
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype; v jsonb; d jsonb; v_start date; v_end date; v_slot uuid;
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
    -- extend an existing place of the same kind, otherwise start today (if a place is still free)
    select id, ends_on into v_slot, v_start from featured_slots
      where listing_id = p.listing_id and category_id = p.category_id and town_id = p.town_id
        and coalesce(position, 'featured') = p.position and current_date between starts_on and ends_on
      order by ends_on desc limit 1;
    if v_slot is not null then
      v_end := (v_start + make_interval(months => p.months))::date;
      update featured_slots set ends_on = v_end, months = months + p.months, amount = amount + p.amount,
        payment_ref = coalesce(payment_ref || ', ', '') || p.reference where id = v_slot;
    elsif places_left(p.category_id, p.town_id, p.position) > 0 then
      v_end := (current_date + make_interval(months => p.months))::date;
      insert into featured_slots (listing_id, category_id, town_id, months, amount, is_free, starts_on, ends_on, payment_ref, created_by, position)
        values (p.listing_id, p.category_id, p.town_id, p.months, p.amount, false, current_date, v_end, p.reference, p.user_id, p.position);
    else
      update payments set status = 'needs_attention', paid_at = now(), channel = d->>'channel',
        note = 'Paid but the places filled up before confirmation — offer the next free place or a refund' where id = p.id;
      return 'Paid, but the places filled up meanwhile. The admin will contact you.';
    end if;
    update payments set status = 'paid', paid_at = now(), channel = d->>'channel' where id = p.id;
    return (case p.position when 'top' then 'Your Top spot' else 'Your Featured place' end) || ' is live until ' || to_char(v_end, 'DD Mon YYYY') || '.';
  else
    update payments set status = 'paid', paid_at = now(), channel = d->>'channel' where id = p.id;
    perform set_config('eventshub.payment', 'on', true);
    update flyers set amount = p.amount, payment_ref = p.reference where id = p.flyer_id;
    perform set_config('eventshub.payment', 'off', true);
    return 'Paid. A moderator will check your flyer, then it goes live for 7 days.';
  end if;
end $$;
grant execute on function confirm_payment(text) to authenticated;

-- Flyers: moderators can only approve flyers that are free or paid online; only the admin can record a manual payment
create or replace function approve_flyer(p_id uuid, p_amount numeric, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare f flyers%rowtype; pay payments%rowtype; v_amount numeric; v_ref text;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select * into f from flyers where id = p_id;
  if not found then raise exception 'Flyer not found'; end if;
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
  update flyers set status = 'approved', reject_reason = null, starts_on = current_date,
    ends_on = current_date + 6, amount = v_amount, payment_ref = v_ref, approved_by = auth.uid()
  where id = p_id;
end $$;

-- Flyer owners still can't change payment fields themselves; only confirm_payment may record them
create or replace function protect_flyer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
