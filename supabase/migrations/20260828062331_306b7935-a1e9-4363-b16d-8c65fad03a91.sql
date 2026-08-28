-- L1 legacy cleanup: ended-encounter leftovers get swept automatically.

CREATE OR REPLACE FUNCTION public.prune_ended_encounters(
  _older_than_seconds integer DEFAULT 3600,
  _limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain integer := GREATEST(600, COALESCE(_older_than_seconds, 3600));
  v_cap integer := GREATEST(1, COALESCE(_limit, 500));
  v_deleted integer := 0;
  v_n integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _doomed_encounters(id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _doomed_encounters;

  INSERT INTO _doomed_encounters(id)
  SELECT e.id
  FROM public.encounters e
  WHERE e.status = 'ended'
    AND e.ended_at IS NOT NULL
    AND e.ended_at < now() - make_interval(secs => v_retain)
  ORDER BY e.ended_at
  LIMIT v_cap;

  DELETE FROM public.encounter_participants p
  USING _doomed_encounters d WHERE p.encounter_id = d.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

  DELETE FROM public.encounter_engagements g
  USING _doomed_encounters d WHERE g.encounter_id = d.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

  DELETE FROM public.encounter_creatures c
  USING _doomed_encounters d WHERE c.encounter_id = d.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

  -- Rows whose encounter no longer exists at all.
  DELETE FROM public.encounter_kill_awards k
  WHERE NOT EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = k.encounter_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

  DELETE FROM public.encounter_death_loot l
  WHERE NOT EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = l.encounter_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

  DELETE FROM public.encounter_cast_events ce
  WHERE NOT EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = ce.encounter_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_ended_encounters(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_ended_encounters(integer, integer) TO service_role;

-- Ended encounters no longer keep their final batch forever; live encounters
-- still retain their newest recoverable tick.
CREATE OR REPLACE FUNCTION public.prune_encounter_tick_batches(
  _older_than_seconds integer DEFAULT 180,
  _limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain integer := GREATEST(180, COALESCE(_older_than_seconds, 180));
  v_deleted integer;
BEGIN
  WITH victims AS (
    SELECT b.encounter_id, b.tick_number
    FROM public.encounter_tick_batches b
    JOIN public.encounters e ON e.id = b.encounter_id
    WHERE b.created_at < now() - make_interval(secs => v_retain)
      AND (
        b.tick_number < e.tick_number          -- never the newest, recoverable tick
        OR e.status = 'ended'                  -- ended: nothing left to recover
      )
    ORDER BY b.created_at
    LIMIT GREATEST(1, COALESCE(_limit, 500))
  )
  DELETE FROM public.encounter_tick_batches d
  USING victims v
  WHERE d.encounter_id = v.encounter_id AND d.tick_number = v.tick_number;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.encounter_tick_batches b
  WHERE b.created_at < now() - make_interval(secs => v_retain)
    AND NOT EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = b.encounter_id);

  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.final_maintenance_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN PERFORM public.sweep_stranded_encounters(300, 200);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: sweep_stranded_encounters failed: %', SQLERRM; END;
  BEGIN PERFORM public.cleanup_ground_loot();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: cleanup_ground_loot failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_encounter_access_grants(2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_encounter_access_grants failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_encounter_tick_batches(180, 2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_encounter_tick_batches failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_terminal_combat_actions(3600, 2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_terminal_combat_actions failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_ended_encounters(3600, 2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_ended_encounters failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_effects_catchup_log(2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_effects_catchup_log failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_combat_audit_log();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_combat_audit_log failed: %', SQLERRM; END;
END;
$$;