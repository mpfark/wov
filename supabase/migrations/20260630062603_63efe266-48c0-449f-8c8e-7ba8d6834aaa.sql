-- ── Gear Catalog Overhaul (Plain-Base Tiers) ─────────────────────────────

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS tier smallint,
  ADD COLUMN IF NOT EXISTS weapon_die text;

DROP TABLE IF EXISTS public.forge_pool;

UPDATE public.marketplace_listings ml
   SET status = 'cancelled'
  FROM public.items i
 WHERE ml.item_id = i.id
   AND ml.status = 'active'
   AND i.rarity::text IN ('common','uncommon')
   AND i.origin_type IN ('archetype_seed','plain_base');

DELETE FROM public.character_inventory ci
 USING public.items i
 WHERE ci.item_id = i.id
   AND i.rarity::text IN ('common','uncommon')
   AND i.origin_type IN ('archetype_seed','plain_base')
   AND COALESCE(i.is_soulbound, false) = false;

DELETE FROM public.items
 WHERE rarity::text IN ('common','uncommon')
   AND origin_type IN ('archetype_seed','plain_base');

DO $seed$
DECLARE
  tiers text[][] := ARRAY[
    ARRAY['1','1','Worn'],
    ARRAY['2','11','Sturdy'],
    ARRAY['3','21','Engraved'],
    ARRAY['4','31','Runed'],
    ARRAY['5','41','Ancient']
  ];
  nw_slots jsonb := '{
    "head":["Helm","Hood","Circlet"],
    "chest":["Plate","Vest","Robe"],
    "gloves":["Gauntlets","Gloves","Wraps"],
    "pants":["Greaves","Leggings","Trousers"],
    "ring":["Band","Ring","Loop"],
    "trinket":["Talisman","Charm","Pendant"],
    "off_hand":["Shield","Buckler","Tome"]
  }'::jsonb;
  weapons jsonb := '[
    ["dagger",1,"Dagger"],["sword",1,"Sword"],["axe",1,"Axe"],["mace",1,"Mace"],
    ["wand",1,"Wand"],["bow",2,"Bow"],["staff",2,"Staff"]
  ]'::jsonb;

  tier_row text[];
  rarity   text;
  mult     numeric;
  ilvl     int;
  tier_num int;
  prefix   text;
  rare_word text;
  slot     text;
  variants jsonb;
  variant  text;
  wp       jsonb;
  wp_tag   text;
  wp_hands int;
  wp_name  text;
  iname    text;
  gold     int;
  wt       text;
BEGIN
  FOREACH tier_row SLICE 1 IN ARRAY tiers LOOP
    tier_num := tier_row[1]::int;
    ilvl     := tier_row[2]::int;
    prefix   := tier_row[3];

    FOREACH rarity IN ARRAY ARRAY['common','uncommon'] LOOP
      mult      := CASE rarity WHEN 'uncommon' THEN 1.5 ELSE 1.0 END;
      rare_word := CASE rarity WHEN 'uncommon' THEN 'Fine ' ELSE '' END;
      gold      := GREATEST(1, ROUND(ilvl * 2.5 * mult * mult))::int;

      FOR slot, variants IN SELECT * FROM jsonb_each(nw_slots) LOOP
        FOR variant IN SELECT jsonb_array_elements_text(variants) LOOP
          iname := prefix || ' ' || rare_word || variant;
          wt    := CASE WHEN variant = 'Shield' THEN 'shield' ELSE NULL END;
          INSERT INTO public.items
            (name, slot, rarity, level, tier, value, hands, weapon_tag,
             item_type, origin_type, world_drop, drop_weight, stats, description,
             max_durability, is_soulbound)
          VALUES
            (iname, slot::item_slot, rarity::item_rarity, ilvl, tier_num, gold,
             CASE WHEN slot = 'off_hand' THEN 1 ELSE NULL END, wt,
             'equipment', 'plain_base', true, 10, '{}'::jsonb, '', 100, false);
        END LOOP;
      END LOOP;

      FOR wp IN SELECT jsonb_array_elements(weapons) LOOP
        wp_tag   := wp->>0;
        wp_hands := (wp->>1)::int;
        wp_name  := wp->>2;
        iname    := prefix || ' ' || rare_word || wp_name;
        INSERT INTO public.items
          (name, slot, rarity, level, tier, value, hands, weapon_tag,
           item_type, origin_type, world_drop, drop_weight, stats, description,
           max_durability, is_soulbound)
        VALUES
          (iname, 'main_hand'::item_slot, rarity::item_rarity, ilvl, tier_num, gold,
           wp_hands, wp_tag,
           'equipment', 'plain_base', true, 10, '{}'::jsonb, '', 100, false);
      END LOOP;
    END LOOP;
  END LOOP;
END
$seed$;

INSERT INTO public.class_starting_gear (class, item_id)
SELECT m.cls::character_class, i.id
  FROM (VALUES
    ('warrior',  'Worn Sword'),
    ('wizard',   'Worn Staff'),
    ('ranger',   'Worn Bow'),
    ('assassin', 'Worn Dagger'),
    ('healer',   'Worn Mace'),
    ('bard',     'Worn Wand'),
    ('templar',  'Worn Mace')
  ) AS m(cls, item_name)
  JOIN public.items i
    ON i.name = m.item_name AND i.origin_type = 'plain_base' AND i.rarity::text = 'common'
ON CONFLICT (class) DO UPDATE SET item_id = EXCLUDED.item_id;