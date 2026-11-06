-- NHYIAMU — new category: Market sellers & foodstuffs (market women and traders selling ingredients for home cooking)
update categories set sort = sort + 1 where parent_id is null and sort >= 5
  and not exists (select 1 from categories where slug = 'market');
insert into categories (name, slug, tier, sort) values ('Market sellers & foodstuffs', 'market', 'standard', 5)
on conflict (slug) do nothing;
insert into categories (parent_id, name, slug, tier, sort)
select p.id, s.name, s.slug, 'standard', s.sort
from (values
  ('Foodstuffs (yam, plantain, cassava, gari)', 'market-foodstuffs', 1),
  ('Vegetables, tomatoes and pepper',            'market-vegetables', 2),
  ('Fish and meat',                              'market-fish-meat', 3),
  ('Rice, oil and provisions',                   'market-provisions', 4),
  ('Spices and ingredients',                     'market-spices', 5),
  ('Fruits',                                     'market-fruits', 6),
  ('Eggs and poultry',                           'market-poultry', 7),
  ('Drinks and water (wholesale)',               'market-drinks', 8)
) as s(name, slug, sort)
cross join (select id from categories where slug = 'market') p
on conflict (slug) do nothing;
select name, sort from categories where parent_id is null order by sort limit 7;
