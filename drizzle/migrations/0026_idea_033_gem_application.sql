-- WOV-IDEA-033: forward custom SQL, NOT INSTALLED. Drizzle owns the outer transaction.
DO $guard$
DECLARE dep record;
BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM
 '9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde'
 OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(dep.proacl,acldefault('f',dep.proowner))) a WHERE a.grantee<>dep.proowner)
 OR has_function_privilege('anon',dep.oid,'EXECUTE') OR has_function_privilege('authenticated',dep.oid,'EXECUTE')
 OR has_function_privilege('service_role',dep.oid,'EXECUTE')
 THEN RAISE EXCEPTION 'gem_progression_dependency_drift'; END IF;
 IF to_regprocedure('public.gem_application_internal(uuid,uuid,uuid,text,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'gem_function_exists_reconcile_first'; END IF;
 -- Full installed derived-resource identity and trigger/lock composition are preflight gates.
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.character_sync_derived_internal(uuid,boolean,boolean)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM
 '08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d'
 OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.prorettype<>'jsonb'::regtype
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(dep.proacl,acldefault('f',dep.proowner))) a WHERE a.grantee<>dep.proowner)
 THEN RAISE EXCEPTION 'gem_resource_dependency_drift'; END IF;
END $guard$;

CREATE FUNCTION public.gem_application_internal(_actor uuid,_character_id uuid,_inventory_id uuid,_gem_key text,_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $gem$
DECLARE c public.characters; inv public.character_inventory; item public.items; station public.nodes;
 prior public.character_inventory_action_request; args jsonb; v_result jsonb; xp_result jsonb;
 coverage jsonb; original_coverage jsonb; stage integer; locked_id uuid;
 attr text; key text; val jsonb; amount numeric; stats jsonb; gems jsonb; after_stats jsonb;
 item_level integer; salvage_cost integer; gold_cost integer; remaining_gold integer; affected integer;
 budget numeric; used numeric:=0; cap numeric; multiplier numeric; taper numeric;
BEGIN
 IF _actor IS NULL OR _character_id IS NULL OR _inventory_id IS NULL OR _completion_id IS NULL OR _gem_key IS NULL
 OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'invalid_gem_request'; END IF;
 args:=jsonb_build_object('actor',_actor,'gem_key',_gem_key,'contract_version',1);
 PERFORM pg_advisory_xact_lock(hashtextextended('gem_application:'||_completion_id::text,0));
 SELECT * INTO c FROM public.characters WHERE id=_character_id;
 IF NOT FOUND OR c.user_id IS DISTINCT FROM _actor THEN RAISE EXCEPTION 'gem_not_authorized'; END IF;
 -- Replay before mutable costs, station, item, combat and inventory checks.
 SELECT * INTO prior FROM public.character_inventory_action_request WHERE request_id=_completion_id;
 IF FOUND THEN
  IF prior.character_id IS DISTINCT FROM _character_id OR prior.action IS DISTINCT FROM 'gem_application'
   OR prior.inventory_id IS DISTINCT FROM _inventory_id OR prior.arguments IS DISTINCT FROM args
  THEN RAISE EXCEPTION 'request_id_conflict'; END IF;
  IF prior.result IS NULL THEN RAISE EXCEPTION 'request_pending'; END IF;
  RETURN prior.result||jsonb_build_object('gold_remaining',c.gold,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.progression_receipt WHERE character_id=_character_id
  AND source='craft_completion' AND event_id=_completion_id) THEN RAISE EXCEPTION 'request_id_conflict'; END IF;

 -- F6 coverage discipline: discover, lock nodes, revalidate, lock encounters/character, revalidate.
 -- No party mutation and no late node locks. Historical live claims are included even off-node.
 FOR stage IN 0..2 LOOP
  WITH relevant AS (
   SELECT e.id,e.node_id FROM public.node_encounter e
   WHERE (e.node_id=(SELECT current_node_id FROM public.characters WHERE id=_character_id)
     OR EXISTS(SELECT 1 FROM public.node_fighter f WHERE f.encounter_id=e.id AND f.character_id=_character_id))
    AND (e.status='active' OR (e.claim_token IS NOT NULL AND e.claim_expires_at>clock_timestamp()))
  ), nodes AS (
   SELECT current_node_id id FROM public.characters WHERE id=_character_id AND current_node_id IS NOT NULL
   UNION SELECT node_id FROM relevant WHERE node_id IS NOT NULL
  ) SELECT jsonb_build_object('node',(SELECT current_node_id FROM public.characters WHERE id=_character_id),
    'encounters',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM relevant r),'[]'::jsonb),
    'nodes',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM nodes),'[]'::jsonb)) INTO coverage;
  IF stage=0 THEN
   original_coverage:=coverage;
   FOR locked_id IN SELECT value::uuid FROM jsonb_array_elements_text(coverage->'nodes') ORDER BY value::uuid LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_id::text,0));
   END LOOP;
  ELSE
   IF coverage IS DISTINCT FROM original_coverage THEN RAISE EXCEPTION 'gem_coverage_changed'; END IF;
   IF stage=1 THEN
    PERFORM 1 FROM public.node_encounter e WHERE e.id IN
      (SELECT (value->>'id')::uuid FROM jsonb_array_elements(coverage->'encounters')) ORDER BY e.id FOR UPDATE;
    SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
    IF NOT FOUND OR c.user_id IS DISTINCT FROM _actor THEN RAISE EXCEPTION 'gem_not_authorized'; END IF;
   END IF;
  END IF;
 END LOOP;
 IF c.deleted_at IS NOT NULL OR c.hp IS NULL OR c.hp<=0 OR c.level NOT BETWEEN 1 AND 42
 THEN RAISE EXCEPTION 'gem_inactive'; END IF;
 IF c.movement_locked_until>clock_timestamp() THEN RAISE EXCEPTION 'gem_movement_pending'; END IF;
 IF EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
  WHERE f.character_id=c.id AND ((e.claim_token IS NOT NULL AND e.claim_expires_at>clock_timestamp())
    OR (f.present AND e.status='active' AND EXISTS(SELECT 1 FROM public.node_creature nc
      WHERE nc.encounter_id=e.id AND nc.is_alive AND nc.hp>0 AND nc.engaged))))
 THEN RAISE EXCEPTION 'gem_combat_active'; END IF;
 attr:=CASE _gem_key WHEN 'garnet' THEN 'str' WHEN 'topaz' THEN 'dex' WHEN 'emerald' THEN 'con'
  WHEN 'sapphire' THEN 'int' WHEN 'pearl' THEN 'wis' WHEN 'amethyst' THEN 'cha' END;
 IF attr IS NULL THEN RAISE EXCEPTION 'gem_invalid_key'; END IF;
 SELECT * INTO inv FROM public.character_inventory WHERE id=_inventory_id AND character_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'gem_item_not_owned'; END IF;
 SELECT * INTO item FROM public.items WHERE id=inv.item_id FOR SHARE;
 IF NOT FOUND OR item.item_type::text IS DISTINCT FROM 'equipment' OR COALESCE(item.is_soulbound,false)
  OR item.rarity IS NULL OR item.rarity::text IN('unique','soulforged') OR item.slot IS NULL
  OR item.slot::text NOT IN('main_hand','off_hand','head','chest','gloves','pants','ring','trinket')
 THEN RAISE EXCEPTION 'gem_item_ineligible'; END IF;
 SELECT * INTO station FROM public.nodes WHERE id=c.current_node_id FOR SHARE;
 IF NOT FOUND OR (CASE WHEN item.slot::text IN('ring','trinket') THEN NOT COALESCE(station.is_jewelcrafter,false)
  ELSE NOT COALESCE(station.is_blacksmith,false) END) THEN RAISE EXCEPTION 'gem_wrong_station'; END IF;
 item_level:=COALESCE(inv.crafted_level,item.level,1);
 IF item_level<1 OR item_level::bigint*2>2147483647 THEN RAISE EXCEPTION 'gem_cost_bounds'; END IF;
 -- Preserve the existing gem/UI formulas, including hands=1 and explicit {} override semantics.
 multiplier:=CASE WHEN item.rarity::text='uncommon' THEN 1.5 ELSE 1 END;
 taper:=CASE WHEN item_level<=30 THEN 1 WHEN item_level<=35 THEN 0.90 WHEN item_level<=40 THEN 0.80 ELSE 0.72 END;
 budget:=greatest(2,floor((2+(item_level-1)*0.24*multiplier)*taper)
   +CASE WHEN item.rarity::text='uncommon' AND item_level>=30 THEN 1 ELSE 0 END);
 cap:=least(CASE WHEN item_level<=28 THEN 4+floor(item_level::numeric/4)
   WHEN item_level<=40 THEN 11+floor((item_level-28)::numeric/6) ELSE 13 END,greatest(1,floor(budget*0.6)));
 stats:=COALESCE(inv.stat_override,item.stats,'{}'::jsonb); gems:=COALESCE(inv.applied_gems,'{}'::jsonb);
 IF jsonb_typeof(stats) IS DISTINCT FROM 'object' OR jsonb_typeof(gems) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'gem_invalid_item_stats'; END IF;
 FOR key,val IN SELECT * FROM jsonb_each(stats) LOOP
  IF jsonb_typeof(val)<>'number' THEN RAISE EXCEPTION 'gem_invalid_item_stats'; END IF;
  amount:=val::text::numeric;
  IF amount<0 OR amount>2147483647 THEN RAISE EXCEPTION 'gem_invalid_item_stats'; END IF;
 END LOOP;
 after_stats:=stats;
 FOR key,val IN SELECT * FROM jsonb_each(gems) LOOP
  IF jsonb_typeof(val)<>'number' THEN RAISE EXCEPTION 'gem_invalid_item_stats'; END IF;
  amount:=val::text::numeric;
  IF amount<0 OR amount<>trunc(amount) OR amount>2147483646 THEN RAISE EXCEPTION 'gem_invalid_item_stats'; END IF;
  key:=CASE key WHEN 'garnet' THEN 'str' WHEN 'topaz' THEN 'dex' WHEN 'emerald' THEN 'con'
    WHEN 'sapphire' THEN 'int' WHEN 'pearl' THEN 'wis' WHEN 'amethyst' THEN 'cha' END;
  IF key IS NOT NULL THEN after_stats:=jsonb_set(after_stats,ARRAY[key],to_jsonb(COALESCE((after_stats->>key)::numeric,0)+amount)); END IF;
 END LOOP;
 after_stats:=jsonb_set(after_stats,ARRAY[attr],to_jsonb(COALESCE((after_stats->>attr)::numeric,0)+1));
 IF (after_stats->>attr)::numeric>cap THEN RAISE EXCEPTION 'gem_stat_cap'; END IF;
 FOR key,val IN SELECT * FROM jsonb_each(after_stats) LOOP
  used:=used+val::text::numeric*CASE key WHEN 'ac' THEN 3 WHEN 'hp' THEN 0.5 WHEN 'hp_regen' THEN 2 ELSE 1 END;
 END LOOP;
 IF used>budget THEN RAISE EXCEPTION 'gem_stat_budget'; END IF;
 salvage_cost:=2+item_level; gold_cost:=2*item_level;
 IF c.gold IS NULL OR c.gold<gold_cost THEN RAISE EXCEPTION 'gem_insufficient_gold'; END IF;
 INSERT INTO public.character_inventory_action_request(request_id,character_id,action,inventory_id,arguments)
 VALUES(_completion_id,c.id,'gem_application',inv.id,args);
 -- Deterministic material row ordering; no helper RPCs or compensating refunds.
 PERFORM 1 FROM public.character_materials WHERE character_id=c.id AND material_key IN(_gem_key,'salvage') ORDER BY material_key FOR UPDATE;
 UPDATE public.character_materials SET count=count-1 WHERE character_id=c.id AND material_key=_gem_key AND count>=1;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'gem_missing_gem'; END IF;
 UPDATE public.character_materials SET count=count-salvage_cost WHERE character_id=c.id AND material_key='salvage' AND count>=salvage_cost;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'gem_insufficient_materials'; END IF;
 UPDATE public.characters SET gold=gold-gold_cost WHERE id=c.id AND gold>=gold_cost RETURNING gold INTO remaining_gold;
 IF NOT FOUND OR remaining_gold IS DISTINCT FROM c.gold-gold_cost THEN RAISE EXCEPTION 'gem_debit_failed'; END IF;
 gems:=jsonb_set(gems,ARRAY[_gem_key],to_jsonb(COALESCE((gems->>_gem_key)::integer,0)+1));
 UPDATE public.character_inventory SET applied_gems=gems WHERE id=inv.id;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'gem_update_failed'; END IF;
 -- No full heal merely for an equipment maximum increase. Existing triggers still execute.
 IF inv.equipped_slot IS NOT NULL THEN PERFORM public.character_sync_derived_internal(c.id,false,c.hp>0); END IF;
 xp_result:=public.progression_apply_xp_internal(c.id,_completion_id,'craft_completion',25,
  jsonb_build_object('completionId',_completion_id,'inventoryId',inv.id,'gemKey',_gem_key,'operation','gem_application'));
 IF xp_result->>'kind' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'gem_progression_refused'; END IF;
 v_result:=jsonb_build_object('gem_outcome','committed','completion_id',_completion_id,'inventory_id',inv.id,
  'gem_used',_gem_key,'applied_gems',gems,'effective_stats',after_stats,'level',item_level,'budget_used',used,
  'budget_max',budget,'gold_remaining',remaining_gold,'salvage_spent',salvage_cost,'xp_offered',25,
  'xp_awarded',(xp_result->'receipt'->>'appliedXp')::integer,'replayed',false);
 UPDATE public.character_inventory_action_request r SET result=v_result WHERE request_id=_completion_id;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'gem_receipt_failed'; END IF;
 RETURN v_result;
END $gem$;
ALTER FUNCTION public.gem_application_internal(uuid,uuid,uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gem_application_internal(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gem_application_internal(uuid,uuid,uuid,text,uuid) TO service_role;
DO $acl$ BEGIN
 IF has_function_privilege('anon','public.gem_application_internal(uuid,uuid,uuid,text,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.gem_application_internal(uuid,uuid,uuid,text,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.gem_application_internal(uuid,uuid,uuid,text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'gem_authority_drift'; END IF;
END $acl$;
