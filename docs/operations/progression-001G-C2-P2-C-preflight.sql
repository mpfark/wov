-- Read-only, scoped installed metadata/counts only. No gameplay/secret reads.
SELECT attname,format_type(atttypid,atttypmod) AS type FROM pg_attribute
WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped
AND attname IN ('deleted_at','restore_until','lifecycle_version');
SELECT p.oid::regprocedure AS identity,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('delete_character_cascade','c2_harness_run','c2_harness_run_c',
  'character_create_c2_internal','character_create_c2','character_lifecycle_command',
  'character_lifecycle_purge_internal','character_lifecycle_expire_receipts_internal',
  'combat2_presence_heartbeat','combat2_session_access','settle_out_of_combat_resources');
-- Exact source-body guards for activation-only exclusions; normalize line endings only.
SELECT oid::regprocedure AS identity,
  encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS body_sha256
FROM pg_proc WHERE oid IN ('public.combat2_presence_heartbeat(uuid)'::regprocedure,
  'public.combat2_session_access(uuid,uuid)'::regprocedure,
  'public.settle_out_of_combat_resources(timestamptz)'::regprocedure);
-- Only the character's incoming dependency graph, including nested cascade actions.
WITH RECURSIVE dependents(oid) AS (
  SELECT 'public.characters'::regclass::oid
  UNION SELECT fk.conrelid FROM pg_constraint fk JOIN dependents d ON d.oid=fk.confrelid WHERE fk.contype='f'
)
SELECT conrelid::regclass AS child,confrelid::regclass AS parent,conname,convalidated,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE contype='f' AND confrelid IN (SELECT oid FROM dependents);
SELECT count(*) AS orphan_material_rows FROM public.character_materials m
LEFT JOIN public.characters c ON c.id=m.character_id WHERE c.id IS NULL;
SELECT r.rolname,has_table_privilege(r.oid,'public.characters','UPDATE') AS table_update,
  has_table_privilege(r.oid,'public.characters','DELETE') AS direct_delete,
  has_table_privilege(r.oid,'public.characters','TRUNCATE') AS direct_truncate
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
