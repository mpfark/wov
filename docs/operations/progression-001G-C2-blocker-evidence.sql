-- READ ONLY. No function invocation, grants, SET ROLE, scheduling or gameplay writes.
-- Execute visibility query FIRST. Continue orphan classification only with complete
-- administrative visibility (row_security_active=false and SELECT=true for each table).
-- Restricted-role NOT EXISTS results cannot prove physical absence.
SELECT current_user inspector_role,c.oid::regclass relation,
  c.relrowsecurity,c.relforcerowsecurity,row_security_active(c.oid) inspector_rls_active,
  has_table_privilege(current_user,c.oid,'SELECT') inspector_select
  FROM pg_class c WHERE c.oid IN ('public.characters'::regclass,
    'public.character_materials'::regclass,'public.character_inventory'::regclass,
    'public.progression_character_state'::regclass,'public.character_creation_origin'::regclass,
    'public.character_creation_log'::regclass,'public.character_lifecycle_receipt'::regclass);
SELECT c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) definition
  FROM pg_constraint c WHERE c.conrelid='public.character_materials'::regclass
    OR c.confrelid='public.character_materials'::regclass;
SELECT t.tgname,t.tgenabled,p.proname,pg_get_userbyid(p.proowner) owner
  FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid='public.character_materials'::regclass AND NOT t.tgisinternal;

-- Exact minimal snapshot: no character/account names, emails or private receipt contents.
-- Do not infer material ownership, earned provenance or deletion authorization from it.
SELECT m.character_id,m.material_key,m.count,m.updated_at,
  EXISTS(SELECT 1 FROM public.character_inventory i WHERE i.character_id=m.character_id) has_inventory,
  EXISTS(SELECT 1 FROM public.progression_character_state s WHERE s.character_id=m.character_id) has_progression_state,
  EXISTS(SELECT 1 FROM public.character_creation_origin o WHERE o.character_id=m.character_id) has_creation_origin,
  EXISTS(SELECT 1 FROM public.character_creation_log l WHERE l.result_character_id=m.character_id) has_creation_replay,
  EXISTS(SELECT 1 FROM public.character_lifecycle_receipt r WHERE r.character_id=m.character_id) has_lifecycle_receipt
  FROM public.character_materials m
  WHERE NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=m.character_id)
  ORDER BY m.character_id,m.material_key;

-- Only the three settlement-chain definitions, not dispatcher/vault/Auth bodies.
-- Return exact definitions plus metadata; a hash alone cannot establish behavior.
SELECT p.oid::regprocedure identity,pg_get_userbyid(p.proowner) owner,p.prosecdef,
  p.provolatile,p.proconfig,p.proacl::text acl,
  encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') body_sha256,
  pg_get_functiondef(p.oid) definition
  FROM pg_proc p WHERE p.oid IN (
    to_regprocedure('public.settle_out_of_combat_resources(timestamptz)'),
    to_regprocedure('public.settle_out_of_combat_resources_without_character_stances(timestamptz)'),
    to_regprocedure('public.combat2_regenerate_force_shields(timestamptz,integer)'))
  ORDER BY p.proname;
