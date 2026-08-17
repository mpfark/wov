-- Attribution roster: participation history that survives departure.
--
-- A finite player-owned effect keeps belonging to its source after that source
-- leaves the node, logs out, disengages, or dies. `encounter_participants` rows
-- are DELETED on all of those transitions (trg_character_encounter_lifecycle,
-- encounter_reconcile, encounter_disengage), which erased the fled source from
-- the effects-only snapshot: the pure resolver then found no ParticipantSnapshot
-- for the lethal effect's source, `recipients` was empty, and the kill committed
-- with zero reward/bond/material/gem/loot proposals.
--
-- The roster is participants UNION the character sources of live effects that
-- belong to this encounter. Membership grants attribution ONLY: presence
-- (characters.current_node_id = encounters.node_id) still decides targeting and
-- acting, so a rostered absentee can never be hit, healed, or act.
CREATE OR REPLACE FUNCTION public.encounter_attribution_roster(_encounter_id uuid)
RETURNS TABLE(character_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT ep.character_id
  FROM public.encounter_participants ep
  WHERE ep.encounter_id = _encounter_id
  UNION
  SELECT ae.source_id
  FROM public.active_effects ae
  WHERE ae.source_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.characters c WHERE c.id = ae.source_id)
    AND (
      EXISTS (SELECT 1 FROM public.encounter_creatures ec
              WHERE ec.encounter_id = _encounter_id AND ec.creature_id = ae.target_id)
      OR EXISTS (SELECT 1 FROM public.encounter_participants ep2
                 WHERE ep2.encounter_id = _encounter_id AND ep2.character_id = ae.target_id)
    );
$fn$;

REVOKE ALL ON FUNCTION public.encounter_attribution_roster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_attribution_roster(uuid) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_active_effects_source ON public.active_effects (source_id);

-- Rebind the two authority functions onto the roster. The bodies are otherwise
-- untouched: this is a deterministic, asserted text substitution of exactly the
-- participant-membership clauses, so no unrelated behaviour can drift.
DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_before int;
BEGIN
  -- 1. encounter_snapshot_v2: participant roster + effect-owner rows.
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'encounter_snapshot_v2';
  IF v_src IS NULL THEN RAISE EXCEPTION 'encounter_snapshot_v2 not found'; END IF;

  v_new := replace(v_src,
E'      FROM public.encounter_participants ep\n      JOIN public.characters c ON c.id = ep.character_id',
E'      FROM public.encounter_attribution_roster(_encounter_id) r\n      JOIN public.characters c ON c.id = r.character_id\n      LEFT JOIN public.encounter_participants ep\n        ON ep.encounter_id = _encounter_id AND ep.character_id = c.id');
  IF v_new = v_src THEN RAISE EXCEPTION 'snapshot participant FROM clause not matched'; END IF;

  v_src := v_new;
  v_new := replace(v_src,
E'      ) ORDER BY ep.joined_at, c.id)',
E'      ) ORDER BY COALESCE(ep.joined_at, c.created_at), c.id)');
  IF v_new = v_src THEN RAISE EXCEPTION 'snapshot participant ORDER BY not matched'; END IF;

  v_src := v_new;
  v_new := replace(v_src,
E'      WHERE ep.encounter_id = _encounter_id), \'[]\'::jsonb),\n    \'creatures\'',
E'      ), \'[]\'::jsonb),\n    \'creatures\'');
  IF v_new = v_src THEN RAISE EXCEPTION 'snapshot participant WHERE clause not matched'; END IF;

  v_src := v_new;
  v_new := replace(v_src,
E'\'joinedAtMs\', (extract(epoch from ep.joined_at) * 1000)::bigint',
E'\'joinedAtMs\', (extract(epoch from COALESCE(ep.joined_at, c.created_at)) * 1000)::bigint');
  IF v_new = v_src THEN RAISE EXCEPTION 'snapshot joinedAtMs not matched'; END IF;

  v_src := v_new;
  v_new := replace(v_src,
E'\'rowVersion\', extract(epoch from ep.joined_at)::bigint',
E'\'rowVersion\', extract(epoch from COALESCE(ep.joined_at, c.created_at))::bigint');
  IF v_new = v_src THEN RAISE EXCEPTION 'snapshot rowVersion not matched'; END IF;

  -- Effects belonging to this encounter include those targeting a rostered
  -- character, so an absentee's own DoTs still expire through the same path.
  v_src := v_new;
  v_new := replace(v_src,
E'        SELECT ep.character_id FROM public.encounter_participants ep WHERE ep.encounter_id = _encounter_id',
E'        SELECT r.character_id FROM public.encounter_attribution_roster(_encounter_id) r');
  IF v_new = v_src THEN RAISE EXCEPTION 'snapshot effect target filter not matched'; END IF;

  EXECUTE v_new;

  -- 2. commit_encounter_tick_v2: validation membership follows the same roster,
  --    so a legitimately attributed reward is never rejected as "unknown".
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'commit_encounter_tick_v2';
  IF v_src IS NULL THEN RAISE EXCEPTION 'commit_encounter_tick_v2 not found'; END IF;

  v_before := (length(v_src) - length(replace(v_src,
E'SELECT 1 FROM public.encounter_participants ep\n                      WHERE ep.encounter_id = _encounter_id AND ep.character_id', '')))
    / length(E'SELECT 1 FROM public.encounter_participants ep\n                      WHERE ep.encounter_id = _encounter_id AND ep.character_id');
  IF v_before <> 4 THEN
    RAISE EXCEPTION 'expected 4 commit membership clauses, found %', v_before;
  END IF;

  v_new := replace(v_src,
E'SELECT 1 FROM public.encounter_participants ep\n                      WHERE ep.encounter_id = _encounter_id AND ep.character_id',
E'SELECT 1 FROM public.encounter_attribution_roster(_encounter_id) ep\n                      WHERE ep.character_id');

  v_src := v_new;
  v_new := replace(v_src,
E'EXISTS (SELECT 1 FROM public.encounter_participants ep\n                 WHERE ep.encounter_id = _encounter_id AND ep.character_id = e."targetId")',
E'EXISTS (SELECT 1 FROM public.encounter_attribution_roster(_encounter_id) ep\n                 WHERE ep.character_id = e."targetId")');
  IF v_new = v_src THEN RAISE EXCEPTION 'commit effect-target clause not matched'; END IF;

  EXECUTE v_new;
END
$mig$;