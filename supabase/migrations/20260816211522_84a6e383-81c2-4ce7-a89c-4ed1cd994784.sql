-- 1. No tick may be claimed for an encounter that is no longer active.
DO $mig$
DECLARE
  src text;
  a text;
  b text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'claim_encounter_tick';
  IF src IS NULL THEN RAISE EXCEPTION 'claim_encounter_tick not found'; END IF;

  a := $a$  IF v_enc.tick_at = 0 THEN$a$;
  b := $b$  -- An ended encounter is terminal: no further tick is ever claimed for it.
  -- A new fight at the node creates a new encounter through encounter_for_node.
  IF v_enc.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'encounter_ended');
  END IF;

  IF v_enc.tick_at = 0 THEN$b$;
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'claim anchor not found'; END IF;
  src := replace(src, a, b);
  EXECUTE src;
END
$mig$;

-- 2. A corpse is not a legal target, even if a stale row still reads alive.
DO $mig2$
DECLARE
  src text;
  a text;
  b text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'join_encounter_engagement';
  IF src IS NULL THEN RAISE EXCEPTION 'join_encounter_engagement not found'; END IF;

  a := $a$  SELECT node_id INTO v_node_id FROM public.creatures WHERE id = _creature_id AND is_alive = true;$a$;
  b := $b$  SELECT node_id INTO v_node_id FROM public.creatures
  WHERE id = _creature_id AND is_alive = true AND hp > 0;$b$;
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'engagement anchor not found'; END IF;
  src := replace(src, a, b);
  EXECUTE src;
END
$mig2$;