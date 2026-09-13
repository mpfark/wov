-- Production cutover: Combat2 owns every ordinary gameplay node. Historical
-- canary rows remain available as rollback diagnostics but no longer gate play.
CREATE OR REPLACE FUNCTION public.combat2_node_runtime_eligible(_node_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT _node_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.nodes n WHERE n.id=_node_id)
 AND (NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_node t WHERE t.node_id=_node_id)
   OR EXISTS(SELECT 1 FROM public.combat2_test_arena_node t JOIN public.combat2_test_arena a ON a.id=t.arena_id
      WHERE t.node_id=_node_id AND t.active AND a.active));
$$;
REVOKE ALL ON FUNCTION public.combat2_node_runtime_eligible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_node_runtime_eligible(uuid) TO service_role;

CREATE TABLE public.combat2_player_presence(
 character_id uuid PRIMARY KEY REFERENCES public.characters(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.combat2_player_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.combat2_player_presence FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.combat2_player_presence TO service_role;

CREATE FUNCTION public.combat2_presence_heartbeat(_character_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid();
BEGIN
 IF caller IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.user_id=caller)
 THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 INSERT INTO public.combat2_player_presence(character_id,user_id,seen_at) VALUES(_character_id,caller,clock_timestamp())
 ON CONFLICT(character_id) DO UPDATE SET user_id=EXCLUDED.user_id,seen_at=clock_timestamp();
 RETURN jsonb_build_object('ok',true,'kind','present');
END $$;
REVOKE ALL ON FUNCTION public.combat2_presence_heartbeat(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_presence_heartbeat(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.combat2_session_access(_character_id uuid,_node_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE caller uuid:=auth.uid();arena uuid;scheduler jsonb;
BEGIN
 IF caller IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.user_id=caller AND c.current_node_id=_node_id)
 THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT t.arena_id INTO arena FROM public.combat2_test_arena_node t JOIN public.combat2_test_arena a ON a.id=t.arena_id AND a.active WHERE t.node_id=_node_id AND t.active;
 IF EXISTS(SELECT 1 FROM public.combat2_test_arena_node t WHERE t.node_id=_node_id) THEN
  IF arena IS NULL OR NOT public.combat2_test_arena_access_allowed(caller,_character_id,_node_id)
  THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('combat2-production-activation'));
 UPDATE public.combat_config SET value='open' WHERE key='combat_mode' AND value IS DISTINCT FROM 'open';
 PERFORM public.wake_world();
 scheduler:=public.combat2_dispatch_scheduler_enable();
 IF COALESCE(scheduler->>'ok','false')<>'true' THEN
  PERFORM public.combat2_dispatch_scheduler_disable();
  UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
  PERFORM public.shutdown_world();
  RETURN jsonb_build_object('ok',false,'kind','access_check_failed');
 END IF;
 IF arena IS NULL THEN
  INSERT INTO public.combat2_player_presence(character_id,user_id,seen_at) VALUES(_character_id,caller,clock_timestamp())
  ON CONFLICT(character_id) DO UPDATE SET user_id=EXCLUDED.user_id,seen_at=clock_timestamp();
 ELSE
  INSERT INTO public.combat2_test_presence(arena_id,character_id,user_id,seen_at) VALUES(arena,_character_id,caller,clock_timestamp())
  ON CONFLICT(arena_id,character_id) DO UPDATE SET user_id=EXCLUDED.user_id,seen_at=clock_timestamp();
 END IF;
 RETURN jsonb_build_object('ok',true,'kind','allowed','node_id',_node_id,'scope',CASE WHEN arena IS NULL THEN 'ordinary_world' ELSE 'test_arena' END);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','access_check_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_session_access(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_session_access(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.idle_shutdown_check() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.combat2_player_presence p JOIN public.characters c ON c.id=p.character_id AND c.user_id=p.user_id WHERE p.seen_at>now()-interval '30 minutes') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_test_presence p JOIN public.combat2_test_arena_access x ON x.arena_id=p.arena_id AND x.character_id=p.character_id AND x.user_id=p.user_id AND x.active AND x.revoked_at IS NULL JOIN public.characters c ON c.id=p.character_id AND c.user_id=p.user_id JOIN public.combat2_test_arena_node n ON n.arena_id=p.arena_id AND n.node_id=c.current_node_id AND n.active WHERE p.seen_at>now()-interval '5 minutes') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE claim_token IS NOT NULL AND claim_expires_at>now()) THEN RETURN; END IF;
 BEGIN PERFORM public.return_unique_items(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'return_unique_items() failed during shutdown: %',SQLERRM; END;
 UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
 PERFORM public.combat2_dispatch_scheduler_disable();
 PERFORM public.shutdown_world();
END $$;
REVOKE ALL ON FUNCTION public.idle_shutdown_check() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.idle_shutdown_check() TO service_role;
