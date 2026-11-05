-- =====================================================================
-- Events Hub — database setup (part 2: starting data)
-- =====================================================================

-- ---------- Places ---------------------------------------------------
insert into regions (name, slug) values ('Ashanti', 'ashanti');

insert into districts (region_id, name, slug) values
  ((select id from regions where slug = 'ashanti'), 'Ejisu Municipal',  'ejisu-municipal'),
  ((select id from regions where slug = 'ashanti'), 'Juaben Municipal', 'juaben-municipal');

-- Main towns to start with. More towns are added from the admin screen.
insert into towns (district_id, name, slug)
select d.id, t.name, t.slug
from (values
  ('ejisu-municipal',  'Ejisu-Besease',  'ejisu-besease'),
  ('ejisu-municipal',  'Ejisu',          'ejisu'),
  ('ejisu-municipal',  'Bonwire',        'bonwire'),
  ('ejisu-municipal',  'Onwe',           'onwe'),
  ('ejisu-municipal',  'Boankra',        'boankra'),
  ('ejisu-municipal',  'Fumesua',        'fumesua'),
  ('ejisu-municipal',  'Kwamo',          'kwamo'),
  ('juaben-municipal', 'Juaben',         'juaben'),
  ('juaben-municipal', 'Adumasa',        'adumasa'),
  ('juaben-municipal', 'Achiase',        'achiase'),
  ('juaben-municipal', 'Nobewam',        'nobewam'),
  ('juaben-municipal', 'Yaw Nkrumah',    'yaw-nkrumah'),
  ('juaben-municipal', 'New Bomfa',      'new-bomfa'),
  ('juaben-municipal', 'Kubease',        'kubease'),
  ('juaben-municipal', 'Dumakwai',       'dumakwai'),
  ('juaben-municipal', 'Duampompo',      'duampompo'),
  ('juaben-municipal', 'Atia',           'atia'),
  ('juaben-municipal', 'New Koforidua',  'new-koforidua'),
  ('juaben-municipal', 'Boamadumasi',    'boamadumasi'),
  ('juaben-municipal', 'Esaase',         'esaase'),
  ('juaben-municipal', 'Nkyerepoaso',    'nkyerepoaso'),
  ('juaben-municipal', 'Odoyefe',        'odoyefe')
) as t(district, name, slug)
join districts d on d.slug = t.district;

-- ---------- Categories (top level) -----------------------------------
insert into categories (name, slug, tier, sort) values
  ('Event centres and venues',     'venues',        'premium',   1),
  ('Event planners and managers',  'planners',      'premium',   2),
  ('Rentals and logistics',        'rentals',       'standard',  3),
  ('Food and drinks',              'food-drinks',   'standard',  4),
  ('Decorators',                   'decorators',    'standard',  5),
  ('Clothing',                     'clothing',      'standard',  6),
  ('Beauty',                       'beauty',        'standard',  7),
  ('Accommodation',                'accommodation', 'premium',   8),
  ('Transport',                    'transport',     'standard',  9),
  ('Media and PR',                 'media-pr',      'standard', 10),
  ('Photo and video',              'photo-video',   'standard', 11),
  ('Entertainment',                'entertainment', 'standard', 12),
  ('Ushers and protocol',          'ushers',        'standard', 13),
  ('Printing and branding',        'printing',      'standard', 14),
  ('Power',                        'power',         'standard', 15),
  ('Security and safety',          'security',      'standard', 16),
  ('Sanitation',                   'sanitation',    'standard', 17),
  ('Funeral services',             'funeral',       'standard', 18),
  ('Event finance',                'finance',       'standard', 19),
  ('Other services',               'other',         'standard', 20);

