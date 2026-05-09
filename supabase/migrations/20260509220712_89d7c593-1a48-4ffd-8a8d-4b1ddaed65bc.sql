UPDATE creatures
SET loot_mode = 'item_pool', loot_table_id = NULL
WHERE rarity IN ('regular','rare') AND is_humanoid = true AND loot_mode <> 'item_pool';

UPDATE creatures
SET loot_mode = 'salvage_only', loot_table_id = NULL
WHERE rarity IN ('regular','rare') AND is_humanoid = false AND loot_mode <> 'salvage_only';