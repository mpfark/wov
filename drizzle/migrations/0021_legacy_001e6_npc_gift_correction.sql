-- Reviewed local preparation, NOT INSTALLED. Guarded same-signature NPC gift correction.
DO $install$
DECLARE f oid := to_regprocedure('public.grant_npc_gift(uuid,uuid,uuid,boolean)');
 old_owner oid; old_acl jsonb; after_acl jsonb; server_execute boolean;
BEGIN
 IF f IS NULL THEN RAISE EXCEPTION 'npc_gift_missing'; END IF;
 SELECT proowner INTO old_owner FROM pg_proc WHERE oid=f;
 IF (SELECT prosecdef AND prorettype='jsonb'::regtype AND proconfig=ARRAY['search_path=public']
   AND proargnames=ARRAY['_character_id','_npc_id','_item_id','_once_per_character']
   AND pronargdefaults=1 AND pg_get_expr(proargdefaults,0)='true'
   AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='9e5c246bb43d458ef7256ba931524178389171a2ce12ffeee9ea0a3dbfaa003b'
   FROM pg_proc WHERE oid=f) IS DISTINCT FROM true THEN RAISE EXCEPTION 'npc_gift_source_drift'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
 INTO old_acl FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid=f AND a.grantee<>0 AND a.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'));
 server_execute:=has_function_privilege('service_role',f,'EXECUTE');
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.grant_npc_gift(_character_id uuid,_npc_id uuid,_item_id uuid,_once_per_character boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $gift$
DECLARE c public.characters; n public.npcs; topic jsonb; flag boolean; once_flag boolean;
 matches integer:=0; inserted integer; held boolean; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR _character_id IS NULL OR _npc_id IS NULL OR _item_id IS NULL THEN
   RETURN jsonb_build_object('ok',false,'reason','not_owner'); END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR NO KEY UPDATE;
 IF NOT FOUND OR c.user_id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('ok',false,'reason','not_owner'); END IF;
 IF c.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason','inactive_character'); END IF;
 SELECT * INTO n FROM public.npcs WHERE id=_npc_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','npc_not_found'); END IF;
 IF c.current_node_id IS NULL OR n.node_id IS NULL OR c.current_node_id IS DISTINCT FROM n.node_id THEN
   RETURN jsonb_build_object('ok',false,'reason','not_at_npc'); END IF;
 IF jsonb_typeof(n.dialogue_topics) IS DISTINCT FROM 'array' THEN
   RETURN jsonb_build_object('ok',false,'reason','gift_not_configured'); END IF;
 FOR topic IN SELECT value FROM jsonb_array_elements(n.dialogue_topics) LOOP
   IF topic->>'kind' IS DISTINCT FROM 'give_item' OR jsonb_typeof(topic->'params') IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
   IF COALESCE(topic->'params'->>'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
   IF (topic->'params'->>'item_id')::uuid<>_item_id THEN CONTINUE; END IF;
   IF jsonb_typeof(topic->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(topic->'label') IS DISTINCT FROM 'string' THEN
     RETURN jsonb_build_object('ok',false,'reason','invalid_gift_configuration'); END IF;
   IF topic->'params'->'once_per_character' IS NULL OR topic->'params'->'once_per_character'='null'::jsonb THEN flag:=true;
   ELSIF jsonb_typeof(topic->'params'->'once_per_character')='boolean' THEN flag:=(topic->'params'->>'once_per_character')::boolean;
   ELSE RETURN jsonb_build_object('ok',false,'reason','invalid_gift_configuration'); END IF;
   IF matches>0 AND once_flag IS DISTINCT FROM flag THEN
     RETURN jsonb_build_object('ok',false,'reason','gift_configuration_conflict'); END IF;
   once_flag:=flag; matches:=matches+1;
 END LOOP;
 IF matches=0 THEN RETURN jsonb_build_object('ok',false,'reason','gift_not_configured'); END IF;
 IF _once_per_character IS DISTINCT FROM once_flag THEN
   RETURN jsonb_build_object('ok',false,'reason','gift_argument_mismatch'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.items WHERE id=_item_id) THEN
   RETURN jsonb_build_object('ok',false,'reason','gift_item_missing'); END IF;
 IF once_flag AND EXISTS(SELECT 1 FROM public.character_npc_gifts WHERE character_id=c.id AND npc_id=n.id AND item_id=_item_id) THEN
   RETURN jsonb_build_object('ok',false,'reason','already_gifted'); END IF;
 SELECT EXISTS(SELECT 1 FROM public.character_inventory WHERE character_id=c.id AND item_id=_item_id) INTO held;
 INSERT INTO public.character_npc_gifts(character_id,npc_id,item_id) VALUES(c.id,n.id,_item_id)
 ON CONFLICT(character_id,npc_id,item_id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=0 AND NOT EXISTS(SELECT 1 FROM public.character_npc_gifts WHERE character_id=c.id AND npc_id=n.id AND item_id=_item_id) THEN RAISE EXCEPTION 'npc_gift_ledger_suppressed'; END IF;
 IF once_flag AND inserted<>1 THEN RETURN jsonb_build_object('ok',false,'reason','already_gifted'); END IF;
 IF NOT held THEN
   INSERT INTO public.character_inventory(character_id,item_id,current_durability) VALUES(c.id,_item_id,100);
   GET DIAGNOSTICS inserted=ROW_COUNT;
   IF inserted<>1 THEN RAISE EXCEPTION 'npc_gift_inventory_suppressed'; END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'already_in_inventory',held);
END;
$gift$;
$definition$;
 REVOKE EXECUTE ON FUNCTION public.grant_npc_gift(uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.grant_npc_gift(uuid,uuid,uuid,boolean) TO authenticated;
 -- If service previously relied on PUBLIC, preserve that existing effective server capability explicitly.
 IF server_execute AND NOT has_function_privilege('service_role',f,'EXECUTE') THEN
   GRANT EXECUTE ON FUNCTION public.grant_npc_gift(uuid,uuid,uuid,boolean) TO service_role;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
 INTO after_acl FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid=f AND a.grantee<>0 AND a.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'));
 IF after_acl IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY (value->>'grantor')::oid,(value->>'grantee')::oid,value->>'privilege_type',value->>'is_grantable'),'[]'::jsonb)
 FROM jsonb_array_elements(old_acl) WHERE (value->>'grantee')::oid IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='service_role'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(old_acl) a WHERE (a.value->>'grantee')::oid=(SELECT oid FROM pg_roles WHERE rolname='service_role')
   AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) b WHERE p.oid=f AND to_jsonb(b)=a.value))
 OR (SELECT proowner FROM pg_proc WHERE oid=f)<>old_owner
 OR has_function_privilege('anon',f,'EXECUTE') OR NOT has_function_privilege('authenticated',f,'EXECUTE')
 OR has_function_privilege('service_role',f,'EXECUTE') IS DISTINCT FROM server_execute
 THEN RAISE EXCEPTION 'npc_gift_authority_drift'; END IF;
END $install$;
