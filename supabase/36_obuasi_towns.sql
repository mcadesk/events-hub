-- 36: Open Obuasi Municipal and Obuasi East Municipal.
-- Communities as named in the assemblies' own plans: Obuasi Municipal 2026-2029 MTDP and 2021 composite budget;
-- Obuasi East 2026 composite budget and assembly news (e.g. Ayease CHPS). Map positions are left empty except for
-- Obuasi; the district head or admin adds them from the Towns page (press and hold on Google Maps to copy).
-- A slug already used elsewhere in Ghana gets "-obuasi" added.

with t(district, name, base) as (values
  ('obuasi-municipal', 'Abaamu', 'abaamu'),
  ('obuasi-municipal', 'Abompe', 'abompe'),
  ('obuasi-municipal', 'Adaase', 'adaase'),
  ('obuasi-municipal', 'Anyinam', 'anyinam'),
  ('obuasi-municipal', 'Awonakrom', 'awonakrom'),
  ('obuasi-municipal', 'Bediem', 'bediem'),
  ('obuasi-municipal', 'Bogbiri', 'bogbiri'),
  ('obuasi-municipal', 'Gausu', 'gausu'),
  ('obuasi-municipal', 'Koffekrom', 'koffekrom'),
  ('obuasi-municipal', 'Kunka', 'kunka'),
  ('obuasi-municipal', 'Mangoase', 'mangoase'),
  ('obuasi-municipal', 'Mensakrom', 'mensakrom'),
  ('obuasi-municipal', 'Mimmiriwa No. 1', 'mimmiriwa-1'),
  ('obuasi-municipal', 'Mimmiriwa No. 2', 'mimmiriwa-2'),
  ('obuasi-municipal', 'New Baakoyeden', 'new-baakoyeden'),
  ('obuasi-municipal', 'New Nsuta', 'new-nsuta'),
  ('obuasi-municipal', 'Nyanferase', 'nyanferase'),
  ('obuasi-municipal', 'Sanso', 'sanso'),
  ('obuasi-east-municipal', 'Ahansonyewodea', 'ahansonyewodea'),
  ('obuasi-east-municipal', 'Akaporiso', 'akaporiso'),
  ('obuasi-east-municipal', 'Asonkore', 'asonkore'),
  ('obuasi-east-municipal', 'Ayease', 'ayease'),
  ('obuasi-east-municipal', 'Boete', 'boete'),
  ('obuasi-east-municipal', 'Bossman', 'bossman'),
  ('obuasi-east-municipal', 'Brahabebome', 'brahabebome'),
  ('obuasi-east-municipal', 'Diawuoso', 'diawuoso'),
  ('obuasi-east-municipal', 'Domeabra', 'domeabra'),
  ('obuasi-east-municipal', 'Kwabenakwa', 'kwabenakwa'),
  ('obuasi-east-municipal', 'Kwabrafoso', 'kwabrafoso'),
  ('obuasi-east-municipal', 'Mampamhwe', 'mampamhwe'),
  ('obuasi-east-municipal', 'Nyamesomyede', 'nyamesomyede'),
  ('obuasi-east-municipal', 'Odumasi', 'odumasi'),
  ('obuasi-east-municipal', 'Pomposo', 'pomposo'),
  ('obuasi-east-municipal', 'Sampsonkrom', 'sampsonkrom'),
  ('obuasi-east-municipal', 'Tutuka Tiatiaso', 'tutuka-tiatiaso'),
  ('obuasi-east-municipal', 'Wawasi', 'wawasi')
)
insert into towns (district_id, name, slug, active)
select d.id, t.name,
  case when exists (select 1 from towns x where x.slug = t.base) then t.base || '-obuasi' else t.base end,
  true
from t join districts d on d.slug = t.district
where not exists (select 1 from towns x where x.district_id = d.id and lower(x.name) = lower(t.name))
on conflict (slug) do nothing;

-- Show the two capitals too, and put Obuasi on the map
update towns set active = true
where slug in ('obuasi', 'tutuka') and district_id in (select id from districts where slug in ('obuasi-municipal', 'obuasi-east-municipal'));
update towns set lat = 6.2000, lng = -1.6830 where slug = 'obuasi' and lat is null;

select d.name as municipality, count(*) as towns, count(*) filter (where t.active) as shown
from towns t join districts d on d.id = t.district_id
where d.slug in ('obuasi-municipal', 'obuasi-east-municipal') group by d.name;
