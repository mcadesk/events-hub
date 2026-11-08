-- 27: map positions for the launch towns (from OpenStreetMap / Nominatim).
-- Towns whose OSM match was unsure are left empty; the admin can add them on the Towns page.
update towns t set lat = v.lat, lng = v.lng
from (values
  (1,  6.72360, -1.44873),  -- Ejisu-Besease
  (2,  6.71399, -1.46658),  -- Ejisu
  (3,  6.79334, -1.47323),  -- Bonwire
  (4,  6.68480, -1.44971),  -- Onwe
  (5,  6.69514, -1.40401),  -- Boankra
  (6,  6.71077, -1.52144),  -- Fumesua
  (7,  6.71445, -1.50325),  -- Kwamo
  (8,  6.81565, -1.42151),  -- Juaben
  (11, 6.62612, -1.29654),  -- Nobewam
  (13, 6.76309, -1.45649),  -- New Bomfa
  (14, 6.67418, -1.37317),  -- Kubease
  (16, 6.64012, -1.34175),  -- Duampompo
  (18, 6.63134, -1.32117),  -- New Koforidua
  (21, 6.76758, -1.35743),  -- Nkyerepoaso
  (22, 6.74721, -1.37448)   -- Odoyefe
) as v(id, lat, lng)
where t.id = v.id and t.lat is null;
