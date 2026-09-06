-- Permanent content and admin-only lifecycle authority for the dormant proving ground.
ALTER TABLE public.combat2_test_arena ADD COLUMN region_id uuid UNIQUE REFERENCES public.regions(id) ON DELETE RESTRICT;
ALTER TABLE public.node_encounter ADD COLUMN stop_reason text;
CREATE TABLE public.combat2_test_arena_creature (
 creature_id uuid PRIMARY KEY REFERENCES public.creatures(id) ON DELETE RESTRICT,
 arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
 node_id uuid NOT NULL REFERENCES public.combat2_test_arena_node(node_id) ON DELETE RESTRICT,
 baseline_hp integer NOT NULL CHECK(baseline_hp>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.combat2_test_arena_request (
 request_id uuid PRIMARY KEY, arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN('stop','reset')), caller_id uuid,
 confirm_destroy_diagnostics boolean NOT NULL DEFAULT false, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.combat2_test_arena_creature ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_arena_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_test_arena_creature,public.combat2_test_arena_request FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.combat2_test_arena_creature,public.combat2_test_arena_request TO service_role;

-- Fixed permanent identities; none belongs to a real user or character.
INSERT INTO public.regions(id,name,description,min_level,max_level,sort_order,direction) VALUES
 ('ffff5000-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_REGION','Administrative Combat2 proving ground. Not part of the playable world.',1,99,9999,NULL);
INSERT INTO public.combat2_test_arena(id,arena_key,label,description,active,region_id) VALUES
 ('ffff5000-0000-4000-8000-000000000002','combat2_proving_ground','Combat2 Proving Ground','Permanent isolated diagnostic arena.',true,'ffff5000-0000-4000-8000-000000000001');

INSERT INTO public.nodes(id,region_id,name,description,x,y,connections) VALUES
 ('ffff5010-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_STAGING','Administrative staging and reset room.',0,0,
  '[{"node_id":"ffff5011-0000-4000-8000-000000000001","direction":"N","hidden":false,"locked":false},{"node_id":"ffff5012-0000-4000-8000-000000000001","direction":"E","hidden":false,"locked":false},{"node_id":"ffff5013-0000-4000-8000-000000000001","direction":"S","hidden":false,"locked":false},{"node_id":"ffff5014-0000-4000-8000-000000000001","direction":"W","hidden":false,"locked":false}]'),
 ('ffff5011-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_LOW','Low-level aggressive and non-aggressive initiation chamber.',0,-1,'[{"node_id":"ffff5010-0000-4000-8000-000000000001","direction":"S","hidden":false,"locked":false}]'),
 ('ffff5012-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_EQUAL','Level-20 equivalence chamber.',1,0,'[{"node_id":"ffff5010-0000-4000-8000-000000000001","direction":"W","hidden":false,"locked":false}]'),
 ('ffff5013-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_HIGH','High-damage mitigation, healing, flee and death chamber.',0,1,'[{"node_id":"ffff5010-0000-4000-8000-000000000001","direction":"N","hidden":false,"locked":false}]'),
 ('ffff5014-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_BOSS','Deterministic supported telegraph chamber.',-1,0,'[{"node_id":"ffff5010-0000-4000-8000-000000000001","direction":"E","hidden":false,"locked":false}]');
INSERT INTO public.combat2_test_arena_node(node_id,arena_id,purpose,active) VALUES
 ('ffff5010-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','staging',true),
 ('ffff5011-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','low',true),
 ('ffff5012-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','equal',true),
 ('ffff5013-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','high_damage',true),
 ('ffff5014-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','boss',true);
ALTER TABLE public.combat2_test_arena ALTER COLUMN region_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.combat2_test_region_visible(_region_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.combat2_test_arena a WHERE a.region_id=_region_id)
 OR public.is_steward_or_overlord() OR EXISTS(
  SELECT 1 FROM public.combat2_test_arena a JOIN public.combat2_test_arena_access x ON x.arena_id=a.id
  JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id
  WHERE a.region_id=_region_id AND a.active AND x.user_id=auth.uid() AND x.active AND x.revoked_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.combat2_test_region_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_region_visible(uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "Anyone can view regions" ON public.regions;
DROP POLICY IF EXISTS "Visible regions" ON public.regions;
CREATE POLICY "Visible regions" ON public.regions FOR SELECT USING(public.combat2_test_region_visible(regions.id));

INSERT INTO public.creatures(id,node_id,name,description,level,hp,max_hp,ac,stats,rarity,is_humanoid,is_aggressive,base_aggressive,is_alive,drop_chance,loot_mode,loot_table,loot_table_id,respawn_seconds,boss_cast) VALUES
 ('ffff5020-0000-4000-8000-000000000001','ffff5011-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_LOW_AGGRESSOR','Permanent low-level aggressive target.',5,80,80,8,'{"str":8,"dex":8,"con":8}','regular',false,true,true,true,0,'salvage_only','[]',NULL,86400,NULL),
 ('ffff5021-0000-4000-8000-000000000001','ffff5011-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_LOW_PASSIVE','Permanent non-aggressive engagement target.',5,80,80,8,'{"str":8,"dex":8,"con":8}','regular',false,false,false,true,0,'salvage_only','[]',NULL,86400,NULL),
 ('ffff5022-0000-4000-8000-000000000001','ffff5012-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_EQUAL_AGGRESSOR','Permanent level-20 target.',20,400,400,14,'{"str":16,"dex":12,"con":16}','regular',false,true,true,true,0,'salvage_only','[]',NULL,86400,NULL),
 ('ffff5023-0000-4000-8000-000000000001','ffff5013-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_HIGH_BRUTE','Permanent high-damage target.',28,900,900,16,'{"str":28,"dex":12,"con":22}','rare',false,true,true,true,0,'salvage_only','[]',NULL,86400,NULL),
 ('ffff5024-0000-4000-8000-000000000001','ffff5013-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_HIGH_SKIRMISHER','Second controlled high-damage target.',24,600,600,15,'{"str":20,"dex":22,"con":16}','regular',false,true,true,true,0,'salvage_only','[]',NULL,86400,NULL),
 ('ffff5025-0000-4000-8000-000000000001','ffff5014-0000-4000-8000-000000000001','ZZ_COMBAT2_TEST_BOSS_SENTINEL','Permanent supported telegraph boss.',25,1500,1500,17,'{"str":24,"dex":12,"con":24}','boss',false,true,true,true,0,'salvage_only','[]',NULL,86400,
  '{"enabled":true,"ability_key":"proving_ground_slam","label":"Proving Ground Slam","cast_ms":4000,"cooldown_ms":4000,"chance":1,"base_amount":35,"target_mode":"tank","damage_type":"physical","cast_flavor":"raises its testing hammer","hit_flavor":"brings the testing hammer down"}');
INSERT INTO public.combat2_test_arena_creature(creature_id,arena_id,node_id,baseline_hp) VALUES
 ('ffff5020-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','ffff5011-0000-4000-8000-000000000001',80),
 ('ffff5021-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','ffff5011-0000-4000-8000-000000000001',80),
 ('ffff5022-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','ffff5012-0000-4000-8000-000000000001',400),
 ('ffff5023-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','ffff5013-0000-4000-8000-000000000001',900),
 ('ffff5024-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','ffff5013-0000-4000-8000-000000000001',600),
 ('ffff5025-0000-4000-8000-000000000001','ffff5000-0000-4000-8000-000000000002','ffff5014-0000-4000-8000-000000000001',1500);

CREATE OR REPLACE FUNCTION public.combat2_test_admin_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$ SELECT auth.role()='service_role' OR public.is_steward_or_overlord(); $$;
REVOKE ALL ON FUNCTION public.combat2_test_admin_allowed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_admin_allowed() TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_test_status(_arena_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE out jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT jsonb_build_object('ok',true,'kind','status','arena_id',a.id,'active',a.active,
  'node_count',(SELECT count(*) FROM public.combat2_test_arena_node n WHERE n.arena_id=a.id),
  'creature_count',(SELECT count(*) FROM public.combat2_test_arena_creature c WHERE c.arena_id=a.id),
  'active_encounters',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.status='active')) INTO out
 FROM public.combat2_test_arena a WHERE a.id=_arena_id;
 RETURN COALESCE(out,jsonb_build_object('ok',false,'kind','unknown_arena'));
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_grant(_arena_id uuid,_user_id uuid,_character_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) OR
    NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character_id AND user_id=_user_id) THEN RETURN jsonb_build_object('ok',false,'kind','invalid_binding'); END IF;
 INSERT INTO public.combat2_test_arena_access(arena_id,user_id,character_id,active,granted_by,revoked_at)
 VALUES(_arena_id,_user_id,_character_id,true,auth.uid(),NULL)
 ON CONFLICT(arena_id,character_id) DO UPDATE SET user_id=EXCLUDED.user_id,active=true,granted_by=auth.uid(),granted_at=now(),revoked_at=NULL;
 RETURN jsonb_build_object('ok',true,'kind','granted','arena_id',_arena_id,'character_id',_character_id);
END; $$;
CREATE OR REPLACE FUNCTION public.combat2_test_revoke(_arena_id uuid,_user_id uuid,_character_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 UPDATE public.combat2_test_arena_access SET active=false,revoked_at=now()
 WHERE arena_id=_arena_id AND user_id=_user_id AND character_id=_character_id;
 RETURN jsonb_build_object('ok',true,'kind',CASE WHEN FOUND THEN 'revoked' ELSE 'already_absent' END,'arena_id',_arena_id,'character_id',_character_id);
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_stop(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE prior public.combat2_test_arena_request; result jsonb; n integer; rejected_intents integer; consumed_events integer;
 effects_removed integer; fighters_absented integer; groups_deactivated integer; caller uuid:=auth.uid();
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
 IF FOUND THEN IF prior.arena_id<>_arena_id OR prior.operation<>'stop' OR prior.caller_id IS DISTINCT FROM caller THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF; RETURN prior.result; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 PERFORM 1 FROM public.node_encounter WHERE test_arena_id=_arena_id ORDER BY id FOR UPDATE;
 UPDATE public.node_intent SET status='rejected',reject_reason='test_stop' WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id) AND status='pending'; GET DIAGNOSTICS rejected_intents=ROW_COUNT;
 UPDATE public.node_pending_event SET consumed_at=now() WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id) AND consumed_at IS NULL; GET DIAGNOSTICS consumed_events=ROW_COUNT;
 DELETE FROM public.node_effect WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id); GET DIAGNOSTICS effects_removed=ROW_COUNT;
 UPDATE public.node_fighter SET present=false,left_at=COALESCE(left_at,now()),exit_request_id=NULL WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id) AND present; GET DIAGNOSTICS fighters_absented=ROW_COUNT;
 UPDATE public.node_arrival_group SET active=false WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id) AND active; GET DIAGNOSTICS groups_deactivated=ROW_COUNT;
 UPDATE public.node_encounter SET status='ended',stop_reason='test_stop',claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL,intent_cutoff_seq=NULL,next_due_at='infinity',updated_at=now() WHERE test_arena_id=_arena_id AND status='active'; GET DIAGNOSTICS n=ROW_COUNT;
 result:=jsonb_build_object('ok',true,'kind',CASE WHEN n=0 THEN 'already_stopped' ELSE 'stopped' END,'arena_id',_arena_id,
  'encounters_stopped',n,'intents_rejected',rejected_intents,'events_consumed',consumed_events,'effects_removed',effects_removed,
  'fighters_absented',fighters_absented,'groups_deactivated',groups_deactivated);
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result)
 VALUES(_request_id,_arena_id,'stop',caller,false,result); RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','stop_failed');
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE prior public.combat2_test_arena_request; result jsonb; staging uuid; encounters integer; restored_characters integer;
 restored_creatures integer; callers uuid:=auth.uid();
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
 DELETE FROM public.combat2_tick_notification WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id);
 DELETE FROM public.node_tick_log WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id);
 DELETE FROM public.combat2_departure_request WHERE origin_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id) OR destination_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id);
 DELETE FROM public.node_reward_claim WHERE creature_id IN(SELECT creature_id FROM public.combat2_test_arena_creature WHERE arena_id=_arena_id);
 DELETE FROM public.node_ground_loot WHERE node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id);
 DELETE FROM public.node_encounter WHERE test_arena_id=_arena_id;
 PERFORM set_config('app.combat2_test_relocate_authorized','true',true);
 UPDATE public.characters c SET current_node_id=staging,hp=c.max_hp,cp=c.max_cp,mp=c.max_mp,died_at=NULL
 WHERE EXISTS(SELECT 1 FROM public.combat2_test_arena_access x WHERE x.arena_id=_arena_id AND x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL); GET DIAGNOSTICS restored_characters=ROW_COUNT;
 UPDATE public.creatures c SET hp=r.baseline_hp,is_alive=true,died_at=NULL,last_damaged_at=NULL,is_aggressive=c.base_aggressive,rewards_awarded_at=NULL,spawn_seq=spawn_seq+1
 FROM public.combat2_test_arena_creature r WHERE r.arena_id=_arena_id AND r.creature_id=c.id; GET DIAGNOSTICS restored_creatures=ROW_COUNT;
 result:=jsonb_build_object('ok',true,'kind','reset','arena_id',_arena_id,'encounters_deleted',encounters,
  'characters_restored',restored_characters,'creatures_restored',restored_creatures);
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result)
 VALUES(_request_id,_arena_id,'reset',callers,true,result); RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','reset_failed');
END; $$;

REVOKE ALL ON FUNCTION public.combat2_test_status(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.combat2_test_status(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_test_grant(uuid,uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.combat2_test_grant(uuid,uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_test_revoke(uuid,uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.combat2_test_revoke(uuid,uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_test_stop(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.combat2_test_stop(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) TO authenticated,service_role;