-- ---------- Subcategories --------------------------------------------
insert into categories (parent_id, name, slug, tier, sort)
select p.id, s.name, s.slug, p.tier, s.sort
from (values
  ('venues','Halls','venues-halls',1), ('venues','Gardens and outdoor','venues-outdoor',2),
  ('venues','Hotel halls','venues-hotel',3), ('venues','Church and school halls','venues-church-school',4),
  ('venues','Parks','venues-parks',5),
  ('planners','Full planning','planners-full',1), ('planners','Day-of coordination','planners-day-of',2),
  ('planners','Wedding planners','planners-wedding',3), ('planners','Funeral organisers','planners-funeral',4),
  ('rentals','Canopies','rentals-canopies',1), ('rentals','Chairs','rentals-chairs',2),
  ('rentals','Tables','rentals-tables',3), ('rentals','Tents','rentals-tents',4),
  ('rentals','Stages','rentals-stages',5), ('rentals','Sound and PA','rentals-sound',6),
  ('rentals','Lighting','rentals-lighting',7), ('rentals','LED screens','rentals-led',8),
  ('food-drinks','Caterers','food-caterers',1), ('food-drinks','Food vendors','food-vendors',2),
  ('food-drinks','Drinks suppliers','food-drinks-suppliers',3), ('food-drinks','Bartenders','food-bartenders',4),
  ('food-drinks','Cakes and bakers','food-cakes',5), ('food-drinks','Small chops','food-small-chops',6),
  ('decorators','Venue decor','decor-venue',1), ('decorators','Florists','decor-florists',2),
  ('decorators','Balloon art','decor-balloons',3), ('decorators','Backdrops','decor-backdrops',4),
  ('clothing','Cloth sellers','clothing-cloth',1), ('clothing','Kente','clothing-kente',2),
  ('clothing','Tailors','clothing-tailors',3), ('clothing','Seamstresses','clothing-seamstresses',4),
  ('clothing','Uniform and group orders','clothing-group',5),
  ('beauty','Makeup','beauty-makeup',1), ('beauty','Hair','beauty-hair',2),
  ('beauty','Barbers','beauty-barbers',3), ('beauty','Nails','beauty-nails',4),
  ('accommodation','Hotels','accommodation-hotels',1), ('accommodation','Guest houses','accommodation-guest-houses',2),
  ('accommodation','Short-stay apartments','accommodation-apartments',3),
  ('transport','Buses','transport-buses',1), ('transport','Car rental','transport-cars',2),
  ('transport','Wedding cars','transport-wedding',3), ('transport','Haulage','transport-haulage',4),
  ('media-pr','TV','media-tv',1), ('media-pr','Radio','media-radio',2),
  ('media-pr','Information centres','media-info-centres',3), ('media-pr','PR agencies','media-pr-agencies',4),
  ('media-pr','Influencers','media-influencers',5),
  ('photo-video','Photographers','photo-photographers',1), ('photo-video','Videographers','photo-videographers',2),
  ('photo-video','Drone','photo-drone',3), ('photo-video','Live-streaming','photo-live',4),
  ('entertainment','MCs','ent-mcs',1), ('entertainment','DJs','ent-djs',2), ('entertainment','Bands','ent-bands',3),
  ('entertainment','Cultural troupes','ent-cultural',4), ('entertainment','Choirs','ent-choirs',5),
  ('entertainment','Kids'' entertainment','ent-kids',6),
  ('ushers','Ushering teams','ushers-teams',1), ('ushers','Protocol officers','ushers-protocol',2),
  ('ushers','Hostesses','ushers-hostesses',3),
  ('printing','Invitations','print-invitations',1), ('printing','Programme booklets','print-programmes',2),
  ('printing','Banners','print-banners',3), ('printing','Customised T-shirts','print-tshirts',4),
  ('printing','Souvenirs','print-souvenirs',5),
  ('power','Generator rental','power-generators',1), ('power','Electricians','power-electricians',2),
  ('security','Private security','security-private',1), ('security','Medical standby','security-medical',2),
  ('security','Ambulance','security-ambulance',3),
  ('sanitation','Mobile toilets','sanitation-toilets',1), ('sanitation','Cleaning crews','sanitation-cleaning',2),
  ('sanitation','Waste collection','sanitation-waste',3),
  ('funeral','Funeral homes','funeral-homes',1), ('funeral','Hearse','funeral-hearse',2),
  ('funeral','Coffin makers','funeral-coffins',3), ('funeral','Mortuaries','funeral-mortuaries',4),
  ('finance','Credit unions','finance-credit-unions',1), ('finance','Banks','finance-banks',2),
  ('finance','Savings and loans','finance-sl',3), ('finance','Microfinance','finance-mfi',4),
  ('other','Ticketing','other-ticketing',1), ('other','Insurance','other-insurance',2),
  ('other','Interpreters','other-interpreters',3), ('other','Sign language','other-sign-language',4)
) as s(parent, name, slug, sort)
join categories p on p.slug = s.parent;

-- ---------- Featured prices (GH₵) ------------------------------------
insert into featured_prices (tier, months, amount) values
  ('standard', 1,  50), ('standard', 3, 135), ('standard', 6, 240), ('standard', 12, 420),
  ('premium',  1, 100), ('premium',  3, 270), ('premium',  6, 480), ('premium',  12, 840);
