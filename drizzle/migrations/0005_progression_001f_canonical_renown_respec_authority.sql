-- ENG-PROGRESSION-001F PREPARED ONLY; NOT INSTALLED / NOT ACTIVE.
-- Run only through a separately authorized standard Drizzle forward transaction.
-- No history registration, player mutation, activation or key rotation.
DO $guard$ DECLARE dep record; BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>1
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM '''{}''::jsonb'
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_offered','_metadata']
 THEN RAISE EXCEPTION '001F dependency drift: progression_apply_xp_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_permanent_delta_internal(uuid,uuid,text,numeric,jsonb,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0ced64d37ebd32c7fa4a176a82933a7c5f87786c0abcf49edc7686719f53b0a0'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>1
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM '''{}''::jsonb'
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_expected_version','_deltas','_metadata']
 THEN RAISE EXCEPTION '001F dependency drift: progression_apply_permanent_delta_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_class_config_internal(text,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'e6288a593666a804f5e3403078743d95b203bf04a8d3f7e8b3aa54aad93ede38'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'s' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_class','_classless']
 THEN RAISE EXCEPTION '001F dependency drift: progression_class_config_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_snapshot_internal(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'d4a41d06a5a8f1078aff91a248bf58efe79d04eadd5936813428f2fd060cb463'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'s' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character']
 THEN RAISE EXCEPTION '001F dependency drift: progression_snapshot_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.character_sync_derived_internal(uuid,boolean,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_level_gained','_was_alive']
 THEN RAISE EXCEPTION '001F dependency drift: character_sync_derived_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'68d70101310138a1e4d3bffb4a57a835ca524d8da28a2957aa2d259ef98e1b29'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>2
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM 'NULL::jsonb, NULL::text'
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_actor','_request','_expected_version','_operation','_allocations','_target_class']
 THEN RAISE EXCEPTION '001F dependency drift: progression_command'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_refuse_raw_progression_write()'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'b09bbe59f8b477c0278ab7c05b5c745d757dbf7065f7be3e2a43219677d93896'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM false
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'trigger'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM NULL::text[]
 THEN RAISE EXCEPTION '001F dependency drift: progression_refuse_raw_progression_write'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_command_projection_internal(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'6b41d2e02ddd93cbe9bcb4b3d81b427f6b80ac664e5dffaaedd174c82bdcc9af'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'s' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character']
 THEN RAISE EXCEPTION '001F dependency drift: progression_command_projection_internal'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.join_order(uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'603bb8a96bc2336e7d79d28ef5a9f3dc287d9157bf6a16c2a726fa567c5bd230'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_class']
 THEN RAISE EXCEPTION '001F dependency drift: join_order'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.switch_order(uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'ca05dd3015f1c6e6e618ca58f777e8af62068d587846485e6315b25030cc72a0'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_class']
 THEN RAISE EXCEPTION '001F dependency drift: switch_order'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.award_class_bond(uuid,text,integer)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'6e2c03502418dcfa448baaf31022f03fe58f5db98e2b115ade9dbdff5860a6a2'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
 OR dep.prorettype<>'integer'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_class','_amount']
 THEN RAISE EXCEPTION '001F dependency drift: award_class_bond'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.award_class_bond_for_kill(uuid,integer,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'4ac232d36fbba9ca798250ccb79904aeb872acbd1d05cbbfc6df719990dcd756'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
 OR dep.prorettype<>'integer'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>1
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM 'false'
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_creature_level','_is_boss']
 THEN RAISE EXCEPTION '001F dependency drift: award_class_bond_for_kill'; END IF;
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.train_renown_stat(uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'e4cde3ca8bd43e09e5cda0cd97c18b683198a1407265e7bd3b7bb27782162552'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM true
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR dep.provolatile<>'v' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>0
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character_id','_stat']
 THEN RAISE EXCEPTION '001F dependency drift: train_renown_stat'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='progression_command')<>1
 OR NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND NOT enabled)
 OR (SELECT count(*) FROM public.progression_command_control)<>1
 THEN RAISE EXCEPTION '001F command/control drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname=ANY(ARRAY['progression_apply_xp_internal','progression_apply_permanent_delta_internal','progression_class_config_internal','progression_snapshot_internal','character_sync_derived_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal','join_order','switch_order','award_class_bond','award_class_bond_for_kill','train_renown_stat']) GROUP BY proname HAVING count(*)<>1)
 THEN RAISE EXCEPTION '001F dependency overload drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY['progression_apply_xp_internal','progression_apply_permanent_delta_internal','progression_class_config_internal','progression_snapshot_internal','character_sync_derived_internal','progression_refuse_raw_progression_write','progression_command_projection_internal','join_order','switch_order','award_class_bond','award_class_bond_for_kill','train_renown_stat']) AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION '001F private dependency ACL drift'; END IF;
 -- Retained D/E RP writers must not provide a service/ordinary definer bypass around the raw fence.
 IF EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname<>'postgres'
 AND EXISTS(SELECT 1 FROM pg_proc fn WHERE fn.pronamespace='public'::regnamespace
 AND fn.proname IN('train_renown_stat','award_party_member','commit_encounter_tick_v2','node_tick_commit_without_bounded_failure')
 AND has_function_privilege(role.oid,fn.oid,'EXECUTE')))
 THEN RAISE EXCEPTION '001F legacy RP writer effective ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)'::regprocedure
 AND (a.grantee NOT IN(p.proowner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE'))
 OR NOT has_function_privilege('service_role','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)','EXECUTE')
 THEN RAISE EXCEPTION '001F narrow command ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN('public.progression_character_state'::regclass,
 'public.progression_receipt'::regclass,'public.progression_respec_milestone'::regclass,
 'public.progression_class_growth_milestone'::regclass,'public.progression_command_control'::regclass)
 AND (c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col,LATERAL aclexplode(col.attacl) a WHERE col.attrelid=c.oid AND a.grantee<>c.relowner)))
 THEN RAISE EXCEPTION '001F sidecar containment drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass
 AND tgname='progression_refuse_raw_progression_write' AND tgenabled='O' AND tgtype=19
 AND tgfoid='public.progression_refuse_raw_progression_write()'::regprocedure)
 THEN RAISE EXCEPTION '001F raw fence trigger drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_receipt'::regclass
 AND conname='progression_receipt_operation_check' AND convalidated
 AND pg_get_constraintdef(oid)='CHECK ((operation = ANY (ARRAY[''xp''::text, ''permanent''::text, ''order''::text])))')
 THEN RAISE EXCEPTION '001F receipt constraint drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.characters'::regclass
 AND conname='characters_unspent_stat_points_check' AND convalidated
 AND pg_get_constraintdef(oid)='CHECK (((unspent_stat_points >= 0) AND (unspent_stat_points <= 200)))')
 THEN RAISE EXCEPTION '001F installed pool cap drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto' AND extversion='1.3' AND extnamespace='extensions'::regnamespace)
 OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
 THEN RAISE EXCEPTION '001F pgcrypto dependency missing'; END IF;
 IF to_regclass('public.progression_renown_key') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal'))
 THEN RAISE EXCEPTION '001F object collision'; END IF;
