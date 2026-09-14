-- Atomic adjacent-node creation. Lock order: request row, parent row, shared placement advisory lock.
CREATE TABLE public.admin_adjacent_node_request (
  request_id uuid PRIMARY KEY, caller_id uuid NOT NULL, parent_node_id uuid,
  expected_parent_connections jsonb, direction text, node_fields jsonb, result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.admin_adjacent_node_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_adjacent_node_request FROM PUBLIC,anon,authenticated;
REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_adjacent_node_request FROM PUBLIC,anon,authenticated;

-- The legacy normalizer discarded unknown connection properties. Preserve the selected
-- complete entry while retaining its established uppercase/deduplication behavior.
CREATE OR REPLACE FUNCTION public.normalize_node_connections() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.connections IS NULL OR jsonb_typeof(NEW.connections)<>'array' THEN NEW.connections:='[]'::jsonb; RETURN NEW; END IF;
 SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'direction'),'[]'::jsonb) INTO NEW.connections FROM (
  SELECT DISTINCT ON (upper(c->>'direction'),c->>'node_id')
   c || jsonb_build_object('node_id',c->>'node_id','direction',upper(c->>'direction')) AS entry
  FROM jsonb_array_elements(NEW.connections) c
  WHERE jsonb_typeof(c)='object' AND c?'node_id' AND c?'direction'
  ORDER BY upper(c->>'direction'),c->>'node_id',(CASE WHEN COALESCE(c->>'label','')='' THEN 1 ELSE 0 END)
 ) chosen;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_adjacent_node(
 _request_id uuid,_parent_node_id uuid,_expected_parent_connections jsonb,_direction text,_node_fields jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 caller uuid:=auth.uid(); prior public.admin_adjacent_node_request%ROWTYPE;
 dir text:=upper(btrim(coalesce(_direction,''))); rev text; parent public.nodes%ROWTYPE;
 fields jsonb:=coalesce(_node_fields,'null'::jsonb); clean_name text; nx bigint; ny bigint; new_id uuid; response jsonb;
 allowed text[]:=ARRAY['name','description','searchable_items','is_vendor','is_inn','is_blacksmith','is_jewelcrafter','is_stonebinder','is_teleport','is_public_teleport','is_trainer','is_marketplace','is_soulforge','is_heraldry','illustration_url','illustration_metadata','class_hall'];
BEGIN
 IF caller IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authenticated'); END IF;
 IF NOT public.is_steward_or_overlord() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
 INSERT INTO public.admin_adjacent_node_request VALUES(_request_id,caller,_parent_node_id,_expected_parent_connections,_direction,_node_fields,NULL,clock_timestamp()) ON CONFLICT(request_id) DO NOTHING;
 SELECT * INTO prior FROM public.admin_adjacent_node_request WHERE request_id=_request_id FOR UPDATE;
 IF prior.caller_id IS DISTINCT FROM caller OR prior.parent_node_id IS DISTINCT FROM _parent_node_id OR prior.expected_parent_connections IS DISTINCT FROM _expected_parent_connections OR prior.direction IS DISTINCT FROM _direction OR prior.node_fields IS DISTINCT FROM _node_fields THEN RETURN jsonb_build_object('ok',false,'kind','request_conflict'); END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result||jsonb_build_object('replayed',true); END IF;
 rev:=CASE dir WHEN'N'THEN'S' WHEN'S'THEN'N' WHEN'E'THEN'W' WHEN'W'THEN'E' WHEN'NE'THEN'SW' WHEN'SW'THEN'NE' WHEN'NW'THEN'SE' WHEN'SE'THEN'NW' END;
 IF _parent_node_id IS NULL OR jsonb_typeof(_expected_parent_connections) IS DISTINCT FROM 'array' OR jsonb_typeof(fields) IS DISTINCT FROM 'object' OR rev IS NULL
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(fields) k WHERE k<>ALL(allowed))
  OR NOT(fields?'name' AND fields?'description' AND fields?'searchable_items' AND fields?'illustration_url' AND fields?'illustration_metadata')
  OR jsonb_typeof(fields->'name')<>'string' OR jsonb_typeof(fields->'description')<>'string' OR jsonb_typeof(fields->'searchable_items')<>'array' OR jsonb_typeof(fields->'illustration_url')<>'string' OR jsonb_typeof(fields->'illustration_metadata')<>'object'
  OR EXISTS(SELECT 1 FROM unnest(allowed[4:15]) k WHERE NOT(fields?k) OR jsonb_typeof(fields->k)<>'boolean')
  OR (fields?'class_hall' AND jsonb_typeof(fields->'class_hall') NOT IN ('string','null'))
 THEN response:=jsonb_build_object('ok',false,'kind','invalid_request');
 ELSE
  clean_name:=btrim(fields->>'name');
  IF (fields->>'name')<>'' AND clean_name='' OR length(clean_name)>200 THEN response:=jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
 END IF;
 IF response IS NULL THEN
  SELECT * INTO parent FROM public.nodes WHERE id=_parent_node_id FOR UPDATE;
  IF NOT FOUND THEN response:=jsonb_build_object('ok',false,'kind','parent_not_found');
  ELSIF jsonb_typeof(parent.connections)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(parent.connections)e WHERE jsonb_typeof(e)<>'object' OR NOT(e?'node_id' AND e?'direction') OR jsonb_typeof(e->'node_id')<>'string' OR jsonb_typeof(e->'direction')<>'string' OR upper(e->>'direction') NOT IN('N','NE','E','SE','S','SW','W','NW') OR (e?'hidden' AND jsonb_typeof(e->'hidden')<>'boolean')) THEN response:=jsonb_build_object('ok',false,'kind','malformed_parent_connections');
  ELSIF parent.connections<>_expected_parent_connections THEN response:=jsonb_build_object('ok',false,'kind','stale_parent_state');
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(parent.connections)e WHERE upper(e->>'direction')=dir) THEN response:=jsonb_build_object('ok',false,'kind','direction_occupied');
  END IF;
 END IF;
 IF response IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_create_region_with_initial_node',0));
  nx:=parent.x::bigint+(CASE dir WHEN'E'THEN 1 WHEN'NE'THEN 1 WHEN'SE'THEN 1 WHEN'W'THEN -1 WHEN'NW'THEN -1 WHEN'SW'THEN -1 ELSE 0 END);
  ny:=parent.y::bigint+(CASE dir WHEN'S' THEN 1 WHEN'SE'THEN 1 WHEN'SW'THEN 1 WHEN'N'THEN -1 WHEN'NE'THEN -1 WHEN'NW'THEN -1 ELSE 0 END);
  IF nx NOT BETWEEN -2147483648 AND 2147483647 OR ny NOT BETWEEN -2147483648 AND 2147483647 THEN response:=jsonb_build_object('ok',false,'kind','coordinate_collision');
  ELSIF EXISTS(SELECT 1 FROM public.nodes WHERE x=nx AND y=ny) THEN response:=jsonb_build_object('ok',false,'kind','coordinate_collision'); END IF;
 END IF;
 IF response IS NULL THEN BEGIN
  INSERT INTO public.nodes(name,description,region_id,area_id,connections,searchable_items,is_vendor,is_inn,is_blacksmith,is_jewelcrafter,is_stonebinder,is_teleport,is_public_teleport,is_trainer,is_marketplace,is_soulforge,is_heraldry,illustration_url,illustration_metadata,class_hall,x,y)
  VALUES(clean_name,fields->>'description',parent.region_id,parent.area_id,jsonb_build_array(jsonb_build_object('node_id',parent.id,'direction',rev,'hidden',false)),fields->'searchable_items',(fields->>'is_vendor')::boolean,(fields->>'is_inn')::boolean,(fields->>'is_blacksmith')::boolean,(fields->>'is_jewelcrafter')::boolean,(fields->>'is_stonebinder')::boolean,(fields->>'is_teleport')::boolean,(fields->>'is_public_teleport')::boolean,(fields->>'is_trainer')::boolean,(fields->>'is_marketplace')::boolean,(fields->>'is_soulforge')::boolean,(fields->>'is_heraldry')::boolean,fields->>'illustration_url',fields->'illustration_metadata',nullif(fields->>'class_hall',''),nx::integer,ny::integer) RETURNING id INTO new_id;
  UPDATE public.nodes SET connections=parent.connections||jsonb_build_array(jsonb_build_object('node_id',new_id,'direction',dir,'hidden',false)) WHERE id=parent.id;
  response:=jsonb_build_object('ok',true,'kind','created','node_id',new_id,'parent_node_id',parent.id,'replayed',false);
 EXCEPTION WHEN unique_violation THEN response:=jsonb_build_object('ok',false,'kind','coordinate_collision'); WHEN check_violation OR not_null_violation OR foreign_key_violation THEN response:=jsonb_build_object('ok',false,'kind','invalid_request'); WHEN OTHERS THEN response:=jsonb_build_object('ok',false,'kind','database_error'); END; END IF;
 UPDATE public.admin_adjacent_node_request SET result=response WHERE request_id=_request_id; RETURN response;
END; $$;
REVOKE ALL ON FUNCTION public.admin_create_adjacent_node(uuid,uuid,jsonb,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_create_adjacent_node(uuid,uuid,jsonb,text,jsonb) TO authenticated;
