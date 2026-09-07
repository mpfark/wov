-- Server-owned ordinary-world Combat2 respawn configuration and recovery.
CREATE TABLE public.combat2_respawn_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_node_id uuid NOT NULL REFERENCES public.nodes(id),
  delay_ms integer NOT NULL CHECK (delay_ms >= 0),
  restored_hp integer NOT NULL CHECK (restored_hp > 0),
  gold_loss_rate numeric NOT NULL CHECK (gold_loss_rate >= 0 AND gold_loss_rate <= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.combat2_respawn_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_respawn_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.combat2_respawn_config TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nodes WHERE id='b0000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'configured Combat2 respawn node does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.combat2_test_arena_node WHERE node_id='b0000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'configured Combat2 respawn node is a Test Arena node';
  END IF;
END $$;
INSERT INTO public.combat2_respawn_config(singleton,default_node_id,delay_ms,restored_hp,gold_loss_rate)
VALUES(true,'b0000000-0000-4000-8000-000000000001',3000,1,0.10);

CREATE TABLE public.combat2_respawn_request (
  request_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  origin_node_id uuid NOT NULL REFERENCES public.nodes(id),
  destination_node_id uuid NOT NULL REFERENCES public.nodes(id),
  death_at timestamptz NOT NULL,
  restored_hp integer NOT NULL,
  gold_lost integer NOT NULL CHECK (gold_lost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.combat2_respawn_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_respawn_request FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.combat2_respawn_request TO service_role;

-- Browser location writes remain blocked. Only transaction-local, server-side
-- departure, Test Arena administration, or respawn contexts may cross guards.
CREATE OR REPLACE FUNCTION public.combat2_guard_owned_location_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.current_node_id IS DISTINCT FROM NEW.current_node_id
     AND COALESCE(auth.role(),'') <> 'service_role'
     AND COALESCE(current_setting('app.combat2_depart_authorized',true),'') <> 'true'
     AND COALESCE(current_setting('app.combat2_respawn_authorized',true),'') <> 'true'
     AND EXISTS (SELECT 1 FROM public.node_fighter nf JOIN public.node_encounter e ON e.id=nf.encounter_id
       WHERE nf.character_id=OLD.id AND nf.present AND e.status='active') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='combat2_depart_required';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.combat2_guard_owned_location_write() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.combat2_guard_test_arena_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE old_test boolean; new_test boolean; approved boolean;
BEGIN
 IF OLD.current_node_id IS NOT DISTINCT FROM NEW.current_node_id THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=OLD.current_node_id) INTO old_test;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=NEW.current_node_id) INTO new_test;
 IF NOT old_test AND NOT new_test THEN RETURN NEW; END IF;
 approved:=COALESCE(current_setting('app.combat2_depart_authorized',true),'')='true'
   OR COALESCE(current_setting('app.combat2_test_relocate_authorized',true),'')='true'
   OR COALESCE(current_setting('app.combat2_respawn_authorized',true),'')='true';
 IF NOT approved THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_relocation_required'; END IF;
 IF auth.role()='service_role' THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_not_authorized'; END IF;
 IF new_test AND NOT public.combat2_test_arena_access_allowed(auth.uid(),NEW.id,NEW.current_node_id) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_not_authorized'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.combat2_guard_test_arena_location() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.combat2_respawn(_character_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE
  prior public.combat2_respawn_request; c public.characters; cfg public.combat2_respawn_config;
  encounter public.node_encounter; origin uuid; death_at timestamptz; eligible_at timestamptz;
  loss integer; restored integer; destination_name text;
BEGIN
  IF _character_id IS NULL OR _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
  IF auth.uid() IS NULL OR NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
  -- Lock order: request advisory, node advisory, encounter, character. This
  -- matches request serialization and Combat2 encounter-before-character commits.
  PERFORM pg_advisory_xact_lock(hashtextextended('combat2_respawn_request:'||_request_id::text,0));
  SELECT * INTO prior FROM public.combat2_respawn_request WHERE request_id=_request_id;
  IF FOUND THEN
    IF prior.character_id IS DISTINCT FROM _character_id THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
    RETURN jsonb_build_object('ok',true,'kind','already_respawned','request_id',prior.request_id,
      'destination_node_id',prior.destination_node_id,'restored_hp',prior.restored_hp,'gold_lost',prior.gold_lost);
  END IF;
  SELECT current_node_id INTO origin FROM public.characters WHERE id=_character_id;
  IF origin IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','state_changed'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||origin::text,0));
  SELECT * INTO encounter FROM public.node_encounter WHERE node_id=origin FOR UPDATE;
  SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
  IF NOT FOUND OR c.current_node_id IS DISTINCT FROM origin THEN RETURN jsonb_build_object('ok',false,'kind','state_changed'); END IF;
  IF EXISTS (SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=origin) THEN
    RETURN jsonb_build_object('ok',false,'kind','test_arena_reset_required');
  END IF;
  IF c.hp > 0 THEN RETURN jsonb_build_object('ok',false,'kind','not_dead'); END IF;
  death_at:=c.last_death_at;
  IF death_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.node_fighter nf JOIN public.node_encounter ne ON ne.id=nf.encounter_id
      WHERE nf.character_id=_character_id AND ne.node_id=origin AND NOT nf.present AND nf.left_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'kind','state_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.node_fighter nf JOIN public.node_encounter ne ON ne.id=nf.encounter_id
      WHERE nf.character_id=_character_id AND nf.present AND ne.status='active') THEN
    RETURN jsonb_build_object('ok',false,'kind','state_changed');
  END IF;
  SELECT * INTO cfg FROM public.combat2_respawn_config WHERE singleton FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.nodes n WHERE n.id=cfg.default_node_id)
     OR EXISTS(SELECT 1 FROM public.combat2_test_arena_node t WHERE t.node_id=cfg.default_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','configuration_error');
  END IF;
  eligible_at:=death_at+make_interval(secs=>cfg.delay_ms/1000.0);
  IF clock_timestamp()<eligible_at THEN RETURN jsonb_build_object('ok',false,'kind','not_ready','eligible_at',eligible_at); END IF;
  loss:=LEAST(GREATEST(COALESCE(c.gold,0),0),FLOOR(GREATEST(COALESCE(c.gold,0),0)*cfg.gold_loss_rate)::integer);
  restored:=LEAST(cfg.restored_hp,GREATEST(c.max_hp,1));

  UPDATE public.node_intent SET status='rejected',reject_reason='character_respawned'
    WHERE character_id=_character_id AND status='pending';
  DELETE FROM public.node_effect WHERE source_character_id=_character_id OR target_character_id=_character_id;
  UPDATE public.node_pending_event SET consumed_at=COALESCE(consumed_at,now())
    WHERE consumed_at IS NULL AND (actor_character_id=_character_id OR target_character_id=_character_id);
  UPDATE public.combat2_departure_request SET status='dead',resolved_at=COALESCE(resolved_at,now())
    WHERE character_id=_character_id AND status='queued';
  UPDATE public.node_fighter SET present=false,left_at=COALESCE(left_at,now()),exit_request_id=NULL,updated_at=now()
    WHERE character_id=_character_id;
  IF encounter.id IS NOT NULL THEN
    UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
      claim_expires_at=NULL,intent_cutoff_seq=NULL,updated_at=now() WHERE id=encounter.id;
  END IF;
  PERFORM set_config('app.combat2_respawn_authorized','true',true);
  UPDATE public.characters SET hp=restored,gold=GREATEST(COALESCE(gold,0)-loss,0),current_node_id=cfg.default_node_id
    WHERE id=_character_id AND hp<=0 AND current_node_id=origin AND last_death_at=death_at;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','state_changed'); END IF;
  INSERT INTO public.combat2_respawn_request(request_id,character_id,origin_node_id,destination_node_id,death_at,restored_hp,gold_lost)
    VALUES(_request_id,_character_id,origin,cfg.default_node_id,death_at,restored,loss);
  SELECT name INTO destination_name FROM public.nodes WHERE id=cfg.default_node_id;
  RETURN jsonb_build_object('ok',true,'kind','respawned','request_id',_request_id,
    'destination_node_id',cfg.default_node_id,'destination_name',destination_name,'restored_hp',restored,'gold_lost',loss);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'kind','error','stage','respawn','code',SQLSTATE);
END $$;
REVOKE ALL ON FUNCTION public.combat2_respawn(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_respawn(uuid,uuid) TO authenticated,service_role;