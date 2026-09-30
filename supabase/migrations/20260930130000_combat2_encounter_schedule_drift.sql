-- Preserve the two-second encounter schedule phase across ordinary worker
-- latency. Missed opportunities are skipped; they are never replayed as a
-- burst. The public commit wrapper chain and every gameplay fence stay intact.
DO $migration$
DECLARE
  target regprocedure := to_regprocedure(
    'public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'
  );
  definition text;
  patched text;
  owner_oid oid;
  owner_name text;
  security_definer boolean;
  volatility "char";
  settings text[];
  acl aclitem[];
  marker_matches integer;
  old_assignment_pattern text :=
    '(claim_expires_at[[:space:]]*=[[:space:]]*NULL[[:space:]]*,[[:space:]]*)'
    || 'next_due_at[[:space:]]*=[[:space:]]*greatest[[:space:]]*\([[:space:]]*now[[:space:]]*\([[:space:]]*\)[[:space:]]*,[[:space:]]*next_due_at[[:space:]]*\)[[:space:]]*\+[[:space:]]*interval[[:space:]]*''2 seconds'''
    || '([[:space:]]*,[[:space:]]*status[[:space:]]*=[[:space:]]*COALESCE)';
  new_assignment text :=
    'next_due_at = next_due_at'
    || E'\n         + (floor(greatest(0::numeric, extract(epoch from (now() - next_due_at))) / 2)::bigint + 1)'
    || E'\n           * interval ''2 seconds''';
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'ENG-HB-003 commit predecessor missing';
  END IF;

  SELECT pg_get_functiondef(p.oid), p.proowner, r.rolname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
    INTO definition, owner_oid, owner_name, security_definer, volatility, settings, acl
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = target::oid;

  IF owner_name <> 'postgres'
     OR NOT security_definer
     OR volatility <> 'v'
     OR settings IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR NOT has_function_privilege(
       'service_role',
       'public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'public',
       'public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ENG-HB-003 commit predecessor authority drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'node_encounter'
          AND column_name = 'next_due_at' AND data_type = 'timestamp with time zone'
     )
     OR definition !~ 'SELECT[[:space:]]+\*[[:space:]]+INTO[[:space:]]+e[[:space:]]+FROM[[:space:]]+public\.node_encounter[[:space:]]+WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*_encounter_id[[:space:]]+FOR[[:space:]]+UPDATE'
     OR definition !~ 'e\.claim_token[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+_claim_token'
     OR definition !~ 'e\.claim_expires_at[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]+e\.claim_expires_at[[:space:]]*<=[[:space:]]*now\(\)'
     OR definition !~ 'tick[[:space:]]*=[[:space:]]*_candidate_tick'
     OR definition !~ 'state_version[[:space:]]*=[[:space:]]*state_version[[:space:]]*\+[[:space:]]*1' THEN
    RAISE EXCEPTION 'ENG-HB-003 commit predecessor composition drift';
  END IF;

  SELECT count(*) INTO marker_matches
    FROM regexp_matches(definition, old_assignment_pattern, 'g');
  IF marker_matches <> 1 THEN
    RAISE EXCEPTION 'ENG-HB-003 expected one due-time assignment, found %', marker_matches;
  END IF;

  patched := regexp_replace(
    definition,
    old_assignment_pattern,
    E'\\1' || new_assignment || E'\\2'
  );
  IF patched = definition
     OR patched !~ 'next_due_at[[:space:]]*=[[:space:]]*next_due_at[[:space:]]*\+[[:space:]]*\(floor\(greatest\(0::numeric,[[:space:]]*extract\(epoch[[:space:]]+from[[:space:]]+\(now\(\)[[:space:]]*-[[:space:]]*next_due_at\)\)\)[[:space:]]*/[[:space:]]*2\)::bigint[[:space:]]*\+[[:space:]]*1\)[[:space:]]*\*[[:space:]]*interval[[:space:]]*''2 seconds'''
     OR patched ~ old_assignment_pattern THEN
    RAISE EXCEPTION 'ENG-HB-003 due-time patch failed';
  END IF;

  EXECUTE patched;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = target::oid
       AND p.proowner = owner_oid
       AND p.prosecdef = security_definer
       AND p.provolatile = volatility
       AND p.proconfig IS NOT DISTINCT FROM settings
       AND p.proacl IS NOT DISTINCT FROM acl
  ) THEN
    RAISE EXCEPTION 'ENG-HB-003 commit authority changed during patch';
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
  IS 'Atomic Combat2 commit; advances the two-second encounter deadline from its prior server schedule phase and skips obsolete opportunities.';
