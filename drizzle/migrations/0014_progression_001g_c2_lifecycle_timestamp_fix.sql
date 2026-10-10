-- Reviewed forward-only correction; NOT INSTALLED. Standard Lovable Drizzle
-- transaction only, after separate authorization. Never rerun reset/cutover.
-- Privilege intent: keep postgres-owned SECURITY DEFINER/fixed search_path;
-- keep existing activated authenticated EXECUTE, no new PUBLIC/anon/service_role
-- access, and preserve all existing ACL entries exactly. No character DML.
DO $patch$
DECLARE
 target oid := 'public.character_lifecycle_command(uuid,uuid,bigint,text,text)'::regprocedure;
 before_meta jsonb; definition text; old_projection text;
BEGIN
 SELECT to_jsonb(p)-ARRAY['prosrc','xmin','ctid'] INTO before_meta FROM pg_proc p WHERE oid=target;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND proowner='postgres'::regrole
   AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
   AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=
     '61e8aaf923fd454c194d0630497d75d0982fb28cd01f3e143c0c127c8ca88709')
 THEN RAISE EXCEPTION 'lifecycle timestamp fix: command source/authority drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass
   AND tgname='update_characters_updated_at' AND NOT tgisinternal
   AND tgenabled='O' AND tgtype=19
   AND tgfoid='public.update_updated_at()'::regprocedure AND tgqual IS NULL)
 THEN RAISE EXCEPTION 'lifecycle timestamp fix: timestamp trigger unavailable/drifted'; END IF;
 IF replace((SELECT prosrc FROM pg_proc WHERE oid='public.update_updated_at()'::regprocedure),E'\r\n',E'\n')
   IS DISTINCT FROM E'\nBEGIN\n  NEW.updated_at = now();\n  RETURN NEW;\nEND;\n'
 THEN RAISE EXCEPTION 'lifecycle timestamp fix: timestamp body drift'; END IF;
 definition:=pg_get_functiondef(target);
 old_projection:='ARRAY[''deleted_at'',''restore_until'',''lifecycle_version'']';
 IF (length(definition)-length(replace(definition,old_projection,'')))/length(old_projection)<>2
 THEN RAISE EXCEPTION 'lifecycle timestamp fix: projection count'; END IF;
 definition:=replace(definition,old_projection,
   'ARRAY[''deleted_at'',''restore_until'',''lifecycle_version'',''updated_at'']');
 IF (length(definition)-length(replace(definition,'AND restore_until IS NOT DISTINCT FROM deadline)','')))
   /length('AND restore_until IS NOT DISTINCT FROM deadline)')<>1
 THEN RAISE EXCEPTION 'lifecycle timestamp fix: final state assertion count'; END IF;
 definition:=replace(definition,'AND restore_until IS NOT DISTINCT FROM deadline)',
   'AND restore_until IS NOT DISTINCT FROM deadline AND updated_at IS NOT DISTINCT FROM transaction_timestamp())');
 EXECUTE definition;
 IF (SELECT to_jsonb(p)-ARRAY['prosrc','xmin','ctid'] FROM pg_proc p WHERE oid=target) IS DISTINCT FROM before_meta
 THEN RAISE EXCEPTION 'lifecycle timestamp fix: function metadata/privileges changed'; END IF;
END $patch$;
