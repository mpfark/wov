-- SELECT-only metadata preparation. NOT executed. One observation snapshot.
WITH requested(identity,expected_prosrc_sha256) AS (VALUES
 ('public.heal_party_member(uuid,uuid,integer)','0760c5b00b30c473e1ebbe3f20cc87a26a3a6988d35dc2cd09112af867ad45c9'),
 ('public.heal_party_member(uuid,uuid,integer,integer)','3e95e38ce52038b169c465bf82528cb3d742e7378da4577608b605d492b99e97'),
 ('public.damage_party_member(uuid,integer)','642207a3714bac31f12c95edaec1c1a495b342ab5114a4f8a46ff38a4acff34b'))
SELECT statement_timestamp() AS observed_at,current_user AS inspection_role,pg_current_snapshot()::text AS snapshot,
 r.identity,r.expected_prosrc_sha256,p.oid IS NOT NULL AS exists,
 pg_get_function_identity_arguments(p.oid) AS identity_arguments,
 pg_get_function_arguments(p.oid) AS arguments_with_defaults,pg_get_function_result(p.oid) AS result_type,
 pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,p.prosecdef,p.provolatile,p.proconfig,
 encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS actual_prosrc_sha256,
 pg_get_functiondef(p.oid) AS definition,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable))
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS direct_acl,
 (SELECT jsonb_agg(jsonb_build_object('role',q.rolname,'superuser',q.rolsuper,
 'effective_execute',has_function_privilege(q.oid,p.oid,'EXECUTE')) ORDER BY q.rolname)
 FROM pg_roles q WHERE q.rolname IN ('anon','authenticated','service_role','postgres')
 OR q.oid IN (SELECT a.grantee FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>0)) AS effective_execute
FROM requested r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.identity)
LEFT JOIN pg_language l ON l.oid=p.prolang ORDER BY r.identity;
