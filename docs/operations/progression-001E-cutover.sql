-- ENG-PROGRESSION-001E LOCAL PREPARATION; NOT INSTALLED / NOT ACTIVE.
-- Reviewed source: e9526a64e166fc8ca84ee80a8397ebec9c919922078e84563aa2ef83b239557a (001C); no historical migration edits/backfill.
-- ONE standard Lovable Drizzle tool transaction required. No standalone execution.
-- Command control starts disabled; separate explicit activation required.
DO $guard$ DECLARE dep record; BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'190f4ae17af03395f0d026c8ac503592593b928b10754b563a41f78e8262719d'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_offered','_metadata']
 THEN RAISE EXCEPTION '001E dependency body/security drift: progression_apply_xp_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_permanent_delta_internal(uuid,uuid,text,numeric,jsonb,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0ced64d37ebd32c7fa4a176a82933a7c5f87786c0abcf49edc7686719f53b0a0'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_expected_version','_deltas','_metadata']
 THEN RAISE EXCEPTION '001E dependency body/security drift: progression_apply_permanent_delta_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_class_config_internal(text,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'e6288a593666a804f5e3403078743d95b203bf04a8d3f7e8b3aa54aad93ede38'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'s'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_class','_classless']
 THEN RAISE EXCEPTION '001E dependency body/security drift: progression_class_config_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_snapshot_internal(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'d4a41d06a5a8f1078aff91a248bf58efe79d04eadd5936813428f2fd060cb463'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'s'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character']
 THEN RAISE EXCEPTION '001E dependency body/security drift: progression_snapshot_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.character_sync_derived_internal(uuid,boolean,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_level_gained','_was_alive']
 THEN RAISE EXCEPTION '001E dependency body/security drift: character_sync_derived_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.join_order(uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'603bb8a96bc2336e7d79d28ef5a9f3dc287d9157bf6a16c2a726fa567c5bd230'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_class']
 THEN RAISE EXCEPTION '001E dependency body/security drift: join_order'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.switch_order(uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'ca05dd3015f1c6e6e618ca58f777e8af62068d587846485e6315b25030cc72a0'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_class']
 THEN RAISE EXCEPTION '001E dependency body/security drift: switch_order'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.award_class_bond(uuid,text,integer)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'6e2c03502418dcfa448baaf31022f03fe58f5db98e2b115ade9dbdff5860a6a2'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
   OR dep.prorettype<>'integer'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_class','_amount']
 THEN RAISE EXCEPTION '001E dependency body/security drift: award_class_bond'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.award_class_bond_for_kill(uuid,integer,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'4ac232d36fbba9ca798250ccb79904aeb872acbd1d05cbbfc6df719990dcd756'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
   OR dep.prorettype<>'integer'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_creature_level','_is_boss']
 THEN RAISE EXCEPTION '001E dependency body/security drift: award_class_bond_for_kill'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.train_renown_stat(uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'e4cde3ca8bd43e09e5cda0cd97c18b683198a1407265e7bd3b7bb27782162552'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
   OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
   OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_stat']
 THEN RAISE EXCEPTION '001E dependency body/security drift: train_renown_stat'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname=ANY(ARRAY['progression_apply_xp_internal','progression_apply_permanent_delta_internal','progression_class_config_internal','progression_snapshot_internal','character_sync_derived_internal','join_order','switch_order','award_class_bond','award_class_bond_for_kill','train_renown_stat']) GROUP BY proname HAVING count(*)<>1)
 THEN RAISE EXCEPTION '001E dependency overload drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY['progression_apply_xp_internal','progression_apply_permanent_delta_internal','progression_class_config_internal','progression_snapshot_internal','character_sync_derived_internal']) AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION '001E private authority ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class rel WHERE rel.oid IN('public.progression_character_state'::regclass,'public.progression_receipt'::regclass,'public.progression_respec_milestone'::regclass)
   AND (rel.relowner<>'postgres'::regrole OR NOT rel.relrowsecurity
    OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=rel.oid)
    OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(rel.relacl,acldefault('r',rel.relowner))) a WHERE a.grantee<>rel.relowner)))
 THEN RAISE EXCEPTION '001E sidecar security drift'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.character_class_bonds'::regclass)
 OR EXISTS(SELECT 1 FROM pg_policy policy WHERE policy.polrelid='public.character_class_bonds'::regclass AND policy.polcmd<>'r'
   AND EXISTS(SELECT 1 FROM unnest(policy.polroles) role WHERE CASE WHEN role=0 THEN true ELSE
     pg_has_role('anon',role,'MEMBER') OR pg_has_role('authenticated',role,'MEMBER') END))
 THEN RAISE EXCEPTION '001E ordinary bond RLS drift'; END IF;
 IF to_regclass('public.progression_class_growth_milestone') IS NOT NULL
 OR to_regclass('public.progression_command_control') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
   ('progression_command','progression_command_projection','progression_command_projection_internal','progression_refuse_raw_progression_write','progression_verify_class_growth_internal'))
 THEN RAISE EXCEPTION '001E object collision'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_receipt'::regclass
   AND conname='progression_receipt_operation_check' AND pg_get_constraintdef(oid) LIKE '%xp%permanent%')
 THEN RAISE EXCEPTION '001E receipt schema drift'; END IF;
 -- Full trigger fingerprints supplied by accepted 001C inspection, unchanged in preflight.
 IF encode(sha256(convert_to(pg_get_functiondef('public.restrict_party_leader_updates()'::regprocedure),'UTF8')),'hex')
   <>'02c3aaa505f08fb4f9e92ffcf16ba41cb9e3ae79e51aaabdf4fde4f0876f465d'
 OR encode(sha256(convert_to(pg_get_functiondef('public.combat2_refuse_invalid_stance_class_change()'::regprocedure),'UTF8')),'hex')
   <>'98745bca6cbb73743ef7c22dc7c8484024b904d9357e7d97a7b1af86275f76c1'
 THEN RAISE EXCEPTION '001E installed trigger drift'; END IF;
 IF has_table_privilege('authenticated','public.characters','UPDATE')
 OR has_table_privilege('anon','public.characters','UPDATE')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['str','dex','con','int','wis','cha','class','is_classless','unspent_stat_points','respec_points']) col
   WHERE has_column_privilege('authenticated','public.characters',col,'UPDATE')
      OR has_column_privilege('anon','public.characters',col,'UPDATE'))
 THEN RAISE EXCEPTION '001E character browser ACL drift'; END IF;
