-- ENG-STANCE-001/002: one character-owned stance lifecycle. Encounter rows are
-- projections only; they never own a reservation or persistent ward.

DO $$
DECLARE node_rows bigint; active_rows bigint; legacy_rows bigint; unknown_rows bigint;
 counts jsonb; relation_name text; before_hash text; after_hash text;
 protected_hashes jsonb:='{}'::jsonb; old_trusted text; old_timeout text;
BEGIN
  IF to_regprocedure('public.node_tick_claim(uuid,integer)') IS NULL
     OR to_regprocedure('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)') IS NULL
     OR to_regprocedure('public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.settle_out_of_combat_resources(timestamptz)') IS NULL
     OR to_regprocedure('public.combat2_test_stop(uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_test_reset(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'ENG-STANCE-001 predecessor functions missing';
  END IF;
  IF to_regclass('public.character_stance') IS NOT NULL THEN
    RAISE EXCEPTION 'ENG-STANCE-001 already installed: refusing repeated reset';
  END IF;
  IF public.world_state_is_awake() OR public.combat_mode_is_open()
     OR EXISTS(SELECT 1 FROM public.combat_config WHERE key='combat_soak' AND value='on')
     OR EXISTS(SELECT 1 FROM cron.job WHERE active AND command ILIKE '%combat%')
     OR EXISTS(SELECT 1 FROM public.node_encounter WHERE claim_token IS NOT NULL AND claim_expires_at>clock_timestamp())
     OR EXISTS(SELECT 1 FROM public.combat2_test_run WHERE status='recording') THEN
    RAISE EXCEPTION 'ENG-STANCE-001 reset requires asleep/maintenance, soak off, schedules disabled, no live claims or recording runs';
  END IF;

  -- Exact authored identities, mechanic kinds and effect types. A poison/ignite
  -- stack on a creature is an offscreen effect, not the self-owned stance.
  CREATE TEMP TABLE eng_stance_reset_manifest(key text PRIMARY KEY,kind text,effect_type text) ON COMMIT DROP;
  INSERT INTO pg_temp.eng_stance_reset_manifest VALUES
    ('envenom','stack_source','poison'),('eagle_eye','offense','eagle_eye'),
    ('holy_shield','reactive','holy_shield'),('shield_wall','block','shield_wall'),
    ('battle_cry','mitigation','battle_cry'),('arcane_surge','offense','arcane_surge'),
    ('force_shield','absorb','force_shield'),('ignite','stack_source','ignite');
  old_timeout:=current_setting('lock_timeout');
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.node_effect,public.active_effects,public.characters IN SHARE ROW EXCLUSIVE MODE;
  -- No deletion cascade or unknown DELETE trigger may widen the reset scope.
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D'
      AND tgrelid IN('public.node_effect'::regclass,'public.active_effects'::regclass) AND (tgtype::integer & 8)<>0)
     OR EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
      AND confrelid IN('public.node_effect'::regclass,'public.active_effects'::regclass)) THEN
    RAISE EXCEPTION 'ENG-STANCE-001 reset has unexpected effect deletion trigger/dependency';
  END IF;
  -- Deferred general character UPDATE triggers cannot be checked before commit.
  -- The known death trigger is UPDATE OF hp and does not fire for this update.
  IF EXISTS(SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled<>'D' AND t.tgdeferrable
      AND t.tgrelid='public.characters'::regclass AND (t.tgtype::integer & 16)<>0
      AND (cardinality(t.tgattr::smallint[])=0 OR EXISTS(SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[])
          AND a.attname IN('reserved_buffs','stance_state')))) THEN
    RAISE EXCEPTION 'ENG-STANCE-001 reset has unexpected deferred character trigger';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled<>'D'
      AND t.tgrelid='public.characters'::regclass AND (t.tgtype::integer & 16)<>0
      AND (cardinality(t.tgattr::smallint[])=0 OR EXISTS(SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[])
          AND a.attname IN('reserved_buffs','stance_state')))
      AND t.tgfoid NOT IN('public.update_updated_at()'::regprocedure,
        'public.restrict_party_leader_updates()'::regprocedure,'public.sync_stance_effects()'::regprocedure)) THEN
    RAISE EXCEPTION 'ENG-STANCE-001 reset has unexpected character update trigger';
  END IF;
  SELECT count(*) INTO unknown_rows FROM public.characters
   WHERE (reserved_buffs IS NOT NULL AND jsonb_typeof(reserved_buffs)<>'object')
      OR (stance_state IS NOT NULL AND jsonb_typeof(stance_state)<>'object');
  IF unknown_rows<>0 THEN
    RAISE EXCEPTION 'ENG-STANCE-001 unclassifiable legacy JSON: characters=%',unknown_rows;
  END IF;
  CREATE TEMP TABLE eng_stance_reset_node ON COMMIT DROP AS
    SELECT e.id,e.ability_key,e.is_reservation FROM public.node_effect e
    JOIN pg_temp.eng_stance_reset_manifest m ON m.key=e.ability_key
    WHERE e.target_character_id IS NOT NULL AND e.target_creature_id IS NULL
      AND e.source_character_id=e.target_character_id AND e.source_creature_id IS NULL
      AND ((e.is_reservation AND e.kind='reservation' AND e.effect_type='cp_reservation')
        OR (NOT e.is_reservation AND e.kind=m.kind AND e.effect_type=m.effect_type));
  SELECT count(*) INTO unknown_rows FROM public.node_effect e
   WHERE (e.is_reservation OR (e.target_character_id IS NOT NULL
     AND e.ability_key IN(SELECT key FROM pg_temp.eng_stance_reset_manifest)))
     AND NOT EXISTS(SELECT 1 FROM pg_temp.eng_stance_reset_node r WHERE r.id=e.id);
  IF unknown_rows<>0 THEN
    RAISE EXCEPTION 'ENG-STANCE-001 unclassifiable node stance/reservation rows=%',unknown_rows;
  END IF;
  -- Historical active_effects: exact self-owned key and lifetime marker; older
  -- timed self rows require the explicit source ability identity as well.
  CREATE TEMP TABLE eng_stance_reset_active ON COMMIT DROP AS
    SELECT e.id,m.key FROM public.active_effects e
    JOIN pg_temp.eng_stance_reset_manifest m ON m.key=e.effect_type
    JOIN public.characters c ON c.id=e.target_id
    WHERE e.source_id=e.target_id AND (e.source_ability_key IS NULL OR e.source_ability_key=m.key)
      AND (e.lifetime='stance' OR (e.lifetime='timed' AND e.source_ability_key=m.key));
  SELECT count(*) INTO unknown_rows FROM public.active_effects e
   WHERE (e.lifetime='stance' OR (e.source_id=e.target_id AND EXISTS(SELECT 1 FROM public.characters c WHERE c.id=e.target_id)
     AND (e.source_ability_key IN(SELECT key FROM pg_temp.eng_stance_reset_manifest)
       OR e.effect_type IN(SELECT key FROM pg_temp.eng_stance_reset_manifest))))
     AND NOT EXISTS(SELECT 1 FROM pg_temp.eng_stance_reset_active r WHERE r.id=e.id);
  IF unknown_rows<>0 THEN
    RAISE EXCEPTION 'ENG-STANCE-001 unclassifiable legacy stance effects=%',unknown_rows;
  END IF;
  CREATE TEMP TABLE eng_stance_reset_characters ON COMMIT DROP AS
    SELECT id,reserved_buffs,stance_state,
      coalesce(reserved_buffs,'{}'::jsonb)-ARRAY(SELECT key FROM pg_temp.eng_stance_reset_manifest) AS remaining_reservations,
      coalesce(stance_state,'{}'::jsonb)-ARRAY['force_shield_hp','force_shield_updated_at'] AS remaining_state
    FROM public.characters WHERE coalesce(reserved_buffs,'{}'::jsonb) ?| ARRAY(SELECT key FROM pg_temp.eng_stance_reset_manifest)
      OR coalesce(stance_state,'{}'::jsonb) ?| ARRAY['force_shield_hp','force_shield_updated_at'];
  SELECT count(*) INTO node_rows FROM pg_temp.eng_stance_reset_node;
  SELECT count(*) INTO active_rows FROM pg_temp.eng_stance_reset_active;
  SELECT count(*) INTO legacy_rows FROM pg_temp.eng_stance_reset_characters;
  IF node_rows+active_rows+legacy_rows>10000 THEN
    RAISE EXCEPTION 'ENG-STANCE-001 bounded reset exceeds 10000 affected rows: node=%, legacy_effects=%, characters=%',node_rows,active_rows,legacy_rows;
  END IF;
  SELECT jsonb_build_object('node_mechanics',(SELECT count(*) FROM pg_temp.eng_stance_reset_node WHERE NOT is_reservation),
    'node_reservations',(SELECT count(*) FROM pg_temp.eng_stance_reset_node WHERE is_reservation),
    'legacy_effects',active_rows,'characters',legacy_rows,
    'legacy_reservation_entries',(SELECT count(*) FROM pg_temp.eng_stance_reset_characters c
      CROSS JOIN LATERAL jsonb_object_keys(c.reserved_buffs) AS entries(key) WHERE key IN(SELECT key FROM pg_temp.eng_stance_reset_manifest)),
    'force_shield_ward_fields',(SELECT count(*) FROM pg_temp.eng_stance_reset_characters c
      CROSS JOIN LATERAL jsonb_object_keys(c.stance_state) AS entries(key) WHERE key IN('force_shield_hp','force_shield_updated_at')))
    INTO counts;
  RAISE NOTICE 'ENG-STANCE-001 reset preflight: %',counts;

  -- Fingerprint protected surfaces, including unaffected effects and complete
  -- character rows with only the expected JSON edits and normal updated_at. Locks and
  -- a mismatch exception make unexpected immediate trigger effects roll back.
  FOREACH relation_name IN ARRAY ARRAY['characters','character_inventory','node_effect','active_effects',
    'node_encounter','node_fighter','node_creature','node_participation','node_reward_claim','node_ground_loot',
    'node_intent','node_pending_event','combat2_departure_request','combat2_party_departure_request',
    'combat2_party_departure_member'] || ARRAY(SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'combat2_test_%' ORDER BY c.relname) LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',relation_name);
    IF relation_name='characters' THEN
      SELECT md5(coalesce(string_agg(md5((CASE WHEN r.id IS NULL THEN to_jsonb(c) ELSE to_jsonb(c)||jsonb_build_object(
        'reserved_buffs',CASE WHEN r.reserved_buffs IS NULL THEN NULL ELSE r.remaining_reservations END,
        'stance_state',CASE WHEN r.stance_state IS NULL THEN NULL ELSE r.remaining_state END,
        'updated_at',now()) END)::text),'' ORDER BY c.id),''))
        INTO before_hash FROM public.characters c LEFT JOIN pg_temp.eng_stance_reset_characters r ON r.id=c.id;
    ELSE
      EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),'''')) FROM public.%I t %s',
        relation_name,CASE relation_name WHEN 'node_effect' THEN 'WHERE id NOT IN(SELECT id FROM pg_temp.eng_stance_reset_node)'
          WHEN 'active_effects' THEN 'WHERE id NOT IN(SELECT id FROM pg_temp.eng_stance_reset_active)' ELSE '' END) INTO before_hash;
    END IF;
    protected_hashes:=protected_hashes||jsonb_build_object(relation_name,before_hash);
  END LOOP;
  DELETE FROM public.node_effect WHERE id IN(SELECT id FROM pg_temp.eng_stance_reset_node);
  DELETE FROM public.active_effects WHERE id IN(SELECT id FROM pg_temp.eng_stance_reset_active);
  old_trusted:=current_setting('app.trusted_rpc',true);
  PERFORM set_config('app.trusted_rpc','true',true);
  UPDATE public.characters c SET reserved_buffs=CASE WHEN c.reserved_buffs IS NULL THEN NULL ELSE r.remaining_reservations END,
    stance_state=CASE WHEN c.stance_state IS NULL THEN NULL ELSE r.remaining_state END
    FROM pg_temp.eng_stance_reset_characters r WHERE r.id=c.id;
  PERFORM set_config('app.trusted_rpc',coalesce(old_trusted,''),true);
  IF EXISTS(SELECT 1 FROM public.characters c JOIN pg_temp.eng_stance_reset_characters r ON r.id=c.id
    WHERE c.reserved_buffs IS DISTINCT FROM CASE WHEN r.reserved_buffs IS NULL THEN NULL ELSE r.remaining_reservations END
       OR c.stance_state IS DISTINCT FROM CASE WHEN r.stance_state IS NULL THEN NULL ELSE r.remaining_state END)
     OR EXISTS(SELECT 1 FROM public.node_effect WHERE id IN(SELECT id FROM pg_temp.eng_stance_reset_node))
     OR EXISTS(SELECT 1 FROM public.active_effects WHERE id IN(SELECT id FROM pg_temp.eng_stance_reset_active)) THEN
    RAISE EXCEPTION 'ENG-STANCE-001 reset postflight mismatch';
  END IF;
  FOR relation_name,before_hash IN SELECT key,value FROM jsonb_each_text(protected_hashes) LOOP
    IF relation_name='characters' THEN
      SELECT md5(coalesce(string_agg(md5(to_jsonb(c)::text),'' ORDER BY c.id),''))
        INTO after_hash FROM public.characters c;
    ELSE
      EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),'''')) FROM public.%I t',relation_name) INTO after_hash;
    END IF;
    IF before_hash IS DISTINCT FROM after_hash THEN
      RAISE EXCEPTION 'ENG-STANCE-001 reset changed protected surface: %',relation_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'ENG-STANCE-001 reset postflight: reset=%, remaining_identified_node=0, remaining_identified_legacy_effects=0, remaining_identified_JSON=0; protected fingerprints unchanged; new authority initializes empty',counts;
  PERFORM set_config('lock_timeout',old_timeout,true);
