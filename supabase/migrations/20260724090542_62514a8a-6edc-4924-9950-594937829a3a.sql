
WITH adj(name, primary_share, aoe_share, cap) AS (
  VALUES
    ('The Rot-King of Hollow-Rib', 0.55, 0.55, 80),
    ('Rell Vane, the Third Cut', 1.15, 0.0, 84),
    ('Thrum the Stone-King', 1.0, 0.15, 96),
    ('Ithrak Vaal, the Ashen Arcanist', 0.65, 0.6, 104),
    ('Ser Caldris, the Drowned Blade', 0.65, 0.55, 112),
    ('Aelthir the Rootbound Seer', 0.55, 0.45, 128),
    ('Khar-Zul the Unmoving', 1.2, 0.0, 160),
    ('Skeldrath, the Shattered Peak', 0.65, 0.65, 128),
    ('Maelor Ashvein, the Far-Stalker', 0.85, 0.25, 165),
    ('Aureth, the Returning Flame', 0.45, 0.75, 111),
    ('Ignis Colossus', 0.65, 0.65, 148),
    ('Orath Veyl, Keeper of the Turning Mind', 0.75, 0.5, 148),
    ('Vaeroth, the Sleeping Hoard', 0.9, 0.45, 195),
    ('Vel’kaar, the Unbound Executioner', 1.25, 0.1, 117),
    ('Zhar’gorath, the Chain of Cinders', 0.9, 0.35, 156),
    ('King Aldric Vael, the Unbroken', 1.0, 0.3, 176)
)
UPDATE public.creatures c
SET boss_cast = COALESCE(c.boss_cast, '{}'::jsonb)
  || jsonb_build_object(
       'stored_power',
       COALESCE(c.boss_cast->'stored_power', '{}'::jsonb)
         || jsonb_build_object(
              'consume_mode',  'all',
              'primary_share', adj.primary_share,
              'aoe_share',     adj.aoe_share,
              'cap',           adj.cap
            )
     )
FROM adj
WHERE c.rarity = 'boss' AND c.name = adj.name;