END $guard$;
ALTER TABLE public.progression_receipt DROP CONSTRAINT progression_receipt_operation_check;
ALTER TABLE public.progression_receipt ADD CONSTRAINT progression_receipt_operation_check CHECK(operation IN('xp','permanent','order','respec','renown'));
CREATE TABLE public.progression_renown_key (
 key_version integer PRIMARY KEY CHECK(key_version>0),active boolean NOT NULL,
 key_material bytea NOT NULL CHECK(octet_length(key_material)=32)
);
CREATE UNIQUE INDEX progression_renown_one_active_key ON public.progression_renown_key(active) WHERE active;
ALTER TABLE public.progression_renown_key OWNER TO postgres;
ALTER TABLE public.progression_renown_key ENABLE ROW LEVEL SECURITY;
INSERT INTO public.progression_renown_key VALUES(1,true,extensions.gen_random_bytes(32));
CREATE FUNCTION public.progression_validate_fresh_internal(_character uuid,_expected_version numeric,_operation text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
 latest public.progression_receipt%ROWTYPE; old public.progression_receipt%ROWTYPE;
 v numeric; counters jsonb; last_counters jsonb; k text; j jsonb; n numeric;
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character FOR UPDATE;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 v:=COALESCE(s.version,0);
 IF v<>_expected_version THEN RETURN jsonb_build_object('kind','refused','reason','stale_state'); END IF;
 IF v>=9007199254740991 THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
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
   OR (latest.receipt->>'versionBefore')::numeric IS DISTINCT FROM s.version-1
   OR (SELECT count(*) FROM public.progression_receipt WHERE character_id=c.id AND (receipt->>'versionAfter')::numeric=s.version)<>1
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
 IF v=0 AND EXISTS(SELECT 1 FROM public.progression_receipt WHERE character_id=c.id)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 IF s.character_id IS NOT NULL AND s.version=0 AND counters<>jsonb_build_object('str',0,'dex',0,'con',0,'int',0,'wis',0,'cha',0)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 IF c.bhp IS NULL OR c.bhp<0 OR c.rp_total_earned IS NULL OR c.rp_total_earned<0
  OR jsonb_typeof(c.bhp_trained) IS DISTINCT FROM 'object'
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 FOR k,j IN SELECT * FROM jsonb_each(c.bhp_trained) LOOP
  IF k<>ALL(ARRAY['str','dex','con','int','wis','cha']) OR jsonb_typeof(j)<>'number'
  THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
  n:=j::text::numeric;
  IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 END LOOP;
 IF v>0 AND (latest.receipt->'after'->'trainedRanks' IS DISTINCT FROM c.bhp_trained
   OR (latest.receipt->'after'->>'renownBalance')::numeric IS DISTINCT FROM c.bhp)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 SELECT * INTO old FROM public.progression_receipt WHERE character_id=c.id AND operation IN('respec','renown')
  ORDER BY (receipt->>'versionAfter')::numeric DESC LIMIT 1;
 IF FOUND AND (old.receipt->'after'->>'lifetimeRp')::numeric IS DISTINCT FROM c.rp_total_earned
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 PERFORM 1 FROM public.progression_character_state WHERE character_id=c.id FOR UPDATE;
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

 IF _operation IN('respec','renown') THEN
  IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_trainer)
  THEN RETURN jsonb_build_object('kind','refused','reason','not_at_trainer'); END IF;
  IF c.hp>c.max_hp OR c.cp>c.max_cp OR c.mp>c.max_mp
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
 END IF;
 RETURN jsonb_build_object('kind','valid');
