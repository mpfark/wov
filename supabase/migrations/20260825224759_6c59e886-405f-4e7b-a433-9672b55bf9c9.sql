-- Restore the damaged-creature aggression transition inside
-- commit_encounter_tick_v2.
--
-- The C3 cutover replaced damage_creature() with the authoritative commit
-- routine but did not carry over that RPC's secondary responsibility: a passive
-- creature that survives committed damage becomes temporarily aggressive.
--
-- This migration patches ONLY the survivor UPDATE, in place, by rewriting the
-- stored function definition. Nothing else about the routine changes: the
-- signature, advisory locking, boundary fencing, replay/idempotency guards,
-- SECURITY DEFINER + search_path, grants and the death branch are all preserved
-- byte-for-byte, because they are re-emitted from pg_get_functiondef().
--
-- Contract:
--   * committed positive HP reduction on a surviving creature -> is_aggressive = true
--   * zero delta or HP increase -> is_aggressive unchanged (HP still written)
--   * already aggressive -> stays true
--   * refused / conflicting / rolled-back / replayed commit -> no mutation at all
--   * death branch unchanged; base_aggressive never touched
--   * respawn_creatures() keeps restoring is_aggressive = base_aggressive
--
-- The comparison is against the PRE-update HP: a bare column reference on the
-- right-hand side of an UPDATE ... SET expression is the old row value in
-- Postgres, so `(v_item->>'hpAfter')::integer < hp` is the pre-update delta.
-- The predicate lives in a CASE inside SET, never in the WHERE clause, so every
-- legitimate survivor HP proposal is still written.
DO $mig$
DECLARE
  v_def  text;
  v_old  text;
  v_new  text;
  v_hits integer;
BEGIN
  v_old := E'      UPDATE public.creatures\n'
        || E'      SET hp = (v_item->>\'hpAfter\')::integer,\n'
        || E'          last_damaged_at = now()\n'
        || E'      WHERE id = (v_item->>\'creatureId\')::uuid';

  v_new := E'      UPDATE public.creatures\n'
        || E'      SET hp = (v_item->>\'hpAfter\')::integer,\n'
        || E'          last_damaged_at = now(),\n'
        || E'          -- Historical damage_creature() behaviour: surviving a real\n'
        || E'          -- hit makes a passive creature hostile. `hp` here is the\n'
        || E'          -- PRE-update value. Creature-wide hostility, no per-character\n'
        || E'          -- threat memory, natural temperament untouched.\n'
        || E'          is_aggressive = CASE\n'
        || E'            WHEN (v_item->>\'hpAfter\')::integer < hp THEN true\n'
        || E'            ELSE is_aggressive\n'
        || E'          END\n'
        || E'      WHERE id = (v_item->>\'creatureId\')::uuid';

  v_def := pg_get_functiondef(
    'public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)'::regprocedure
  );

  IF position('is_aggressive' IN v_def) > 0 THEN
    RAISE NOTICE 'commit_encounter_tick_v2 already carries the aggression transition; no-op';
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'preflight failed: survivor UPDATE matched % times (expected 1)', v_hits;
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;

  -- postflight: exactly one aggression write, and only in the survivor branch.
  v_def := pg_get_functiondef(
    'public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)'::regprocedure
  );
  IF (length(v_def) - length(replace(v_def, 'is_aggressive = CASE', ''))) / length('is_aggressive = CASE') <> 1 THEN
    RAISE EXCEPTION 'postflight failed: expected exactly one aggression write';
  END IF;
  IF position('base_aggressive' IN v_def) > 0 THEN
    RAISE EXCEPTION 'postflight failed: base_aggressive must never be written here';
  END IF;
END
$mig$;

-- Execution stays service-role only (unchanged; restated so the reviewed
-- migration is explicit about the privilege surface).
REVOKE ALL ON FUNCTION public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb) TO service_role;