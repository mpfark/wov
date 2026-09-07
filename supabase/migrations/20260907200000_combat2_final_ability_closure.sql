-- Additive final Combat2 ability closure: authoritative friendly targets and
-- tick-model backfill. Applied migrations are deliberately left untouched.
ALTER TABLE public.node_intent
  ADD COLUMN IF NOT EXISTS target_character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL;
ALTER TABLE public.node_intent ADD COLUMN IF NOT EXISTS target_fighter_id uuid REFERENCES public.node_fighter(id) ON DELETE SET NULL;
ALTER TABLE public.node_intent ADD COLUMN IF NOT EXISTS target_entry_seq bigint;

-- Existing timed effects are translated once to the authoritative 2-second
-- encounter tick model. Compatibility timestamps remain for presentation.
UPDATE public.node_effect ne
SET config = ne.config || jsonb_build_object(
  'activated_at_tick', e.tick,
  'expires_after_tick', e.tick + GREATEST(1, CEIL(GREATEST(0, EXTRACT(EPOCH FROM (ne.expires_at-now()))*1000)/2000.0)::integer),
  'interval_ticks', GREATEST(1, CEIL(ne.interval_ms/2000.0)::integer),
  'next_pulse_tick', e.tick + LEAST(
    GREATEST(1, CEIL(GREATEST(0, EXTRACT(EPOCH FROM (ne.expires_at-now()))*1000)/2000.0)::integer),
    GREATEST(1, CEIL(ne.interval_ms/2000.0)::integer))
)
FROM public.node_encounter e
WHERE ne.encounter_id=e.id AND ne.expires_at IS NOT NULL AND ne.interval_ms IS NOT NULL
  AND ne.next_due_at IS NOT NULL AND NOT ne.config ? 'activated_at_tick';

UPDATE public.node_effect ne SET config=ne.config || '{"persistent_stance":true}'::jsonb
WHERE EXISTS (SELECT 1 FROM public.abilities a LEFT JOIN public.base_abilities ba ON ba.id=a.base_ability_id
  WHERE a.ability_key=ne.ability_key AND COALESCE(a.activation_mode,ba.activation_mode)='stance');

