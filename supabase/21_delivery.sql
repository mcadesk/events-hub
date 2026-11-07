-- NHYIAMU — delivery services: rename Transport to "Transport and delivery" and add delivery types
update categories set name = 'Transport and delivery' where slug = 'transport';
insert into categories (parent_id, name, slug, tier, sort)
select p.id, s.name, s.slug, 'standard', s.sort from (values
  ('Dispatch riders (motorbike delivery)', 'transport-dispatch', 5),
  ('Tricycle / aboboyaa goods delivery', 'transport-tricycle', 6),
  ('Market and foodstuff delivery', 'transport-market', 7),
  ('Food and cake delivery', 'transport-food', 8),
  ('Courier and parcel services', 'transport-courier', 9)
) as s(name, slug, sort) cross join (select id from categories where slug = 'transport') p
on conflict (slug) do nothing;
