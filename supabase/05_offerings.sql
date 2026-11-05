-- Events Hub — allow any number of offerings (categories) per listing.
-- Photos stay limited to 10 by the same check_listing_limits() function.
drop trigger if exists limit_categories on public.listing_categories;
