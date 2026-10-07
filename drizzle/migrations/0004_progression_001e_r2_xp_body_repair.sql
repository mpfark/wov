-- ENG-PROGRESSION-001E-R2 PREPARED ONLY; NO HOSTED EXECUTION AUTHORIZED.
-- One future standard Drizzle transaction; no full 001E replay or standalone lifecycle.
-- Only public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) may change.
-- Canonical CRLF-to-LF prosrc SHA-256: 9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde
-- Known one-leading-space deviation SHA-256: 962c01151256ab2eec3b30ed3dbd2ba449d59745cf5ca8cf760911c1f502561d
-- No trimming/collapsing whitespace. Already-canonical identity also accepted for safe replay.
DO $r2$ DECLARE dep record; BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') NOT IN('962c01151256ab2eec3b30ed3dbd2ba449d59745cf5ca8cf760911c1f502561d','9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde')
 OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
 OR dep.prokind<>'f' OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_offered','_metadata']
 OR dep.pronargs<>5 OR dep.proargtypes IS DISTINCT FROM '2950 2950 25 1700 3802'::oidvector
 OR dep.proallargtypes IS NOT NULL OR dep.proargmodes IS NOT NULL OR dep.pronargdefaults<>1
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM '''{}''::jsonb'
 OR dep.proisstrict OR dep.proleakproof OR dep.proparallel<>'u' OR dep.procost<>100 OR dep.prorows<>0 OR dep.prosupport<>0
 OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='progression_apply_xp_internal')<>1
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(dep.proacl,acldefault('f',dep.proowner))) a WHERE a.grantee<>dep.proowner)
 OR EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname<>'postgres'
   AND (NOT role.rolsuper OR role.rolname IN('anon','authenticated','service_role'))
   AND has_function_privilege(role.oid,dep.oid,'EXECUTE'))
 THEN RAISE EXCEPTION '001E R2 precondition XP body/security/ACL drift'; END IF;
END $r2$;
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
ALTER FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) OWNER TO postgres;
ALTER FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) SECURITY DEFINER;
ALTER FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) SET search_path=pg_catalog,public;
REVOKE ALL ON FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) TO postgres;
DO $r2$ DECLARE dep record; BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') <>'9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde'
 OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
 OR dep.prokind<>'f' OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_offered','_metadata']
 OR dep.pronargs<>5 OR dep.proargtypes IS DISTINCT FROM '2950 2950 25 1700 3802'::oidvector
 OR dep.proallargtypes IS NOT NULL OR dep.proargmodes IS NOT NULL OR dep.pronargdefaults<>1
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM '''{}''::jsonb'
 OR dep.proisstrict OR dep.proleakproof OR dep.proparallel<>'u' OR dep.procost<>100 OR dep.prorows<>0 OR dep.prosupport<>0
 OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='progression_apply_xp_internal')<>1
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(dep.proacl,acldefault('f',dep.proowner))) a WHERE a.grantee<>dep.proowner)
 OR EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname<>'postgres'
   AND (NOT role.rolsuper OR role.rolname IN('anon','authenticated','service_role'))
   AND has_function_privilege(role.oid,dep.oid,'EXECUTE'))
 THEN RAISE EXCEPTION '001E R2 result XP body/security/ACL drift'; END IF;
END $r2$;