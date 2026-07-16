-- ============================================================
-- M3: Delta character-resource RPCs (encounter-owned, feature-flagged)
-- No existing callers are changed by this migration.
-- ============================================================

-- ── helper: ensure encounter + participant for a character ───────
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

  SELECT id INTO v_encounter_id
  FROM public.encounters
  WHERE node_id = v_node_id AND encounter_key = 'default' AND status = 'active'
  LIMIT 1;

  IF v_encounter_id IS NULL THEN
    INSERT INTO public.encounters (node_id, encounter_key, status)
    VALUES (v_node_id, 'default', 'active')
    RETURNING id INTO v_encounter_id;
  END IF;

  INSERT INTO public.encounter_participants (encounter_id, character_id, last_action_at)
  VALUES (v_encounter_id, _character_id, now())
  ON CONFLICT (character_id) DO UPDATE
     SET last_action_at = now(),
         encounter_id   = EXCLUDED.encounter_id;

  RETURN v_encounter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_ensure_for_character(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_ensure_for_character(uuid) TO service_role;

-- ── encounter_apply_character_damage ─────────────────────────────
CREATE OR REPLACE FUNCTION public.encounter_apply_character_damage(
  _character_id uuid,
  _amount int,
  _source_kind text,
  _source_creature_id uuid DEFAULT NULL
)
RETURNS TABLE (
  encounter_id uuid,
  new_hp int,
  old_hp int,
  caused_death boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc uuid;
  v_old_hp int;
  v_new_hp int;
  v_alive boolean;
  v_killed boolean := false;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'encounter_apply_character_damage: _amount must be >= 0 (got %)', _amount;
  END IF;

  v_enc := public.encounter_ensure_for_character(_character_id);
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  SELECT hp INTO v_old_hp
  FROM public.characters
  WHERE id = _character_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_enc, 0, 0, false;
    RETURN;
  END IF;

  v_alive := v_old_hp > 0;
  IF NOT v_alive THEN
    RETURN QUERY SELECT v_enc, 0, v_old_hp, false;
    RETURN;
  END IF;

  v_new_hp := GREATEST(v_old_hp - _amount, 0);
  v_killed := v_new_hp = 0;

  UPDATE public.characters
     SET hp = v_new_hp
   WHERE id = _character_id;

  IF v_killed THEN
    -- Clear active effects on death (mirrors current tick logic).
    DELETE FROM public.active_effects WHERE character_id = _character_id;
  END IF;

  RETURN QUERY SELECT v_enc, v_new_hp, v_old_hp, v_killed;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_apply_character_damage(uuid,int,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_damage(uuid,int,text,uuid) TO service_role;

-- ── encounter_apply_character_heal ───────────────────────────────
CREATE OR REPLACE FUNCTION public.encounter_apply_character_heal(
  _character_id uuid,
  _amount int,
  _source_kind text
)
RETURNS TABLE (
  encounter_id uuid,
  new_hp int,
  old_hp int,
  hit_max boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc uuid;
  v_old_hp int;
  v_max_hp int;
  v_new_hp int;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'encounter_apply_character_heal: _amount must be >= 0 (got %)', _amount;
  END IF;

  v_enc := public.encounter_ensure_for_character(_character_id);
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  SELECT hp, max_hp INTO v_old_hp, v_max_hp
  FROM public.characters
  WHERE id = _character_id
  FOR UPDATE;

  IF NOT FOUND OR v_old_hp <= 0 THEN
    -- Dead characters cannot be healed by this path.
    RETURN QUERY SELECT v_enc, COALESCE(v_old_hp, 0), COALESCE(v_old_hp, 0), false;
    RETURN;
  END IF;

  v_new_hp := LEAST(v_old_hp + _amount, v_max_hp);

  UPDATE public.characters
     SET hp = v_new_hp
   WHERE id = _character_id;

  RETURN QUERY SELECT v_enc, v_new_hp, v_old_hp, v_new_hp = v_max_hp;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_apply_character_heal(uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_heal(uuid,int,text) TO service_role;

-- ── encounter_apply_character_resource (cp | mp, signed delta) ───
CREATE OR REPLACE FUNCTION public.encounter_apply_character_resource(
  _character_id uuid,
  _resource text,
  _delta int,
  _source_kind text
)
RETURNS TABLE (
  encounter_id uuid,
  new_value int,
  old_value int,
  hit_max boolean,
  hit_zero boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc uuid;
  v_old int;
  v_max int;
  v_new int;
BEGIN
  IF _resource NOT IN ('cp','mp') THEN
    RAISE EXCEPTION 'encounter_apply_character_resource: _resource must be cp or mp (got %)', _resource;
  END IF;
  IF _delta IS NULL THEN
    RAISE EXCEPTION 'encounter_apply_character_resource: _delta must not be null';
  END IF;

  v_enc := public.encounter_ensure_for_character(_character_id);
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  IF _resource = 'cp' THEN
    SELECT cp, max_cp INTO v_old, v_max
    FROM public.characters WHERE id = _character_id FOR UPDATE;
  ELSE
    SELECT mp, max_mp INTO v_old, v_max
    FROM public.characters WHERE id = _character_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_enc, 0, 0, false, false;
    RETURN;
  END IF;

  v_new := GREATEST(0, LEAST(v_old + _delta, v_max));

  IF _resource = 'cp' THEN
    UPDATE public.characters SET cp = v_new WHERE id = _character_id;
  ELSE
    UPDATE public.characters SET mp = v_new WHERE id = _character_id;
  END IF;

  RETURN QUERY SELECT v_enc, v_new, v_old, v_new = v_max, v_new = 0;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_apply_character_resource(uuid,text,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_resource(uuid,text,int,text) TO service_role;

-- ── dry-run twins (read-only, no writes; used by parity harness) ──

CREATE OR REPLACE FUNCTION public.encounter_apply_character_damage_dry_run(
  _character_id uuid,
  _amount int
)
RETURNS TABLE (new_hp int, old_hp int, caused_death boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old int;
  v_new int;
BEGIN
  SELECT hp INTO v_old FROM public.characters WHERE id = _character_id;
  IF NOT FOUND OR v_old <= 0 THEN
    RETURN QUERY SELECT COALESCE(v_old, 0), COALESCE(v_old, 0), false;
    RETURN;
  END IF;
  v_new := GREATEST(v_old - _amount, 0);
  RETURN QUERY SELECT v_new, v_old, v_new = 0;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_apply_character_damage_dry_run(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_damage_dry_run(uuid,int) TO service_role;

CREATE OR REPLACE FUNCTION public.encounter_apply_character_heal_dry_run(
  _character_id uuid,
  _amount int
)
RETURNS TABLE (new_hp int, old_hp int, hit_max boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old int;
  v_max int;
  v_new int;
BEGIN
  SELECT hp, max_hp INTO v_old, v_max FROM public.characters WHERE id = _character_id;
  IF NOT FOUND OR v_old <= 0 THEN
    RETURN QUERY SELECT COALESCE(v_old, 0), COALESCE(v_old, 0), false;
    RETURN;
  END IF;
  v_new := LEAST(v_old + _amount, v_max);
  RETURN QUERY SELECT v_new, v_old, v_new = v_max;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_apply_character_heal_dry_run(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_heal_dry_run(uuid,int) TO service_role;

CREATE OR REPLACE FUNCTION public.encounter_apply_character_resource_dry_run(
  _character_id uuid,
  _resource text,
  _delta int
)
RETURNS TABLE (new_value int, old_value int, hit_max boolean, hit_zero boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old int;
  v_max int;
  v_new int;
BEGIN
  IF _resource NOT IN ('cp','mp') THEN
    RAISE EXCEPTION 'encounter_apply_character_resource_dry_run: _resource must be cp or mp (got %)', _resource;
  END IF;

  IF _resource = 'cp' THEN
    SELECT cp, max_cp INTO v_old, v_max FROM public.characters WHERE id = _character_id;
  ELSE
    SELECT mp, max_mp INTO v_old, v_max FROM public.characters WHERE id = _character_id;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, false, false;
    RETURN;
  END IF;

  v_new := GREATEST(0, LEAST(v_old + _delta, v_max));
  RETURN QUERY SELECT v_new, v_old, v_new = v_max, v_new = 0;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_apply_character_resource_dry_run(uuid,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_resource_dry_run(uuid,text,int) TO service_role;
