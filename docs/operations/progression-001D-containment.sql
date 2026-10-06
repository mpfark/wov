-- D2 ONLY: incomplete cutover component, not an install-ready D1-D3 payload.
-- Standard Lovable custom-SQL preparation, outside migration discovery.
-- No historical body edit, character write, trigger, wrapper or activation.
-- Requires reviewed paused/deployed entry window and complete D1 before use.
DO $containment$
DECLARE signature text; function_id oid; object_owner oid; grant_row record;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
        'apply_crafting_xp','stonebinder_commit_fuse','commit_encounter_tick_v2','award_party_member'])) <> 5 THEN
    RAISE EXCEPTION '001D unexpected containment overload inventory';
  END IF;
  FOREACH signature IN ARRAY ARRAY[
    'public.apply_crafting_xp(uuid,integer)',
    'public.stonebinder_commit_fuse(uuid,uuid,uuid,uuid,integer)',
    'public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)',
    'public.award_party_member(uuid,integer,integer)',
    'public.award_party_member(uuid,integer,integer,integer,integer)'
  ] LOOP
    function_id := to_regprocedure(signature);
    IF function_id IS NULL THEN
      RAISE EXCEPTION '001D containment target missing: %', signature;
    END IF;
    SELECT proowner INTO object_owner FROM pg_proc WHERE oid=function_id;
    IF object_owner <> 'postgres'::regrole THEN
      RAISE EXCEPTION '001D unexpected owner: %', signature;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role', signature);
    -- Remove every nonowner ACL grant, including inherited/custom group grants.
    FOR grant_row IN
      SELECT DISTINCT a.grantee FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=function_id AND a.grantee<>object_owner
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', signature,
        CASE WHEN grant_row.grantee=0 THEN 'PUBLIC'
             ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END);
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_id AND a.grantee<>object_owner) THEN
      RAISE EXCEPTION '001D residual nonowner function grant: %', signature;
    END IF;
  END LOOP;
END $containment$;