END $guard$;
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

ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'str')='number' AND (applied_deltas->>'str')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'str')::numeric=trunc((applied_deltas->>'str')::numeric));
ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'dex')='number' AND (applied_deltas->>'dex')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'dex')::numeric=trunc((applied_deltas->>'dex')::numeric));
ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'con')='number' AND (applied_deltas->>'con')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'con')::numeric=trunc((applied_deltas->>'con')::numeric));
ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'int')='number' AND (applied_deltas->>'int')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'int')::numeric=trunc((applied_deltas->>'int')::numeric));
ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'wis')='number' AND (applied_deltas->>'wis')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'wis')::numeric=trunc((applied_deltas->>'wis')::numeric));
ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'cha')='number' AND (applied_deltas->>'cha')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'cha')::numeric=trunc((applied_deltas->>'cha')::numeric));
ALTER FUNCTION public.progression_verify_class_growth_internal() OWNER TO postgres;
ALTER FUNCTION public.progression_refuse_raw_progression_write() OWNER TO postgres;
ALTER FUNCTION public.progression_command_projection_internal(uuid) OWNER TO postgres;
ALTER FUNCTION public.progression_command_projection(uuid) OWNER TO postgres;
ALTER FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.progression_apply_xp_internal(_character uuid, _event uuid, _source text,
  _offered numeric, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
 old public.progression_receipt%ROWTYPE; req jsonb; cfg jsonb; growth jsonb; r jsonb; resources jsonb;
 lv integer; rem bigint; paid bigint:=0; discarded bigint:=0; points integer:=0; token_count integer:=0;
 ds integer:=0; dd integer:=0; dc integer:=0; di integer:=0; dw integer:=0; dh integer:=0;
 crossed jsonb:='[]'; milestones jsonb:='[]'; threshold bigint; before jsonb;
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 IF _character IS NULL OR _event IS NULL OR _source IS NULL OR _source NOT IN('combat2_reward','craft_completion','admin_xp')
  OR _offered IS NULL OR _offered<0 OR _offered>2147483647 OR _offered<>trunc(_offered) OR jsonb_typeof(_metadata) IS DISTINCT FROM 'object'
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_award'); END IF;
 IF _source='admin_xp' AND (COALESCE(_metadata->>'reason','') !~ '[^[:space:]]' OR
 jsonb_typeof(_metadata->'actorId') IS DISTINCT FROM 'string' OR (_metadata->>'actorId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
 THEN RETURN jsonb_build_object('kind','refused','reason','ineligible_source'); END IF;
 IF (_source='combat2_reward' AND (_metadata->>'rewardClaimId') IS DISTINCT FROM _event::text)
 OR (_source='craft_completion' AND (_metadata->>'completionId') IS DISTINCT FROM _event::text)
 THEN RETURN jsonb_build_object('kind','refused','reason','ineligible_source'); END IF;
 req:=jsonb_build_object('operation','xp','offeredXp',_offered,'metadata',_metadata,'contractVersion',1,'rulesVersion',1);
 SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','refused','reason','character_missing'); END IF;
 SELECT * INTO old FROM public.progression_receipt WHERE character_id=_character AND source=_source AND event_id=_event;
 IF FOUND THEN
  IF old.operation<>'xp' OR old.request<>req THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','original',old.receipt);
 END IF;
 IF c.level NOT BETWEEN 1 AND 42 OR c.xp<0 OR (c.level=42 AND c.xp<>0)
  OR (c.level<42 AND c.xp>=50::bigint*c.level*c.level)
  THEN RETURN jsonb_build_object('kind','reconciliation_required','reason',CASE WHEN c.level NOT BETWEEN 1 AND 42 THEN 'invalid_level'
    WHEN c.xp<0 THEN 'invalid_xp' WHEN c.level=42 THEN 'cap_xp_nonzero' ELSE 'xp_backlog' END); END IF;
 IF c.xp::bigint+_offered>2147483647 THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 IF c.unspent_stat_points<0 OR c.respec_points<0 OR c.cp<0 OR c.mp<0
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
 PERFORM 1 FROM public.classes WHERE class_key=c.class FOR SHARE;
  BEGIN cfg:=public.progression_class_config_internal(c.class,c.is_classless);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='invalid_class_config' THEN
    RETURN jsonb_build_object('kind','refused','reason','invalid_class_config');
   END IF; RAISE;
  END; growth:=cfg->'level_bonuses';
 before:=public.progression_snapshot_internal(_character); lv:=c.level; rem:=c.xp::bigint+_offered;
 WHILE lv<42 AND rem>=50::bigint*lv*lv LOOP
  threshold:=50::bigint*lv*lv; rem:=rem-threshold; paid:=paid+threshold; lv:=lv+1; points:=points+1;
  crossed:=crossed || jsonb_build_array(lv);
  IF lv%3=0 AND NOT c.is_classless THEN
   ds:=ds+(growth->>'str')::int; dd:=dd+(growth->>'dex')::int; dc:=dc+(growth->>'con')::int;
   di:=di+(growth->>'int')::int; dw:=dw+(growth->>'wis')::int; dh:=dh+(growth->>'cha')::int;
  END IF;
  IF lv IN(10,20,30,40) AND NOT EXISTS(SELECT 1 FROM public.progression_respec_milestone WHERE character_id=_character AND level=lv)
   THEN milestones:=milestones||jsonb_build_array(lv); token_count:=token_count+1; END IF;
 END LOOP;
 IF lv=42 THEN discarded:=rem; rem:=0; END IF;
 -- Independent destination proof: never silently skip contradictory new events.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(crossed) x
   WHERE x::integer%3=0 AND (EXISTS(SELECT 1 FROM public.progression_class_growth_milestone m
     WHERE m.character_id=_character AND m.destination_level=x::integer)
   OR EXISTS(SELECT 1 FROM public.progression_receipt p,
       LATERAL jsonb_array_elements_text(COALESCE(p.receipt->'crossedLevels','[]')) y
     WHERE p.character_id=_character AND p.operation='xp' AND y::integer=x::integer)))
 THEN RAISE EXCEPTION 'class_growth_destination_conflict'; END IF;
 IF c.unspent_stat_points::bigint+points>200 OR c.respec_points::bigint+token_count>2147483647
  OR greatest(c.str::bigint+ds,c.dex::bigint+dd,c.con::bigint+dc,c.int::bigint+di,c.wis::bigint+dw,c.cha::bigint+dh)>2147483647
  THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 INSERT INTO public.progression_character_state(character_id,opaque_baseline) VALUES(_character,before) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 IF _offered>0 THEN
  UPDATE public.characters SET level=lv,xp=rem::integer,unspent_stat_points=c.unspent_stat_points+points,
    respec_points=c.respec_points+token_count,str=c.str+ds,dex=c.dex+dd,con=c.con+dc,int=c.int+di,wis=c.wis+dw,cha=c.cha+dh WHERE id=_character;
 END IF;
 -- No-level XP changes no resource fields; no opportunistic anomaly repair.
 IF points>0 THEN resources:=public.character_sync_derived_internal(_character,true,c.hp>0); END IF;
 UPDATE public.progression_character_state SET version=version+1 WHERE character_id=_character;
 SELECT * INTO c FROM public.characters WHERE id=_character;
 r:=jsonb_build_object('characterId',_character,'source',_source,'eventId',_event,'versionBefore',s.version,'versionAfter',s.version+1,
  'offeredXp',_offered,'appliedXp',_offered-discarded,'discardedXp',discarded,'thresholdsPaid',paid,
  'crossedLevels',crossed,'discretionaryPointsGranted',points,'respecMilestonesGranted',milestones,
  'classConfig',cfg-'base_hp','resourceConfig',CASE WHEN points>0 THEN jsonb_build_object('class_key',c.class,'base_hp',cfg->'base_hp') ELSE NULL END,'permanentDeltas',jsonb_build_object('str',ds,'dex',dd,'con',dc,'int',di,'wis',dw,'cha',dh),
  'before',before,'after',public.progression_snapshot_internal(_character));
 INSERT INTO public.progression_receipt VALUES(_character,_source,_event,'xp',req,r);
 INSERT INTO public.progression_respec_milestone(character_id,level,source,event_id)
  SELECT _character,x::integer,_source,_event FROM jsonb_array_elements_text(milestones) x;
 INSERT INTO public.progression_class_growth_milestone
   (character_id,destination_level,class_key,is_classless,applied_deltas,config_fingerprint,source,event_id)
 SELECT _character,x::integer,c.class,c.is_classless,growth,cfg->>'fingerprint',_source,_event
 FROM jsonb_array_elements_text(crossed) x WHERE x::integer%3=0;
 RETURN jsonb_build_object('kind','committed','receipt',r);
END $$;
-- Strip every default/custom/inherited nonowner grant. Only narrow commands regain intended EXECUTE.
DO $acl$ DECLARE p record; g record; BEGIN
 FOR p IN SELECT oid,proowner,oid::regprocedure::text identity FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['progression_verify_class_growth_internal','progression_refuse_raw_progression_write','progression_command_projection_internal','progression_command_projection','progression_command','progression_apply_xp_internal','join_order','switch_order','award_class_bond','award_class_bond_for_kill','train_renown_stat']) LOOP
   IF p.proowner<>'postgres'::regrole THEN RAISE EXCEPTION '001E unexpected function owner'; END IF;
   FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=p.oid),acldefault('f',p.proowner))) WHERE grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',p.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
   END LOOP;
 END LOOP;
 FOR p IN SELECT oid,relowner owner,oid::regclass::text identity,relacl FROM pg_class
   WHERE oid IN ('public.progression_class_growth_milestone'::regclass,'public.progression_command_control'::regclass) LOOP
   FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(p.relacl,acldefault('r',p.owner))) WHERE grantee<>p.owner LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',p.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
   END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.progression_command_projection(uuid) TO authenticated;