END $$;

CREATE TABLE public.character_stance (
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  ability_key text NOT NULL CHECK (ability_key IN ('envenom','eagle_eye','holy_shield','shield_wall','battle_cry','arcane_surge','force_shield','ignite')),
  reserve_pct numeric NOT NULL CHECK (reserve_pct > 0 AND reserve_pct <= 1),
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state)='object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(character_id,ability_key)
);
ALTER TABLE public.character_stance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.character_stance FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.character_stance TO service_role;

CREATE TABLE public.character_stance_request (
  request_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  ability_key text NOT NULL,
  action text NOT NULL CHECK(action IN('activate','drop')),
  encounter_id uuid REFERENCES public.node_encounter(id) ON DELETE SET NULL,
  intent_id uuid REFERENCES public.node_intent(id) ON DELETE SET NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  committed_at timestamptz
);
CREATE INDEX character_stance_request_character_created_idx ON public.character_stance_request(character_id,created_at DESC);
ALTER TABLE public.character_stance_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.character_stance_request FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.character_stance_request TO service_role;

CREATE TABLE public.combat2_test_arena_stance_snapshot_header (
  arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(arena_id,character_id)
);
CREATE TABLE public.combat2_test_arena_stance_snapshot (
  arena_id uuid NOT NULL,
  character_id uuid NOT NULL,
  ability_key text NOT NULL,
  reserve_pct numeric NOT NULL,
  state jsonb NOT NULL,
  version bigint NOT NULL,
  activated_at timestamptz NOT NULL,
  PRIMARY KEY(arena_id,character_id,ability_key),
  FOREIGN KEY(arena_id,character_id) REFERENCES public.combat2_test_arena_stance_snapshot_header(arena_id,character_id) ON DELETE CASCADE
);
ALTER TABLE public.combat2_test_arena_stance_snapshot_header ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_arena_stance_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_test_arena_stance_snapshot_header,public.combat2_test_arena_stance_snapshot FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.combat2_test_arena_stance_snapshot_header,public.combat2_test_arena_stance_snapshot TO service_role;

