
-- 1. Add columns to character_inventory for per-instance overrides + applied gems
ALTER TABLE public.character_inventory
  ADD COLUMN IF NOT EXISTS applied_gems jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stat_override jsonb,
  ADD COLUMN IF NOT EXISTS crafted_level int;

COMMENT ON COLUMN public.character_inventory.applied_gems IS
  'Per-instance gem stat additions, e.g. {"garnet": 2, "topaz": 1}. Each entry = +N to the gem''s attribute. See effectiveItemStats() helper.';
COMMENT ON COLUMN public.character_inventory.stat_override IS
  'When set, replaces items.stats as the effective base before applied_gems are added. Used for migration (existing pre-statted items become plain bases keeping only ac/hp) and for player-crafted plain bases.';
COMMENT ON COLUMN public.character_inventory.crafted_level IS
  'When set, used in place of items.level for stat budget / cap calculations on this instance.';

-- 2. Refund existing common/uncommon equipment: convert attribute stats into primary gems,
--    set stat_override to keep only defensive keys (ac/hp/hp_regen).
DO $$
DECLARE
  inv_row RECORD;
  attr_key TEXT;
  attr_val INT;
  refund_keys JSONB;
  defense_stats JSONB;
  gem_key TEXT;
BEGIN
  FOR inv_row IN
    SELECT ci.id, ci.character_id, i.stats
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE i.item_type = 'equipment'
      AND i.rarity IN ('common','uncommon')
      AND ci.stat_override IS NULL
  LOOP
    refund_keys := '{}'::jsonb;
    defense_stats := '{}'::jsonb;
    FOR attr_key, attr_val IN
      SELECT key, (value)::text::int FROM jsonb_each_text(COALESCE(inv_row.stats, '{}'::jsonb))
    LOOP
      IF attr_key IN ('str','dex','con','int','wis','cha') AND attr_val > 0 THEN
        gem_key := CASE attr_key
          WHEN 'str' THEN 'garnet'
          WHEN 'dex' THEN 'topaz'
          WHEN 'con' THEN 'emerald'
          WHEN 'int' THEN 'sapphire'
          WHEN 'wis' THEN 'pearl'
          WHEN 'cha' THEN 'amethyst'
        END;
        PERFORM public.add_material(inv_row.character_id, gem_key, attr_val);
      ELSIF attr_key IN ('ac','hp','hp_regen') AND attr_val <> 0 THEN
        defense_stats := defense_stats || jsonb_build_object(attr_key, attr_val);
      END IF;
    END LOOP;
    UPDATE public.character_inventory
       SET stat_override = defense_stats
     WHERE id = inv_row.id;
  END LOOP;
END $$;

-- 3. Convert any owned hybrid gems into the matching 2 primary gems
DO $$
DECLARE
  cm RECORD;
  pair TEXT[];
BEGIN
  FOR cm IN
    SELECT character_id, material_key, count FROM public.character_materials
    WHERE material_key IN ('citrine','bloodstone','sunstone','jade','heliodor','aquamarine','opal','moonstone')
      AND count > 0
  LOOP
    pair := CASE cm.material_key
      WHEN 'citrine'    THEN ARRAY['garnet','topaz']
      WHEN 'bloodstone' THEN ARRAY['garnet','emerald']
      WHEN 'sunstone'   THEN ARRAY['amethyst','garnet']
      WHEN 'jade'       THEN ARRAY['topaz','pearl']
      WHEN 'heliodor'   THEN ARRAY['amethyst','topaz']
      WHEN 'aquamarine' THEN ARRAY['pearl','emerald']
      WHEN 'opal'       THEN ARRAY['sapphire','pearl']
      WHEN 'moonstone'  THEN ARRAY['amethyst','pearl']
    END;
    PERFORM public.add_material(cm.character_id, pair[1], cm.count);
    PERFORM public.add_material(cm.character_id, pair[2], cm.count);
    PERFORM public.consume_material(cm.character_id, cm.material_key, cm.count);
  END LOOP;
END $$;

-- 4. Retire hybrid gems from the catalog (kept in table so legacy refs resolve,
--    but flagged so drop logic and UI ignore them).
UPDATE public.materials
   SET category = 'legacy_gem'
 WHERE key IN ('citrine','bloodstone','sunstone','jade','heliodor','aquamarine','opal','moonstone');

-- 5. Plain base item rows that the new forge crafts spawn into inventory.
--    One per slot. items.level=1 is a placeholder; per-instance crafted_level
--    on character_inventory is the real level used for budget/cap.
INSERT INTO public.items (
  id, name, description, item_type, slot, rarity, stats, max_durability, value,
  hands, level, is_soulbound, weapon_tag, world_drop, drop_weight, illustration_url, illustration_metadata, procs, origin_type
) VALUES
  (gen_random_uuid(), 'Plain Helm',     'A blank helm awaiting gem-work.',     'equipment', 'head',      'common', '{}', 100, 5, NULL, 1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Hauberk',  'A blank chestpiece awaiting gem-work.','equipment', 'chest',     'common', '{}', 100, 5, NULL, 1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Gloves',   'Blank gloves awaiting gem-work.',     'equipment', 'gloves',    'common', '{}', 100, 5, NULL, 1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Greaves',  'Blank greaves awaiting gem-work.',    'equipment', 'pants',     'common', '{}', 100, 5, NULL, 1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Blade',    'A simple blade awaiting gem-work.',   'equipment', 'main_hand', 'common', '{}', 100, 5, 1,    1, false, 'sword',false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Buckler',  'A simple buckler awaiting gem-work.', 'equipment', 'off_hand',  'common', '{}', 100, 5, 1,    1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Ring',     'A blank band awaiting gem-work.',     'equipment', 'ring',      'common', '{}', 100, 5, NULL, 1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base'),
  (gen_random_uuid(), 'Plain Charm',    'A blank charm awaiting gem-work.',    'equipment', 'trinket',   'common', '{}', 100, 5, NULL, 1, false, NULL,  false, 0, '', '{}', '[]', 'plain_base')
ON CONFLICT DO NOTHING;
