-- 31: the person paying covers Paystack's fee (1.95% in Ghana).
-- The place or flyer price stays the same and is what counts for commissions and income;
-- the fee is added on top at checkout and kept in payments.fee.
insert into app_settings (key, value) values ('paystack_fee_pct', '1.95') on conflict (key) do nothing;

alter table payments add column if not exists fee numeric(10,2) not null default 0;

-- Fee to add so that, after Paystack takes its percentage of the total, the full price is left.
create or replace function paystack_fee(p_amount numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select case when coalesce(setting_num('paystack_fee_pct', 0), 0) <= 0 then 0::numeric
    else ceil(p_amount / (1 - setting_num('paystack_fee_pct', 0) / 100) * 100 - p_amount * 100) / 100 end
$$;
grant execute on function paystack_fee(numeric) to anon, authenticated;

create or replace function set_payment_fee() returns trigger language plpgsql as $$
begin
  if new.fee = 0 and new.amount > 0 then new.fee := paystack_fee(new.amount); end if;
  return new;
end $$;
drop trigger if exists set_payment_fee on payments;
create trigger set_payment_fee before insert on payments for each row execute function set_payment_fee();

create or replace function start_payment(
  p_kind text, p_listing uuid default null, p_category int default null,
  p_position text default null, p_months int default null, p_flyer uuid default null, p_level text default 'town')
returns table (reference text, amount_pesewas int, email text)
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype; f flyers%rowtype; v_amount numeric; v_ref text; v_email text; v_has_own boolean;
  v_district int; v_region smallint;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  select coalesce(p.email, u.email) into v_email from profiles p left join auth.users u on u.id = p.id where p.id = auth.uid();
  if v_email is null or v_email = '' then raise exception 'Your account has no email address'; end if;
  v_ref := 'NHY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));

  if p_kind = 'place' then
    select * into l from listings where id = p_listing;
    if not found or l.owner_id <> auth.uid() then raise exception 'You can only pay for your own listing'; end if;
    if l.status <> 'live' then raise exception 'Your listing must be approved and live first'; end if;
    if p_position not in ('top', 'featured') or p_months not in (1, 3, 6, 12) or p_level not in ('town', 'district', 'region', 'national') then
      raise exception 'Choose a level, a place and a plan';
    end if;
    if not level_allowed(l.coverage, p_level) then
      raise exception 'Your listing only covers %. Update the areas you serve to buy a wider place.', l.coverage;
    end if;
    if not exists (select 1 from listing_categories lc join categories c on c.id = lc.category_id
                   where lc.listing_id = l.id and coalesce(c.parent_id, c.id) = p_category) then
      raise exception 'Choose one of your listing''s own categories';
    end if;
    v_amount := place_price(p_level, p_position, p_months, l.base_town_id);
    if v_amount is null then raise exception 'Price not found'; end if;
    select t.district_id, d.region_id into v_district, v_region from towns t join districts d on d.id = t.district_id where t.id = l.base_town_id;
    v_has_own := exists (select 1 from featured_slots where listing_id = l.id and category_id = p_category and level = p_level
                          and coalesce(position, 'featured') = p_position and current_date between starts_on and ends_on);
    if not v_has_own and places_left_at(p_category, p_level, p_position, l.base_town_id) = 0 then
      raise exception 'Sorry, all those places are taken right now';
    end if;
    insert into payments (reference, user_id, kind, listing_id, category_id, town_id, position, months, amount, level)
      values (v_ref, auth.uid(), 'place', l.id, p_category, l.base_town_id, p_position, p_months, v_amount, p_level);

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

  return query select v_ref, round((v_amount + paystack_fee(v_amount)) * 100)::int, v_email;
end $$;

create or replace function confirm_payment(p_ref text) returns text
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype; v jsonb; d jsonb; v_start date; v_end date; v_slot uuid; v_district int; v_region smallint;
  v_label text;
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
  if (d->>'amount')::int <> round((p.amount + p.fee) * 100)::int or upper(d->>'currency') <> 'GHS' then
    update payments set status = 'needs_attention', note = 'Amount or currency did not match: ' || (d->>'amount') || ' ' || (d->>'currency') where id = p.id;
    return 'Paid, but the amount did not match. The admin will check it.';
  end if;

  if p.kind = 'place' then
    select t.district_id, dd.region_id into v_district, v_region from towns t join districts dd on dd.id = t.district_id where t.id = p.town_id;
    select id, ends_on into v_slot, v_start from featured_slots
      where listing_id = p.listing_id and category_id = p.category_id and level = p.level
        and coalesce(position, 'featured') = p.position and current_date between starts_on and ends_on
      order by ends_on desc limit 1;
    if v_slot is not null then
      v_end := (v_start + make_interval(months => p.months))::date;
      update featured_slots set ends_on = v_end, months = months + p.months, amount = amount + p.amount,
        payment_ref = coalesce(payment_ref || ', ', '') || p.reference where id = v_slot;
    elsif places_left_at(p.category_id, p.level, p.position, p.town_id) > 0 then
      v_end := (current_date + make_interval(months => p.months))::date;
      insert into featured_slots (listing_id, category_id, town_id, months, amount, is_free, starts_on, ends_on, payment_ref, created_by, position, level, district_id, region_id)
        values (p.listing_id, p.category_id, p.town_id, p.months, p.amount, false, current_date, v_end, p.reference, p.user_id, p.position, p.level, v_district, v_region);
    else
      update payments set status = 'needs_attention', paid_at = now(), channel = d->>'channel',
        note = 'Paid but the places filled up before confirmation — offer the next free place or a refund' where id = p.id;
      return 'Paid, but the places filled up meanwhile. The admin will contact you.';
    end if;
    update payments set status = 'paid', paid_at = now(), channel = d->>'channel' where id = p.id;
    v_label := case p.level when 'national' then ' across Ghana' when 'region' then ' in your region' when 'district' then ' in your district' else '' end;
    return (case p.position when 'top' then 'Your Top spot' else 'Your Featured place' end) || v_label || ' is live until ' || to_char(v_end, 'DD Mon YYYY') || '.';
  else
    update payments set status = 'paid', paid_at = now(), channel = d->>'channel' where id = p.id;
    perform set_config('eventshub.payment', 'on', true);
    update flyers set amount = p.amount, payment_ref = p.reference where id = p.flyer_id;
    perform set_config('eventshub.payment', 'off', true);
    return 'Paid. A moderator will check your flyer, then it goes live for 7 days.';
  end if;
end $$;