CREATE FUNCTION public.combat2_stance_reserved_cp(_character_id uuid,_max_cp integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(sum(floor(greatest(0,_max_cp)*reserve_pct)::integer),0)::integer
 FROM public.character_stance WHERE character_id=_character_id
$$;
REVOKE ALL ON FUNCTION public.combat2_stance_reserved_cp(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_stance_reserved_cp(uuid,integer) TO service_role;

CREATE FUNCTION public.combat2_character_stances(_character_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.characters; rows jsonb; reserved integer;
BEGIN
 SELECT * INTO c FROM public.characters WHERE id=_character_id;
 IF c.id IS NULL OR c.user_id IS DISTINCT FROM auth.uid() THEN
   RETURN jsonb_build_object('ok',false,'kind','not_authorized');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ability_key',s.ability_key,'reserve_pct',s.reserve_pct,
   'reserved_cp',floor(greatest(0,c.max_cp)*s.reserve_pct)::integer,'state',s.state,'version',s.version,
   'activated_at',s.activated_at) ORDER BY s.ability_key),'[]'::jsonb)
 INTO rows FROM public.character_stance s WHERE s.character_id=c.id;
 reserved:=public.combat2_stance_reserved_cp(c.id,c.max_cp);
 RETURN jsonb_build_object('ok',true,'kind','projected','character_id',c.id,'max_cp',c.max_cp,
   'raw_cp',c.cp,'reserved_cp',reserved,'spendable_cp',greatest(0,c.cp-reserved),'stances',rows);
