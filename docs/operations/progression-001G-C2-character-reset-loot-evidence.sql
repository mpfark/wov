-- READ ONLY. Specific remaining reset gate: ground ownership and unique holders.
-- First query must establish complete SELECT visibility; stop otherwise.
-- Do not invoke writers, delete loot, reveal private JSON, or infer NULL means world-owned.
SELECT current_user inspector,c.oid::regclass relation,
 row_security_active(c.oid) inspector_rls_active,has_table_privilege(current_user,c.oid,'SELECT') inspector_select
FROM pg_class c WHERE c.oid IN('public.node_ground_loot'::regclass,'public.node_death_loot'::regclass,
 'public.unique_item_instance'::regclass,'public.character_inventory'::regclass,
 'public.marketplace_listings'::regclass,'public.characters'::regclass);

SELECT conname,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint
WHERE conrelid='public.node_ground_loot'::regclass AND confrelid='public.characters'::regclass;

-- IDs and provenance flags only. A recorded drop link is evidence to review, not
-- a new automatic rule that labels every unlinked/NULL row as disposable.
SELECT gl.id ground_loot_id,gl.node_id,gl.item_id,gl.dropped_by,gl.unique_instance_id,
 gl.dropped_at,(gl.creature_name IS NOT NULL) legacy_creature_label_present,
 EXISTS(SELECT 1 FROM public.characters c WHERE c.id=gl.dropped_by) current_character_exists,
 EXISTS(SELECT 1 FROM public.node_death_loot d WHERE d.ground_loot_id=gl.id
   AND d.item_id=gl.item_id AND d.outcome='dropped') matching_recorded_creature_drop,
 EXISTS(SELECT 1 FROM public.unique_item_instance u WHERE u.id=gl.unique_instance_id
   AND u.item_id=gl.item_id AND u.location_kind='ground' AND u.location_id=gl.id) matching_unique_ground_holder
FROM public.node_ground_loot gl ORDER BY gl.id;

-- A registry row's current location is not its historical owner. Report detached
-- inventory/escrow/ground/transit rows for exact classification, never blanket delete.
SELECT u.id instance_id,u.item_id,u.location_kind,u.location_id,
 EXISTS(SELECT 1 FROM public.character_inventory i WHERE i.id=u.location_id
   AND i.unique_instance_id=u.id AND i.item_id=u.item_id) matching_inventory_holder,
 EXISTS(SELECT 1 FROM public.marketplace_listings m WHERE m.id=u.location_id
   AND m.unique_instance_id=u.id AND m.item_id=u.item_id AND m.status='active') matching_active_escrow_holder,
 EXISTS(SELECT 1 FROM public.node_ground_loot g WHERE g.id=u.location_id
   AND g.unique_instance_id=u.id AND g.item_id=u.item_id) matching_ground_holder
FROM public.unique_item_instance u ORDER BY u.id;
