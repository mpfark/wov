
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
  _allowed text[] := array['ignite','envenom','holy_shield','force_shield','eagle_eye','arcane_surge','battle_cry','shield_wall'];
  _gear_wis int;
  _wis_total int;
  _wis_mod int;
  _shield_cap int;
  _new_stance_state jsonb;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);

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

CREATE OR REPLACE FUNCTION public.drop_stance(p_character_id uuid, p_stance_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing jsonb;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);

  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.characters
     SET reserved_buffs = coalesce(reserved_buffs, '{}'::jsonb) - p_stance_key,
         stance_state = CASE
           WHEN p_stance_key = 'force_shield'
             THEN coalesce(stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at'
           ELSE stance_state
         END
   WHERE id = p_character_id
   RETURNING reserved_buffs INTO _existing;

  RETURN coalesce(_existing, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_stances(p_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _had jsonb;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);

  IF NOT (owns_character(p_character_id) OR is_steward_or_overlord()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.characters
     SET reserved_buffs = '{}'::jsonb,
         stance_state = coalesce(stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at'
   WHERE id = p_character_id
   RETURNING '{}'::jsonb INTO _had;

  RETURN coalesce(_had, '{}'::jsonb);
END;
$$;
