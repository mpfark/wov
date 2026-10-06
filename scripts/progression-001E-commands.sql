-- Source fragment assembled by prepare-progression-001E.mjs; not a migration.
CREATE TABLE public.progression_class_growth_milestone (
 character_id uuid NOT NULL REFERENCES public.progression_character_state(character_id) ON DELETE CASCADE,
 destination_level integer NOT NULL CHECK(destination_level BETWEEN 3 AND 42 AND destination_level%3=0),
 class_key text NOT NULL,
 is_classless boolean NOT NULL,
 applied_deltas jsonb NOT NULL CHECK(jsonb_typeof(applied_deltas)='object'),
 config_fingerprint text NOT NULL CHECK(config_fingerprint ~ '^[0-9a-f]{64}$'),
 source text NOT NULL,
 event_id uuid NOT NULL,
 PRIMARY KEY(character_id,destination_level),
 CHECK(is_classless=(class_key='classless')),
 CHECK(applied_deltas ?& ARRAY['str','dex','con','int','wis','cha'] AND applied_deltas-ARRAY['str','dex','con','int','wis','cha']='{}'::jsonb),
 CHECK(NOT is_classless OR applied_deltas='{"str":0,"dex":0,"con":0,"int":0,"wis":0,"cha":0}'::jsonb),
 FOREIGN KEY(character_id,source,event_id) REFERENCES public.progression_receipt(character_id,source,event_id)
 DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.progression_class_growth_milestone OWNER TO postgres;
ALTER TABLE public.progression_class_growth_milestone ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.progression_verify_class_growth_internal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.progression_receipt%ROWTYPE;
BEGIN
 SELECT * INTO STRICT p FROM public.progression_receipt
 WHERE character_id=NEW.character_id AND source=NEW.source AND event_id=NEW.event_id;
 IF p.operation<>'xp' OR NOT (p.receipt->'crossedLevels' @> to_jsonb(ARRAY[NEW.destination_level]))
 OR p.receipt->'classConfig'->>'class_key' IS DISTINCT FROM NEW.class_key
 OR (p.receipt->'classConfig'->>'is_classless')::boolean IS DISTINCT FROM NEW.is_classless
 OR p.receipt->'classConfig'->>'fingerprint' IS DISTINCT FROM NEW.config_fingerprint
 OR p.receipt->'classConfig'->'level_bonuses' IS DISTINCT FROM NEW.applied_deltas
 THEN RAISE EXCEPTION 'class_growth_receipt_conflict'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER progression_verify_class_growth AFTER INSERT OR UPDATE ON public.progression_class_growth_milestone
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.progression_verify_class_growth_internal();
CREATE TABLE public.progression_command_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE public.progression_command_control OWNER TO postgres;
ALTER TABLE public.progression_command_control ENABLE ROW LEVEL SECURITY;
INSERT INTO public.progression_command_control(singleton,enabled) VALUES(true,false);
ALTER TABLE public.progression_receipt DROP CONSTRAINT progression_receipt_operation_check;
ALTER TABLE public.progression_receipt ADD CONSTRAINT progression_receipt_operation_check CHECK(operation IN('xp','permanent','order'));

-- Narrow temporary raw-write fence. Invoker context distinguishes service DML from owner-internal domain calls.
-- No JWT clearing, app.trusted_rpc bypass, default grant, or rewritten legacy trigger.
CREATE FUNCTION public.progression_refuse_raw_progression_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user<>'postgres' AND
   ROW(NEW.str,NEW.dex,NEW.con,NEW.int,NEW.wis,NEW.cha,NEW.level,NEW.xp,NEW.class,NEW.is_classless,NEW.unspent_stat_points,NEW.respec_points)
   IS DISTINCT FROM ROW(OLD.str,OLD.dex,OLD.con,OLD.int,OLD.wis,OLD.cha,OLD.level,OLD.xp,OLD.class,OLD.is_classless,OLD.unspent_stat_points,OLD.respec_points)
 THEN RAISE EXCEPTION 'progression_raw_override_paused_until_001G' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER progression_refuse_raw_progression_write BEFORE UPDATE ON public.characters
 FOR EACH ROW EXECUTE FUNCTION public.progression_refuse_raw_progression_write();

CREATE FUNCTION public.progression_command_projection_internal(_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
BEGIN
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 RETURN jsonb_build_object('progressionVersion',COALESCE(s.version,0),'character',jsonb_build_object(
  'id',c.id,'class',c.class,'is_classless',c.is_classless,'level',c.level,'xp',c.xp,
  'str',c.str,'dex',c.dex,'con',c.con,'int',c.int,'wis',c.wis,'cha',c.cha,
  'unspent_stat_points',c.unspent_stat_points,'respec_points',c.respec_points,
  'hp',c.hp,'cp',c.cp,'mp',c.mp,'max_hp',c.max_hp,'max_cp',c.max_cp,'max_mp',c.max_mp));
END $$;
CREATE FUNCTION public.progression_command_projection(_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character AND user_id=auth.uid())
 THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 RETURN jsonb_build_object('kind','current','projection',public.progression_command_projection_internal(_character));
END $$;

CREATE FUNCTION public.progression_command(_character uuid,_actor uuid,_request uuid,_expected_version numeric,
 _operation text,_allocations jsonb DEFAULT NULL,_target_class text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
 old public.progression_receipt%ROWTYPE; latest public.progression_receipt%ROWTYPE;
 initial_node uuid; v numeric; k text; j jsonb; n numeric; d jsonb:='{}'; total bigint:=0;
 req jsonb; cfg public.classes%ROWTYPE; before jsonb; before_bonds jsonb; r jsonb; result jsonb;
 source_key text; meta jsonb; counters jsonb; last_counters jsonb;
BEGIN
 IF auth.uid() IS NOT NULL OR _actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character AND user_id=_actor)
 THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 IF _request IS NULL OR _operation IS NULL OR _operation NOT IN('allocate','join','switch')
  OR _expected_version IS NULL OR _expected_version<0 OR _expected_version>9007199254740991 OR _expected_version<>trunc(_expected_version)
 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
 IF _operation='allocate' THEN
  IF _target_class IS NOT NULL OR jsonb_typeof(_allocations) IS DISTINCT FROM 'object'
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_allocation'); END IF;
  FOR k,j IN SELECT * FROM jsonb_each(_allocations) LOOP
   IF k<>ALL(ARRAY['str','dex','con','int','wis','cha']) OR jsonb_typeof(j)<>'number'
   THEN RETURN jsonb_build_object('kind','refused','reason','invalid_allocation'); END IF;
   n:=j::text::numeric;
   IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RETURN jsonb_build_object('kind','refused','reason','invalid_allocation'); END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['str','dex','con','int','wis','cha'] LOOP
   d:=d||jsonb_build_object(k,COALESCE((_allocations->>k)::numeric,0)::integer);
   total:=total+COALESCE((_allocations->>k)::numeric,0)::bigint;
  END LOOP;
  IF total=0 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_allocation'); END IF;
  source_key:='discretionary_allocation';meta:=jsonb_build_object('actorId',_actor,'command','allocate');
  req:=jsonb_build_object('operation','permanent','expectedVersion',_expected_version,'deltas',d,'metadata',meta,'contractVersion',1,'rulesVersion',1);
 ELSE
  IF _allocations IS NOT NULL OR _target_class IS NULL OR _target_class !~ '^[a-z][a-z0-9_]{1,31}$'
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
  source_key:='order_command';
  req:=jsonb_build_object('operation',_operation,'actorId',_actor,'expectedVersion',_expected_version,'targetClass',_target_class,'contractVersion',1,'rulesVersion',1);
 END IF;
 -- Acquire only the initially observed acting node. Never acquire another node/encounter after c lock.
 SELECT current_node_id INTO initial_node FROM public.characters WHERE id=_character AND user_id=_actor;
 IF initial_node IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||initial_node::text,0)); END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;
 IF NOT FOUND OR c.user_id<>_actor THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 SELECT * INTO old FROM public.progression_receipt WHERE character_id=_character AND source=source_key AND event_id=_request;
 IF FOUND THEN
  IF old.request<>req THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','original',old.receipt);
 END IF;
 IF c.current_node_id IS DISTINCT FROM initial_node THEN RETURN jsonb_build_object('kind','refused','reason','location_changed'); END IF;
 IF NOT (SELECT enabled FROM public.progression_command_control WHERE singleton)
 THEN RETURN jsonb_build_object('kind','refused','reason','commands_paused'); END IF;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 v:=COALESCE(s.version,0);
 IF v<>_expected_version THEN RETURN jsonb_build_object('kind','refused','reason','stale_state'); END IF;
 IF c.hp<=0 THEN RETURN jsonb_build_object('kind','refused','reason','dead'); END IF;
 IF c.level NOT BETWEEN 1 AND 42 OR c.xp<0 OR (c.level=42 AND c.xp<>0) OR (c.level<42 AND c.xp>=50::bigint*c.level*c.level)
  OR c.is_classless IS DISTINCT FROM (c.class='classless') OR c.unspent_stat_points NOT BETWEEN 0 AND 200 OR c.respec_points<0
  OR least(c.str,c.dex,c.con,c.int,c.wis,c.cha,c.cp,c.mp)<0 OR c.max_hp<1 OR c.max_cp<0 OR c.max_mp<0
 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
 counters:=jsonb_build_object('str',COALESCE(s.str_invested,0),'dex',COALESCE(s.dex_invested,0),'con',COALESCE(s.con_invested,0),
   'int',COALESCE(s.int_invested,0),'wis',COALESCE(s.wis_invested,0),'cha',COALESCE(s.cha_invested,0));
 IF EXISTS(SELECT 1 FROM jsonb_each_text(counters) x WHERE x.value::integer<0 OR x.value::integer>(to_jsonb(c)->>x.key)::integer)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 IF s.character_id IS NOT NULL AND s.version>0 THEN
  SELECT * INTO latest FROM public.progression_receipt WHERE character_id=_character ORDER BY (receipt->>'versionAfter')::numeric DESC LIMIT 1;
  IF NOT FOUND OR (latest.receipt->>'versionAfter')::numeric IS DISTINCT FROM s.version
   OR latest.receipt->'after'->'permanentStats' IS DISTINCT FROM jsonb_build_object('str',c.str,'dex',c.dex,'con',c.con,'int',c.int,'wis',c.wis,'cha',c.cha)
   OR latest.receipt->'after'->>'classKey' IS DISTINCT FROM c.class
   OR (latest.receipt->'after'->>'level')::integer IS DISTINCT FROM c.level
   OR (latest.receipt->'after'->>'xp')::integer IS DISTINCT FROM c.xp
   OR (latest.receipt->'after'->>'unspentStatPoints')::integer IS DISTINCT FROM c.unspent_stat_points
   OR (latest.receipt->'after'->>'respecPoints')::integer IS DISTINCT FROM c.respec_points
  THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
  SELECT receipt->'refundableInvestmentAfter' INTO last_counters FROM public.progression_receipt
   WHERE character_id=_character AND receipt ? 'refundableInvestmentAfter' ORDER BY (receipt->>'versionAfter')::numeric DESC LIMIT 1;
  IF FOUND AND counters IS DISTINCT FROM last_counters THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
  IF NOT FOUND AND counters<>jsonb_build_object('str',0,'dex',0,'con',0,'int',0,'wis',0,'cha',0)
  THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 END IF;
 IF s.character_id IS NOT NULL AND s.version=0 AND counters<>jsonb_build_object('str',0,'dex',0,'con',0,'int',0,'wis',0,'cha',0)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
   WHERE f.character_id=c.id AND ((e.claim_token IS NOT NULL AND e.claim_expires_at>clock_timestamp())
    OR (f.present AND e.status='active' AND EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.encounter_id=e.id AND nc.is_alive AND nc.hp>0 AND nc.engaged))))
 THEN RETURN jsonb_build_object('kind','refused','reason','active_combat'); END IF;
 IF c.movement_locked_until>clock_timestamp()
 OR EXISTS(SELECT 1 FROM public.character_stance WHERE character_id=c.id)
 OR EXISTS(SELECT 1 FROM public.character_stance_request WHERE character_id=c.id AND intent_id IS NOT NULL AND committed_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.node_intent WHERE character_id=c.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.combat2_departure_request WHERE character_id=c.id AND status IN('queued','finalizing'))
 OR EXISTS(SELECT 1 FROM public.combat2_party_departure_member m JOIN public.combat2_party_departure_request p ON p.request_id=m.request_id
    WHERE m.character_id=c.id AND (m.status IN('waiting','queued') OR p.status IN('queued','finalizing')))
 OR EXISTS(SELECT 1 FROM public.combat_sessions cs WHERE cs.character_id=c.id OR cs.party_id IN
   (SELECT party_id FROM public.party_members WHERE character_id=c.id AND status='accepted'))
 THEN RETURN jsonb_build_object('kind','refused','reason','unsafe_lifecycle'); END IF;
 IF _operation='allocate' THEN
  IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_trainer)
  THEN RETURN jsonb_build_object('kind','refused','reason','not_at_trainer'); END IF;
  -- Private primitive owns positive deltas, point/counter accounting and fixed clamp policy.
  result:=public.progression_apply_permanent_delta_internal(c.id,_request,source_key,_expected_version,d,meta);
  IF result->>'kind' NOT IN('committed','replayed') THEN RETURN result; END IF;
  RETURN result||jsonb_build_object('projection',public.progression_command_projection_internal(c.id));
 END IF;
 IF _target_class=c.class THEN RETURN jsonb_build_object('kind','refused','reason','already_in_order'); END IF;
 IF (_operation='join' AND NOT c.is_classless) OR (_operation='switch' AND c.is_classless)
 THEN RETURN jsonb_build_object('kind','refused','reason','wrong_operation'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND class_hall=_target_class)
 THEN RETURN jsonb_build_object('kind','refused','reason','wrong_class_hall'); END IF;
 SELECT * INTO cfg FROM public.classes WHERE class_key=_target_class FOR SHARE;
 IF NOT FOUND OR cfg.status<>'active' OR NOT cfg.is_selectable OR cfg.is_pre_class
 THEN RETURN jsonb_build_object('kind','refused','reason','class_unavailable'); END IF;
 PERFORM public.progression_class_config_internal(_target_class,false);
 before:=public.progression_snapshot_internal(c.id);
 SELECT COALESCE(jsonb_object_agg(class,bond),'{}') INTO before_bonds FROM public.character_class_bonds WHERE character_id=c.id;
 INSERT INTO public.progression_character_state(character_id,opaque_baseline) VALUES(c.id,before) ON CONFLICT DO NOTHING;
 DELETE FROM public.character_class_bonds WHERE character_id=c.id;
 INSERT INTO public.character_class_bonds(character_id,class,bond) VALUES(c.id,_target_class,0);
 UPDATE public.characters SET class=_target_class,is_classless=false WHERE id=c.id;
 PERFORM public.character_sync_derived_internal(c.id,false,true);
 UPDATE public.progression_character_state SET version=version+1 WHERE character_id=c.id;
 r:=jsonb_build_object('characterId',c.id,'actorId',_actor,'source',source_key,'eventId',_request,'operation',_operation,
  'versionBefore',v,'versionAfter',v+1,'before',before,'after',public.progression_snapshot_internal(c.id),
  'bondsBefore',before_bonds,'bondsAfter',jsonb_build_object(_target_class,0),'refundableInvestmentAfter',counters,
  'classConfig',public.progression_class_config_internal(_target_class,false)-'base_hp',
  'resourceConfig',jsonb_build_object('class_key',_target_class,'base_hp',cfg.base_hp),
  'projection',public.progression_command_projection_internal(c.id));
 INSERT INTO public.progression_receipt VALUES(c.id,source_key,_request,'order',req,r);
 RETURN jsonb_build_object('kind','committed','receipt',r,'projection',r->'projection');
EXCEPTION WHEN OTHERS THEN
 -- PL/pgSQL block subtransaction rolls every mutation back before a structured refusal.
 RETURN jsonb_build_object('kind','refused','reason','invalid_transaction');
END $$;
