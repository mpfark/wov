-- 1. Revoke the paused validation credentials.
DELETE FROM public.app_secrets WHERE key = 'c5_validation_token';
DELETE FROM public.combat_validation_grants;

-- 2. Authoritative Force Shield regeneration clock.
CREATE OR REPLACE FUNCTION public.apply_force_shield_regen(_character_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  TICK_MS constant bigint := 2000;
  c record;
  eff record;
  in_combat boolean;
  gear_int integer;
  gear_wis integer;
  int_total integer;
  wis_total integer;
  int_mod integer;
  wis_mod integer;
  cap integer;
  regen_per_tick integer;
  pool_before integer;
  cursor_before timestamptz;
  db_now timestamptz;
  elapsed_ms bigint;
  ticks bigint;
  next_hp integer;
  new_cursor timestamptz;
  new_state jsonb;
BEGIN
  db_now := clock_timestamp();

  -- Row lock: serialises concurrent invocations so an interval cannot be
  -- consumed twice.
  SELECT id, user_id, level, int, wis, hp, reserved_buffs, stance_state, current_node_id
    INTO c
    FROM public.characters
    WHERE id = _character_id
    FOR UPDATE;

  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF c.user_id <> auth.uid() AND NOT public.is_steward_or_overlord() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Stance dropped/replaced, or character dead: grant nothing, never recreate
  -- the ward, and clear the stale mirror so an old cursor cannot survive into a
  -- later activation.
  IF NOT (coalesce(c.reserved_buffs, '{}'::jsonb) ? 'force_shield')
     OR coalesce(c.hp, 0) <= 0 THEN
    IF coalesce(c.stance_state, '{}'::jsonb) ? 'force_shield_hp'
       OR coalesce(c.stance_state, '{}'::jsonb) ? 'force_shield_updated_at' THEN
      UPDATE public.characters
        SET stance_state = (coalesce(c.stance_state, '{}'::jsonb)
                            - 'force_shield_hp' - 'force_shield_updated_at')
        WHERE id = c.id;
    END IF;
    RETURN coalesce(c.stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at';
  END IF;

  -- Authoritative pool row. No row => no ward => nothing to regenerate.
  SELECT ae.id, ae.remaining::int AS remaining, ae.magnitude::int AS magnitude
    INTO eff
    FROM public.active_effects ae
   WHERE ae.target_id = c.id
     AND ae.lifetime = 'stance'
     AND ae.effect_type = 'force_shield'
   ORDER BY ae.created_at NULLS LAST
   LIMIT 1
   FOR UPDATE;

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

  SELECT COALESCE(SUM(COALESCE((i.stats->>'int')::int, 0)), 0)
    INTO gear_int
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.character_id = c.id
      AND ci.equipped_slot IS NOT NULL;

  SELECT COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0)
    INTO gear_wis
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.character_id = c.id
      AND ci.equipped_slot IS NOT NULL;

  int_total := coalesce(c.int, 10) + coalesce(gear_int, 0);
  wis_total := coalesce(c.wis, 10) + coalesce(gear_wis, 0);
  int_mod := greatest(0, floor((int_total - 10)::numeric / 2)::int);
  wis_mod := greatest(0, floor((wis_total - 10)::numeric / 2)::int);
  cap := greatest(1, wis_mod + floor(coalesce(c.level, 1)::numeric / 2)::int);
  IF eff.id IS NOT NULL AND eff.magnitude IS NOT NULL THEN
    cap := greatest(1, eff.magnitude);
  END IF;
  regen_per_tick := 1 + floor(int_mod::numeric / 2)::int;

  IF eff.id IS NULL THEN
    -- No authoritative ward row: mirror only, no regeneration, cursor pinned to
    -- the database clock so no time is banked.
    new_state := coalesce(c.stance_state, '{}'::jsonb)
      || jsonb_build_object('force_shield_updated_at', to_jsonb(db_now));
    new_state := new_state - 'force_shield_hp';
    UPDATE public.characters SET stance_state = new_state WHERE id = c.id;
    RETURN new_state;
  END IF;

  pool_before := least(cap, greatest(0, coalesce(eff.remaining, 0)));

  BEGIN
    cursor_before := (c.stance_state->>'force_shield_updated_at')::timestamptz;
  EXCEPTION WHEN others THEN
    cursor_before := NULL;   -- malformed cursor: fail safe
  END;

  -- Missing or future (clock skew) cursor: reset to the DB clock, grant nothing.
  IF cursor_before IS NULL OR cursor_before > db_now THEN
    new_cursor := db_now;
    next_hp := pool_before;
  ELSE
    elapsed_ms := greatest(0, (extract(epoch from (db_now - cursor_before)) * 1000)::bigint);
    ticks := elapsed_ms / TICK_MS;                       -- whole intervals only
    new_cursor := cursor_before + (ticks * TICK_MS) * interval '1 millisecond';

    IF in_combat OR pool_before >= cap THEN
      -- Consume the elapsed intervals without granting: combat time and
      -- full-pool time can never be banked.
      next_hp := pool_before;
    ELSE
      next_hp := least(cap, pool_before + (ticks * regen_per_tick)::int);
    END IF;
  END IF;

  UPDATE public.active_effects
     SET remaining = next_hp
   WHERE id = eff.id
     AND remaining IS DISTINCT FROM next_hp;

  new_state := coalesce(c.stance_state, '{}'::jsonb)
    || jsonb_build_object(
         'force_shield_hp', next_hp,
         'force_shield_updated_at', to_jsonb(new_cursor)
       );

  UPDATE public.characters SET stance_state = new_state WHERE id = c.id;

  RETURN new_state;
END;
$function$;
