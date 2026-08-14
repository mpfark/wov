-- Patch the two deployed functions in place so the semantic effect columns flow
-- through the whole chain: active_effects -> snapshot -> decoder -> resolver ->
-- proposal -> commit -> active_effects.
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- ── 1. encounter_snapshot_v2: project the semantic effect fields ─────
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'encounter_snapshot_v2';

  v_new := replace(
    v_def,
    $old$        'sourceAbilityKey', ae.source_ability_key,
        'rowVersion', (extract(epoch from ae.created_at) * 1000)::bigint)$old$,
    $new$        'sourceAbilityKey', ae.source_ability_key,
        'mechanic', ae.mechanic, 'magnitude', ae.magnitude,
        'remaining', ae.remaining, 'params', COALESCE(ae.params, '{}'::jsonb),
        'paramsVersion', ae.params_version,
        'rowVersion', (extract(epoch from ae.created_at) * 1000)::bigint)$new$);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'encounter_snapshot_v2: effect projection anchor not found';
  END IF;
  EXECUTE v_new;

  -- ── 2. commit_encounter_tick_v2 ─────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'commit_encounter_tick_v2';

  -- 2a. persist mechanic / magnitude / remaining / params on upsert.
  v_new := replace(
    v_def,
    $old$    (node_id, target_id, source_id, effect_type, stacks, damage_per_tick,
     next_tick_at, expires_at, tick_rate_ms, source_ability_key)
  SELECT v_enc.node_id, (e->>'targetId')::uuid, (e->>'sourceId')::uuid, e->>'effectType',
         COALESCE((e->>'stacks')::integer, 1), COALESCE((e->>'amountPerTick')::integer, 0),
         (e->>'nextTickAtMs')::bigint, COALESCE((e->>'expiresAtMs')::bigint, 0),
         COALESCE((e->>'intervalMs')::integer, 2000), e->>'sourceAbilityKey'
  FROM jsonb_array_elements(COALESCE(_proposed->'effectUpserts', '[]'::jsonb)) AS e
  ON CONFLICT (source_id, target_id, effect_type) DO UPDATE
    SET stacks = EXCLUDED.stacks, damage_per_tick = EXCLUDED.damage_per_tick,
        expires_at = EXCLUDED.expires_at, next_tick_at = EXCLUDED.next_tick_at,
        tick_rate_ms = EXCLUDED.tick_rate_ms;$old$,
    $new$    (node_id, target_id, source_id, effect_type, stacks, damage_per_tick,
     next_tick_at, expires_at, tick_rate_ms, source_ability_key,
     mechanic, magnitude, remaining, params, params_version)
  SELECT v_enc.node_id, (e->>'targetId')::uuid, (e->>'sourceId')::uuid, e->>'effectType',
         COALESCE((e->>'stacks')::integer, 1), COALESCE((e->>'amountPerTick')::integer, 0),
         (e->>'nextTickAtMs')::bigint, COALESCE((e->>'expiresAtMs')::bigint, 0),
         COALESCE((e->>'intervalMs')::integer, 2000), e->>'sourceAbilityKey',
         e->>'mechanic', (e->>'magnitude')::numeric, (e->>'remaining')::numeric,
         COALESCE(e->'params', '{}'::jsonb), COALESCE((e->>'paramsVersion')::integer, 1)
  FROM jsonb_array_elements(COALESCE(_proposed->'effectUpserts', '[]'::jsonb)) AS e
  ON CONFLICT (source_id, target_id, effect_type) DO UPDATE
    SET stacks = EXCLUDED.stacks, damage_per_tick = EXCLUDED.damage_per_tick,
        expires_at = EXCLUDED.expires_at, next_tick_at = EXCLUDED.next_tick_at,
        tick_rate_ms = EXCLUDED.tick_rate_ms,
        -- Immutable from application: mechanic, magnitude, params identity.
        mechanic = COALESCE(EXCLUDED.mechanic, ae.mechanic),
        magnitude = COALESCE(EXCLUDED.magnitude, ae.magnitude),
        params = COALESCE(EXCLUDED.params, ae.params),
        params_version = EXCLUDED.params_version,
        -- Mutable each tick: the pool/charge state.
        remaining = EXCLUDED.remaining;$new$);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2: effect upsert anchor not found';
  END IF;
  v_def := v_new;

  -- 2b. stop writing absorb pools into CP-reservation bookkeeping.
  v_new := replace(
    v_def,
    $old$        reserved_buffs = jsonb_set(COALESCE(reserved_buffs, '{}'::jsonb), '{absorb_shield}',
                                   to_jsonb(COALESCE((v_item->>'absorbShieldAfter')::integer, 0)), true),
$old$,
    $new$        -- reserved_buffs is stance/CP-reservation bookkeeping ONLY. The absorb
        -- pool lives in active_effects.remaining and is committed above.
$new$);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2: reserved_buffs absorb anchor not found';
  END IF;
  EXECUTE v_new;

  -- 2c. drop the stale absorb bookkeeping key left behind by earlier writes.
  UPDATE public.characters
  SET reserved_buffs = reserved_buffs - 'absorb_shield'
  WHERE reserved_buffs ? 'absorb_shield';
END
$mig$;
