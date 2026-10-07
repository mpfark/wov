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