END $$;
REVOKE ALL ON FUNCTION public.combat2_character_stances(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_character_stances(uuid) TO authenticated,service_role;

CREATE FUNCTION public.combat2_change_stance(_character_id uuid,_ability_key text,_action text,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.character_stance_request; c public.characters; e public.node_encounter; f public.node_fighter;
 catalogue_ability_id public.abilities.id%TYPE; pct numeric; cost integer;
 reserved integer; new_reserved integer; conflict text; intent_id uuid; result jsonb; arena uuid;
 bonus_wis integer:=0; wis_mod integer; ward integer;
BEGIN
 IF _request_id IS NULL OR _action NOT IN('activate','drop') OR _ability_key NOT IN
   ('envenom','eagle_eye','holy_shield','shield_wall','battle_cry','arcane_surge','force_shield','ignite') THEN
   RETURN jsonb_build_object('ok',false,'kind','invalid_request');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2_stance_request:'||_request_id::text,0));
 SELECT * INTO prior FROM public.character_stance_request WHERE request_id=_request_id;
 IF FOUND THEN
   IF prior.character_id<>_character_id OR prior.ability_key<>_ability_key OR prior.action<>_action THEN
     RETURN jsonb_build_object('ok',false,'kind','request_conflict');
   END IF;
   RETURN prior.result;
 END IF;
 SELECT ne.* INTO e FROM public.node_fighter nf JOIN public.node_encounter ne ON ne.id=nf.encounter_id
  WHERE nf.character_id=_character_id AND nf.present AND ne.status='active' ORDER BY ne.id LIMIT 1;
 IF e.id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||e.node_id::text,0));
   SELECT * INTO e FROM public.node_encounter WHERE id=e.id FOR UPDATE;
 END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF c.id IS NULL OR c.user_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF c.hp<=0 THEN RETURN jsonb_build_object('ok',false,'kind','incapacitated'); END IF;
 IF EXISTS(SELECT 1 FROM public.character_stance_request r WHERE r.character_id=c.id AND r.intent_id IS NOT NULL AND r.committed_at IS NULL) THEN
   RETURN jsonb_build_object('ok',false,'kind','action_in_flight');
 END IF;
 IF e.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.node_intent ni WHERE ni.encounter_id=e.id AND ni.character_id=c.id AND ni.status='pending') THEN
   RETURN jsonb_build_object('ok',false,'kind','action_in_flight');
 END IF;
 SELECT ab.id,coalesce(ab.cp_reserve_pct,base.cp_reserve_pct,0),greatest(0,coalesce(ab.cp_cost,base.cp_cost,0))
  INTO catalogue_ability_id,pct,cost FROM public.class_ability_assignments caa
  JOIN public.abilities ab ON ab.id=caa.ability_id LEFT JOIN public.base_abilities base ON base.id=ab.base_ability_id
  WHERE caa.class_key=c.class AND caa.status='active' AND ab.status='active'
    AND (caa.class_ability_key=_ability_key OR ab.ability_key=_ability_key)
    AND coalesce(ab.activation_mode,base.activation_mode)='stance' LIMIT 1;
 IF catalogue_ability_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','ability_unavailable'); END IF;
 IF _action='activate' AND _ability_key='shield_wall' AND NOT EXISTS(
   SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=c.id AND ci.equipped_slot='off_hand' AND ci.current_durability>0 AND i.weapon_tag='shield'
 ) THEN RETURN jsonb_build_object('ok',false,'kind','ability_requirement_unmet','reason','shield_required'); END IF;
 IF _action='activate' THEN
   IF EXISTS(SELECT 1 FROM public.character_stance WHERE character_id=c.id AND ability_key=_ability_key) THEN
     RETURN jsonb_build_object('ok',false,'kind','stance_already_active');
   END IF;
   IF _ability_key IN('ignite','envenom') THEN
     SELECT ability_key INTO conflict FROM public.character_stance WHERE character_id=c.id
       AND ability_key=CASE _ability_key WHEN 'ignite' THEN 'envenom' ELSE 'ignite' END;
     IF conflict IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','stance_mutually_exclusive','conflicts_with',conflict); END IF;
   END IF;
   reserved:=public.combat2_stance_reserved_cp(c.id,c.max_cp); new_reserved:=floor(greatest(0,c.max_cp)*pct)::integer;
   IF greatest(0,c.cp-reserved)<cost+new_reserved THEN
     RETURN jsonb_build_object('ok',false,'kind','insufficient_cp','required_cp',cost+new_reserved,'available_cp',greatest(0,c.cp-reserved));
   END IF;
 END IF;
 IF _action='drop' AND NOT EXISTS(SELECT 1 FROM public.character_stance WHERE character_id=c.id AND ability_key=_ability_key) THEN
   RETURN jsonb_build_object('ok',false,'kind','stance_not_active');
 END IF;
 SELECT t.arena_id INTO arena FROM public.combat2_test_arena_node t WHERE t.node_id=c.current_node_id;
 IF arena IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_stance_snapshot_header h WHERE h.arena_id=arena AND h.character_id=c.id) THEN
   INSERT INTO public.combat2_test_arena_stance_snapshot_header(arena_id,character_id) VALUES(arena,c.id);
   INSERT INTO public.combat2_test_arena_stance_snapshot(arena_id,character_id,ability_key,reserve_pct,state,version,activated_at)
    SELECT arena,character_id,ability_key,reserve_pct,state,version,activated_at FROM public.character_stance WHERE character_id=c.id;
 END IF;
 IF _action='activate' THEN
   IF _ability_key='force_shield' THEN
     SELECT coalesce(sum(coalesce((coalesce(nullif(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb)->>'wis')::integer,0)
       +coalesce((coalesce(ci.applied_gems,'{}'::jsonb)->>'pearl')::integer,0)),0)::integer INTO bonus_wis
     FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
     WHERE ci.character_id=c.id AND ci.equipped_slot IS NOT NULL AND ci.current_durability>0;
     wis_mod:=floor(((c.wis+bonus_wis)-10)/2.0)::integer; ward:=greatest(1,wis_mod+floor(c.level/2.0)::integer);
   END IF;
   INSERT INTO public.character_stance(character_id,ability_key,reserve_pct,state)
    VALUES(c.id,_ability_key,pct,CASE WHEN _ability_key='force_shield' THEN jsonb_build_object('ward_remaining',ward) ELSE '{}'::jsonb END);
   PERFORM set_config('app.trusted_rpc','true',true);
   UPDATE public.characters SET cp=greatest(0,cp-cost) WHERE id=c.id;
 ELSE
   DELETE FROM public.character_stance WHERE character_id=c.id AND ability_key=_ability_key;
 END IF;
 IF e.id IS NOT NULL THEN
   INSERT INTO public.node_intent(encounter_id,character_id,intent_kind,stance_key,request_id)
    VALUES(e.id,c.id,CASE _action WHEN 'activate' THEN 'stance_activate' ELSE 'stance_drop' END,_ability_key,_request_id)
    RETURNING id INTO intent_id;
   UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL WHERE id=e.id;
 END IF;
 result:=jsonb_build_object('ok',true,'kind',CASE _action WHEN 'activate' THEN 'activated' ELSE 'dropped' END,
   'character_id',c.id,'ability_key',_ability_key,'encounter_id',e.id,'intent_id',intent_id,
   'projection',public.combat2_character_stances(c.id));
 INSERT INTO public.character_stance_request(request_id,character_id,ability_key,action,encounter_id,intent_id,result,committed_at)
 VALUES(_request_id,c.id,_ability_key,_action,e.id,intent_id,result,CASE WHEN e.id IS NULL THEN clock_timestamp() ELSE NULL END);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.combat2_change_stance(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_change_stance(uuid,text,text,uuid) TO authenticated,service_role;

-- Ordinary ability preflight subtracts the same dynamic character reservation.
-- The installed predecessor retains shape, ownership, target and lock authority.
ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid) RENAME TO combat_intent_without_character_stances;
REVOKE ALL ON FUNCTION public.combat_intent_without_character_stances(uuid,uuid,text,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat_intent_without_character_stances(uuid,uuid,text,text,text,uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.combat_intent(_encounter_id uuid,_character_id uuid,_intent_kind text,_ability_key text,_stance_key text,
 _target_creature_id uuid,_target_character_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.characters; cost integer; reserved integer;
BEGIN
 IF _request_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.node_intent WHERE request_id=_request_id) THEN
   RETURN public.combat_intent_without_character_stances(_encounter_id,_character_id,_intent_kind,_ability_key,_stance_key,
     _target_creature_id,_target_character_id,_request_id);
 END IF;
 IF _intent_kind='ability' AND _ability_key IS NOT NULL THEN
   SELECT * INTO c FROM public.characters WHERE id=_character_id;
   IF c.id IS NOT NULL AND c.user_id IS NOT DISTINCT FROM auth.uid() THEN
     SELECT greatest(0,coalesce(a.cp_cost,b.cp_cost,0)) INTO cost
      FROM public.class_ability_assignments ca JOIN public.abilities a ON a.id=ca.ability_id
      LEFT JOIN public.base_abilities b ON b.id=a.base_ability_id
      WHERE ca.class_key=c.class AND ca.status='active' AND a.status='active'
       AND (ca.class_ability_key=_ability_key OR a.ability_key=_ability_key)
      ORDER BY (ca.class_ability_key=_ability_key) DESC,ca.unlock_level DESC LIMIT 1;
     IF cost IS NOT NULL THEN
       reserved:=public.combat2_stance_reserved_cp(c.id,c.max_cp);
       IF greatest(0,c.cp-reserved)<cost THEN
         RETURN jsonb_build_object('ok',false,'kind','insufficient_resource','reason','insufficient_cp',
           'required_cp',cost,'available_cp',greatest(0,c.cp-reserved));
       END IF;
     END IF;
   END IF;
 END IF;
 RETURN public.combat_intent_without_character_stances(_encounter_id,_character_id,_intent_kind,_ability_key,_stance_key,
   _target_creature_id,_target_character_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid) TO authenticated,service_role;

-- Claims freeze character stance identity after the predecessor owns the encounter.
ALTER FUNCTION public.node_tick_claim(uuid,integer) RENAME TO node_tick_claim_without_character_stances;
REVOKE ALL ON FUNCTION public.node_tick_claim_without_character_stances(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim_without_character_stances(uuid,integer) TO service_role;
CREATE FUNCTION public.node_tick_claim(_node_id uuid,_lease_ms integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE out jsonb; eid uuid; stances jsonb; transitions jsonb;
BEGIN
 out:=public.node_tick_claim_without_character_stances(_node_id,_lease_ms);
 IF out->>'ok'<>'true' OR out->>'kind'<>'claimed' THEN RETURN out; END IF;
 eid:=(out#>>'{snapshot,encounter,id}')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('character_id',s.character_id,'ability_key',s.ability_key,
   'reserve_pct',s.reserve_pct,'version',s.version,'state',s.state,'activated_at',s.activated_at)
   ORDER BY s.character_id,s.ability_key),'[]'::jsonb) INTO stances
 FROM public.character_stance s JOIN public.node_fighter f ON f.character_id=s.character_id
 WHERE f.encounter_id=eid AND f.present;
 SELECT coalesce(jsonb_agg(jsonb_build_object('request_id',r.request_id,'intent_id',r.intent_id,
   'character_id',r.character_id,'ability_key',r.ability_key,'action',r.action) ORDER BY r.intent_id),'[]'::jsonb)
 INTO transitions FROM public.character_stance_request r WHERE r.encounter_id=eid AND r.committed_at IS NULL;
 RETURN jsonb_set(jsonb_set(out,'{snapshot,character_stances}',stances,true),'{snapshot,stance_transitions}',transitions,true);
END $$;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;

-- Commit validates every captured stance and persists resolver-owned ward changes.
ALTER FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) RENAME TO node_tick_commit_without_character_stances;
REVOKE ALL ON FUNCTION public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;
CREATE FUNCTION public.node_tick_commit(_encounter_id uuid,_claim_token uuid,_candidate_tick integer,_expected_last_tick integer,
 _expected_state_version bigint,_intent_ids uuid[],_proposed jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row jsonb; result jsonb; current_version bigint;
BEGIN
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->'stance_fence','[]'::jsonb)) LOOP
   SELECT version INTO current_version FROM public.character_stance
    WHERE character_id=(row->>'character_id')::uuid AND ability_key=row->>'ability_key' FOR UPDATE;
   IF current_version IS DISTINCT FROM (row->>'version')::bigint THEN RETURN jsonb_build_object('ok',false,'kind','stale_stance'); END IF;
 END LOOP;
 result:=public.node_tick_commit_without_character_stances(_encounter_id,_claim_token,_candidate_tick,_expected_last_tick,
   _expected_state_version,_intent_ids,_proposed);
 IF result->>'ok'='true' AND result->>'kind'='committed' THEN
   FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->'stance_updates','[]'::jsonb)) LOOP
     UPDATE public.character_stance SET state=row->'state',version=version+1,updated_at=clock_timestamp()
      WHERE character_id=(row->>'character_id')::uuid AND ability_key=row->>'ability_key' AND version=(row->>'version')::bigint;
     IF NOT FOUND THEN RAISE EXCEPTION 'stale stance update'; END IF;
   END LOOP;
   DELETE FROM public.character_stance WHERE character_id IN
    (SELECT value::text::uuid FROM jsonb_array_elements_text(coalesce(_proposed->'stance_clear_character_ids','[]'::jsonb)));
   UPDATE public.character_stance_request SET committed_at=clock_timestamp()
    WHERE encounter_id=_encounter_id AND intent_id=ANY(_intent_ids) AND committed_at IS NULL;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;