END $acl$;
DO $assert$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.join_order(uuid,text)','public.switch_order(uuid,text)','public.award_class_bond(uuid,text,integer)','public.award_class_bond_for_kill(uuid,integer,boolean)','public.train_renown_stat(uuid,text)'] LOOP
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=sig::regprocedure AND a.grantee<>p.proowner) THEN RAISE EXCEPTION '001E containment failed: %',sig; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname<>'postgres'
   AND EXISTS(SELECT 1 FROM pg_proc fn WHERE fn.pronamespace='public'::regnamespace
    AND fn.proname=ANY(ARRAY['progression_verify_class_growth_internal','progression_refuse_raw_progression_write','progression_command_projection_internal','progression_apply_xp_internal','progression_apply_permanent_delta_internal','progression_class_config_internal','progression_snapshot_internal','character_sync_derived_internal','join_order','switch_order','award_class_bond','award_class_bond_for_kill','train_renown_stat'])
    AND has_function_privilege(role.oid,fn.oid,'EXECUTE')))
 THEN RAISE EXCEPTION '001E effective inherited private/legacy EXECUTE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname NOT IN('postgres','service_role')
   AND has_function_privilege(role.oid,'public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)','EXECUTE'))
 THEN RAISE EXCEPTION '001E effective narrow-command ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class rel WHERE rel.oid IN('public.progression_class_growth_milestone'::regclass,'public.progression_command_control'::regclass)
   AND (rel.relowner<>'postgres'::regrole OR NOT rel.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=rel.oid)
    -- Built-in global database authority roles intrinsically bypass ACLs. Custom/ordinary members still fail this check.
    OR EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname<>'postgres' AND role.rolname !~ '^pg_'
      AND has_table_privilege(role.oid,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))))
 THEN RAISE EXCEPTION '001E effective sidecar containment failed'; END IF;
 IF (SELECT enabled FROM public.progression_command_control WHERE singleton) THEN RAISE EXCEPTION '001E must install inactive'; END IF;
END $assert$;
