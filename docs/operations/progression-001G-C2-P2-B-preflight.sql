-- Read-only metadata/data counts; no identifiers, names, secrets or gameplay calls.
SELECT count(*) AS orphan_material_rows FROM public.character_materials m
LEFT JOIN public.characters c ON c.id=m.character_id WHERE c.id IS NULL;
SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.character_materials'::regclass;
SELECT p.oid::regprocedure AS identity,pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef,p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
AND p.proname IN ('character_create_c2_internal','character_create_c2','character_create',
  'c2_harness_run','c2_harness_run_c','delete_character_cascade');
SELECT r.rolname,
  has_table_privilege(r.oid,'public.characters','INSERT') AS character_insert,
  has_any_column_privilege(r.oid,'public.characters','INSERT') AS character_column_insert,
  has_table_privilege(r.oid,'public.characters','DELETE') AS character_delete,
  has_table_privilege(r.oid,'public.character_materials','SELECT') AS material_read,
  has_table_privilege(r.oid,'public.character_materials','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS material_write
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
