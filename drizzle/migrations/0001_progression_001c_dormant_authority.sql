-- Exact reviewed custom-SQL payload for Lovable's standard Drizzle tool.
-- NOT a discoverable migration; no journal entry exists for this preparation.
-- Dormant owner-only objects. No backfill, trigger, wrapper or gameplay call.
-- No AC/class/Renown/creation mutation, no change to existing CHECK constraints.

CREATE TABLE public.progression_character_state (
  character_id uuid PRIMARY KEY REFERENCES public.characters(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
  opaque_baseline jsonb NOT NULL CHECK(jsonb_typeof(opaque_baseline)='object'),
  str_invested integer NOT NULL DEFAULT 0 CHECK(str_invested>=0),
  dex_invested integer NOT NULL DEFAULT 0 CHECK(dex_invested>=0),
  con_invested integer NOT NULL DEFAULT 0 CHECK(con_invested>=0),
  int_invested integer NOT NULL DEFAULT 0 CHECK(int_invested>=0),
  wis_invested integer NOT NULL DEFAULT 0 CHECK(wis_invested>=0),
  cha_invested integer NOT NULL DEFAULT 0 CHECK(cha_invested>=0)
);
CREATE TABLE public.progression_receipt (
  character_id uuid NOT NULL REFERENCES public.progression_character_state(character_id) ON DELETE CASCADE,
  source text NOT NULL,
  event_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('xp','permanent')),
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY(character_id,source,event_id)
);
CREATE TABLE public.progression_respec_milestone (
  character_id uuid NOT NULL REFERENCES public.progression_character_state(character_id) ON DELETE CASCADE,
  level integer NOT NULL CHECK(level IN(10,20,30,40)),
  source text NOT NULL,
  event_id uuid NOT NULL,
  PRIMARY KEY(character_id,level),
  FOREIGN KEY(character_id,source,event_id) REFERENCES public.progression_receipt(character_id,source,event_id)
    DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.progression_character_state OWNER TO postgres;
ALTER TABLE public.progression_receipt OWNER TO postgres;
ALTER TABLE public.progression_respec_milestone OWNER TO postgres;
ALTER TABLE public.progression_character_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_respec_milestone ENABLE ROW LEVEL SECURITY;
-- No RLS policies: no browser/service access. Owner is the only ordinary caller.
REVOKE ALL ON public.progression_character_state, public.progression_receipt,
 public.progression_respec_milestone FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.progression_snapshot_internal(_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'progression_browser_context_forbidden'; END IF;
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character;
 RETURN jsonb_build_object('characterId',c.id,'level',c.level,'xp',c.xp,'classKey',c.class,'isClassless',c.is_classless,
  'permanentStats',jsonb_build_object('str',c.str,'dex',c.dex,'con',c.con,'int',c.int,'wis',c.wis,'cha',c.cha),
  'renownBalance',c.bhp,'trainedRanks',c.bhp_trained,'unspentStatPoints',c.unspent_stat_points,'respecPoints',c.respec_points,
  'resources',jsonb_build_object('hp',c.hp,'cp',c.cp,'mp',c.mp,'maxHp',c.max_hp,'maxCp',c.max_cp,'maxMp',c.max_mp));
END $$;

CREATE FUNCTION public.progression_class_config_internal(_class text, _classless boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cfg public.classes%ROWTYPE; k text; v jsonb; n numeric; b jsonb:='{}'; snapshot jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'progression_browser_context_forbidden'; END IF;
  IF _classless IS DISTINCT FROM (_class='classless') THEN RAISE EXCEPTION 'invalid_class_config'; END IF;
  SELECT * INTO cfg FROM public.classes WHERE class_key=_class;
  IF NOT FOUND OR cfg.base_hp<1 OR jsonb_typeof(cfg.level_bonuses) IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'invalid_class_config'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(cfg.level_bonuses) LOOP
    IF NOT k=ANY(ARRAY['str','dex','con','int','wis','cha']) OR jsonb_typeof(v)<>'number'
      THEN RAISE EXCEPTION 'invalid_class_config'; END IF;
    n:=v::text::numeric;
    IF n<>trunc(n) OR n<0 OR n>153391689 OR (_classless AND n<>0)
      THEN RAISE EXCEPTION 'invalid_class_config'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['str','dex','con','int','wis','cha'] LOOP
    b:=b || jsonb_build_object(k,COALESCE((cfg.level_bonuses->>k)::numeric,0)::integer);
  END LOOP;
  snapshot:=jsonb_build_object('class_key',_class,'is_classless',_classless,
    'level_bonuses',b,'base_hp',cfg.base_hp);
  RETURN snapshot || jsonb_build_object('fingerprint',encode(sha256(convert_to((snapshot-'base_hp')::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION public.character_sync_derived_internal(_character uuid, _level_gained boolean, _was_alive boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; cfg jsonb; h numeric; bc numeric; bi numeric; bw numeric; bd numeric;
  mh integer; mc integer; mm integer; ph integer; pc integer; pm integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'progression_browser_context_forbidden'; END IF;
  IF _level_gained IS NULL OR _was_alive IS NULL THEN RAISE EXCEPTION 'invalid_resource_policy'; END IF;
  SELECT * INTO STRICT c FROM public.characters WHERE id=_character FOR UPDATE;
  IF c.level NOT BETWEEN 1 AND 42 OR c.hp<0 OR c.cp<0 OR c.mp<0 THEN RAISE EXCEPTION 'invalid_resource_state'; END IF;
  PERFORM 1 FROM public.classes WHERE class_key=c.class FOR SHARE;
  BEGIN cfg:=public.progression_class_config_internal(c.class,c.is_classless);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='invalid_class_config' THEN
    RAISE;
   END IF; RAISE;
  END;
  -- Verified installed equipment fallback/gem policy. Numeric intermediates
  -- avoid int4 overflow before final verified caps; malformed JSON refuses.
  WITH equipped AS (
    SELECT COALESCE(NULLIF(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb) base,
      COALESCE(ci.applied_gems,'{}'::jsonb) gems
    FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=_character AND ci.equipped_slot IS NOT NULL AND ci.current_durability>0
  ) SELECT COALESCE(sum(COALESCE((base->>'hp')::integer,0)::numeric),0),
    COALESCE(sum(COALESCE((base->>'con')::integer,0)::numeric+COALESCE((gems->>'emerald')::integer,0)),0),
    COALESCE(sum(COALESCE((base->>'int')::integer,0)::numeric+COALESCE((gems->>'sapphire')::integer,0)),0),
    COALESCE(sum(COALESCE((base->>'wis')::integer,0)::numeric+COALESCE((gems->>'pearl')::integer,0)),0),
    COALESCE(sum(COALESCE((base->>'dex')::integer,0)::numeric+COALESCE((gems->>'topaz')::integer,0)),0)
    INTO h,bc,bi,bw,bd FROM equipped;
  mh:=least(greatest((cfg->>'base_hp')::numeric+2*floor((c.con::numeric+bc-10)/2)+5*(c.level-1)+h,1),10000)::integer;
  mc:=least(greatest(30+3*(c.level-1)+3*(greatest(floor((c.int::numeric+bi-10)/2),0)
    +greatest(floor((c.wis::numeric+bw-10)/2),0)),0),5000)::integer;
  mm:=least(greatest(100+10*greatest(floor((c.dex::numeric+bd-10)/2),0)+2*(c.level-1),0),5000)::integer;
  ph:=CASE WHEN NOT _was_alive THEN 0 WHEN _level_gained THEN mh ELSE least(c.hp,mh) END;
  pc:=least(c.cp,mc); pm:=least(c.mp,mm);
  UPDATE public.characters SET max_hp=mh,max_cp=mc,max_mp=mm,hp=ph,cp=pc,mp=pm WHERE id=_character;
  RETURN jsonb_build_object('hp',ph,'cp',pc,'mp',pm,'max_hp',mh,'max_cp',mc,'max_mp',mm);
END $$;

CREATE FUNCTION public.progression_apply_xp_internal(_character uuid, _event uuid, _source text,
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
 RETURN jsonb_build_object('kind','committed','receipt',r);
END $$;

CREATE FUNCTION public.progression_apply_permanent_delta_internal(_character uuid,_event uuid,_source text,
 _expected_version numeric,_deltas jsonb,_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE; old public.progression_receipt%ROWTYPE;
 req jsonb; d jsonb:='{}'; k text; v jsonb; n numeric; total bigint:=0; before jsonb; r jsonb; cfg jsonb;
 a integer; b integer; e integer; f integer; g integer; h integer;
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 IF _event IS NULL OR _character IS NULL OR _source IS NULL OR _source NOT IN('permanent_reward','discretionary_allocation')
  OR _expected_version IS NULL OR _expected_version<0 OR _expected_version>9007199254740991 OR _expected_version<>trunc(_expected_version) OR jsonb_typeof(_deltas) IS DISTINCT FROM 'object'
  OR jsonb_typeof(_metadata) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('kind','refused','reason','invalid_delta'); END IF;
 FOR k,v IN SELECT * FROM jsonb_each(_deltas) LOOP
  IF NOT k=ANY(ARRAY['str','dex','con','int','wis','cha']) OR jsonb_typeof(v)<>'number' THEN RETURN jsonb_build_object('kind','refused','reason','invalid_delta'); END IF;
  n:=v::text::numeric;
  IF n<>trunc(n) OR n<0 OR n>2147483647 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_delta'); END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['str','dex','con','int','wis','cha'] LOOP d:=d||jsonb_build_object(k,COALESCE((_deltas->>k)::numeric,0)::integer); END LOOP;
 req:=jsonb_build_object('operation','permanent','expectedVersion',_expected_version,'deltas',d,'metadata',_metadata,'contractVersion',1,'rulesVersion',1);
 SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','refused','reason','character_missing'); END IF;
 SELECT * INTO old FROM public.progression_receipt WHERE character_id=_character AND source=_source AND event_id=_event;
 IF FOUND THEN
  IF old.operation<>'permanent' OR old.request<>req THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','original',old.receipt);
 END IF;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 IF COALESCE(s.version,0)<>_expected_version THEN RETURN jsonb_build_object('kind','refused','reason','stale_version'); END IF;
 a:=(d->>'str')::int;b:=(d->>'dex')::int;e:=(d->>'con')::int;f:=(d->>'int')::int;g:=(d->>'wis')::int;h:=(d->>'cha')::int;
 total:=a::bigint+b+e+f+g+h;
 IF total=0 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_delta'); END IF;
 IF c.level NOT BETWEEN 1 AND 42 OR c.cp<0 OR c.mp<0 OR c.unspent_stat_points<0 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
 IF greatest(c.str::bigint+a,c.dex::bigint+b,c.con::bigint+e,c.int::bigint+f,c.wis::bigint+g,c.cha::bigint+h)>2147483647
  THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 IF _source='discretionary_allocation' AND total>c.unspent_stat_points THEN RETURN jsonb_build_object('kind','refused','reason','insufficient_points'); END IF;
 IF _source='discretionary_allocation' AND greatest(COALESCE(s.str_invested,0)::bigint+a,COALESCE(s.dex_invested,0)::bigint+b,
  COALESCE(s.con_invested,0)::bigint+e,COALESCE(s.int_invested,0)::bigint+f,COALESCE(s.wis_invested,0)::bigint+g,COALESCE(s.cha_invested,0)::bigint+h)>2147483647
  THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 PERFORM 1 FROM public.classes WHERE class_key=c.class FOR SHARE;
  BEGIN cfg:=public.progression_class_config_internal(c.class,c.is_classless);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='invalid_class_config' THEN
    RETURN jsonb_build_object('kind','refused','reason','invalid_class_config');
   END IF; RAISE;
  END;before:=public.progression_snapshot_internal(_character);
 INSERT INTO public.progression_character_state(character_id,opaque_baseline) VALUES(_character,before) ON CONFLICT DO NOTHING;
 UPDATE public.characters SET str=c.str+a,dex=c.dex+b,con=c.con+e,int=c.int+f,wis=c.wis+g,cha=c.cha+h,
  unspent_stat_points=c.unspent_stat_points-CASE WHEN _source='discretionary_allocation' THEN total::integer ELSE 0 END WHERE id=_character;
 PERFORM public.character_sync_derived_internal(_character,false,c.hp>0);
 UPDATE public.progression_character_state SET version=version+1,
  str_invested=str_invested+CASE WHEN _source='discretionary_allocation' THEN a ELSE 0 END,
  dex_invested=dex_invested+CASE WHEN _source='discretionary_allocation' THEN b ELSE 0 END,
  con_invested=con_invested+CASE WHEN _source='discretionary_allocation' THEN e ELSE 0 END,
  int_invested=int_invested+CASE WHEN _source='discretionary_allocation' THEN f ELSE 0 END,
  wis_invested=wis_invested+CASE WHEN _source='discretionary_allocation' THEN g ELSE 0 END,
  cha_invested=cha_invested+CASE WHEN _source='discretionary_allocation' THEN h ELSE 0 END WHERE character_id=_character;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=_character;
 SELECT * INTO c FROM public.characters WHERE id=_character;
 r:=jsonb_build_object('characterId',_character,'source',_source,'eventId',_event,'versionBefore',s.version-1,'versionAfter',s.version,
  'classConfig',cfg-'base_hp','resourceConfig',jsonb_build_object('class_key',c.class,'base_hp',cfg->'base_hp'),'permanentDeltas',d,'refundableInvestmentAfter',jsonb_build_object('str',s.str_invested,'dex',s.dex_invested,
  'con',s.con_invested,'int',s.int_invested,'wis',s.wis_invested,'cha',s.cha_invested),'before',before,'after',public.progression_snapshot_internal(_character));
 INSERT INTO public.progression_receipt VALUES(_character,_source,_event,'permanent',req,r);
 RETURN jsonb_build_object('kind','committed','receipt',r);
END $$;

ALTER FUNCTION public.progression_snapshot_internal(uuid) OWNER TO postgres;
ALTER FUNCTION public.progression_class_config_internal(text,boolean) OWNER TO postgres;
ALTER FUNCTION public.character_sync_derived_internal(uuid,boolean,boolean) OWNER TO postgres;
ALTER FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) OWNER TO postgres;
ALTER FUNCTION public.progression_apply_permanent_delta_internal(uuid,uuid,text,numeric,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.progression_snapshot_internal(uuid), public.progression_class_config_internal(text,boolean),
 public.character_sync_derived_internal(uuid,boolean,boolean),
 public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb),
 public.progression_apply_permanent_delta_internal(uuid,uuid,text,numeric,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
-- Strip any other inherited DEFAULT ACL's direct grants (sandbox/custom roles).
-- Administrator/superuser access is outside the ordinary gameplay boundary.
DO $$ DECLARE x record; g record; BEGIN
 FOR x IN SELECT p.oid,p.proowner,p.oid::regprocedure::text identity,p.proacl acl,'FUNCTION' kind FROM pg_proc p
  WHERE p.oid IN ('public.progression_snapshot_internal(uuid)'::regprocedure, 'public.progression_class_config_internal(text,boolean)'::regprocedure,
   'public.character_sync_derived_internal(uuid,boolean,boolean)'::regprocedure,
   'public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure,
   'public.progression_apply_permanent_delta_internal(uuid,uuid,text,numeric,jsonb,jsonb)'::regprocedure)
 UNION ALL SELECT c.oid,c.relowner,c.oid::regclass::text,c.relacl,'TABLE' FROM pg_class c
  WHERE c.oid IN ('public.progression_character_state'::regclass,'public.progression_receipt'::regclass,'public.progression_respec_milestone'::regclass)
 LOOP
  FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(x.acl,acldefault(CASE WHEN x.kind='FUNCTION' THEN 'f'::"char" ELSE 'r'::"char" END,x.proowner))) WHERE grantee<>x.proowner LOOP
   EXECUTE format('REVOKE ALL ON %s %s FROM %s',x.kind,x.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
  END LOOP;
 END LOOP;
END $$;
