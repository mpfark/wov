-- Fail closed before an authored ability can queue when its complete Combat2
-- semantic consumer is not installed. This list mirrors the canonical
-- src/shared/combat2/ability-support.ts registry and is contract-tested.
ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid)
  RENAME TO combat_intent_without_ability_support_gate;
REVOKE ALL ON FUNCTION public.combat_intent_without_ability_support_gate(uuid,uuid,text,text,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat_intent_without_ability_support_gate(uuid,uuid,text,text,text,uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.combat_intent(
  _encounter_id uuid, _character_id uuid, _intent_kind text, _ability_key text,
  _stance_key text, _target_creature_id uuid, _request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE requested_key text := CASE
  WHEN _intent_kind IN ('stance_activate','stance_drop') THEN _stance_key
  WHEN _intent_kind = 'ability' THEN _ability_key
  ELSE NULL
END;
BEGIN
  IF requested_key = ANY(ARRAY[
    'conflagrate','consecrate','crescendo','divine_aegis','envenom','eviscerate',
    'ignite','inspire','purifying_light','transfer_health'
  ]::text[]) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'kind', 'ability_unavailable',
      'reason', 'This ability is not yet available in Combat2.'
    );
  END IF;

  RETURN public.combat_intent_without_ability_support_gate(
    _encounter_id,_character_id,_intent_kind,_ability_key,_stance_key,
    _target_creature_id,_request_id
  );
END $$;

REVOKE ALL ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid)
  TO authenticated,service_role;
