-- Close the public Combat2 intent preflight around replay identity and
-- authoritative spendable CP. Final resolution still revalidates the frozen
-- heartbeat snapshot; this gate only prevents requests already known to be
-- unaffordable from consuming the pending action slot.
BEGIN;

-- PostgreSQL does not reliably validate every composite-row field while a
-- PL/pgSQL body is created. Prove the installed predecessor and every table
-- field this wrapper depends on before renaming any function.
DO $$
DECLARE
  v_predecessor text;
BEGIN
  IF to_regprocedure('public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: expected public combat_intent signature is missing';
  END IF;
  IF to_regprocedure('public.combat_intent_without_spendable_cp_preflight(uuid,uuid,text,text,text,uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: internal wrapper already exists';
  END IF;
  IF to_regprocedure('public.combat_intent_without_ability_support_gate(uuid,uuid,text,text,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: installed queue helper is missing';
  END IF;

  SELECT pg_get_functiondef('public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)'::regprocedure)
    INTO v_predecessor;
  IF position('combat_intent_without_ability_support_gate' IN v_predecessor) = 0
     OR position('target_character_id' IN v_predecessor) = 0 THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: unexpected installed predecessor body';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = 'public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)'::regprocedure
      AND procedure.prosecdef
      AND 'search_path=public, pg_temp' = ANY(COALESCE(procedure.proconfig, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: unexpected predecessor security/search_path contract';
  END IF;

  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('node_intent','request_id'), ('node_intent','encounter_id'),
      ('node_intent','character_id'), ('node_intent','intent_kind'),
      ('node_intent','ability_key'), ('node_intent','stance_key'),
      ('node_intent','target_creature_id'), ('node_intent','target_character_id'),
      ('characters','id'), ('characters','class'), ('characters','cp'),
      ('characters','max_cp'),
      ('node_fighter','id'), ('node_fighter','encounter_id'),
      ('node_fighter','character_id'), ('node_fighter','present'),
      ('class_ability_assignments','ability_id'),
      ('class_ability_assignments','class_ability_key'),
      ('class_ability_assignments','class_key'),
      ('class_ability_assignments','status'),
      ('class_ability_assignments','unlock_level'),
      ('abilities','id'), ('abilities','base_ability_id'),
      ('abilities','ability_key'), ('abilities','status'),
      ('abilities','cp_cost'), ('abilities','cp_reserve_pct'),
      ('base_abilities','id'), ('base_abilities','cp_cost'),
      ('base_abilities','cp_reserve_pct'),
      ('node_effect','encounter_id'), ('node_effect','target_character_id'),
      ('node_effect','is_reservation'), ('node_effect','magnitude')
    ) AS required(table_name, column_name)
    EXCEPT
    SELECT columns.table_name, columns.column_name
    FROM information_schema.columns columns
    WHERE columns.table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: required table column is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'node_fighter' AND column_name = 'max_cp'
  ) THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: unexpected node_fighter.max_cp must not become a resource authority';
  END IF;

  IF EXISTS (
    SELECT required.table_name, required.column_name, required.udt_name
    FROM (VALUES
      ('characters','cp','int4'), ('characters','max_cp','int4'),
      ('abilities','cp_cost','int4'), ('abilities','cp_reserve_pct','numeric'),
      ('base_abilities','cp_cost','int4'), ('base_abilities','cp_reserve_pct','numeric'),
      ('node_effect','magnitude','numeric'), ('node_effect','is_reservation','bool')
    ) AS required(table_name, column_name, udt_name)
    LEFT JOIN information_schema.columns columns
      ON columns.table_schema = 'public'
     AND columns.table_name = required.table_name
     AND columns.column_name = required.column_name
     AND columns.udt_name = required.udt_name
    WHERE columns.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'combat2 spendable-cp preflight: resource column type is unexpected';
  END IF;
END;
$$;

ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)
  RENAME TO combat_intent_without_spendable_cp_preflight;
REVOKE ALL ON FUNCTION public.combat_intent_without_spendable_cp_preflight(uuid,uuid,text,text,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat_intent_without_spendable_cp_preflight(uuid,uuid,text,text,text,uuid,uuid,uuid)
  TO service_role;

CREATE FUNCTION public.combat_intent(
  _encounter_id uuid,
  _character_id uuid,
  _intent_kind text,
  _ability_key text,
  _stance_key text,
  _target_creature_id uuid,
  _target_character_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.node_intent;
  v_character public.characters;
  v_fighter public.node_fighter;
  v_cp_cost integer;
  v_reserve_pct numeric;
  v_reserved integer;
  v_available integer;
  v_required integer;
  v_key text := CASE
    WHEN _intent_kind IN ('stance_activate', 'stance_drop') THEN _stance_key
    ELSE _ability_key
  END;
BEGIN
  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_required');
  END IF;

  -- Serialize the replay check, preflight and eventual insert with the same
  -- character lock used by the installed queue authority.
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_intent:' || _character_id::text, 0));

  SELECT * INTO v_existing
  FROM public.node_intent
  WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_existing.encounter_id IS DISTINCT FROM _encounter_id
       OR v_existing.character_id IS DISTINCT FROM _character_id
       OR v_existing.intent_kind IS DISTINCT FROM _intent_kind
       OR v_existing.ability_key IS DISTINCT FROM _ability_key
       OR v_existing.stance_key IS DISTINCT FROM _stance_key
       OR v_existing.target_creature_id IS DISTINCT FROM _target_creature_id
       OR v_existing.target_character_id IS DISTINCT FROM _target_character_id THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_conflict');
    END IF;
    RETURN public.combat_intent_without_spendable_cp_preflight(
      _encounter_id, _character_id, _intent_kind, _ability_key, _stance_key,
      _target_creature_id, _target_character_id, _request_id
    );
  END IF;

  -- Let the installed shape/ownership/target authority classify malformed,
  -- unavailable and non-present requests. Only make an insufficient-CP
  -- decision when the actor, fighter and authored ability are all known.
  IF _intent_kind IN ('ability', 'stance_activate') AND v_key IS NOT NULL THEN
    SELECT c.* INTO v_character
    FROM public.characters c
    WHERE c.id = _character_id
    FOR UPDATE;

    SELECT nf.* INTO v_fighter
    FROM public.node_fighter nf
    WHERE nf.encounter_id = _encounter_id
      AND nf.character_id = v_character.id
      AND nf.present;

    IF v_character.id IS NOT NULL AND v_fighter.id IS NOT NULL THEN
      SELECT COALESCE(a.cp_cost, ba.cp_cost, 0),
             COALESCE(a.cp_reserve_pct, ba.cp_reserve_pct, 0)
        INTO v_cp_cost, v_reserve_pct
      FROM public.class_ability_assignments ca
      JOIN public.abilities a ON a.id = ca.ability_id
      LEFT JOIN public.base_abilities ba ON ba.id = a.base_ability_id
      WHERE ca.class_key = v_character.class
        AND ca.status = 'active'
        AND a.status = 'active'
        AND (ca.class_ability_key = v_key OR a.ability_key = v_key)
      ORDER BY (ca.class_ability_key = v_key) DESC, ca.unlock_level DESC
      LIMIT 1;

      IF FOUND THEN
        SELECT COALESCE(SUM(GREATEST(0, ne.magnitude)), 0)::integer
          INTO v_reserved
        FROM public.node_effect ne
        WHERE ne.encounter_id = _encounter_id
          AND ne.target_character_id = _character_id
          AND ne.is_reservation;

        v_available := GREATEST(0, COALESCE(v_character.cp, 0) - v_reserved);
        v_required := GREATEST(0, COALESCE(v_cp_cost, 0))
          + CASE WHEN _intent_kind = 'stance_activate'
              THEN FLOOR(GREATEST(0, COALESCE(v_character.max_cp, 0)) * GREATEST(0, COALESCE(v_reserve_pct, 0)))::integer
              ELSE 0 END;

        IF v_available < v_required THEN
          RETURN jsonb_build_object(
            'ok', false,
            'kind', 'insufficient_resource',
            'reason', 'insufficient_cp',
            'required_cp', v_required,
            'available_cp', v_available
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN public.combat_intent_without_spendable_cp_preflight(
    _encounter_id, _character_id, _intent_kind, _ability_key, _stance_key,
    _target_creature_id, _target_character_id, _request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)
  TO authenticated, service_role;

COMMIT;
