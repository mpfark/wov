-- Forward ACL-only reviewed input. NOT installed; no function replacement.
-- Standard Lovable Drizzle only after preflight/publication/installation authorization.
BEGIN;
DO $containment$
DECLARE row record; target oid; before_def text; before_owner oid; retained_acl jsonb;
BEGIN
 FOR row IN SELECT * FROM (VALUES
 ('public.heal_party_member(uuid,uuid,integer)','0760c5b00b30c473e1ebbe3f20cc87a26a3a6988d35dc2cd09112af867ad45c9',0),
 ('public.heal_party_member(uuid,uuid,integer,integer)','3e95e38ce52038b169c465bf82528cb3d742e7378da4577608b605d492b99e97',1),
 ('public.damage_party_member(uuid,integer)','642207a3714bac31f12c95edaec1c1a495b342ab5114a4f8a46ff38a4acff34b',0)
 ) expected(identity,fingerprint,defaults) LOOP
   target:=to_regprocedure(row.identity);
   IF target IS NULL THEN RAISE EXCEPTION 'C5A missing exact signature: %',row.identity; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=target
     AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=row.fingerprint
     AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='v' AND NOT p.proretset
     AND p.prorettype='integer'::regtype AND p.proconfig=ARRAY['search_path=public']::text[]
     AND p.pronargdefaults=row.defaults AND l.lanname='plpgsql')
   THEN RAISE EXCEPTION 'C5A helper body/security drift: %',row.identity; END IF;
   IF NOT has_function_privilege('service_role',target,'EXECUTE')
      OR NOT has_function_privilege('postgres',target,'EXECUTE')
   THEN RAISE EXCEPTION 'C5A expected server authority absent: %',row.identity; END IF;
   SELECT pg_get_functiondef(target),proowner INTO before_def,before_owner FROM pg_proc WHERE oid=target;
   SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]'::jsonb)
     INTO retained_acl FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=target AND a.grantee<>0 AND a.grantee NOT IN ('anon'::regrole,'authenticated'::regrole);
   EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',row.identity);
   IF has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=target AND a.grantee=0 AND a.privilege_type='EXECUTE')
   THEN RAISE EXCEPTION 'C5A inherited browser EXECUTE remains: %',row.identity; END IF;
   IF pg_get_functiondef(target) IS DISTINCT FROM before_def
      OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target
        AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=row.fingerprint
        AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public']::text[])
      OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM before_owner
      OR NOT has_function_privilege('service_role',target,'EXECUTE') OR NOT has_function_privilege('postgres',target,'EXECUTE')
      OR (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]'::jsonb)
        FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=target AND a.grantee<>0 AND a.grantee NOT IN ('anon'::regrole,'authenticated'::regrole)) IS DISTINCT FROM retained_acl
   THEN RAISE EXCEPTION 'C5A retained body/server authority changed: %',row.identity; END IF;
 END LOOP;
END $containment$;
COMMIT;
