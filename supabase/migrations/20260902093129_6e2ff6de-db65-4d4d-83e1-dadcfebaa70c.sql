-- Authoritative Combat2 arrival groups, party representatives, engagement and
-- opportunity transitions. Combat remains controlled by combat_config.

CREATE TABLE public.node_arrival_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  generation bigint NOT NULL,
  arrival_seq bigserial NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT node_arrival_group_generation_uniq UNIQUE (encounter_id, party_id, generation)
);
CREATE UNIQUE INDEX node_arrival_group_active_party_uniq
  ON public.node_arrival_group(encounter_id, party_id) WHERE active AND party_id IS NOT NULL;
CREATE INDEX node_arrival_group_priority_idx
  ON public.node_arrival_group(encounter_id, active, arrival_seq DESC);

ALTER TABLE public.node_fighter
  ADD COLUMN arrival_group_id uuid REFERENCES public.node_arrival_group(id) ON DELETE SET NULL,
  ADD COLUMN exit_request_id uuid REFERENCES public.node_pending_event(id) ON DELETE SET NULL;
ALTER TABLE public.node_creature ADD COLUMN engaged boolean NOT NULL DEFAULT false;

REVOKE ALL ON public.node_arrival_group FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.node_arrival_group TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_refresh_tanks(_encounter_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_group public.node_arrival_group; v_fighter uuid;
BEGIN
  FOR v_group IN SELECT * FROM public.node_arrival_group
    WHERE encounter_id = _encounter_id AND active ORDER BY arrival_seq DESC, id DESC LOOP
    v_fighter := NULL;
    IF v_group.party_id IS NULL THEN
      SELECT nf.id INTO v_fighter FROM public.node_fighter nf
       JOIN public.characters c ON c.id = nf.character_id
       WHERE nf.arrival_group_id = v_group.id AND nf.present AND c.hp > 0
       ORDER BY nf.entry_seq DESC, nf.id DESC LIMIT 1;
    ELSE
      SELECT nf.id INTO v_fighter
      FROM public.node_fighter nf
      JOIN public.characters c ON c.id = nf.character_id
      JOIN public.parties p ON p.id = v_group.party_id
      JOIN public.party_members pm ON pm.party_id = p.id
        AND pm.character_id = nf.character_id AND pm.status = 'accepted'
      WHERE nf.arrival_group_id = v_group.id AND nf.present AND c.hp > 0
      ORDER BY
        CASE WHEN nf.character_id = p.tank_id THEN 0
             WHEN nf.character_id = p.leader_id THEN 1 ELSE 2 END,
        nf.entry_seq DESC, nf.id DESC
      LIMIT 1;
    END IF;
    EXIT WHEN v_fighter IS NOT NULL;
  END LOOP;
  UPDATE public.node_creature SET tank_fighter_id = v_fighter, updated_at = now()
   WHERE encounter_id = _encounter_id AND is_alive
     AND tank_fighter_id IS DISTINCT FROM v_fighter;
  RETURN v_fighter;
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_refresh_tanks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_refresh_tanks(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_fighter_presence_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.present IS DISTINCT FROM NEW.present AND NEW.arrival_group_id IS NOT NULL THEN
    UPDATE public.node_arrival_group g
       SET active = EXISTS (SELECT 1 FROM public.node_fighter nf
                             WHERE nf.arrival_group_id = g.id AND nf.present),
           deactivated_at = CASE WHEN EXISTS (SELECT 1 FROM public.node_fighter nf
                                               WHERE nf.arrival_group_id = g.id AND nf.present)
                                 THEN NULL ELSE now() END
     WHERE g.id = NEW.arrival_group_id;
    PERFORM public.combat2_refresh_tanks(NEW.encounter_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER combat2_fighter_presence_changed
AFTER UPDATE OF present ON public.node_fighter
FOR EACH ROW EXECUTE FUNCTION public.combat2_fighter_presence_changed();

CREATE OR REPLACE FUNCTION public.combat2_validate_party_tank()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.tank_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.party_members pm WHERE pm.party_id = NEW.id
      AND pm.character_id = NEW.tank_id AND pm.status = 'accepted'
  ) THEN RAISE EXCEPTION 'tank must be an accepted party member'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER combat2_validate_party_tank
BEFORE UPDATE OF tank_id ON public.parties
FOR EACH ROW EXECUTE FUNCTION public.combat2_validate_party_tank();

CREATE OR REPLACE FUNCTION public.combat2_party_tank_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_encounter uuid;
BEGIN
  FOR v_encounter IN SELECT DISTINCT g.encounter_id FROM public.node_arrival_group g
    WHERE g.party_id = NEW.id AND g.active LOOP
    UPDATE public.node_encounter SET state_version = state_version + 1,
      claim_token = NULL, claimed_tick = NULL, claim_expires_at = NULL, updated_at = now()
      WHERE id = v_encounter;
    PERFORM public.combat2_refresh_tanks(v_encounter);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER combat2_party_tank_changed
AFTER UPDATE OF tank_id ON public.parties
FOR EACH ROW WHEN (OLD.tank_id IS DISTINCT FROM NEW.tank_id)
EXECUTE FUNCTION public.combat2_party_tank_changed();

CREATE OR REPLACE FUNCTION public.set_party_tank(_party_id uuid, _tank_character_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.parties;
BEGIN
  SELECT * INTO p FROM public.parties WHERE id = _party_id FOR UPDATE;
  IF NOT FOUND OR NOT public.owns_character(p.leader_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized');
  END IF;
  IF _tank_character_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.party_members WHERE party_id = p.id
      AND character_id = _tank_character_id AND status = 'accepted'
  ) THEN RETURN jsonb_build_object('ok', false, 'kind', 'not_member'); END IF;
  UPDATE public.parties SET tank_id = _tank_character_id WHERE id = p.id
    AND tank_id IS DISTINCT FROM _tank_character_id;
  RETURN jsonb_build_object('ok', true, 'kind', 'set', 'tank_character_id', _tank_character_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_party_tank(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_party_tank(uuid, uuid) TO authenticated, service_role;

-- Engagement is committed atomically with the first qualifying hostile action.
CREATE OR REPLACE FUNCTION public.combat2_engage_from_participation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.qualification = 'qualified' AND NEW.qualified_by IN ('damage','debuff') THEN
    UPDATE public.node_creature SET engaged = true, updated_at = now()
      WHERE encounter_id = NEW.encounter_id AND creature_id = NEW.creature_id
        AND spawn_seq = NEW.spawn_seq AND is_alive AND NOT engaged;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER combat2_engage_from_participation
AFTER INSERT OR UPDATE OF qualification, qualified_by ON public.node_participation
FOR EACH ROW EXECUTE FUNCTION public.combat2_engage_from_participation();

CREATE OR REPLACE FUNCTION public.combat_enter(_character_id uuid, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prior public.node_pending_event; e public.node_encounter; f public.node_fighter;
  v_node uuid; v_check uuid; v_party uuid; v_group uuid; v_fighter uuid;
  v_seq bigint; v_generation bigint; v_event uuid; v_version bigint;
  v_reentry boolean := false; v_reactivated boolean := false;
BEGIN
  IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','mode_refused','reason','maintenance'); END IF;
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_required'); END IF;
  IF NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized','reason','character'); END IF;
  SELECT * INTO prior FROM public.node_pending_event WHERE request_id = _request_id;
  IF FOUND THEN
    IF prior.actor_character_id IS DISTINCT FROM _character_id OR prior.event_type <> 'fighter_entered' THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'kind','already_entered','encounter_id',prior.encounter_id,
      'event_id',prior.id,'fighter_id',prior.payload->>'fighter_id','entry_seq',(prior.payload->>'entry_seq')::bigint);
  END IF;
  SELECT current_node_id INTO v_node FROM public.characters WHERE id = _character_id;
  IF v_node IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','no_node'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:' || v_node::text,0));
  SELECT current_node_id INTO v_check FROM public.characters WHERE id = _character_id;
  IF v_check IS DISTINCT FROM v_node THEN RETURN jsonb_build_object('ok',false,'kind','node_changed'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creatures WHERE node_id=v_node AND is_alive) THEN
    RETURN jsonb_build_object('ok',false,'kind','no_living_creatures');
  END IF;
  SELECT * INTO e FROM public.node_encounter WHERE node_id=v_node FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.node_encounter(node_id,status,next_due_at) VALUES(v_node,'active',now()) RETURNING * INTO e;
  ELSIF e.status <> 'active' THEN
    v_reactivated := true;
    UPDATE public.node_fighter SET present=false,left_at=COALESCE(left_at,now()),updated_at=now() WHERE encounter_id=e.id AND present;
    UPDATE public.node_arrival_group SET active=false,deactivated_at=now() WHERE encounter_id=e.id AND active;
    UPDATE public.node_creature SET tank_fighter_id=NULL,engaged=false,updated_at=now() WHERE encounter_id=e.id AND is_alive;
    UPDATE public.node_encounter SET status='active',next_due_at=now(),updated_at=now() WHERE id=e.id RETURNING * INTO e;
  END IF;
  PERFORM public.combat2_seed_spawns(e.id, v_node);
  SELECT pm.party_id INTO v_party FROM public.party_members pm
    WHERE pm.character_id=_character_id AND pm.status='accepted' LIMIT 1;
  IF v_party IS NULL THEN
    SELECT COALESCE(MAX(g.generation),0)+1 INTO v_generation FROM public.node_arrival_group g
      WHERE g.encounter_id=e.id AND g.party_id IS NULL;
    INSERT INTO public.node_arrival_group(encounter_id,party_id,generation)
      VALUES(e.id,NULL,v_generation) RETURNING id INTO v_group;
  ELSE
    SELECT g.id INTO v_group FROM public.node_arrival_group g
      WHERE g.encounter_id=e.id AND g.party_id=v_party AND g.active LIMIT 1;
    IF v_group IS NULL THEN
      SELECT COALESCE(MAX(g.generation),0)+1 INTO v_generation FROM public.node_arrival_group g
        WHERE g.encounter_id=e.id AND g.party_id=v_party;
      INSERT INTO public.node_arrival_group(encounter_id,party_id,generation)
        VALUES(e.id,v_party,v_generation) RETURNING id INTO v_group;
    END IF;
  END IF;
  SELECT nf.* INTO f FROM public.node_fighter nf WHERE nf.encounter_id=e.id AND nf.character_id=_character_id FOR UPDATE;
  IF FOUND AND f.present THEN
    RETURN jsonb_build_object('ok',false,'kind','already_present','encounter_id',e.id,'fighter_id',f.id,'entry_seq',f.entry_seq);
  END IF;
  v_seq := nextval('node_fighter_entry_seq_seq');
  IF FOUND THEN
    v_reentry := true;
    UPDATE public.node_fighter SET present=true,left_at=NULL,entry_seq=v_seq,joined_at=now(),party_id_at_entry=v_party,
      arrival_group_id=v_group,exit_request_id=NULL,updated_at=now() WHERE id=f.id RETURNING id INTO v_fighter;
  ELSE
    INSERT INTO public.node_fighter(encounter_id,character_id,entry_seq,present,party_id_at_entry,joined_at,arrival_group_id)
      VALUES(e.id,_character_id,v_seq,true,v_party,now(),v_group) RETURNING id INTO v_fighter;
  END IF;
  UPDATE public.node_creature nc SET engaged=true,updated_at=now()
    FROM public.creatures cr WHERE nc.encounter_id=e.id AND nc.creature_id=cr.id AND nc.is_alive
      AND cr.is_aggressive=true AND NOT nc.engaged;
  PERFORM public.combat2_refresh_tanks(e.id);
  INSERT INTO public.node_pending_event(encounter_id,event_type,actor_character_id,payload,request_id)
    VALUES(e.id,'fighter_entered',_character_id,jsonb_build_object('fighter_id',v_fighter,'node_id',v_node,
      'entry_seq',v_seq,'arrival_group_id',v_group,'reentry',v_reentry,'reactivated',v_reactivated),_request_id)
    RETURNING id INTO v_event;
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
    claim_expires_at=NULL,updated_at=now() WHERE id=e.id RETURNING state_version INTO v_version;
  RETURN jsonb_build_object('ok',true,'kind',CASE WHEN v_reentry THEN 'reentered' ELSE 'entered' END,
    'encounter_id',e.id,'node_id',v_node,'reactivated',v_reactivated,'fighter_id',v_fighter,
    'entry_seq',v_seq,'event_id',v_event,'state_version',v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.combat_flee(_encounter_id uuid,_character_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.node_encounter; pe public.node_pending_event; f public.node_fighter; v_event uuid; v_version bigint; v_hp integer;
BEGIN
  IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','mode_refused','reason','maintenance'); END IF;
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_required'); END IF;
  IF NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized','reason','character'); END IF;
  SELECT * INTO pe FROM public.node_pending_event WHERE request_id=_request_id;
  IF FOUND THEN
    IF pe.actor_character_id IS DISTINCT FROM _character_id OR pe.encounter_id<>_encounter_id OR pe.event_type<>'fighter_exit_requested' THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_conflict'); END IF;
    SELECT * INTO f FROM public.node_fighter WHERE id=(pe.payload->>'fighter_id')::uuid;
    SELECT hp INTO v_hp FROM public.characters WHERE id=f.character_id;
    RETURN jsonb_build_object('ok',true,'kind',CASE WHEN pe.consumed_at IS NULL THEN 'queued'
      WHEN v_hp<=0 THEN 'dead' ELSE 'fled' END,'event_id',pe.id,'fighter_id',f.id);
  END IF;
  SELECT * INTO e FROM public.node_encounter WHERE id=_encounter_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','no_encounter'); END IF;
  SELECT nf.* INTO f FROM public.node_fighter nf WHERE nf.encounter_id=e.id AND nf.character_id=_character_id AND nf.present FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','not_present'); END IF;
  IF f.exit_request_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','exit_pending','event_id',f.exit_request_id); END IF;
  INSERT INTO public.node_pending_event(encounter_id,event_type,actor_character_id,payload,request_id)
    VALUES(e.id,'fighter_exit_requested',_character_id,jsonb_build_object('fighter_id',f.id,'entry_seq',f.entry_seq,'node_id',e.node_id),_request_id)
    RETURNING id INTO v_event;
  UPDATE public.node_fighter SET exit_request_id=v_event,updated_at=now() WHERE id=f.id;
  UPDATE public.node_intent SET status='rejected',reject_reason='exit_pending'
    WHERE encounter_id=e.id AND character_id=_character_id AND status='pending';
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
    claim_expires_at=NULL,next_due_at=LEAST(next_due_at,now()),updated_at=now() WHERE id=e.id RETURNING state_version INTO v_version;
  RETURN jsonb_build_object('ok',true,'kind','queued','event_id',v_event,'fighter_id',f.id,'state_version',v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.combat_enter(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat_enter(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.combat_flee(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat_flee(uuid,uuid,uuid) TO authenticated, service_role;

-- Extend the installed claim and safe-sync projections without duplicating their
-- authorization, pagination, boss snapshot or event-whitelist bodies.
DO $$ DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO d;
  IF position('''tank_fighter_id'', nc.tank_fighter_id,' in d) = 0 THEN
    RAISE EXCEPTION 'unexpected node_tick_claim contract';
  END IF;
  d := replace(d, '''tank_fighter_id'', nc.tank_fighter_id,',
    '''tank_fighter_id'', nc.tank_fighter_id, ''engaged'', nc.engaged,');
  d := replace(d, '''present'', nf.present, ''party_id_at_entry'', nf.party_id_at_entry,',
    '''present'', nf.present, ''party_id_at_entry'', nf.party_id_at_entry, ''arrival_group_id'', nf.arrival_group_id, ''exit_request_id'', nf.exit_request_id,');
  EXECUTE d;

  SELECT pg_get_functiondef('public.combat2_sync(uuid,uuid,bigint,integer)'::regprocedure) INTO d;
  IF position('''isAlive'', nc.is_alive,' in d) = 0 THEN RAISE EXCEPTION 'unexpected combat2_sync contract'; END IF;
  d := replace(d, '''isAlive'', nc.is_alive,',
    '''isAlive'', nc.is_alive, ''tankFighterId'', nc.tank_fighter_id, ''engaged'', nc.engaged,');
  d := replace(d, '''leftAt'', nf.left_at' || chr(10),
    '''leftAt'', nf.left_at, ''exitState'', CASE WHEN nf.exit_request_id IS NULL THEN NULL WHEN nf.present THEN ''pending'' WHEN c.hp <= 0 THEN ''dead'' ELSE ''exited'' END' || chr(10));
  d := replace(d, 'FROM public.node_fighter nf' || chr(10) || '  WHERE nf.encounter_id',
    'FROM public.node_fighter nf JOIN public.characters c ON c.id = nf.character_id' || chr(10) || '  WHERE nf.encounter_id');
  EXECUTE d;
END $$;
