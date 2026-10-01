-- Freeze and fence equipment only for fighters present at the claim boundary.
-- Historical fighters remain in the snapshot for attribution and rewards, but
-- their mutable off-node loadouts are not inputs to the current tick.
DO $migration$
DECLARE
  target regprocedure := to_regprocedure(
    'public.node_tick_claim_without_canary_gate(uuid,integer)'
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
  equipment_projection_pattern text :=
    '(FROM[[:space:]]+public\.character_inventory[[:space:]]+ci'
    || '[[:space:]]+LEFT[[:space:]]+JOIN[[:space:]]+public\.items[[:space:]]+it'
    || '[[:space:]]+ON[[:space:]]+it\.id[[:space:]]*=[[:space:]]*ci\.item_id'
    || '[[:space:]]+WHERE[[:space:]]+ci\.character_id[[:space:]]*=[[:space:]]*ch\.id)'
    || '([[:space:]]+AND[[:space:]]+ci\.equipped_slot[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL)';
BEGIN
  IF target IS NULL
     OR to_regprocedure('public.node_tick_claim_without_boss_timing(uuid,integer)') IS NULL
     OR to_regprocedure('public.node_tick_claim(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Combat2 present-equipment claim predecessor missing';
  END IF;

  SELECT pg_get_functiondef(p.oid), p.proowner, r.rolname, p.prosecdef,
         p.provolatile, p.proconfig, p.proacl
    INTO definition, owner_oid, owner_name, security_definer,
         volatility, settings, acl
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = target::oid;

  IF owner_name <> 'postgres'
     OR NOT security_definer
     OR volatility <> 'v'
     OR settings IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR NOT has_function_privilege(
       'service_role',
       'public.node_tick_claim_without_canary_gate(uuid,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.node_tick_claim_without_canary_gate(uuid,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.node_tick_claim_without_canary_gate(uuid,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'public',
       'public.node_tick_claim_without_canary_gate(uuid,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Combat2 present-equipment claim authority drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'node_fighter'
          AND column_name = 'present' AND data_type = 'boolean'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'character_inventory'
          AND column_name = 'equipped_slot'
     )
     OR definition !~ '''fighters''[[:space:]]*,[[:space:]]*COALESCE'
     OR definition !~ 'FROM[[:space:]]+public\.node_fighter[[:space:]]+nf'
     OR definition !~ 'WHERE[[:space:]]+nf\.encounter_id[[:space:]]*=[[:space:]]*e\.id'
     OR position('public.node_tick_claim_without_canary_gate' IN
       pg_get_functiondef('public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure)) = 0
     OR position('public.node_tick_claim_without_boss_timing' IN
       pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Combat2 present-equipment claim composition drift';
  END IF;

  SELECT count(*) INTO marker_matches
    FROM regexp_matches(definition, equipment_projection_pattern, 'g');
  IF marker_matches <> 1 THEN
    RAISE EXCEPTION 'Combat2 expected one equipment projection, found %', marker_matches;
  END IF;

  patched := regexp_replace(
    definition,
    equipment_projection_pattern,
    E'\\1 AND nf.present\\2'
  );
  IF patched = definition
     OR patched !~ 'WHERE[[:space:]]+ci\.character_id[[:space:]]*=[[:space:]]*ch\.id[[:space:]]+AND[[:space:]]+nf\.present[[:space:]]+AND[[:space:]]+ci\.equipped_slot[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL'
     OR patched ~ equipment_projection_pattern THEN
    RAISE EXCEPTION 'Combat2 present-equipment claim patch failed';
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
    RAISE EXCEPTION 'Combat2 present-equipment claim authority changed during patch';
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.node_tick_claim_without_canary_gate(uuid,integer)
  IS 'Inner Combat2 claim snapshot; includes current equipment only for fighters present at the frozen claim boundary.';
