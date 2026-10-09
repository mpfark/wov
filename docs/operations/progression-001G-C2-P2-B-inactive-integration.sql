-- Reviewed LOCAL input; standard Lovable/Drizzle tool only, one transaction.
-- Inactive installation: no application EXECUTE grant, no frontend cutover.
DO $dependencies$
DECLARE f oid := 'public.character_create_c2_internal(uuid,text,text,text,uuid,text,text)'::regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=f AND proowner='postgres'::regrole
    AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'])
  THEN RAISE EXCEPTION 'P2-B requires installed private postgres C2 authority'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
    AND has_function_privilege(oid,f,'EXECUTE'))
  THEN RAISE EXCEPTION 'P2-B private authority privilege drift'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.character_materials'::regclass
    AND contype='f' AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid='public.character_materials'::regclass AND attname='character_id')]::smallint[])
  THEN RAISE EXCEPTION 'materials FK already exists; reconcile rather than replace'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.characters'::regclass,'public.character_materials'::regclass)
    AND relowner<>'postgres'::regrole)
  THEN RAISE EXCEPTION 'unexpected dependency owner'; END IF;
END $dependencies$;

CREATE FUNCTION public.character_create_c2(
  _request uuid, _name text, _race text, _gender text,
  _target uuid, _reason text, _expected_revision text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $bridge$
DECLARE result jsonb;
BEGIN
  -- auth.uid() remains the JWT caller, not the SECURITY DEFINER owner.
  -- All validation, ownership, delegation, locks, formulas and receipts belong to 0009.
  result := public.character_create_c2_internal(
    _request,_name,_race,_gender,_target,_reason,_expected_revision);
  IF result->>'kind' NOT IN ('applied','purged') OR result->>'kind' IS NULL
    OR result->>'characterId' IS NULL
  THEN RAISE EXCEPTION 'creation authority response drift'; END IF;
  RETURN jsonb_build_object('kind',result->>'kind','characterId',result->>'characterId');
END $bridge$;
ALTER FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
DO $acl$
DECLARE grantee oid; f oid := 'public.character_create_c2(uuid,text,text,text,uuid,text,text)'::regprocedure;
BEGIN
  FOR grantee IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a
    WHERE p.oid=f AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text) FROM %s',
      CASE WHEN grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grantee)) END);
  END LOOP;
  IF EXISTS (WITH RECURSIVE app(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
    UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
    SELECT 1 FROM pg_roles r WHERE r.rolname<>'postgres'
      AND (NOT r.rolsuper OR r.oid IN (SELECT oid FROM app))
      AND has_function_privilege(r.oid,f,'EXECUTE'))
  THEN RAISE EXCEPTION 'inactive bridge effective EXECUTE leak'; END IF;
END $acl$;

-- Preserve old orphan rows; protect new writes immediately. No data repair/delete.
-- Existing hard-delete RPC already explicitly deletes materials. Future authorized
-- permanent purge must delete origin explicitly and mark replay purged before parent deletion.
ALTER TABLE public.character_materials ADD CONSTRAINT character_materials_character_id_c2_fkey
  FOREIGN KEY(character_id) REFERENCES public.characters(id)
  ON UPDATE RESTRICT ON DELETE CASCADE NOT VALID;

-- Browser consumers only read materials. Existing RLS and service/definer DML remain.
REVOKE ALL ON TABLE public.character_materials FROM PUBLIC,anon,authenticated;
DO $materials_acl$
DECLARE col text; r oid;
BEGIN
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.character_materials'::regclass
    AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE ALL (%I) ON public.character_materials FROM PUBLIC,anon,authenticated',col);
  END LOOP;
  GRANT SELECT ON TABLE public.character_materials TO authenticated;
  FOR r IN WITH RECURSIVE app(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')
    UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
    SELECT oid FROM app LOOP
    IF has_table_privilege(r,'public.character_materials','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r,'public.character_materials','INSERT,UPDATE,REFERENCES')
    THEN RAISE EXCEPTION 'materials inherited browser write privilege: %',pg_get_userbyid(r); END IF;
  END LOOP;
END $materials_acl$;
