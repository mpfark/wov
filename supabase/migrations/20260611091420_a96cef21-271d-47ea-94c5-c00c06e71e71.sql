
-- Phase 2: Remove retired equipment slots from items catalog and enum

-- 1) Delete dependent rows referencing retired-slot items
DELETE FROM character_inventory WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));
DELETE FROM vendor_inventory WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));
DELETE FROM marketplace_listings WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));
DELETE FROM node_ground_loot WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));
DELETE FROM loot_table_entries WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));
DELETE FROM class_starting_gear WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));
DELETE FROM universal_starting_gear WHERE item_id IN (SELECT id FROM items WHERE slot IN ('amulet','shoulders','belt','boots'));

-- 2) Delete retired-slot rows from items and forge_pool
DELETE FROM items WHERE slot IN ('amulet','shoulders','belt','boots');
DELETE FROM forge_pool WHERE slot IN ('amulet','shoulders','belt','boots');

-- 3) Also clean any remaining character_inventory rows whose equipped_slot still points to a retired slot
DELETE FROM character_inventory WHERE equipped_slot IN ('amulet','shoulders','belt','boots');

-- 4) Rebuild item_slot enum without the retired values
ALTER TYPE item_slot RENAME TO item_slot_old;
CREATE TYPE item_slot AS ENUM ('head','chest','gloves','pants','ring','ring_2','trinket','main_hand','off_hand');

ALTER TABLE items ALTER COLUMN slot TYPE item_slot USING slot::text::item_slot;
ALTER TABLE forge_pool ALTER COLUMN slot TYPE item_slot USING slot::text::item_slot;
ALTER TABLE character_inventory ALTER COLUMN equipped_slot TYPE item_slot USING equipped_slot::text::item_slot;

DROP TYPE item_slot_old;
