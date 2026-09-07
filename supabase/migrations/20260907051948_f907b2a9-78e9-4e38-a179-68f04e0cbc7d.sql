CREATE OR REPLACE FUNCTION public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE prior public.combat2_test_arena_request; result jsonb; staging uuid; encounters integer; restored_characters integer;
 restored_creatures integer; callers uuid:=auth.uid(); failure_stage text:='cleanup'; failure_code text;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
 IF FOUND THEN IF prior.arena_id<>_arena_id OR prior.operation<>'reset' OR prior.caller_id IS DISTINCT FROM callers OR prior.confirm_destroy_diagnostics IS DISTINCT FROM _confirm_destroy_diagnostics THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF; RETURN prior.result; END IF;
 IF NOT _confirm_destroy_diagnostics THEN RETURN jsonb_build_object('ok',false,'kind','confirmation_required'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 PERFORM 1 FROM public.node_encounter WHERE test_arena_id=_arena_id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND (status='active' OR claim_token IS NOT NULL)) THEN RETURN jsonb_build_object('ok',false,'kind','arena_not_stopped'); END IF;
 SELECT node_id INTO staging FROM public.combat2_test_arena_node WHERE arena_id=_arena_id AND purpose='staging' AND active;
 IF staging IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','staging_unavailable'); END IF;
 SELECT count(*) INTO encounters FROM public.node_encounter WHERE test_arena_id=_arena_id;
 failure_stage:='cleanup';
 DELETE FROM public.combat2_tick_notification WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id);
 DELETE FROM public.node_tick_log WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id);
 DELETE FROM public.combat2_departure_request WHERE origin_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id) OR destination_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id);
 DELETE FROM public.node_reward_claim WHERE creature_id IN(SELECT creature_id FROM public.combat2_test_arena_creature WHERE arena_id=_arena_id);
 DELETE FROM public.node_ground_loot WHERE node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id);
 DELETE FROM public.node_encounter WHERE test_arena_id=_arena_id;
 failure_stage:='tester_restore';
 PERFORM set_config('app.combat2_test_relocate_authorized','true',true);
 UPDATE public.characters c SET current_node_id=staging,hp=c.max_hp,cp=c.max_cp,mp=c.max_mp
 WHERE EXISTS(SELECT 1 FROM public.combat2_test_arena_access x WHERE x.arena_id=_arena_id AND x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL); GET DIAGNOSTICS restored_characters=ROW_COUNT;
 failure_stage:='creature_restore';
 UPDATE public.creatures c SET hp=r.baseline_hp,is_alive=true,died_at=NULL,last_damaged_at=NULL,is_aggressive=c.base_aggressive,rewards_awarded_at=NULL,spawn_seq=spawn_seq+1
 FROM public.combat2_test_arena_creature r WHERE r.arena_id=_arena_id AND r.creature_id=c.id; GET DIAGNOSTICS restored_creatures=ROW_COUNT;
 failure_stage:='request_finalize';
 result:=jsonb_build_object('ok',true,'kind','reset','arena_id',_arena_id,'encounters_deleted',encounters,
  'characters_restored',restored_characters,'creatures_restored',restored_creatures);
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result)
 VALUES(_request_id,_arena_id,'reset',callers,true,result); RETURN result;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE;
 RETURN jsonb_strip_nulls(jsonb_build_object(
  'ok',false,'kind','reset_failed',
  'stage',CASE WHEN failure_stage IN ('cleanup','tester_restore','creature_restore','request_finalize') THEN failure_stage ELSE NULL END,
  'code',CASE WHEN failure_code ~ '^[[:alnum:]]{5}$' THEN failure_code ELSE NULL END));
END; $$;

REVOKE ALL ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) TO authenticated,service_role;