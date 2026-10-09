-- Reviewed input outside migration discovery. LOCAL ONLY; not installed/activated.
-- Standard Lovable tool, one atomic transaction, separate authorization required.
DO $dependencies$
BEGIN
  IF to_regclass('public.characters_creation_name_key_uq') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid='public.characters_creation_name_key_uq'::regclass
      AND indrelid='public.characters'::regclass AND indisunique AND indisvalid AND indisready
      AND indpred IS NULL AND pg_get_indexdef(indexrelid) LIKE '%lower(btrim(name))%')
  THEN RAISE EXCEPTION 'P2 requires verified S2 unique name index'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass
    AND tgname='trg_grant_starting_materials' AND tgenabled IN ('O','A')
    AND tgfoid='public.grant_starting_materials()'::regprocedure)
  THEN RAISE EXCEPTION 'P2 requires starting material trigger'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN
    ('public.character_creation_origin'::regclass,'public.character_creation_log'::regclass)
    AND (relowner<>'postgres'::regrole OR NOT relrowsecurity OR relforcerowsecurity))
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN
      ('public.character_creation_origin'::regclass,'public.character_creation_log'::regclass))
  THEN RAISE EXCEPTION 'P2 private storage owner/RLS drift'; END IF;
END
$dependencies$;

CREATE FUNCTION public.character_create_c2_internal(
  _request uuid, _name text, _race text, _gender text,
  _target uuid, _reason text, _expected_revision text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $creation$
DECLARE
  manifest jsonb := $manifest${"schemaVersion":1,"versions":{"creation":"creation-c2-v1","race":"race-c2-v1","class":"class-c2-v1","formula":"formula-c2-v1"},"creation":{"baseAttributes":{"str":8,"dex":8,"con":8,"int":8,"wis":8,"cha":8},"level":1,"xp":0,"gold":200,"quota":5,"nameMaxLength":40,"classKey":"classless","family":null,"inventory":[],"equipment":[],"materials":{"salvage":40,"garnet":1,"topaz":1,"emerald":1,"sapphire":1,"pearl":1,"amethyst":1},"unspentStatPoints":0,"respecPoints":0,"renownBalance":0,"renownTotal":0,"trainedRanks":{}},"races":{"human":{"str":1,"dex":1,"con":1,"int":1,"wis":1,"cha":1},"elf":{"str":-1,"dex":2,"con":-1,"int":2,"wis":3,"cha":0},"dwarf":{"str":2,"dex":-1,"con":4,"int":0,"wis":1,"cha":-2},"halfling":{"str":-2,"dex":3,"con":1,"int":0,"wis":1,"cha":2},"edain":{"str":1,"dex":0,"con":3,"int":1,"wis":1,"cha":1},"half_elf":{"str":0,"dex":1,"con":0,"int":1,"wis":2,"cha":3}},"class":{"key":"classless","baseHp":18,"baseAc":10,"levelBonuses":{},"isPreClass":true,"status":"active","isSelectable":false},"formula":{"modifierOffset":10,"modifierDivisor":2,"hpConMultiplier":2,"hpMin":1,"hpCap":10000,"cpBase":30,"cpMentalMultiplier":3,"cpMin":0,"cpCap":5000,"mpBase":100,"mpDexMultiplier":10,"mpMin":0,"mpCap":5000}}$manifest$::jsonb;
  actor uuid := auth.uid(); target uuid; delegated boolean; key integer;
  name_display text := btrim(_name); reason text := nullif(btrim(_reason),'');
  payload jsonb; request_digest bytea; prior public.character_creation_log%ROWTYPE;
  race_row public.races%ROWTYPE; class_row public.classes%ROWTYPE;
  race_delta jsonb; actual_delta jsonb; stats jsonb := '{}'; stat text;
  c public.characters%ROWTYPE; new_id uuid := gen_random_uuid(); start_node uuid;
  hp_max integer; cp_max integer; mp_max integer; base_ac integer;
  dex_mod integer; con_mod integer; int_mod integer; wis_mod integer;
  opaque jsonb; initial jsonb; snapshot jsonb; materials jsonb;
  created timestamptz := statement_timestamp();
BEGIN
  IF actor IS NULL OR _request IS NULL
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
  THEN RAISE EXCEPTION 'creation_not_authorized' USING ERRCODE='42501'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed'
  THEN RAISE EXCEPTION 'creation_requires_read_committed'; END IF;
  target := coalesce(_target,actor); delegated := target<>actor;
  IF name_display IS NULL OR name_display='' OR length(name_display)>40
    OR _race IS NULL OR _gender IS NULL OR _expected_revision IS NULL
    OR _gender NOT IN ('male','female') OR (NOT delegated AND reason IS NOT NULL)
  THEN RAISE EXCEPTION 'invalid_creation_request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(173201,hashtext(actor::text||':'||_request::text));
  FOR key IN SELECT DISTINCT hashtext(v::text) FROM unnest(ARRAY[actor,target]) v ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(173202,key);
  END LOOP;
  -- Hold identity rows against permanent account deletion; no Auth-row UPDATE.
  PERFORM id FROM auth.users WHERE id IN (actor,target) ORDER BY id FOR KEY SHARE;
  IF delegated THEN
    PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role='overlord'::public.app_role FOR SHARE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target)
    OR (delegated AND (reason IS NULL OR reason !~ '[^[:space:]]' OR NOT public.has_role(actor,'overlord'::public.app_role)))
  THEN RAISE EXCEPTION 'creation_not_authorized' USING ERRCODE='42501'; END IF;
  payload := jsonb_build_object('payloadVersion',1,'actor',actor,'target',target,
    'mode',CASE WHEN delegated THEN 'delegated' ELSE 'own' END,'name',name_display,
    'race',_race,'gender',_gender,'expectedRevision',_expected_revision,'reason',reason);
  request_digest := sha256(convert_to(payload::text,'UTF8'));
  SELECT * INTO prior FROM public.character_creation_log
    WHERE actor_id=actor AND request_id=_request FOR UPDATE;
  IF FOUND THEN
    IF prior.payload_version<>1 OR prior.target_account_id<>target OR prior.payload_digest<>request_digest
    THEN RAISE EXCEPTION 'creation_request_conflict' USING ERRCODE='22023'; END IF;
    IF prior.replay_status='purged' THEN
      RETURN jsonb_build_object('kind','purged','characterId',prior.result_character_id);
    END IF;
    SELECT applied_snapshot INTO snapshot FROM public.character_creation_origin
      WHERE character_id=prior.result_character_id;
    IF snapshot IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=prior.result_character_id AND user_id=target)
    THEN RAISE EXCEPTION 'creation_replay_result_missing'; END IF;
    RETURN jsonb_build_object('kind','applied','characterId',prior.result_character_id,
      'initial',snapshot->'initial','progressionVersion',0);
  END IF;
  IF _expected_revision<>manifest->'versions'->>'creation'
  THEN RAISE EXCEPTION 'creation_revision_unavailable'; END IF;
  IF (SELECT count(*) FROM public.characters WHERE user_id=target)>=5
  THEN RAISE EXCEPTION 'character_quota_reached'; END IF;
  race_delta := manifest->'races'->_race;
  IF race_delta IS NULL THEN RAISE EXCEPTION 'creation_race_unavailable'; END IF;
  -- Fixed catalog lock order; use approved pinned inputs, refuse mutable catalog drift.
  SELECT * INTO class_row FROM public.classes WHERE class_key='classless' FOR SHARE;
  IF NOT FOUND OR class_row.status IS DISTINCT FROM 'active' OR class_row.is_pre_class IS DISTINCT FROM true
    OR class_row.is_selectable IS DISTINCT FROM false
    OR class_row.base_hp IS DISTINCT FROM 18 OR class_row.base_ac IS DISTINCT FROM 10 OR class_row.level_bonuses IS DISTINCT FROM '{}'::jsonb
  THEN RAISE EXCEPTION 'creation_class_catalog_drift'; END IF;
  SELECT * INTO race_row FROM public.races WHERE race_key=_race FOR SHARE;
  IF NOT FOUND OR race_row.status IS DISTINCT FROM 'active' OR race_row.is_selectable IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'creation_race_unavailable'; END IF;
  actual_delta := jsonb_build_object('str',race_row.str,'dex',race_row.dex,'con',race_row.con,
    'int',race_row.int,'wis',race_row.wis,'cha',race_row.cha);
  IF actual_delta IS DISTINCT FROM race_delta THEN RAISE EXCEPTION 'creation_race_catalog_drift'; END IF;
  FOREACH stat IN ARRAY ARRAY['str','dex','con','int','wis','cha'] LOOP
    stats := stats||jsonb_build_object(stat,8+(race_delta->>stat)::integer);
  END LOOP;
  dex_mod:=floor(((stats->>'dex')::numeric-10)/2)::integer;
  con_mod:=floor(((stats->>'con')::numeric-10)/2)::integer;
  int_mod:=greatest(floor(((stats->>'int')::numeric-10)/2),0)::integer;
  wis_mod:=greatest(floor(((stats->>'wis')::numeric-10)/2),0)::integer;
  hp_max:=least(10000,greatest(1,18+2*con_mod));
  cp_max:=least(5000,greatest(0,30+3*(int_mod+wis_mod)));
  mp_max:=least(5000,greatest(0,100+10*greatest(dex_mod,0))); base_ac:=10+dex_mod;
  SELECT default_node_id INTO start_node FROM public.combat2_respawn_config WHERE singleton FOR SHARE;
  IF start_node IS NULL OR NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=start_node)
    OR EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=start_node)
  THEN RAISE EXCEPTION 'starting_location_unavailable'; END IF;
  INSERT INTO public.characters(id,user_id,name,race,class,gender,is_classless,level,xp,gold,
    str,dex,con,int,wis,cha,hp,max_hp,cp,max_cp,mp,max_mp,ac,current_node_id,
    family_id,family_name,family_changed_after_creation,unspent_stat_points,respec_points,bhp,bhp_trained,rp_total_earned,created_at)
  VALUES(new_id,target,name_display,_race,'classless',_gender::public.character_gender,true,1,0,200,
    (stats->>'str')::integer,(stats->>'dex')::integer,(stats->>'con')::integer,
    (stats->>'int')::integer,(stats->>'wis')::integer,(stats->>'cha')::integer,
    hp_max,hp_max,cp_max,cp_max,mp_max,mp_max,base_ac,start_node,NULL,NULL,false,0,0,0,'{}',0,created)
  RETURNING * INTO c;
  SELECT * INTO STRICT c FROM public.characters WHERE id=new_id FOR UPDATE;
  SELECT jsonb_object_agg(material_key,count) INTO materials FROM public.character_materials WHERE character_id=c.id;
  IF materials IS DISTINCT FROM manifest->'creation'->'materials'
    OR (SELECT count(*) FROM public.character_materials WHERE character_id=c.id)<>7
    OR EXISTS(SELECT 1 FROM public.character_inventory WHERE character_id=c.id)
    OR c.user_id IS DISTINCT FROM target OR c.name IS DISTINCT FROM name_display
    OR c.race IS DISTINCT FROM _race OR c.gender::text IS DISTINCT FROM _gender OR c.current_node_id IS DISTINCT FROM start_node
    OR c.created_at IS DISTINCT FROM created
    OR c.level IS DISTINCT FROM 1 OR c.xp IS DISTINCT FROM 0 OR c.gold IS DISTINCT FROM 200
    OR c.class IS DISTINCT FROM 'classless' OR c.is_classless IS DISTINCT FROM true
    OR c.family_id IS NOT NULL OR c.family_name IS NOT NULL OR c.family_changed_after_creation IS DISTINCT FROM false
    OR c.unspent_stat_points IS DISTINCT FROM 0 OR c.respec_points IS DISTINCT FROM 0 OR c.bhp IS DISTINCT FROM 0
    OR c.rp_total_earned IS DISTINCT FROM 0 OR c.bhp_trained IS DISTINCT FROM '{}'::jsonb
    OR jsonb_build_object('str',c.str,'dex',c.dex,'con',c.con,'int',c.int,'wis',c.wis,'cha',c.cha) IS DISTINCT FROM stats
    OR ROW(c.hp,c.max_hp,c.cp,c.max_cp,c.mp,c.max_mp,c.ac) IS DISTINCT FROM ROW(hp_max,hp_max,cp_max,cp_max,mp_max,mp_max,base_ac)
  THEN RAISE EXCEPTION 'creation_initialization_drift'; END IF;
  opaque:=jsonb_build_object('characterId',c.id,'level',c.level,'xp',c.xp,'classKey',c.class,'isClassless',c.is_classless,
    'permanentStats',stats,'renownBalance',c.bhp,'trainedRanks',c.bhp_trained,
    'unspentStatPoints',c.unspent_stat_points,'respecPoints',c.respec_points,
    'resources',jsonb_build_object('hp',c.hp,'cp',c.cp,'mp',c.mp,'maxHp',c.max_hp,'maxCp',c.max_cp,'maxMp',c.max_mp));
  INSERT INTO public.progression_character_state(character_id,version,opaque_baseline,
    str_invested,dex_invested,con_invested,int_invested,wis_invested,cha_invested)
    VALUES(c.id,0,opaque,0,0,0,0,0,0);
  IF EXISTS(SELECT 1 FROM public.progression_receipt WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.progression_respec_milestone WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.progression_class_growth_milestone WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.character_class_bonds WHERE character_id=c.id)
  THEN RAISE EXCEPTION 'creation_unexpected_progression_grants'; END IF;
  initial:=jsonb_build_object('level',1,'xp',0,'class','classless','is_classless',true,
    'attributes',stats,'gold',200,'resources',opaque->'resources','ac',base_ac,'currentNodeId',start_node,
    'unspentStatPoints',0,'respecPoints',0,'renownBalance',0,'renownTotal',0,'trainedRanks','{}'::jsonb,
    'family',NULL,'inventory','[]'::jsonb,'equipment','[]'::jsonb,'materials',materials,'createdAt',created);
  snapshot:=jsonb_build_object('choices',jsonb_build_object('name',name_display,'race',_race,'gender',_gender),
    'inputs',jsonb_build_object('baseAttributes',manifest->'creation'->'baseAttributes','raceDeltas',race_delta,
      'class',manifest->'class','formula',manifest->'formula'),
    'initial',initial,'progression',jsonb_build_object('version',0,'opaqueBaseline',opaque,
      'invested',jsonb_build_object('str',0,'dex',0,'con',0,'int',0,'wis',0,'cha',0),
      'growthMilestones','[]'::jsonb,'tokenMilestones','[]'::jsonb));
  INSERT INTO public.character_creation_origin VALUES(c.id,1,
    manifest->'versions'->>'creation',manifest->'versions'->>'race',
    manifest->'versions'->>'class',manifest->'versions'->>'formula',snapshot,created);
  INSERT INTO public.character_creation_log(log_id,actor_id,request_id,target_account_id,result_character_id,
    payload_version,payload_digest,replay_status,created_at,details_expires_at,detailed_receipt)
  VALUES(gen_random_uuid(),actor,_request,target,c.id,1,request_digest,'applied',created,
    ((created AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC',
    jsonb_build_object('actor',actor,'target',target,'mode',payload->'mode','reason',reason,
      'choices',snapshot->'choices','expectedRevision',_expected_revision,'payloadVersion',1,
      'resultCharacterId',c.id,'versions',manifest->'versions','initial',initial));
  RETURN jsonb_build_object('kind','applied','characterId',c.id,'initial',initial,'progressionVersion',0);
END
$creation$;
ALTER FUNCTION public.character_create_c2_internal(uuid,text,text,text,uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.character_create_c2_internal(uuid,text,text,text,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
-- Close any new-function default grants, without changing defaults or old objects.
DO $acl$
DECLARE grantee oid; fn oid:='public.character_create_c2_internal(uuid,text,text,text,uuid,text,text)'::regprocedure;
BEGIN
  FOR grantee IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a
    WHERE p.oid=fn AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.character_create_c2_internal(uuid,text,text,text,uuid,text,text) FROM %s',
      CASE WHEN grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grantee)) END);
  END LOOP;
  IF EXISTS(WITH RECURSIVE application_members(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
    UNION SELECT m.member FROM pg_auth_members m JOIN application_members a ON m.roleid=a.oid
  ) SELECT 1 FROM pg_roles r WHERE r.rolname<>'postgres'
    AND (NOT r.rolsuper OR r.oid IN (SELECT oid FROM application_members))
    AND has_function_privilege(r.oid,fn,'EXECUTE'))
  THEN RAISE EXCEPTION 'creation private function effective privilege leak'; END IF;
END
$acl$;
