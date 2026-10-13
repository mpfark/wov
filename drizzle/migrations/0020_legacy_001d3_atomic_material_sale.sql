-- Reviewed forward SQL; installation only through separately authorized standard Lovable/Drizzle workflow.
-- Prerequisites: reconcile consume_material body, ledger schema/retention, lifecycle triggers and int4 bounds.
CREATE FUNCTION public.material_sale_internal(_actor uuid, _character_id uuid, _key text, _amount integer, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $sale$
DECLARE
 c public.characters;
 m public.materials;
 prior public.character_inventory_action_request;
 args jsonb;
 gain bigint;
 new_gold integer;
 v_result jsonb;
 affected integer;
BEGIN
 IF _actor IS NULL OR _character_id IS NULL OR _request_id IS NULL OR _key IS NULL
    OR _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_sale_request'; END IF;
 args := jsonb_build_object('actor',_actor,'material_key',_key,'amount',_amount);
 PERFORM pg_advisory_xact_lock(hashtextextended('material_sale:'||_request_id::text,0));
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF NOT FOUND OR c.user_id IS DISTINCT FROM _actor OR c.deleted_at IS NOT NULL THEN
   RAISE EXCEPTION 'sale_target_not_authorized'; END IF;
 SELECT * INTO prior FROM public.character_inventory_action_request WHERE request_id=_request_id;
 IF FOUND THEN
   IF prior.character_id IS DISTINCT FROM _character_id OR prior.action IS DISTINCT FROM 'material_sale'
      OR prior.inventory_id IS NOT NULL OR prior.arguments IS DISTINCT FROM args THEN
     RAISE EXCEPTION 'request_id_conflict'; END IF;
   IF prior.result IS NULL THEN RAISE EXCEPTION 'request_pending'; END IF;
   RETURN prior.result || jsonb_build_object('gold_remaining',c.gold,'replayed',true);
 END IF;
 SELECT * INTO m FROM public.materials WHERE key=_key FOR SHARE;
 IF NOT FOUND OR NOT COALESCE(m.tradeable,false) THEN RAISE EXCEPTION 'material_not_tradeable'; END IF;
 gain := (CASE WHEN _key='salvage' THEN 1 ELSE GREATEST(0,COALESCE(m.value,0)) END)::bigint * _amount::bigint;
 IF gain <= 0 OR c.gold IS NULL OR c.gold < 0 OR c.gold::bigint + gain > 2147483647 THEN
   RAISE EXCEPTION 'sale_gold_bounds'; END IF;
 INSERT INTO public.character_inventory_action_request(request_id,character_id,action,inventory_id,arguments)
 VALUES(_request_id,_character_id,'material_sale',NULL,args);
 -- Lock/validate the exact owned row and verify the helper's actual effect, not just transport success.
 PERFORM 1 FROM public.character_materials WHERE character_id=_character_id AND material_key=_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_materials'; END IF;
 DECLARE before_count integer; after_count integer;
 BEGIN
   SELECT count INTO before_count FROM public.character_materials WHERE character_id=_character_id AND material_key=_key;
   IF before_count IS NULL OR before_count < _amount THEN RAISE EXCEPTION 'insufficient_materials'; END IF;
   IF public.consume_material(_character_id,_key,_amount) IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'material_consume_refused'; END IF;
   SELECT count INTO after_count FROM public.character_materials WHERE character_id=_character_id AND material_key=_key;
   IF after_count IS DISTINCT FROM before_count - _amount THEN RAISE EXCEPTION 'material_consume_drift'; END IF;
 END;
 UPDATE public.characters SET gold=gold+gain::integer WHERE id=_character_id RETURNING gold INTO new_gold;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 OR new_gold::bigint IS DISTINCT FROM c.gold::bigint+gain THEN RAISE EXCEPTION 'sale_credit_failed'; END IF;
 v_result := jsonb_build_object('gold_remaining',new_gold,'gold_gained',gain,'amount_sold',_amount,
   'material_key',_key,'material_name',m.name,'replayed',false);
 UPDATE public.character_inventory_action_request SET result=v_result WHERE request_id=_request_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'sale_receipt_failed'; END IF;
 RETURN v_result;
END;
$sale$;
ALTER FUNCTION public.material_sale_internal(uuid,uuid,text,integer,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.material_sale_internal(uuid,uuid,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.material_sale_internal(uuid,uuid,text,integer,uuid) TO service_role;
DO $acl$
BEGIN
 IF has_function_privilege('anon','public.material_sale_internal(uuid,uuid,text,integer,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.material_sale_internal(uuid,uuid,text,integer,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.material_sale_internal(uuid,uuid,text,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'material_sale_authority_drift'; END IF;
END $acl$;
