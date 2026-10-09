-- Read-only, no gameplay calls, writes, record names or secret material.
-- Run only by separately authorized Lovable operator. Reuse P2-C preflight too.
SELECT current_user,has_table_privilege(current_user,'auth.users','TRIGGER') auth_trigger_privilege;
SELECT e.extname,e.extversion FROM pg_extension e WHERE e.extname='pg_cron';
SELECT to_regprocedure('cron.schedule(text,text,text)') schedule_api;
SELECT jobname,schedule FROM cron.job WHERE jobname='character-c2-receipt-expiry';
SELECT t.tgname,t.tgenabled,p.proname,pg_get_userbyid(p.proowner) owner
  FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal;
SELECT count(*) orphan_material_rows FROM public.character_materials m
  WHERE NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=m.character_id);
SELECT p.oid::regprocedure identity,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
  encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') body_sha256
  FROM pg_proc p WHERE p.oid IN (
    'public.apply_family_to_character(uuid,text)'::regprocedure,
    'public.combat2_presence_heartbeat(uuid)'::regprocedure,
    'public.combat2_session_access(uuid,uuid)'::regprocedure,
    'public.settle_out_of_combat_resources(timestamptz)'::regprocedure);
SELECT p.oid::regprocedure identity,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
    ('character_create_c2','character_create_c2_internal','character_lifecycle_command',
     'character_creation_capacity','character_receipt_maintenance_internal','character_account_deleted_internal');
-- Additive lifecycle fields must not accidentally broaden the accepted UPDATE partition.
SELECT a.attname,
  has_column_privilege('service_role','public.characters',a.attname,'UPDATE') service_update,
  has_column_privilege('authenticated','public.characters',a.attname,'UPDATE') authenticated_update
  FROM pg_attribute a WHERE a.attrelid='public.characters'::regclass
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
