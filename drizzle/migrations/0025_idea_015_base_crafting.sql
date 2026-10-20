-- WOV-IDEA-015: reviewed forward custom SQL. Drizzle owns the outer transaction.
-- No historical migration replay. Install before Edge, then Mik's frontend Publish.
DO $guard$
DECLARE dep record;
BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM
    '9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde'
 OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(dep.proacl,acldefault('f',dep.proowner))) a WHERE a.grantee<>dep.proowner)
 OR has_function_privilege('authenticated',dep.oid,'EXECUTE')
 OR has_function_privilege('anon',dep.oid,'EXECUTE')
 OR has_function_privilege('service_role',dep.oid,'EXECUTE')
 THEN RAISE EXCEPTION 'craft_progression_dependency_drift'; END IF;
 IF to_regprocedure('public.base_craft_internal(uuid,uuid,uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'craft_function_already_exists_reconcile_first'; END IF;
 PERFORM 'public.character_inventory_action_request'::regclass;
END $guard$;

CREATE FUNCTION public.base_craft_internal(_actor uuid,_character_id uuid,_item_id uuid,_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $craft$
DECLARE c public.characters; i public.items; n public.nodes;
 prior public.character_inventory_action_request; args jsonb; xp_result jsonb; v_result jsonb;
 item_level integer; minimum_level integer; salvage_cost integer; gold_cost integer;
 inventory_uuid uuid; remaining_gold integer; affected integer;
BEGIN
 IF _actor IS NULL OR _character_id IS NULL OR _item_id IS NULL OR _completion_id IS NULL
 OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'invalid_craft_request'; END IF;
 args:=jsonb_build_object('actor',_actor,'item_id',_item_id,'contract_version',1);
 PERFORM pg_advisory_xact_lock(hashtextextended('base_craft:'||_completion_id::text,0));
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF NOT FOUND OR c.user_id IS DISTINCT FROM _actor THEN RAISE EXCEPTION 'craft_not_authorized'; END IF;
 SELECT * INTO prior FROM public.character_inventory_action_request WHERE request_id=_completion_id;
 IF FOUND THEN
  IF prior.character_id IS DISTINCT FROM _character_id OR prior.action IS DISTINCT FROM 'base_craft'
   OR prior.inventory_id IS NOT NULL OR prior.arguments IS DISTINCT FROM args
  THEN RAISE EXCEPTION 'request_id_conflict'; END IF;
  IF prior.result IS NULL THEN RAISE EXCEPTION 'request_pending'; END IF;
  RETURN prior.result || jsonb_build_object('gold_remaining',c.gold,'replayed',true);
 END IF;
 -- A missing action receipt must not make an already-used canonical completion reusable.
 IF EXISTS(SELECT 1 FROM public.progression_receipt WHERE character_id=_character_id
  AND source='craft_completion' AND event_id=_completion_id)
 THEN RAISE EXCEPTION 'request_id_conflict'; END IF;
 -- All explicit craft_* refusals below follow the completed-receipt lookup.
 IF c.deleted_at IS NOT NULL OR c.hp IS NULL OR c.hp<=0 OR c.level NOT BETWEEN 1 AND 42
 THEN RAISE EXCEPTION 'craft_inactive'; END IF;
 SELECT * INTO i FROM public.items WHERE id=_item_id FOR SHARE;
 IF NOT FOUND OR i.origin_type IS DISTINCT FROM 'plain_base' OR i.rarity IS DISTINCT FROM 'common'
 OR COALESCE(i.tier,1) NOT BETWEEN 1 AND 5
 OR i.slot IS NULL OR i.slot::text NOT IN('main_hand','off_hand','head','chest','gloves','pants','ring','trinket')
 THEN RAISE EXCEPTION 'craft_item_ineligible'; END IF;
 i.tier:=COALESCE(i.tier,1); -- Historical plain-base NULL tier means tier 1.
 minimum_level:=CASE i.tier WHEN 1 THEN 1 ELSE (i.tier-1)*10 END;
 item_level:=CASE i.tier WHEN 1 THEN 1 ELSE (i.tier-1)*10+1 END;
 IF c.level<minimum_level THEN RAISE EXCEPTION 'craft_tier_locked'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=c.current_node_id FOR SHARE;
 IF NOT FOUND OR (CASE WHEN i.slot::text IN('ring','trinket') THEN NOT COALESCE(n.is_jewelcrafter,false)
  ELSE NOT COALESCE(n.is_blacksmith,false) END) THEN RAISE EXCEPTION 'craft_wrong_station'; END IF;
 salvage_cost:=5+2*item_level; gold_cost:=5*item_level;
 IF c.gold IS NULL OR c.gold<gold_cost THEN RAISE EXCEPTION 'craft_insufficient_gold'; END IF;
 INSERT INTO public.character_inventory_action_request(request_id,character_id,action,inventory_id,arguments)
 VALUES(_completion_id,_character_id,'base_craft',NULL,args);
 -- Character lock serializes supported resource/progression/inventory operations.
 -- Conditional arithmetic also prevents partial consumption/negative counts.
 UPDATE public.character_materials SET count=count-salvage_cost
 WHERE character_id=_character_id AND material_key='salvage' AND count>=salvage_cost;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'craft_insufficient_materials'; END IF;
 UPDATE public.characters SET gold=gold-gold_cost WHERE id=_character_id AND gold>=gold_cost RETURNING gold INTO remaining_gold;
 IF NOT FOUND OR remaining_gold IS DISTINCT FROM c.gold-gold_cost THEN RAISE EXCEPTION 'craft_debit_failed'; END IF;
 INSERT INTO public.character_inventory(character_id,item_id,current_durability,applied_gems,stat_override,crafted_level)
 VALUES(_character_id,_item_id,100,'{}','{}',item_level) RETURNING id INTO inventory_uuid;
 xp_result:=public.progression_apply_xp_internal(_character_id,_completion_id,'craft_completion',25,
  jsonb_build_object('completionId',_completion_id,'itemId',_item_id,'inventoryId',inventory_uuid));
 -- A replay without a craft receipt means contradictory pre-existing provenance; roll everything back.
 IF xp_result->>'kind' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'craft_progression_refused'; END IF;
 v_result:=jsonb_build_object('craft_outcome','committed','completion_id',_completion_id,'item_id',_item_id,
  'inventory_id',inventory_uuid,'base_name',i.name,'crafted_level',item_level,'gold_remaining',remaining_gold,
  'salvage_spent',salvage_cost,'xp_offered',25,'xp_awarded',(xp_result->'receipt'->>'appliedXp')::integer,
  'xp_result',xp_result,'replayed',false);
 -- Qualify the local result to avoid PL/pgSQL column ambiguity.
 UPDATE public.character_inventory_action_request r SET result=v_result WHERE r.request_id=_completion_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'craft_receipt_failed'; END IF;
 RETURN v_result;
END $craft$;
ALTER FUNCTION public.base_craft_internal(uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.base_craft_internal(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.base_craft_internal(uuid,uuid,uuid,uuid) TO service_role;
DO $acl$ BEGIN
 IF has_function_privilege('anon','public.base_craft_internal(uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.base_craft_internal(uuid,uuid,uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.base_craft_internal(uuid,uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'craft_authority_drift'; END IF;
END $acl$;
