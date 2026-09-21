-- Combat2 claim-snapshot contract repair (contract only).
--
-- The deployed Combat2 worker decoder requires the creature reward-channel
-- fields gold_enabled, gold_min, gold_max, gold_chance, salvage_enabled and
-- item_source in every `public.node_tick_claim` snapshot. The installed claim
-- chain still emits the pre-channel projection, so every claim is decoded
-- as `snapshot_rejected` immediately after a successful claim acquisition and
-- no tick can ever commit.
--
-- This migration corrects ONLY that contract defect:
--   * it adds the six required columns with behaviour-preserving values
--     derived from the existing loot_mode / loot_table authoring, so reward
--     behaviour matches the legacy projection;
--   * it patches the creature projection in
--     public.node_tick_claim_without_canary_gate(uuid,integer), the innermost
--     snapshot builder that owns it. The outer wrappers
--     node_tick_claim_without_boss_timing and node_tick_claim compose that
--     snapshot unchanged, so they inherit the corrected contract.
--
-- Deliberately NOT included (owned by ADM-025B, still blocked):
--   * unique_item_id / unique_drop_chance and unique_boss_drop mapping,
--   * reward authoring constraints, triggers and admin RPCs,
--   * any gameplay-data cleanup, encounter-specific repair or reward rule change.
--
-- Locking, claim, lease and idempotency behaviour, grants, ownership and the
-- fixed safe search_path are preserved: the function body is regenerated from
-- its installed definition and only the creature projection is extended. The
-- patch is fail-closed and aborts if the marker is absent.

ALTER TABLE public.creatures
  ADD COLUMN IF NOT EXISTS gold_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gold_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gold_max integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gold_chance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salvage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_source text NOT NULL DEFAULT 'none';

-- Behaviour-preserving derivation from the existing authoring. No unique-item
-- mapping, no row deletion, no reward reconfiguration.
UPDATE public.creatures c SET
  gold_enabled = EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.loot_table,'[]'::jsonb)) e WHERE e->>'type'='gold'),
  gold_min = COALESCE((SELECT (e->>'min')::int FROM jsonb_array_elements(COALESCE(c.loot_table,'[]'::jsonb)) e WHERE e->>'type'='gold' LIMIT 1),0),
  gold_max = COALESCE((SELECT (e->>'max')::int FROM jsonb_array_elements(COALESCE(c.loot_table,'[]'::jsonb)) e WHERE e->>'type'='gold' LIMIT 1),0),
  gold_chance = COALESCE((SELECT (e->>'chance')::numeric FROM jsonb_array_elements(COALESCE(c.loot_table,'[]'::jsonb)) e WHERE e->>'type'='gold' LIMIT 1),0),
  salvage_enabled = (c.loot_mode = 'salvage_only'),
  item_source = CASE WHEN c.loot_mode='item_pool' THEN 'world_pool'
                     WHEN c.loot_table_id IS NOT NULL THEN 'assigned_table'
                     ELSE 'none' END;

DO $m$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure) INTO d;
  IF position('''gold_enabled''' IN d) > 0 THEN
    RAISE NOTICE 'claim snapshot already emits the reward-channel contract';
    RETURN;
  END IF;
  d := replace(
    d,
    '''loot_mode'', cr.loot_mode,',
    '''gold_enabled'',cr.gold_enabled,''gold_min'',cr.gold_min,''gold_max'',cr.gold_max,''gold_chance'',cr.gold_chance,''salvage_enabled'',cr.salvage_enabled,''item_source'',cr.item_source,''loot_mode'', cr.loot_mode,'
  );
  IF position('''gold_enabled''' IN d) = 0 THEN
    RAISE EXCEPTION 'claim reward-channel contract patch failed: projection marker not found';
  END IF;
  EXECUTE d;
END $m$;

DO $v$
BEGIN
  IF position('''gold_enabled''' IN pg_get_functiondef('public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure)) = 0
  THEN RAISE EXCEPTION 'claim snapshot does not emit the reward-channel contract after patching'; END IF;
END $v$;