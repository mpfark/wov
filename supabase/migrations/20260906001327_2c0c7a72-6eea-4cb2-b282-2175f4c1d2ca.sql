-- Safe admin projection and relocation authority for the permanent Combat2 proving ground.
CREATE OR REPLACE FUNCTION public.combat2_test_status(_arena_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE out jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT jsonb_build_object(
  'ok',true,'kind','status','arena_id',a.id,'arena_key',a.arena_key,'label',a.label,'active',a.active,
  'stopped',NOT EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.status='active'),
  'reset_eligible',a.active AND NOT EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=a.id AND (e.status='active' OR e.claim_token IS NOT NULL)),
  'node_count',(SELECT count(*) FROM public.combat2_test_arena_node n WHERE n.arena_id=a.id AND n.active),
  'creature_count',(SELECT count(*) FROM public.combat2_test_arena_creature c WHERE c.arena_id=a.id),
  'tester_count',(SELECT count(*) FROM public.combat2_test_arena_access x WHERE x.arena_id=a.id AND x.active AND x.revoked_at IS NULL),
  'active_encounter_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.status='active'),
  'claimed_encounter_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.claim_token IS NOT NULL),
  'pending_intent_count',(SELECT count(*) FROM public.node_intent i JOIN public.node_encounter e ON e.id=i.encounter_id WHERE e.test_arena_id=a.id AND i.status='pending'),
  'pending_event_count',(SELECT count(*) FROM public.node_pending_event p JOIN public.node_encounter e ON e.id=p.encounter_id WHERE e.test_arena_id=a.id AND p.consumed_at IS NULL),
  'diagnostic_history_exists',EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=a.id),
  'nodes',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n.node_id,'purpose',n.purpose,'label',d.name,'active',n.active) ORDER BY n.purpose),'[]'::jsonb)
    FROM public.combat2_test_arena_node n JOIN public.nodes d ON d.id=n.node_id WHERE n.arena_id=a.id),
  'access',(SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',x.user_id,'character_id',x.character_id,'character_name',c.name,'active',x.active,'revoked',x.revoked_at IS NOT NULL) ORDER BY c.name),'[]'::jsonb)
    FROM public.combat2_test_arena_access x JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id WHERE x.arena_id=a.id),
  'last_operation',(SELECT r.result->>'kind' FROM public.combat2_test_arena_request r WHERE r.arena_id=a.id ORDER BY r.created_at DESC LIMIT 1)
 ) INTO out FROM public.combat2_test_arena a WHERE a.id=_arena_id;
 RETURN COALESCE(out,jsonb_build_object('ok',false,'kind','unknown_arena'));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','status_failed');
END; $$;
REVOKE ALL ON FUNCTION public.combat2_test_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_status(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.combat2_test_admin_relocate(_arena_id uuid,_character_id uuid,_destination_node_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE destination_name text;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena a WHERE a.id=_arena_id AND a.active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 PERFORM 1 FROM public.combat2_test_arena_access x JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id
   WHERE x.arena_id=_arena_id AND x.character_id=_character_id AND x.active AND x.revoked_at IS NULL FOR UPDATE OF c;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','access_required'); END IF;
 SELECT d.name INTO destination_name FROM public.combat2_test_arena_node n JOIN public.nodes d ON d.id=n.node_id
  WHERE n.arena_id=_arena_id AND n.node_id=_destination_node_id AND n.active;
 IF destination_name IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_destination'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=_arena_id AND e.claim_token IS NOT NULL) THEN RETURN jsonb_build_object('ok',false,'kind','claim_active'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_departure_request d WHERE d.character_id=_character_id AND d.status='pending') OR
    EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id WHERE f.character_id=_character_id AND f.present AND e.status='active')
 THEN RETURN jsonb_build_object('ok',false,'kind','combat2_depart_required'); END IF;
 PERFORM set_config('app.combat2_test_relocate_authorized','true',true);
 UPDATE public.characters SET current_node_id=_destination_node_id WHERE id=_character_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','ownership_changed'); END IF;
 RETURN jsonb_build_object('ok',true,'kind','moved','arena_id',_arena_id,'character_id',_character_id,'destination_node_id',_destination_node_id,'destination_name',destination_name);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','relocation_refused');
END; $$;
REVOKE ALL ON FUNCTION public.combat2_test_admin_relocate(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_admin_relocate(uuid,uuid,uuid) TO authenticated,service_role;