-- Legacy browser mutation is no longer an authority for the implemented slice.
REVOKE EXECUTE ON FUNCTION public.activate_stance(uuid,text,integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.drop_stance(uuid,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_force_shield_regen(uuid) FROM authenticated;

-- Force Shield keeps its established two-second INT-based refill while outside
-- combat, but the four-second settlement cursor now owns elapsed time. This is
-- server work only; no browser timer can advance the ward.
CREATE FUNCTION public.combat2_regenerate_force_shields(_now timestamptz,_settlement_steps integer)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row record; bonus_int integer; bonus_wis integer; int_mod integer; wis_mod integer;
 cap integer; per_tick integer; changed integer:=0;
BEGIN
 IF _settlement_steps<=0 THEN RETURN 0; END IF;
 FOR row IN SELECT c.*,s.state,s.version FROM public.characters c JOIN public.character_stance s ON s.character_id=c.id
  WHERE s.ability_key='force_shield' ORDER BY c.id FOR UPDATE OF c,s LOOP
   IF row.hp<=0 OR row.current_node_id IS NULL
      OR EXISTS(SELECT 1 FROM public.combat2_test_arena_node t WHERE t.node_id=row.current_node_id)
      OR EXISTS(SELECT 1 FROM public.combat2_departure_request d WHERE d.character_id=row.id
        AND (d.status='queued' OR d.resolved_at>=date_bin(interval '4 seconds',_now,timestamptz 'epoch')))
      OR EXISTS(SELECT 1 FROM public.combat2_party_departure_member m JOIN public.combat2_party_departure_request r ON r.request_id=m.request_id
        WHERE m.character_id=row.id AND ((r.status='queued' AND m.status IN('waiting','queued'))
          OR m.resolved_at>=date_bin(interval '4 seconds',_now,timestamptz 'epoch')))
      OR EXISTS(SELECT 1 FROM public.combat2_respawn_request rr WHERE rr.character_id=row.id
        AND rr.created_at>=date_bin(interval '4 seconds',_now,timestamptz 'epoch'))
      OR EXISTS(SELECT 1 FROM public.node_fighter released WHERE released.character_id=row.id
        AND released.left_at>=date_bin(interval '4 seconds',_now,timestamptz 'epoch'))
      OR EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
        WHERE f.character_id=row.id AND e.status='active' AND ((f.present AND EXISTS(
          SELECT 1 FROM public.node_creature nc WHERE nc.encounter_id=e.id AND nc.is_alive AND nc.hp>0 AND nc.engaged))
          OR (e.claim_token IS NOT NULL AND e.claim_expires_at>_now))) THEN CONTINUE; END IF;
   SELECT coalesce(sum(coalesce((coalesce(nullif(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb)->>'int')::integer,0)
       +coalesce((coalesce(ci.applied_gems,'{}'::jsonb)->>'sapphire')::integer,0)),0)::integer,
     coalesce(sum(coalesce((coalesce(nullif(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb)->>'wis')::integer,0)
       +coalesce((coalesce(ci.applied_gems,'{}'::jsonb)->>'pearl')::integer,0)),0)::integer
     INTO bonus_int,bonus_wis FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
     WHERE ci.character_id=row.id AND ci.equipped_slot IS NOT NULL AND ci.current_durability>0;
   int_mod:=greatest(0,floor(((row.int+bonus_int)-10)/2.0)::integer);
   wis_mod:=greatest(0,floor(((row.wis+bonus_wis)-10)/2.0)::integer);
   cap:=greatest(1,wis_mod+floor(row.level/2.0)::integer); per_tick:=1+floor(int_mod/2.0)::integer;
   UPDATE public.character_stance SET state=jsonb_set(state,'{ward_remaining}',to_jsonb(least(cap,
       greatest(0,coalesce((state->>'ward_remaining')::integer,cap))+(_settlement_steps*2*per_tick))),true),
     version=version+1,updated_at=clock_timestamp()
    WHERE character_id=row.id AND ability_key='force_shield' AND version=row.version
      AND greatest(0,coalesce((state->>'ward_remaining')::integer,cap))<cap;
   IF FOUND THEN changed:=changed+1; END IF;
 END LOOP;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.combat2_regenerate_force_shields(timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_regenerate_force_shields(timestamptz,integer) TO service_role;

ALTER FUNCTION public.settle_out_of_combat_resources(timestamptz) RENAME TO settle_out_of_combat_resources_without_character_stances;
REVOKE ALL ON FUNCTION public.settle_out_of_combat_resources_without_character_stances(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_out_of_combat_resources_without_character_stances(timestamptz) TO service_role;
CREATE FUNCTION public.settle_out_of_combat_resources(_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,cron,pg_temp AS $$
DECLARE out jsonb; regenerated integer:=0;
BEGIN
 out:=public.settle_out_of_combat_resources_without_character_stances(_now);
 IF out->>'ok'='true' AND out->>'kind'='settled' THEN
   regenerated:=public.combat2_regenerate_force_shields(_now,coalesce((out->>'steps')::integer,0));
 END IF;
 RETURN out||jsonb_build_object('force_shields_regenerated',regenerated);
END $$;
REVOKE ALL ON FUNCTION public.settle_out_of_combat_resources(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_out_of_combat_resources(timestamptz) TO service_role;

CREATE FUNCTION public.combat2_refuse_invalid_stance_class_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.class IS DISTINCT FROM OLD.class AND EXISTS(SELECT 1 FROM public.character_stance WHERE character_id=OLD.id) THEN
   RAISE EXCEPTION 'drop active stances before changing class';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER combat2_refuse_invalid_stance_class_change BEFORE UPDATE OF class ON public.characters
FOR EACH ROW EXECUTE FUNCTION public.combat2_refuse_invalid_stance_class_change();

CREATE FUNCTION public.combat2_refuse_invalid_stance_equipment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=coalesce(NEW.character_id,OLD.character_id); removing_shield boolean;
BEGIN
 removing_shield:=OLD.equipped_slot='off_hand' AND EXISTS(SELECT 1 FROM public.items i WHERE i.id=OLD.item_id AND i.weapon_tag='shield')
   AND (TG_OP='DELETE' OR NEW.equipped_slot IS DISTINCT FROM OLD.equipped_slot OR NEW.current_durability<=0);
 IF removing_shield AND EXISTS(SELECT 1 FROM public.character_stance WHERE character_id=owner AND ability_key='shield_wall')
   AND NOT EXISTS(SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
     WHERE ci.character_id=owner AND ci.id<>OLD.id AND ci.equipped_slot='off_hand' AND ci.current_durability>0 AND i.weapon_tag='shield') THEN
   RAISE EXCEPTION 'drop Shield Wall before removing its required shield';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER combat2_refuse_invalid_stance_equipment_change BEFORE UPDATE OF equipped_slot,current_durability OR DELETE
ON public.character_inventory FOR EACH ROW EXECUTE FUNCTION public.combat2_refuse_invalid_stance_equipment_change();

-- Arena stop/reset restores the exact pre-run stance set.
CREATE FUNCTION public.combat2_restore_arena_stances(_arena_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h record;
BEGIN
 FOR h IN SELECT * FROM public.combat2_test_arena_stance_snapshot_header WHERE arena_id=_arena_id ORDER BY character_id LOOP
   DELETE FROM public.character_stance WHERE character_id=h.character_id;
   INSERT INTO public.character_stance(character_id,ability_key,reserve_pct,state,version,activated_at)
    SELECT character_id,ability_key,reserve_pct,state,version,activated_at FROM public.combat2_test_arena_stance_snapshot
    WHERE arena_id=_arena_id AND character_id=h.character_id;
 END LOOP;
 DELETE FROM public.combat2_test_arena_stance_snapshot_header WHERE arena_id=_arena_id;
END $$;
REVOKE ALL ON FUNCTION public.combat2_restore_arena_stances(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_restore_arena_stances(uuid) TO service_role;

ALTER FUNCTION public.combat2_test_stop(uuid,uuid) RENAME TO combat2_test_stop_without_character_stances;
CREATE FUNCTION public.combat2_test_stop(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE out jsonb;
BEGIN out:=public.combat2_test_stop_without_character_stances(_arena_id,_request_id);
 IF out->>'ok'='true' THEN PERFORM public.combat2_restore_arena_stances(_arena_id); END IF; RETURN out; END $$;
REVOKE ALL ON FUNCTION public.combat2_test_stop(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_stop(uuid,uuid) TO authenticated,service_role;

ALTER FUNCTION public.combat2_test_reset(uuid,uuid,boolean) RENAME TO combat2_test_reset_without_character_stances;
CREATE FUNCTION public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE out jsonb;
BEGIN out:=public.combat2_test_reset_without_character_stances(_arena_id,_request_id,_confirm_destroy_diagnostics);
 IF out->>'ok'='true' THEN PERFORM public.combat2_restore_arena_stances(_arena_id); END IF; RETURN out; END $$;
REVOKE ALL ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) TO authenticated,service_role;
