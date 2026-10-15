WITH requested(identity) AS (VALUES
 ('public.assassin_take_contract(uuid)'),
 ('public.assassin_abandon_contract(uuid)'),
 ('public.apply_contract_complete(uuid,integer)'),
 ('public.owns_character(uuid)'),
 ('public.commit_encounter_tick(uuid,bigint,uuid,uuid,integer,jsonb)'),
 ('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.restrict_party_leader_updates()'),
 ('public.character_lifecycle_character_fence()'),
 ('public.update_updated_at()')
), targets AS (
 SELECT identity, to_regprocedure(identity)::oid AS oid FROM requested
), metadata AS (
 SELECT t.identity, p.oid IS NOT NULL AS present,
        p.oid::regprocedure::text AS installed_identity,
        pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_get_function_result(p.oid) AS result_type,
        pg_get_userbyid(p.proowner) AS owner, l.lanname AS language,
        p.prosecdef AS security_definer, p.provolatile AS volatility,
        p.proconfig AS settings, p.proacl AS raw_explicit_acl,
        pg_get_functiondef(p.oid) AS definition,
        encode(sha256(convert_to(regexp_replace(
          replace(pg_get_functiondef(p.oid), E'\r\n', E'\n'),
          '[[:space:]]+', ' ', 'g'), 'UTF8')), 'hex')
          AS normalized_definition_sha256,
        encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
          AS lf_body_sha256,
        (SELECT jsonb_agg(jsonb_build_object(
           'grantee_oid', a.grantee,
           'grantee', CASE WHEN a.grantee=0 THEN 'PUBLIC'
                           ELSE pg_get_userbyid(a.grantee) END,
           'grantor', pg_get_userbyid(a.grantor),
           'privilege', a.privilege_type, 'grantable', a.is_grantable,
           'origin', CASE WHEN p.proacl IS NULL THEN 'default' ELSE 'explicit' END)
           ORDER BY a.grantee,a.grantor,a.privilege_type)
         FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a)
          AS acl_entries,
        (SELECT jsonb_agg(jsonb_build_object(
           'role', r.name, 'role_present', pr.oid IS NOT NULL,
           'execute', CASE WHEN pr.oid IS NOT NULL AND p.oid IS NOT NULL
                    THEN has_function_privilege(pr.oid,p.oid,'EXECUTE') END)
           ORDER BY r.name)
         FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) r(name)
         LEFT JOIN pg_roles pr ON pr.rolname=r.name) AS effective_execute
 FROM targets t LEFT JOIN pg_proc p ON p.oid=t.oid
 LEFT JOIN pg_language l ON l.oid=p.prolang
)
SELECT jsonb_build_object(
 'observed_at', statement_timestamp(), 'role', current_user,
 'session_role', session_user,
 'isolation', current_setting('transaction_isolation'),
 'read_only', current_setting('transaction_read_only'),
 'functions', (SELECT jsonb_agg(to_jsonb(m) ORDER BY identity) FROM metadata m)
) AS contract_metadata;
