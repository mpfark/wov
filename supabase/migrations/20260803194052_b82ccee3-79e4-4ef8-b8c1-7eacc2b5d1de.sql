-- Phase 2: authoritative ability loadout mutation.

CREATE OR REPLACE FUNCTION public.assert_loadout_swap_allowed(
  _character_id uuid,
  _role_id uuid
) RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _char record;
  _current_key text;
  _result record;
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id, class, level, hp, coalesce(reserved_buffs, '{}'::jsonb) AS reserved_buffs
    INTO _char
    FROM public.characters
   WHERE id = _character_id
   FOR UPDATE;

  IF _char IS NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;
  IF _char.hp <= 0 THEN
    RAISE EXCEPTION 'You cannot change techniques while dead';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.combat_sessions cs
     WHERE cs.character_id = _character_id
        OR cs.party_id IN (
             SELECT pm.party_id FROM public.party_members pm
              WHERE pm.character_id = _character_id AND pm.status = 'active'
           )
  ) THEN
    RAISE EXCEPTION 'You cannot change techniques during combat';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.class_ability_roles r
     WHERE r.id = _role_id AND r.class_key = _char.class
  ) THEN
    RAISE EXCEPTION 'That slot does not belong to your class';
  END IF;

  -- Currently equipped ability for this slot: explicit row, else the slot default.
  SELECT a.ability_key INTO _current_key
    FROM public.character_ability_loadout l
    JOIN public.abilities a ON a.id = l.ability_id
   WHERE l.character_id = _character_id AND l.role_id = _role_id;

  IF _current_key IS NULL THEN
    SELECT a.ability_key INTO _current_key
      FROM public.class_ability_assignments ca
      JOIN public.abilities a ON a.id = ca.ability_id
     WHERE ca.role_id = _role_id
       AND ca.class_key = _char.class
       AND ca.status = 'active'
       AND ca.is_default
     LIMIT 1;
  END IF;

  IF _current_key IS NOT NULL AND (_char.reserved_buffs ? _current_key) THEN
    RAISE EXCEPTION 'Drop the active stance in that slot first';
  END IF;

  SELECT _char.class, _char.level INTO _result;
  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ability_loadout(
  _character_id uuid,
  _role_id uuid,
  _ability_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _class text;
  _level int;
  _assignment record;
  _checked record;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);

  _checked := public.assert_loadout_swap_allowed(_character_id, _role_id);
  SELECT class, level INTO _class, _level FROM public.characters WHERE id = _character_id;

  SELECT ca.is_default, ca.unlock_level
    INTO _assignment
    FROM public.class_ability_assignments ca
    JOIN public.abilities a ON a.id = ca.ability_id
   WHERE ca.ability_id = _ability_id
     AND ca.role_id = _role_id
     AND ca.class_key = _class
     AND ca.status = 'active'
     AND a.status = 'active';

  IF _assignment IS NULL THEN
    RAISE EXCEPTION 'That technique is not available in this slot';
  END IF;
  IF _assignment.unlock_level > _level THEN
    RAISE EXCEPTION 'That technique unlocks at level %', _assignment.unlock_level;
  END IF;

  IF _assignment.is_default THEN
    DELETE FROM public.character_ability_loadout
     WHERE character_id = _character_id AND role_id = _role_id;
    RETURN;
  END IF;

  INSERT INTO public.character_ability_loadout (character_id, role_id, ability_id)
  VALUES (_character_id, _role_id, _ability_id)
  ON CONFLICT (character_id, role_id)
  DO UPDATE SET ability_id = EXCLUDED.ability_id, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_ability_loadout(
  _character_id uuid,
  _role_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _checked record;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  _checked := public.assert_loadout_swap_allowed(_character_id, _role_id);

  DELETE FROM public.character_ability_loadout
   WHERE character_id = _character_id AND role_id = _role_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_loadout_swap_allowed(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_ability_loadout(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_ability_loadout(uuid, uuid) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.character_ability_loadout FROM authenticated;
GRANT SELECT ON public.character_ability_loadout TO authenticated;
GRANT ALL ON public.character_ability_loadout TO service_role;