END $$;
-- Private F mutation; caller owns trainer/lifecycle/proof validation and character lock.
CREATE FUNCTION public.progression_apply_f_internal(_character uuid,_actor uuid,_request uuid,
 _expected_version numeric,_operation text,_stat text,_normalized jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
 before jsonb; after_state jsonb; counters jsonb; deltas jsonb; r jsonb; proof jsonb; investment_proof jsonb;
 refund bigint; rank_before numeric; cost numeric; chance integer; draw jsonb; success boolean;
 source_key text; v bigint; key_name text; prior public.progression_receipt%ROWTYPE; validated jsonb; canonical_request jsonb;
BEGIN
 IF auth.uid() IS NOT NULL OR _operation IS NULL OR _operation NOT IN('respec','renown') OR _actor IS NULL
  OR _request IS NULL OR _expected_version IS NULL OR _expected_version<0 OR _expected_version<>trunc(_expected_version)
  OR (_operation='respec' AND _stat IS NOT NULL)
 THEN RAISE EXCEPTION 'invalid_private_f_request'; END IF;
 canonical_request:=jsonb_build_object('operation',_operation,'actorId',_actor,'expectedVersion',_expected_version,'contractVersion',1,'rulesVersion',1);
 IF _operation='renown' THEN canonical_request:=canonical_request||jsonb_build_object('stat',_stat); END IF;
 IF canonical_request IS DISTINCT FROM _normalized THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character FOR UPDATE;
 IF c.user_id IS DISTINCT FROM _actor THEN RAISE EXCEPTION 'invalid_private_f_owner'; END IF;
 source_key:=CASE WHEN _operation='respec' THEN 'full_respec' ELSE 'renown_training' END;
 SELECT * INTO prior FROM public.progression_receipt WHERE character_id=c.id AND event_id=_request
  AND source IN('discretionary_allocation','order_command','full_respec','renown_training');
 IF FOUND THEN
  IF (SELECT count(*) FROM public.progression_receipt WHERE character_id=c.id AND event_id=_request
   AND source IN('discretionary_allocation','order_command','full_respec','renown_training'))<>1
  THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  IF prior.source<>source_key OR prior.request IS DISTINCT FROM _normalized
  THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','original',prior.receipt);
 END IF;
 validated:=public.progression_validate_fresh_internal(c.id,_expected_version,_operation);
 IF validated->>'kind'<>'valid' THEN RETURN validated; END IF;
 PERFORM 1 FROM public.classes WHERE class_key=c.class FOR SHARE;
 PERFORM public.progression_class_config_internal(c.class,c.is_classless);
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=c.id;
 v:=COALESCE(s.version,0);
 IF v<>_expected_version THEN RETURN jsonb_build_object('kind','refused','reason','stale_state'); END IF;
 IF v>=9007199254740991 THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 counters:=jsonb_build_object('str',COALESCE(s.str_invested,0),'dex',COALESCE(s.dex_invested,0),
  'con',COALESCE(s.con_invested,0),'int',COALESCE(s.int_invested,0),'wis',COALESCE(s.wis_invested,0),'cha',COALESCE(s.cha_invested,0));
 IF EXISTS(SELECT 1 FROM jsonb_each_text(counters) x WHERE x.value::numeric<0 OR x.value::numeric>(to_jsonb(c)->>x.key)::numeric)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 before:=public.progression_snapshot_internal(c.id)||jsonb_build_object('lifetimeRp',c.rp_total_earned);
 SELECT jsonb_build_object('source',source,'eventId',event_id,'versionAfter',receipt->'versionAfter') INTO proof
 FROM public.progression_receipt WHERE character_id=c.id ORDER BY (receipt->>'versionAfter')::numeric DESC LIMIT 1;
 SELECT jsonb_build_object('source',source,'eventId',event_id,'versionAfter',receipt->'versionAfter') INTO investment_proof
 FROM public.progression_receipt WHERE character_id=c.id AND receipt ? 'refundableInvestmentAfter'
 ORDER BY (receipt->>'versionAfter')::numeric DESC LIMIT 1;
 IF _operation='respec' THEN
  SELECT sum(value::bigint) INTO refund FROM jsonb_each_text(counters);
  IF refund=0 THEN RETURN jsonb_build_object('kind','refused','reason','empty_refund'); END IF;
  IF c.respec_points<1 THEN RETURN jsonb_build_object('kind','refused','reason','insufficient_respec_token'); END IF;
  IF c.unspent_stat_points::bigint+refund>200 THEN RETURN jsonb_build_object('kind','refused','reason','pool_cap'); END IF;
  deltas:=counters;source_key:='full_respec';
 ELSE
  IF _stat IS NULL OR _stat<>ALL(ARRAY['str','dex','con','int','wis','cha'])
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
  IF c.level<30 THEN RETURN jsonb_build_object('kind','refused','reason','renown_level_required'); END IF;
  rank_before:=COALESCE((c.bhp_trained->>_stat)::numeric,0);cost:=10*(rank_before+1);
  IF cost>2147483647 OR rank_before>=2147483647 OR (to_jsonb(c)->>_stat)::numeric>=2147483647
  THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
  IF c.bhp<cost THEN RETURN jsonb_build_object('kind','refused','reason','insufficient_rp'); END IF;
  chance:=greatest(5,95-10*rank_before)::integer;
  draw:=public.progression_renown_draw_internal(c.id,_request,_stat,v,rank_before);
  success:=(draw->>'roll')::integer<chance;
  source_key:='renown_training';
  deltas:=jsonb_build_object(_stat,CASE WHEN success THEN 1 ELSE 0 END);
 END IF;
 -- The baseline is immutable and is created only after every ordinary refusal.
 INSERT INTO public.progression_character_state(character_id,opaque_baseline) VALUES(c.id,before) ON CONFLICT DO NOTHING;
 IF _operation='respec' THEN
  UPDATE public.characters SET str=str-(counters->>'str')::integer,dex=dex-(counters->>'dex')::integer,
   con=con-(counters->>'con')::integer,int=int-(counters->>'int')::integer,
   wis=wis-(counters->>'wis')::integer,cha=cha-(counters->>'cha')::integer,
   unspent_stat_points=unspent_stat_points+refund,respec_points=respec_points-1 WHERE id=c.id;
  UPDATE public.progression_character_state SET str_invested=0,dex_invested=0,con_invested=0,
   int_invested=0,wis_invested=0,cha_invested=0 WHERE character_id=c.id;
 ELSE
  UPDATE public.characters SET bhp=bhp-cost WHERE id=c.id;
  IF success THEN
   EXECUTE format('UPDATE public.characters SET %I=%I+1,bhp_trained=jsonb_set(bhp_trained,ARRAY[$1],to_jsonb($2::integer),true) WHERE id=$3',_stat,_stat)
    USING _stat,rank_before+1,c.id;
  END IF;
 END IF;
 -- Failure is deliberately not a resource repair operation.
 IF _operation='respec' OR success THEN PERFORM public.character_sync_derived_internal(c.id,false,true); END IF;
 UPDATE public.progression_character_state SET version=version+1 WHERE character_id=c.id;
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character;
 after_state:=public.progression_snapshot_internal(c.id)||jsonb_build_object('lifetimeRp',c.rp_total_earned);
 r:=jsonb_build_object('characterId',c.id,'actorId',_actor,'source',source_key,'eventId',_request,'operation',_operation,
  'request',_normalized,'proofReference',proof,'investmentProofReference',investment_proof,'versionBefore',v,'versionAfter',v+1,'before',before,'after',after_state,
  'refundableInvestmentBefore',counters,'refundableInvestmentAfter',CASE WHEN _operation='respec'
   THEN '{"str":0,"dex":0,"con":0,"int":0,"wis":0,"cha":0}'::jsonb ELSE counters END,
  'projection',public.progression_command_projection_internal(c.id));
 IF _operation='respec' THEN r:=r||jsonb_build_object('refundedDeltas',deltas,'totalRefund',refund);
 ELSE r:=r||draw||jsonb_build_object('stat',_stat,'rankBefore',rank_before,'rankAfter',rank_before+CASE WHEN success THEN 1 ELSE 0 END,
  'cost',cost,'chance',chance,'outcome',CASE WHEN success THEN 'success' ELSE 'failure' END,'permanentDelta',CASE WHEN success THEN 1 ELSE 0 END);
 END IF;
 INSERT INTO public.progression_receipt VALUES(c.id,source_key,_request,_operation,_normalized,r);
 RETURN jsonb_build_object('kind','committed','receipt',r,'projection',r->'projection');
END $$;

CREATE FUNCTION public.progression_renown_draw_internal(_character uuid,_request uuid,_stat text,_version numeric,_rank numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE secret bytea; key_v integer; draw_i integer; fields text[]; field text; message bytea; digest bytea; x bigint;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'private_renown_rng'; END IF;
 SELECT key_material,key_version INTO STRICT secret,key_v FROM public.progression_renown_key WHERE active FOR SHARE;
 FOR draw_i IN 0..127 LOOP
  fields:=ARRAY['wov.renown.v1',_character::text,_request::text,_stat,trunc(_version)::text,trunc(_rank)::text,draw_i::text];
  message:=''::bytea;
  FOREACH field IN ARRAY fields LOOP
   IF field IS NULL THEN RAISE EXCEPTION 'invalid_rng_input'; END IF;
   message:=message||int4send(octet_length(convert_to(field,'UTF8')))||convert_to(field,'UTF8');
  END LOOP;
  digest:=extensions.hmac(message,secret,'sha256');
  x:=get_byte(digest,0)::bigint*16777216+get_byte(digest,1)::bigint*65536+get_byte(digest,2)::bigint*256+get_byte(digest,3);
  IF x<4294967200 THEN RETURN jsonb_build_object('algorithm','wov.renown.v1/hmac-sha256-u32be-rejection128',
   'keyVersion',key_v,'drawIndex',draw_i,'roll',x%100); END IF;
 END LOOP;
 RAISE EXCEPTION 'renown_rng_exhausted';
END $$;

CREATE OR REPLACE FUNCTION public.progression_refuse_raw_progression_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user<>'postgres' AND
   ROW(NEW.str,NEW.dex,NEW.con,NEW.int,NEW.wis,NEW.cha,NEW.level,NEW.xp,NEW.class,NEW.is_classless,NEW.unspent_stat_points,NEW.respec_points,NEW.bhp,NEW.bhp_trained,NEW.rp_total_earned)
   IS DISTINCT FROM ROW(OLD.str,OLD.dex,OLD.con,OLD.int,OLD.wis,OLD.cha,OLD.level,OLD.xp,OLD.class,OLD.is_classless,OLD.unspent_stat_points,OLD.respec_points,OLD.bhp,OLD.bhp_trained,OLD.rp_total_earned)
 THEN RAISE EXCEPTION 'progression_raw_override_paused_until_001G' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.progression_command_projection_internal(_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
BEGIN
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 RETURN jsonb_build_object('progressionVersion',COALESCE(s.version,0),'character',jsonb_build_object(
  'id',c.id,'class',c.class,'is_classless',c.is_classless,'level',c.level,'xp',c.xp,
  'str',c.str,'dex',c.dex,'con',c.con,'int',c.int,'wis',c.wis,'cha',c.cha,
  'unspent_stat_points',c.unspent_stat_points,'respec_points',c.respec_points,
  'bhp',c.bhp,'bhp_trained',c.bhp_trained,'rp_total_earned',c.rp_total_earned,'hp',c.hp,'cp',c.cp,'mp',c.mp,'max_hp',c.max_hp,'max_cp',c.max_cp,'max_mp',c.max_mp));
END $$;
-- Exact old signature retired; RESTRICT stops unexpected dependencies, no overload survives.
DROP FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text);
CREATE FUNCTION public.progression_command(_character uuid,_actor uuid,_request uuid,_expected_version numeric,
 _operation text,_allocations jsonb DEFAULT NULL,_target_class text DEFAULT NULL,_stat text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;
ALTER FUNCTION public.progression_validate_fresh_internal(uuid,numeric,text) OWNER TO postgres;
ALTER FUNCTION public.progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.progression_renown_draw_internal(uuid,uuid,text,numeric,numeric) OWNER TO postgres;
ALTER FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text) OWNER TO postgres;
ALTER FUNCTION public.progression_refuse_raw_progression_write() OWNER TO postgres;
ALTER FUNCTION public.progression_command_projection_internal(uuid) OWNER TO postgres;
DO $acl$ DECLARE p record; g record; BEGIN
 FOR p IN SELECT oid,proowner,oid::regprocedure::text identity,proacl FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN('progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal',
  'progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal','train_renown_stat') LOOP
  FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) WHERE grantee<>p.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',p.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
  END LOOP;
 END LOOP;
 FOR g IN SELECT DISTINCT grantee FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid='public.progression_renown_key'::regclass AND a.grantee<>c.relowner LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.progression_renown_key FROM %s',CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text) TO service_role;
 -- A table UPDATE grant implies every column. Preserve service writes to unrelated fields as column grants.
 IF has_table_privilege('service_role','public.characters','UPDATE') THEN
  FOR p IN SELECT attname FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped
   AND attname<>ALL(ARRAY['str','dex','con','int','wis','cha','level','xp','class','is_classless','unspent_stat_points','respec_points','bhp','bhp_trained','rp_total_earned']) LOOP
   EXECUTE format('GRANT UPDATE(%I) ON public.characters TO service_role',p.attname);
  END LOOP;
 END IF;
 REVOKE UPDATE ON public.characters FROM service_role;
 REVOKE UPDATE(str,dex,con,int,wis,cha,level,xp,class,is_classless,unspent_stat_points,respec_points,bhp,bhp_trained,rp_total_earned) ON public.characters FROM service_role;
END $acl$;
DO $assert$ DECLARE installed record; BEGIN
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_validate_fresh_internal(uuid,numeric,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'036cc182e27ca11b58841bd1e1b90e026ed5344015519d1333102606588d9c5f'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_expected_version','_operation']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_validate_fresh_internal(uuid,numeric,text)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0026d856625b09bea510d291e563ce05530baf9690d845cad244ea7199fc4494'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_actor','_request','_expected_version','_operation','_stat','_normalized']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_renown_draw_internal(uuid,uuid,text,numeric,numeric)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'b820e6e27ab3b748e888a392915563f772c907823493a2617d32266204f1c0d7'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_request','_stat','_version','_rank']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_renown_draw_internal(uuid,uuid,text,numeric,numeric)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0e165e22a469dbdf7c65e2cc15a778cf358b1f77da8079ce30fc0d42f5863382'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>3
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM 'NULL::jsonb, NULL::text, NULL::text'
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_actor','_request','_expected_version','_operation','_allocations','_target_class','_stat']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_refuse_raw_progression_write()'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'cfbe32e43079c64328b397238cae0e7033e24de6ae2df4571ee40e6a62a6037a'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM false
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'trigger'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM NULL::text[]
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_refuse_raw_progression_write()'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_command_projection_internal(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'4ea3f550ed6260a0045540ad693977ba97f650c0139076700770d6dbe6bf3e26'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'s'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_command_projection_internal(uuid)'; END IF;
 IF (SELECT enabled FROM public.progression_command_control WHERE singleton)
 OR (SELECT count(*) FROM public.progression_renown_key WHERE active AND key_version=1)<>1
 THEN RAISE EXCEPTION '001F must install paused with one key'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname=ANY(ARRAY['progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal']) GROUP BY proname HAVING count(*)<>1)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.progression_renown_key'::regclass AND relowner='postgres'::regrole AND relrowsecurity)
 THEN RAISE EXCEPTION '001F resulting object metadata drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role') AND
  (has_table_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,REFERENCES')))
 OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.progression_renown_key'::regclass)
 THEN RAISE EXCEPTION '001F key containment failed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname<>'postgres' AND
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND p.proname IN('progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','train_renown_stat','progression_command_projection_internal','progression_refuse_raw_progression_write')
   AND has_function_privilege(r.oid,p.oid,'EXECUTE')))
 THEN RAISE EXCEPTION '001F inherited private EXECUTE'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['bhp','bhp_trained','rp_total_earned']) col
  WHERE has_column_privilege('service_role','public.characters',col,'UPDATE'))
 THEN RAISE EXCEPTION '001F inherited raw Renown UPDATE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public.progression_renown_key'::regclass AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col,LATERAL aclexplode(col.attacl) a
  WHERE col.attrelid='public.progression_renown_key'::regclass AND a.grantee<>'postgres'::regrole)
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname NOT IN('postgres','service_role')
  AND has_function_privilege(r.oid,'public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE'))
 THEN RAISE EXCEPTION '001F final ACL drift'; END IF;
END $assert$;
