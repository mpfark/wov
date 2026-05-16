-- Wizard Force Shield: pool cap now scales from WIS (sustained ward).
-- Regen-per-tick still scales from INT (the spark). Both functions updated
-- in lockstep so the seeded cap on activation matches the OOC regen target.

CREATE OR REPLACE FUNCTION public.activate_stance(p_character_id uuid, p_stance_key text, p_tier integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _char record;
  _existing jsonb;
  _reserved_total int := 0;
  _entry jsonb;
  _pct numeric;
  _reserve int;
  _available int;
  _allowed text[] := array['ignite','envenom','holy_shield','force_shield','eagle_eye','arcane_surge','battle_cry'];
  _gear_wis int;
  _wis_total int;
  _wis_mod int;
  _shield_cap int;
  _new_stance_state jsonb;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT (p_stance_key = ANY(_allowed)) THEN
    RAISE EXCEPTION 'Unknown stance: %', p_stance_key;
  END IF;
  IF p_tier NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'Invalid tier: %', p_tier;
  END IF;

  SELECT * INTO _char FROM public.characters WHERE id = p_character_id FOR UPDATE;
  IF _char IS NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  _existing := coalesce(_char.reserved_buffs, '{}'::jsonb);

  IF _existing ? p_stance_key THEN
    RETURN _existing;
  END IF;

  IF (p_stance_key = 'ignite' AND _existing ? 'envenom')
     OR (p_stance_key = 'envenom' AND _existing ? 'ignite') THEN
    RAISE EXCEPTION 'Ignite and Envenom are mutually exclusive';
  END IF;

  SELECT coalesce(sum((value->>'reserved')::int), 0) INTO _reserved_total
  FROM jsonb_each(_existing);

  _pct := CASE p_tier WHEN 1 THEN 0.10 WHEN 2 THEN 0.15 WHEN 3 THEN 0.20 END;
  _reserve := greatest(5, ceil(_char.max_cp * _pct)::int);

  _available := _char.cp - _reserved_total;
  IF _reserve > _available THEN
    RAISE EXCEPTION 'Not enough available CP (need %, have %)', _reserve, _available;
  END IF;

  _entry := jsonb_build_object(
    'tier', p_tier,
    'reserved', _reserve,
    'activated_at', (extract(epoch from now()) * 1000)::bigint
  );

  -- Force Shield: seed the persistent ward HP at full WIS-based cap on first activation.
  IF p_stance_key = 'force_shield' THEN
    SELECT COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0)
      INTO _gear_wis
      FROM public.character_inventory ci
      JOIN public.items i ON i.id = ci.item_id
      WHERE ci.character_id = p_character_id
        AND ci.equipped_slot IS NOT NULL;

    _wis_total := coalesce(_char.wis, 10) + coalesce(_gear_wis, 0);
    _wis_mod := greatest(0, floor((_wis_total - 10)::numeric / 2)::int);
    _shield_cap := greatest(1, _wis_mod + floor(coalesce(_char.level, 1)::numeric / 2)::int);
    _new_stance_state := coalesce(_char.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', _shield_cap,
           'force_shield_updated_at', to_jsonb(now())
         );
    UPDATE public.characters
       SET reserved_buffs = _existing || jsonb_build_object(p_stance_key, _entry),
           stance_state = _new_stance_state
     WHERE id = p_character_id
     RETURNING reserved_buffs INTO _existing;
  ELSE
    UPDATE public.characters
       SET reserved_buffs = _existing || jsonb_build_object(p_stance_key, _entry)
     WHERE id = p_character_id
     RETURNING reserved_buffs INTO _existing;
  END IF;

  RETURN _existing;
END;
$$;


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
  gear_wis integer;
  int_total integer;
  wis_total integer;
  int_mod integer;
  wis_mod integer;
  cap integer;
  regen_per_tick integer;
  current_hp integer;
  last_ts timestamptz;
  elapsed_ms bigint;
  ticks integer;
  next_hp integer;
  new_state jsonb;
BEGIN
  SELECT id, user_id, level, int, wis, reserved_buffs, stance_state, current_node_id
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

  -- Sum INT bonuses from equipped items (drives regen-per-tick).
  SELECT COALESCE(SUM(COALESCE((i.stats->>'int')::int, 0)), 0)
    INTO gear_int
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.character_id = c.id
      AND ci.equipped_slot IS NOT NULL;

  -- Sum WIS bonuses from equipped items (drives pool cap).
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
  -- Cap = WIS-driven (sustained ward).
  cap := greatest(1, wis_mod + floor(coalesce(c.level, 1)::numeric / 2)::int);
  -- Regen per tick = INT-driven (the spark).
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