-- Extend the frozen claim projection without replacing any other claim logic.
DO $$ DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO d;
  IF position('''target_character_id'', ni.target_character_id' in d)=0 THEN
    d := replace(d,
      '''stance_key'', ni.stance_key, ''target_creature_id'', ni.target_creature_id',
      '''stance_key'', ni.stance_key, ''target_creature_id'', ni.target_creature_id, ''target_character_id'', ni.target_character_id, ''target_fighter_id'', ni.target_fighter_id, ''target_entry_seq'', ni.target_entry_seq');
    IF d IS NULL OR position('''target_character_id'', ni.target_character_id' in d)=0 THEN
      RAISE EXCEPTION 'unexpected node_tick_claim intent projection';
    END IF;
    EXECUTE d;
  END IF;
  IF position('''tick_origin'', e.created_at' in d)=0 THEN
    d := replace(d,'''now'', now()','''now'', now(), ''tick_origin'', e.created_at');
    IF position('''tick_origin'', e.created_at' in d)=0 THEN RAISE EXCEPTION 'unexpected node_tick_claim encounter projection'; END IF;
    EXECUTE d;
  END IF;
  IF position('LEFT JOIN public.party_members pm ON pm.character_id = ch.id AND pm.status = ''accepted''' in d)=0 THEN
    d := replace(d,'LEFT JOIN public.party_members pm ON pm.character_id = ch.id',
      'LEFT JOIN public.party_members pm ON pm.character_id = ch.id AND pm.status = ''accepted''');
    IF position('LEFT JOIN public.party_members pm ON pm.character_id = ch.id AND pm.status = ''accepted''' in d)=0 THEN
      RAISE EXCEPTION 'unexpected node_tick_claim party projection';
    END IF;
    EXECUTE d;
  END IF;
END $$;

-- Permit deterministic tick-timing refreshes (for capped hostile stacks) in
-- the existing absolute effect-update commit path.
DO $$ DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
  IF position('config          = CASE WHEN rec ? ''config''' in d)=0 THEN
    d := replace(d,'SET stacks          = COALESCE((rec->>''stacks'')::int, ne.stacks),',
      'SET config          = CASE WHEN rec ? ''config'' THEN rec->''config'' ELSE ne.config END,' || E'\n           ' ||
      'stacks          = COALESCE((rec->>''stacks'')::int, ne.stacks),');
    IF d IS NULL OR position('config          = CASE WHEN rec ? ''config''' in d)=0 THEN
      RAISE EXCEPTION 'unexpected node_tick_commit effect update contract';
    END IF;
    EXECUTE d;
  END IF;
END $$;

-- Eight-argument public contract. The installed seven-argument implementation
-- remains the queue/ownership authority and is callable only server-side.
DROP FUNCTION IF EXISTS public.combat_intent(uuid,uuid,text,text,text,uuid,uuid);
CREATE FUNCTION public.combat_intent(
  _encounter_id uuid, _character_id uuid, _intent_kind text, _ability_key text,
  _stance_key text, _target_creature_id uuid, _target_character_id uuid, _request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; target_type text; actor_f public.node_fighter; target_f public.node_fighter;
BEGIN
  SELECT COALESCE(a.target_type,ba.target_type,ba.default_target_type) INTO target_type
  FROM public.class_ability_assignments ca
  JOIN public.abilities a ON a.id=ca.ability_id
  LEFT JOIN public.base_abilities ba ON ba.id=a.base_ability_id
  JOIN public.characters c ON c.id=_character_id AND c.class=ca.class_key
  WHERE ca.status='active' AND a.status='active' AND a.ability_key=COALESCE(_ability_key,_stance_key)
  ORDER BY ca.unlock_level DESC LIMIT 1;

  IF target_type='ally' THEN
    IF _target_character_id IS NULL THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_target','reason','ally_required');
    END IF;
    SELECT * INTO actor_f FROM public.node_fighter
      WHERE encounter_id=_encounter_id AND character_id=_character_id AND present FOR UPDATE;
    SELECT * INTO target_f FROM public.node_fighter
      WHERE encounter_id=_encounter_id AND character_id=_target_character_id AND present FOR UPDATE;
    IF NOT FOUND OR actor_f.id IS NULL OR target_f.id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.characters c JOIN public.node_encounter e ON e.id=_encounter_id
                      WHERE c.id=_target_character_id AND c.hp>0 AND c.current_node_id=e.node_id)
       OR (_target_character_id=_character_id AND COALESCE(_ability_key,'')<>'divine_aegis')
       OR (_target_character_id<>_character_id AND NOT EXISTS (
          SELECT 1 FROM public.party_members a JOIN public.party_members b ON b.party_id=a.party_id
          WHERE a.character_id=_character_id AND b.character_id=_target_character_id
            AND a.status='accepted' AND b.status='accepted'
            AND a.party_id=actor_f.party_id_at_entry AND b.party_id=target_f.party_id_at_entry)) THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_target','reason','ally_not_eligible');
    END IF;
  ELSIF _target_character_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_target','reason','ally_not_allowed');
  END IF;

  result := public.combat_intent_without_ability_support_gate(
    _encounter_id,_character_id,_intent_kind,_ability_key,_stance_key,_target_creature_id,_request_id);
  IF result->>'ok'='true' THEN
    IF result->>'kind'='queued' THEN
      UPDATE public.node_intent SET target_character_id=_target_character_id,
        target_fighter_id=CASE WHEN _target_character_id IS NULL THEN NULL ELSE target_f.id END,
        target_entry_seq=CASE WHEN _target_character_id IS NULL THEN NULL ELSE target_f.entry_seq END
        WHERE id=(result->>'intent_id')::uuid;
    ELSIF NOT EXISTS (SELECT 1 FROM public.node_intent ni
      WHERE ni.id=(result->>'intent_id')::uuid
        AND ni.target_character_id IS NOT DISTINCT FROM _target_character_id) THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_target_conflict');
    END IF;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid) TO authenticated,service_role;

-- Expose only same-encounter authoritative fighter choices to the owning client.
ALTER FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) RENAME TO combat2_sync_without_allies;
REVOKE ALL ON FUNCTION public.combat2_sync_without_allies(uuid,uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_sync_without_allies(uuid,uuid,bigint,integer) TO service_role;
CREATE FUNCTION public.combat2_sync(_character_id uuid,_encounter_id uuid,
  _after_tick bigint DEFAULT 0,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; actor_party uuid;
BEGIN
  result := public.combat2_sync_without_allies(_character_id,_encounter_id,_after_tick,_limit);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  SELECT pm.party_id INTO actor_party FROM public.party_members pm
    WHERE pm.character_id=_character_id AND pm.status='accepted' LIMIT 1;
  RETURN result || jsonb_build_object('allies',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('characterId',nf.character_id,'fighterId',nf.id,
      'entrySeq',nf.entry_seq,'name',c.name,'hp',c.hp,'maxHp',c.max_hp,
      'cp',c.cp,'maxCp',c.max_cp,'mp',c.mp,'maxMp',c.max_mp,'present',nf.present)
      ORDER BY nf.entry_seq,nf.id)
    FROM public.node_fighter nf JOIN public.characters c ON c.id=nf.character_id
    LEFT JOIN public.party_members pm ON pm.character_id=nf.character_id AND pm.status='accepted'
    WHERE nf.encounter_id=_encounter_id AND nf.present AND c.hp>0
      AND (nf.character_id=_character_id OR (actor_party IS NOT NULL AND pm.party_id=actor_party))
  ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) TO authenticated,service_role;
