-- TEST-ONLY probe: exact clone of public.combat_intent's serialization body,
-- with (a) the maintenance gate omitted and (b) ownership resolved from an
-- explicit actor user id instead of auth.uid(), plus an optional in-lock hold
-- so two independent sessions can be ordered deterministically.
-- Dropped again at the end of this checkpoint. Not granted to anon/authenticated.
CREATE OR REPLACE FUNCTION public.combat_intent_probe(
  _encounter_id uuid,
  _character_id uuid,
  _intent_kind text,
  _ability_key text,
  _stance_key text,
  _target_creature_id uuid,
  _request_id uuid,
  _actor_user uuid,
  _hold_ms integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  e            public.node_encounter;
  v_existing   public.node_intent;
  v_key        text;
  v_new_id     uuid;
  v_new_seq    bigint;
  v_superseded uuid[];
BEGIN
  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_required');
  END IF;
  IF _intent_kind IS NULL OR _intent_kind NOT IN ('ability','stance_activate','stance_drop') THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'intent_kind');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.characters
                 WHERE id = _character_id AND user_id = _actor_user) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized', 'reason', 'character');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('combat_intent:' || _character_id::text, 0));
  IF COALESCE(_hold_ms, 0) > 0 THEN
    PERFORM pg_sleep(_hold_ms / 1000.0);
  END IF;

  SELECT * INTO v_existing FROM public.node_intent WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_existing.character_id <> _character_id THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'already_queued',
                              'intent_id', v_existing.id, 'seq', v_existing.seq,
                              'status', v_existing.status);
  END IF;

  SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_encounter');
  END IF;
  IF e.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_accepting_input', 'reason', e.status);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.characters c
                 WHERE c.id = _character_id AND c.current_node_id = e.node_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_at_node');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                 WHERE nf.encounter_id = _encounter_id
                   AND nf.character_id = _character_id
                   AND nf.present) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_present');
  END IF;

  IF _intent_kind = 'ability' THEN
    IF _ability_key IS NULL OR _stance_key IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'shape_ability');
    END IF;
    v_key := _ability_key;
    IF NOT public.character_can_use_ability(_character_id, v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'ability_unavailable', 'ability_key', v_key);
    END IF;
    IF public.ability_key_is_stance(v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'stance_requires_stance_intent');
    END IF;
  ELSE
    IF _stance_key IS NULL OR _ability_key IS NOT NULL OR _target_creature_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'shape_stance');
    END IF;
    v_key := _stance_key;
    IF NOT public.ability_key_is_stance(v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'not_a_stance');
    END IF;
    IF NOT public.character_can_use_ability(_character_id, v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'stance_unavailable', 'stance_key', v_key);
    END IF;
  END IF;

  IF _target_creature_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.node_creature nc
                   WHERE nc.encounter_id = _encounter_id
                     AND nc.creature_id = _target_creature_id
                     AND nc.is_alive) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_target',
                                'reason', 'not_in_encounter_or_dead');
    END IF;
  END IF;

  WITH s AS (
    UPDATE public.node_intent
       SET status = 'rejected', reject_reason = 'superseded'
     WHERE character_id = _character_id AND status = 'pending'
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_superseded FROM s;

  INSERT INTO public.node_intent
    (encounter_id, character_id, intent_kind, ability_key, stance_key,
     target_creature_id, status, request_id)
  VALUES
    (_encounter_id, _character_id, _intent_kind,
     CASE WHEN _intent_kind = 'ability' THEN _ability_key ELSE NULL END,
     CASE WHEN _intent_kind = 'ability' THEN NULL ELSE _stance_key END,
     _target_creature_id, 'pending', _request_id)
  RETURNING id, seq INTO v_new_id, v_new_seq;

  RETURN jsonb_build_object('ok', true, 'kind', 'queued',
                            'intent_id', v_new_id, 'seq', v_new_seq,
                            'intent_kind', _intent_kind,
                            'superseded', to_jsonb(v_superseded));
END;
$function$;

REVOKE ALL ON FUNCTION public.combat_intent_probe(uuid,uuid,text,text,text,uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.combat_intent_probe(uuid,uuid,text,text,text,uuid,uuid,uuid,integer) FROM anon;
REVOKE ALL ON FUNCTION public.combat_intent_probe(uuid,uuid,text,text,text,uuid,uuid,uuid,integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.combat_intent_probe(uuid,uuid,text,text,text,uuid,uuid,uuid,integer) TO service_role;