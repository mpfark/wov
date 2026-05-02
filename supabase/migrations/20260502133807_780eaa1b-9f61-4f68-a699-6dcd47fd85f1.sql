CREATE OR REPLACE FUNCTION public.apply_force_shield_regen(_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  in_combat boolean;
  gear_int integer;
  int_total integer;
  int_mod integer;
  cap integer;
  regen_per_tick integer;
  current_hp integer;
  last_ts timestamptz;
  elapsed_ms bigint;
  ticks integer;
  next_hp integer;
  new_state jsonb;
BEGIN
  SELECT id, user_id, level, int, reserved_buffs, stance_state, current_node_id
    INTO c
    FROM public.characters
    WHERE id = _character_id;

  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF c.user_id <> auth.uid() AND NOT public.is_steward_or_overlord() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT (coalesce(c.reserved_buffs, '{}'::jsonb) ? 'force_shield') THEN
    IF c.stance_state ? 'force_shield_hp' THEN
      UPDATE public.characters
        SET stance_state = (c.stance_state - 'force_shield_hp' - 'force_shield_updated_at')
        WHERE id = c.id;
    END IF;
    RETURN coalesce(c.stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at';
  END IF;

  -- Match HP/CP/MP regen semantics: only active combat at the character's
  -- current node pauses regeneration. Stale/off-node sessions should not keep
  -- Force Shield frozen while normal resources are regenerating.
  SELECT EXISTS (
    SELECT 1
    FROM public.combat_sessions s
    WHERE s.node_id = c.current_node_id
      AND (
        s.character_id = c.id
        OR (
          s.party_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.party_members pm
            WHERE pm.party_id = s.party_id
              AND pm.character_id = c.id
              AND pm.status = 'accepted'
          )
        )
      )
  ) INTO in_combat;

  -- Sum INT bonuses from equipped items so OOC cap matches combat-tick.
  SELECT COALESCE(SUM(COALESCE((i.stats->>'int')::int, 0)), 0)
    INTO gear_int
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.character_id = c.id
      AND ci.equipped_slot IS NOT NULL;

  int_total := coalesce(c.int, 10) + coalesce(gear_int, 0);
  int_mod := greatest(0, floor((int_total - 10)::numeric / 2)::int);
  cap := greatest(1, int_mod + floor(coalesce(c.level, 1)::numeric / 2)::int);
  regen_per_tick := 1 + floor(int_mod::numeric / 2)::int;

  current_hp := least(cap, coalesce((c.stance_state->>'force_shield_hp')::int, cap));
  last_ts := coalesce((c.stance_state->>'force_shield_updated_at')::timestamptz, now());

  IF in_combat THEN
    new_state := coalesce(c.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', current_hp,
           'force_shield_updated_at', to_jsonb(now())
         );
  ELSE
    elapsed_ms := greatest(0, (extract(epoch from (now() - last_ts)) * 1000)::bigint);
    ticks := (elapsed_ms / 2000)::int;
    next_hp := least(cap, current_hp + ticks * regen_per_tick);
    new_state := coalesce(c.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', next_hp,
           'force_shield_updated_at', to_jsonb(last_ts + make_interval(secs => (ticks * 2)))
         );
  END IF;

  UPDATE public.characters
     SET stance_state = new_state
     WHERE id = c.id;

  RETURN new_state;
END;
$$;