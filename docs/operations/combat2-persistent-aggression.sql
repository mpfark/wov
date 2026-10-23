-- Forward-only candidate; Lovable owns the outer transaction and Drizzle history.
-- Direct resolved damaging attacks only. DoT/proc/retaliation-only provocation is undecided.
DO $aggression$
DECLARE target regprocedure:=to_regprocedure('public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)');
 body text; definition text; before record; after record;
 needle text:='       SET hp = GREATEST(COALESCE((rec->>''hp'')::int, cr.hp), 0),';
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'missing Combat2 commit core'; END IF;
 SELECT prosrc,pg_get_functiondef(target),proowner,prosecdef,proconfig,proacl
 INTO before FROM pg_proc WHERE oid=target;
 body:=before.prosrc; definition:=before.pg_get_functiondef;
 IF md5(regexp_replace(body,'[[:space:]]+',' ','g')) IS DISTINCT FROM '74d0800a416276d89e6495724c3c82d5'
 OR pg_get_userbyid(before.proowner) IS DISTINCT FROM 'postgres' OR before.prosecdef IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Combat2 aggression source/security drift'; END IF;
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'creature mirror drift'; END IF;
 body:=replace(body,needle,needle||$change$
           provoked_spawn_seq = CASE
             WHEN cr.is_alive AND COALESCE((rec->>'is_alive')::boolean,true)
               AND (rec->>'hp')::integer>0 AND (rec->>'hp')::integer<cr.hp
               AND COALESCE((rec->>'damaged')::boolean,false)
               AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'events','[]'::jsonb)) hit
                 WHERE hit->>'kind'='attack' AND hit->'actor'->>'type'='character'
                   AND hit->'target'->>'type'='creature' AND hit->'target'->>'id'=cr.id::text
                   AND hit->>'hitQuality' IS DISTINCT FROM 'miss' AND (hit->>'amount')::numeric>0
                   AND EXISTS(SELECT 1 FROM public.node_fighter attacker
                     WHERE attacker.encounter_id=_encounter_id AND attacker.character_id=(hit->'actor'->>'id')::uuid))
             THEN cr.spawn_seq ELSE cr.provoked_spawn_seq END,
$change$);
 -- Existing encounter/token/version/replay/proposal/generation gates stay before this mutation.
 -- CREATE FUNCTION validates the body after the column is installed below, in the same transaction.
 EXECUTE 'ALTER TABLE public.creatures ADD COLUMN provoked_spawn_seq integer CHECK(provoked_spawn_seq IS NULL OR provoked_spawn_seq=spawn_seq)';
 EXECUTE replace(definition,before.prosrc,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE oid=target;
 IF ROW(before.proowner,before.prosecdef,before.proconfig,before.proacl) IS DISTINCT FROM
    ROW(after.proowner,after.prosecdef,after.proconfig,after.proacl) THEN RAISE EXCEPTION 'Combat2 commit metadata changed'; END IF;
 IF has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')
 OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN RAISE EXCEPTION 'unexpected commit authority'; END IF;
END $aggression$;

CREATE FUNCTION public.creature_life_hostility() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- Monotonic within one living instance/generation, including Admin/default edits and healing.
 IF TG_OP='UPDATE' THEN
  IF NEW.spawn_seq IS DISTINCT FROM OLD.spawn_seq THEN NEW.provoked_spawn_seq:=NULL;
  ELSIF OLD.is_alive AND OLD.hp>0 AND OLD.provoked_spawn_seq=OLD.spawn_seq THEN
   NEW.provoked_spawn_seq:=OLD.provoked_spawn_seq;
  END IF;
 END IF;
 IF NOT NEW.is_alive OR NEW.hp<=0 THEN NEW.provoked_spawn_seq:=NULL; END IF;
 IF NEW.provoked_spawn_seq IS NOT NULL THEN
  IF NEW.provoked_spawn_seq IS DISTINCT FROM NEW.spawn_seq THEN RAISE EXCEPTION 'stale creature hostility generation'; END IF;
  NEW.is_aggressive:=true;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION public.creature_life_hostility() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_life_hostility() FROM PUBLIC,anon,authenticated,service_role;
DO $acl$ DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.creature_life_hostility() FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public.creature_life_hostility()'::regprocedure AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'unexpected hostility trigger grant'; END IF;
 IF has_column_privilege('anon','public.creatures','provoked_spawn_seq','UPDATE')
 OR has_column_privilege('authenticated','public.creatures','provoked_spawn_seq','UPDATE')
 OR has_column_privilege('anon','public.creatures','provoked_spawn_seq','INSERT')
 OR has_column_privilege('authenticated','public.creatures','provoked_spawn_seq','INSERT') THEN
  RAISE EXCEPTION 'browser creature mutation boundary unavailable'; END IF;
END $acl$;
CREATE TRIGGER zz_creature_life_hostility BEFORE INSERT OR UPDATE ON public.creatures
 FOR EACH ROW EXECUTE FUNCTION public.creature_life_hostility();
