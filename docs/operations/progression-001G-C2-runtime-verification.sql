-- Read-only evidence intake only. Use a trusted operator with visibility of private
-- creation/progression storage. No RPC execution, JWT impersonation or Auth secrets.
-- Verify exactly one Calikon row; otherwise STOP and resolve identity with owner.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_timestamp AS observed_at, current_user AS inspection_role;
SELECT id,user_id,name,race,gender,class,is_classless,level,xp,
 str,dex,con,int,wis,cha,hp,max_hp,cp,max_cp,mp,max_mp,ac,gold,
 family_id,family_name,unspent_stat_points,respec_points,bhp,bhp_trained,
 rp_total_earned,deleted_at,restore_until,lifecycle_version
FROM public.characters WHERE lower(name)=lower('Calikon');

SELECT c.id,
 (SELECT count(*) FROM public.characters x WHERE x.user_id=c.user_id) AS retained_slots,
 5 AS slot_limit,
 (SELECT count(*) FROM public.character_inventory x WHERE x.character_id=c.id) AS inventory_rows,
 (SELECT jsonb_object_agg(x.material_key,x.count) FROM public.character_materials x WHERE x.character_id=c.id) AS materials,
 (SELECT count(*) FROM public.character_materials x WHERE x.character_id=c.id) AS material_rows,
 (SELECT count(*) FROM public.progression_receipt x WHERE x.character_id=c.id) AS progression_receipts,
 (SELECT count(*) FROM public.progression_class_growth_milestone x WHERE x.character_id=c.id) AS growth_milestones,
 (SELECT count(*) FROM public.progression_respec_milestone x WHERE x.character_id=c.id) AS token_milestones,
 (SELECT count(*) FROM public.character_class_bonds x WHERE x.character_id=c.id) AS class_bonds
FROM public.characters c WHERE lower(c.name)=lower('Calikon');

SELECT s.* FROM public.progression_character_state s
JOIN public.characters c ON c.id=s.character_id WHERE lower(c.name)=lower('Calikon');
SELECT o.character_id,o.snapshot_schema_version,o.creation_version,o.race_version,
 o.class_version,o.formula_version,o.applied_snapshot,o.created_at
FROM public.character_creation_origin o JOIN public.characters c ON c.id=o.character_id
WHERE lower(c.name)=lower('Calikon');
-- UUID/actor are request identifiers, not credentials. Keep this evidence admin-only.
-- Receipt includes exact original choices/mode/reason/revision needed for replay.
-- No replay is authorized by this query package.
SELECT l.log_id,l.actor_id,l.request_id,l.target_account_id,l.result_character_id,
 l.payload_version,l.replay_status,l.created_at,l.details_expires_at,l.detailed_receipt
FROM public.character_creation_log l JOIN public.characters c ON c.id=l.result_character_id
WHERE lower(c.name)=lower('Calikon');
COMMIT;
