-- ENG-PROGRESSION-001E/F selective activation. LOCAL CANDIDATE, NOT INSTALLED.
-- One atomic DO; standard Drizzle tool owns the outer transaction. All flags default OFF.
DO $install$
DECLARE p record; before_command jsonb; before_projection jsonb; ddl text;
BEGIN
 LOCK TABLE public.progression_command_control IN ACCESS EXCLUSIVE MODE;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0e165e22a469dbdf7c65e2cc15a778cf358b1f77da8079ce30fc0d42f5863382'
  OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'progression command drift'; END IF;
 before_command:=to_jsonb(p)-'prosrc';
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.progression_validate_fresh_internal(uuid,numeric,text)'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='036cc182e27ca11b58841bd1e1b90e026ed5344015519d1333102606588d9c5f') THEN RAISE EXCEPTION 'progression private dependency drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='0026d856625b09bea510d291e563ce05530baf9690d845cad244ea7199fc4494') THEN RAISE EXCEPTION 'progression private dependency drift'; END IF;

 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.progression_command_projection(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'443cf2f281a9e389139741c35d751d924b91121ae464b0fc9b8805885c225c3a'
  OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'progression projection drift'; END IF;
 before_projection:=to_jsonb(p)-'prosrc';
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.progression_command_control'::regclass AND relowner='postgres'::regrole AND relrowsecurity)
  OR (SELECT count(*) FROM public.progression_command_control)<>1
  OR EXISTS(SELECT 1 FROM public.progression_command_control WHERE NOT singleton OR enabled)
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role') AND
   (has_table_privilege(r.oid,'public.progression_command_control','SELECT,INSERT,UPDATE,DELETE')
    OR has_any_column_privilege(r.oid,'public.progression_command_control','SELECT,INSERT,UPDATE')))
  OR has_function_privilege('anon','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
  OR has_function_privilege('anon','public.progression_command_projection(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.progression_command_projection(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'progression control/authority drift'; END IF;
 ALTER TABLE public.progression_command_control
  ADD COLUMN join_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN allocation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN respec_enabled boolean NOT NULL DEFAULT false;
 ddl:=pg_get_functiondef('public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure);
 ddl:=replace(ddl,(SELECT prosrc FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure),$newcommand$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
 old public.progression_receipt%ROWTYPE; latest public.progression_receipt%ROWTYPE;
 initial_node uuid; v numeric; k text; j jsonb; n numeric; d jsonb:='{}'; total bigint:=0;
 req jsonb; cfg public.classes%ROWTYPE; before jsonb; before_bonds jsonb; r jsonb; result jsonb;
 source_key text; meta jsonb; counters jsonb; last_counters jsonb;
BEGIN
 IF auth.uid() IS NOT NULL OR _actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character AND user_id=_actor)
 THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 IF _request IS NULL OR _operation IS NULL OR _operation NOT IN('allocate','join','switch','respec','renown')
  OR _expected_version IS NULL OR _expected_version<0 OR _expected_version>9007199254740991 OR _expected_version<>trunc(_expected_version)
 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
 IF _operation IN('respec','renown') THEN
  IF _allocations IS NOT NULL OR _target_class IS NOT NULL
    OR (_operation='respec' AND _stat IS NOT NULL)
    OR (_operation='renown' AND (_stat IS NULL OR _stat<>ALL(ARRAY['str','dex','con','int','wis','cha'])))
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
  source_key:=CASE WHEN _operation='respec' THEN 'full_respec' ELSE 'renown_training' END;
  req:=jsonb_build_object('operation',_operation,'actorId',_actor,'expectedVersion',_expected_version,
    'contractVersion',1,'rulesVersion',1);
  IF _operation='renown' THEN req:=req||jsonb_build_object('stat',_stat); END IF;
 ELSIF _operation='allocate' THEN
  IF _stat IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
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
  IF _stat IS NOT NULL OR _allocations IS NOT NULL OR _target_class IS NULL OR _target_class !~ '^[a-z][a-z0-9_]{1,31}$'
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
  source_key:='order_command';
  req:=jsonb_build_object('operation',_operation,'actorId',_actor,'expectedVersion',_expected_version,'targetClass',_target_class,'contractVersion',1,'rulesVersion',1);
 END IF;
 -- Acquire only the initially observed acting node. Never acquire another node/encounter after c lock.
 SELECT current_node_id INTO initial_node FROM public.characters WHERE id=_character AND user_id=_actor;
 IF initial_node IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||initial_node::text,0)); END IF;
 PERFORM 1 FROM public.node_encounter WHERE node_id=initial_node ORDER BY id FOR UPDATE;
 SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;
 IF NOT FOUND OR c.user_id<>_actor THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 SELECT * INTO old FROM public.progression_receipt WHERE character_id=_character AND source IN('discretionary_allocation','order_command','full_respec','renown_training') AND event_id=_request;
 IF FOUND THEN
  IF (SELECT count(*) FROM public.progression_receipt WHERE character_id=c.id AND event_id=_request
   AND source IN('discretionary_allocation','order_command','full_respec','renown_training'))<>1
  THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  IF old.source<>source_key OR old.request<>req THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','original',old.receipt);
 END IF;
 IF c.current_node_id IS DISTINCT FROM initial_node THEN RETURN jsonb_build_object('kind','refused','reason','location_changed'); END IF;
 IF (SELECT enabled FROM public.progression_command_control WHERE singleton) IS DISTINCT FROM true
 THEN RETURN jsonb_build_object('kind','refused','reason','commands_paused'); END IF;
 IF _operation IN('switch','renown') OR NOT COALESCE((SELECT CASE _operation
   WHEN 'join' THEN join_enabled WHEN 'allocate' THEN allocation_enabled
   WHEN 'respec' THEN respec_enabled ELSE false END
   FROM public.progression_command_control WHERE singleton),false)
 THEN RETURN jsonb_build_object('kind','refused','reason','operation_disabled'); END IF;
 result:=public.progression_validate_fresh_internal(c.id,_expected_version,_operation);
 IF result->>'kind'<>'valid' THEN RETURN result; END IF;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=c.id;
 v:=COALESCE(s.version,0);
 counters:=jsonb_build_object('str',COALESCE(s.str_invested,0),'dex',COALESCE(s.dex_invested,0),'con',COALESCE(s.con_invested,0),'int',COALESCE(s.int_invested,0),'wis',COALESCE(s.wis_invested,0),'cha',COALESCE(s.cha_invested,0));
 IF _operation IN('respec','renown') THEN
  IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_trainer)
  THEN RETURN jsonb_build_object('kind','refused','reason','not_at_trainer'); END IF;
  IF c.hp>c.max_hp OR c.cp>c.max_cp OR c.mp>c.max_mp
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
  PERFORM public.progression_class_config_internal(c.class,c.is_classless);
  RETURN public.progression_apply_f_internal(c.id,_actor,_request,v,_operation,_stat,req);
 END IF;
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
END $newcommand$);
 EXECUTE ddl;
 ddl:=pg_get_functiondef('public.progression_command_projection(uuid)'::regprocedure);
 ddl:=replace(ddl,(SELECT prosrc FROM pg_proc WHERE oid='public.progression_command_projection(uuid)'::regprocedure),$newprojection$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character AND user_id=auth.uid())
 THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 RETURN jsonb_build_object('kind','current','projection',public.progression_command_projection_internal(_character),
 'availability',jsonb_build_object(
  'join',COALESCE((SELECT enabled AND join_enabled FROM public.progression_command_control WHERE singleton),false),
  'allocate',COALESCE((SELECT enabled AND allocation_enabled FROM public.progression_command_control WHERE singleton),false),
  'respec',COALESCE((SELECT enabled AND respec_enabled FROM public.progression_command_control WHERE singleton),false),
  'switch',false,'renown',false));
END $newprojection$);
 EXECUTE ddl;
 IF (SELECT to_jsonb(x)-'prosrc' FROM pg_proc x WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure) IS DISTINCT FROM before_command
  OR (SELECT to_jsonb(x)-'prosrc' FROM pg_proc x WHERE oid='public.progression_command_projection(uuid)'::regprocedure) IS DISTINCT FROM before_projection
 THEN RAISE EXCEPTION 'progression metadata changed'; END IF;
END $install$;
