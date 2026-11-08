-- 28: "Request a quote" — a customer describes their event, the supplier answers on WhatsApp.
-- Customers must be signed in. Limits: 10 requests a day per person, and only one open
-- request per supplier at a time, so suppliers don't get flooded.

create table if not exists quote_requests (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  requester_id uuid not null references profiles(id) on delete cascade,
  name         text not null check (length(name) between 2 and 80),
  phone        text not null check (phone ~ '^\+233[0-9]{9}$'),
  event_type   text check (length(event_type) <= 60),
  event_date   date,
  guests       int check (guests between 1 and 100000),
  budget       numeric(12,2) check (budget >= 0),
  details      text not null check (length(details) between 5 and 800),
  status       text not null default 'new' check (status in ('new','replied','booked','declined','closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists quote_requests_listing on quote_requests(listing_id, created_at desc);
create index if not exists quote_requests_requester on quote_requests(requester_id, created_at desc);

alter table quote_requests enable row level security;
grant select on quote_requests to authenticated;

drop policy if exists "quote read" on quote_requests;
create policy "quote read" on quote_requests for select using (
  requester_id = auth.uid()
  or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid())
  or my_role() = 'admin'
);

-- Send a request (all checks happen here; there is no direct insert)
create or replace function request_quote(
  p_listing uuid, p_name text, p_phone text, p_event_type text, p_event_date date,
  p_guests int, p_budget numeric, p_details text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_owner uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'Please sign in to request a quote'; end if;
  select owner_id, status::text into v_owner, v_status from listings where id = p_listing;
  if v_status is distinct from 'live' then raise exception 'This supplier is not taking requests right now'; end if;
  if v_owner = auth.uid() then raise exception 'You cannot request a quote from your own listing'; end if;
  if p_event_date is not null and p_event_date < current_date then raise exception 'The event date has already passed'; end if;
  if (select count(*) from quote_requests where requester_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have sent 10 requests today. Please try again tomorrow';
  end if;
  if exists (select 1 from quote_requests where requester_id = auth.uid() and listing_id = p_listing
             and status in ('new','replied') and created_at > now() - interval '14 days') then
    raise exception 'You already have an open request with this supplier. Chat with them on WhatsApp';
  end if;
  insert into quote_requests (listing_id, requester_id, name, phone, event_type, event_date, guests, budget, details)
  values (p_listing, auth.uid(), trim(p_name), p_phone, nullif(trim(p_event_type), ''), p_event_date,
          p_guests, p_budget, trim(p_details))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function request_quote(uuid, text, text, text, date, int, numeric, text) to authenticated;

-- Change the status. The supplier can mark replied/booked/declined; the customer can close their own.
create or replace function set_quote_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare q quote_requests; v_owner uuid;
begin
  select * into q from quote_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  select owner_id into v_owner from listings where id = q.listing_id;
  if v_owner = auth.uid() and p_status in ('replied','booked','declined') then null;
  elsif q.requester_id = auth.uid() and p_status = 'closed' then null;
  elsif my_role() = 'admin' and p_status in ('replied','booked','declined','closed') then null;
  else raise exception 'Not allowed';
  end if;
  update quote_requests set status = p_status, updated_at = now() where id = p_id;
end $$;
grant execute on function set_quote_status(uuid, text) to authenticated;

-- How many new requests the signed-in supplier has (for the badge on the account tabs)
create or replace function my_new_quotes() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from quote_requests q join listings l on l.id = q.listing_id
  where l.owner_id = auth.uid() and q.status = 'new'
$$;
grant execute on function my_new_quotes() to authenticated;
