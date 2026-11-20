-- 37: Open Bibiani-Anhwiaso-Bekwai Municipal (Western North).
-- Main towns = seats of its 1 town council and 8 area councils (ghanadistricts.com), plus Chirano (health sub-district).
-- The municipality has about 119 communities; smaller ones can be added from the Towns page.
-- A slug already used elsewhere in Ghana gets "-sefwi" added. Map positions to be added from the Towns page.
with t(name, base) as (values
  ('Sefwi Bekwai', 'sefwi-bekwai'),
  ('Anhwiaso', 'anhwiaso'),
  ('Asawinso', 'asawinso'),
  ('Awaso', 'awaso'),
  ('Chirano', 'chirano'),
  ('Humjibre', 'humjibre'),
  ('Lineso', 'lineso'),
  ('Subri', 'subri'),
  ('Wenchi', 'wenchi')
)
insert into towns (district_id, name, slug, active)
select d.id, t.name,
  case when exists (select 1 from towns x where x.slug = t.base) then t.base || '-sefwi' else t.base end,
  true
from t join districts d on d.slug = 'bibiani-anhwiaso-bekwai-municipal'
where not exists (select 1 from towns x where x.district_id = d.id and lower(x.name) = lower(t.name))
on conflict (slug) do nothing;

update towns set active = true
where slug = 'bibiani' and district_id = (select id from districts where slug = 'bibiani-anhwiaso-bekwai-municipal');

select t.name, t.slug, t.active from towns t join districts d on d.id = t.district_id
where d.slug = 'bibiani-anhwiaso-bekwai-municipal' order by t.name;
