-- Atomic, stale-state-fenced Batch Node Editor mutations. Only region_id and area_id are supported.
-- Lock order: durable request row, then all affected node rows ordered by UUID; updates use the same order.
CREATE TABLE public.admin_batch_node_request(request_id uuid PRIMARY KEY,caller_id uuid NOT NULL,mutations jsonb,result jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.admin_batch_node_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_batch_node_request FROM PUBLIC,anon,authenticated;
REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_batch_node_request FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_mutate_nodes_batch(_request_id uuid,_mutations jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller uuid:=auth.uid();prior public.admin_batch_node_request%ROWTYPE;m jsonb;n public.nodes%ROWTYPE;ids uuid[];stale_ids uuid[]:='{}';missing_ids uuid[]:='{}';final_region uuid;final_area uuid;response jsonb;updated integer:=0;
BEGIN
 IF caller IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authenticated');END IF;
 IF NOT public.is_steward_or_overlord() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized');END IF;
 IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request');END IF;
 INSERT INTO public.admin_batch_node_request VALUES(_request_id,caller,_mutations,NULL,clock_timestamp()) ON CONFLICT(request_id)DO NOTHING;
 SELECT * INTO prior FROM public.admin_batch_node_request WHERE request_id=_request_id FOR UPDATE;
 IF prior.caller_id IS DISTINCT FROM caller OR prior.mutations IS DISTINCT FROM _mutations THEN RETURN jsonb_build_object('ok',false,'kind','request_conflict');END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result||jsonb_build_object('replayed',true);END IF;
 IF jsonb_typeof(_mutations)IS DISTINCT FROM'array' OR jsonb_array_length(_mutations)<1 OR jsonb_array_length(_mutations)>100 THEN response:=jsonb_build_object('ok',false,'kind','invalid_request');END IF;
 IF response IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(_mutations)e WHERE jsonb_typeof(e)<>'object' OR (SELECT array_agg(k ORDER BY k)FROM jsonb_object_keys(e)k)<>ARRAY['changes','expected_state','node_id']::text[] OR jsonb_typeof(e->'node_id')<>'string' OR (e->>'node_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(e->'expected_state')<>'object' OR jsonb_typeof(e->'changes')<>'object' OR e->'changes'='{}'::jsonb)THEN response:=jsonb_build_object('ok',false,'kind','invalid_request');END IF;
 IF response IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(_mutations)e,jsonb_object_keys(e->'changes')k WHERE k NOT IN('region_id','area_id'))THEN response:=jsonb_build_object('ok',false,'kind','unsupported_field');END IF;
 IF response IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(_mutations)e WHERE (e->'changes'?'region_id' AND jsonb_typeof(e->'changes'->'region_id')<>'string') OR (e->'changes'?'area_id' AND jsonb_typeof(e->'changes'->'area_id')NOT IN('string','null')))THEN response:=jsonb_build_object('ok',false,'kind','invalid_request');END IF;
 IF response IS NULL THEN SELECT array_agg((e->>'node_id')::uuid ORDER BY(e->>'node_id')::uuid)INTO ids FROM jsonb_array_elements(_mutations)e;IF cardinality(ids)<>cardinality(ARRAY(SELECT DISTINCT unnest(ids))) OR ids<>ARRAY(SELECT(e->>'node_id')::uuid FROM jsonb_array_elements(_mutations)e)THEN response:=jsonb_build_object('ok',false,'kind','invalid_request');END IF;END IF;
 IF response IS NULL THEN
  PERFORM id FROM public.nodes WHERE id=ANY(ids)ORDER BY id FOR UPDATE;
  SELECT coalesce(array_agg(x),'{}')INTO missing_ids FROM unnest(ids)x WHERE NOT EXISTS(SELECT 1 FROM public.nodes n0 WHERE n0.id=x);
  IF cardinality(missing_ids)>0 THEN response:=jsonb_build_object('ok',false,'kind','node_not_found','node_ids',to_jsonb(missing_ids));END IF;
 END IF;
 IF response IS NULL THEN
  FOR m IN SELECT value FROM jsonb_array_elements(_mutations)ORDER BY value->>'node_id' LOOP
   SELECT * INTO n FROM public.nodes WHERE id=(m->>'node_id')::uuid;
   IF (to_jsonb(n)-'created_at')<>(m->'expected_state') THEN stale_ids:=array_append(stale_ids,n.id);CONTINUE;END IF;
   BEGIN final_region:=CASE WHEN m->'changes'?'region_id'THEN(m->'changes'->>'region_id')::uuid ELSE n.region_id END;final_area:=CASE WHEN NOT(m->'changes'?'area_id')THEN n.area_id WHEN m->'changes'->'area_id'='null'::jsonb THEN NULL ELSE(m->'changes'->>'area_id')::uuid END;EXCEPTION WHEN invalid_text_representation THEN response:=jsonb_build_object('ok',false,'kind','invalid_request');EXIT;END;
   IF NOT EXISTS(SELECT 1 FROM public.regions r WHERE r.id=final_region)THEN response:=jsonb_build_object('ok',false,'kind','reference_not_found');EXIT;END IF;
   IF final_area IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.areas a WHERE a.id=final_area)THEN response:=jsonb_build_object('ok',false,'kind','reference_not_found');EXIT;END IF;
   IF final_area IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.areas a WHERE a.id=final_area AND a.region_id=final_region)THEN response:=jsonb_build_object('ok',false,'kind','inconsistent_region_area');EXIT;END IF;
  END LOOP;
  IF response IS NULL AND cardinality(stale_ids)>0 THEN response:=jsonb_build_object('ok',false,'kind','stale_node_state','node_ids',to_jsonb(stale_ids));END IF;
 END IF;
 IF response IS NULL THEN
  PERFORM r.id FROM public.regions r WHERE r.id IN(SELECT DISTINCT CASE WHEN e->'changes'?'region_id'THEN(e->'changes'->>'region_id')::uuid ELSE(e->'expected_state'->>'region_id')::uuid END FROM jsonb_array_elements(_mutations)e)ORDER BY r.id FOR KEY SHARE;
  PERFORM a.id FROM public.areas a WHERE a.id IN(SELECT DISTINCT CASE WHEN NOT(e->'changes'?'area_id')THEN(e->'expected_state'->>'area_id')::uuid WHEN e->'changes'->'area_id'='null'::jsonb THEN NULL ELSE(e->'changes'->>'area_id')::uuid END FROM jsonb_array_elements(_mutations)e)ORDER BY a.id FOR KEY SHARE;
 END IF;
 IF response IS NULL THEN BEGIN
  FOR m IN SELECT value FROM jsonb_array_elements(_mutations)ORDER BY value->>'node_id' LOOP UPDATE public.nodes SET region_id=CASE WHEN m->'changes'?'region_id'THEN(m->'changes'->>'region_id')::uuid ELSE region_id END,area_id=CASE WHEN NOT(m->'changes'?'area_id')THEN area_id WHEN m->'changes'->'area_id'='null'::jsonb THEN NULL ELSE(m->'changes'->>'area_id')::uuid END WHERE id=(m->>'node_id')::uuid;updated:=updated+1;END LOOP;
  response:=jsonb_build_object('ok',true,'kind','updated','updated_count',updated,'replayed',false);
 EXCEPTION WHEN OTHERS THEN response:=jsonb_build_object('ok',false,'kind','database_error');END;END IF;
 UPDATE public.admin_batch_node_request SET result=response WHERE request_id=_request_id;RETURN response;
END;$$;
REVOKE ALL ON FUNCTION public.admin_mutate_nodes_batch(uuid,jsonb)FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_mutate_nodes_batch(uuid,jsonb)TO authenticated;
