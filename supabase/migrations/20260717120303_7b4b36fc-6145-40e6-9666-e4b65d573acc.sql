-- Fix race condition in encounter_ensure_for_* helpers.
-- Two concurrent ticks (creature-damage + character-damage) both saw no active
-- encounter, both tried to INSERT, and one lost to the unique index
-- encounters_active_key_uidx (node_id, encounter_key) with error 23505.
-- The raised exception rolled back the entire tick RPC, so creature damage
-- and character resource writes were never persisted — appearing as HP
-- jumping back to full every tick.

CREATE OR REPLACE FUNCTION public.encounter_ensure_for_creature(_creature_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node_id uuid;
  v_encounter_id uuid;
BEGIN
  SELECT encounter_id INTO v_encounter_id
  FROM public.encounter_creatures
  WHERE creature_id = _creature_id;

  IF v_encounter_id IS NOT NULL THEN
    RETURN v_encounter_id;
  END IF;

  SELECT node_id INTO v_node_id
  FROM public.creatures
  WHERE id = _creature_id;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'creature % has no node', _creature_id;
  END IF;

  -- Race-safe upsert-and-fetch loop against encounters_active_key_uidx
  LOOP
    SELECT id INTO v_encounter_id
    FROM public.encounters
    WHERE node_id = v_node_id AND encounter_key = 'default' AND status = 'active'
    LIMIT 1;

    EXIT WHEN v_encounter_id IS NOT NULL;

    BEGIN
      INSERT INTO public.encounters (node_id, encounter_key, status)
      VALUES (v_node_id, 'default', 'active')
      RETURNING id INTO v_encounter_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Another tick won the race; loop back and SELECT the row it inserted.
      v_encounter_id := NULL;
    END;
  END LOOP;

  INSERT INTO public.encounter_creatures (encounter_id, creature_id)
  VALUES (v_encounter_id, _creature_id)
  ON CONFLICT (creature_id) DO NOTHING;

  RETURN v_encounter_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.encounter_ensure_for_character(_character_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node_id uuid;
  v_encounter_id uuid;
BEGIN
  SELECT current_node_id INTO v_node_id
  FROM public.characters
  WHERE id = _character_id;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'character % has no current_node_id', _character_id;
  END IF;

  LOOP
    SELECT id INTO v_encounter_id
    FROM public.encounters
    WHERE node_id = v_node_id AND encounter_key = 'default' AND status = 'active'
    LIMIT 1;

    EXIT WHEN v_encounter_id IS NOT NULL;

    BEGIN
      INSERT INTO public.encounters (node_id, encounter_key, status)
      VALUES (v_node_id, 'default', 'active')
      RETURNING id INTO v_encounter_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_encounter_id := NULL;
    END;
  END LOOP;

  INSERT INTO public.encounter_participants (encounter_id, character_id, last_action_at)
  VALUES (v_encounter_id, _character_id, now())
  ON CONFLICT (character_id) DO UPDATE
     SET last_action_at = now(),
         encounter_id   = EXCLUDED.encounter_id;

  RETURN v_encounter_id;
END;
$$;