-- LOCAL ONLY: extends the G4A6 disposable fixture, not production DDL.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_%' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE SCHEMA g4a7;
CREATE FUNCTION g4a6.test_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('g4a7.cutoff',true),''),'2026-01-01T00:00:00Z')::timestamptz;
$$;
ALTER TABLE g4a6.node_encounter ALTER id SET DEFAULT gen_random_uuid();
ALTER TABLE g4a6.node_encounter ADD next_due_at timestamptz DEFAULT '2025-01-01',ADD intent_cutoff_seq bigint,ADD updated_at timestamptz;
ALTER TABLE g4a6.creatures ADD name text DEFAULT 'local creature',ADD level integer DEFAULT 1,ADD ac integer DEFAULT 10,
 ADD stats jsonb DEFAULT '{}',ADD rarity text DEFAULT 'regular',ADD is_humanoid boolean DEFAULT false,
 ADD is_aggressive boolean DEFAULT true,ADD base_aggressive boolean DEFAULT true,ADD boss_crit_flavors jsonb DEFAULT '[]',
 ADD boss_death_cry text,ADD died_at timestamptz,ADD last_damaged_at timestamptz,ADD respawn_seconds integer DEFAULT 300,
 ADD rewards_awarded_at timestamptz;
ALTER TABLE g4a6.node_creature ALTER id SET DEFAULT gen_random_uuid();
ALTER TABLE g4a6.node_creature ADD created_at timestamptz DEFAULT g4a6.test_now(),ADD updated_at timestamptz,
 ADD last_damaged_at timestamptz,ADD died_at timestamptz;
ALTER TABLE g4a6.node_fighter ALTER id SET DEFAULT gen_random_uuid(),ALTER hp SET DEFAULT 100;
ALTER TABLE g4a6.node_fighter ADD left_at timestamptz,ADD updated_at timestamptz,ADD joined_at timestamptz,
 ADD party_id_at_entry uuid,ADD arrival_group_id uuid,ADD exit_request_id uuid;
CREATE SEQUENCE g4a6.node_fighter_entry_seq_seq;
CREATE TABLE g4a6.characters(id uuid PRIMARY KEY,user_id uuid,current_node_id uuid,hp integer DEFAULT 100,class text DEFAULT 'warrior',deleted_at timestamptz);
CREATE TABLE g4a6.party_members(character_id uuid,party_id uuid,status text);
CREATE TABLE g4a6.node_arrival_group(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encounter_id uuid,party_id uuid,
 generation bigint,active boolean DEFAULT true,deactivated_at timestamptz);
ALTER TABLE g4a6.node_pending_event ALTER id SET DEFAULT gen_random_uuid();
ALTER TABLE g4a6.node_pending_event ADD actor_character_id uuid,ADD event_type text,ADD payload jsonb,ADD request_id uuid UNIQUE,ADD consumed_tick integer;
ALTER TABLE g4a6.node_intent ALTER id SET DEFAULT gen_random_uuid();
ALTER TABLE g4a6.node_intent ADD seq bigserial,ADD character_id uuid,ADD intent_kind text,ADD ability_key text,
 ADD stance_key text,ADD target_creature_id uuid,ADD target_character_id uuid,ADD request_id uuid UNIQUE,ADD reject_reason text;
CREATE TABLE g4a6.class_ability_assignments(class_key text,status text,ability_id uuid,class_ability_key text,unlock_level integer);
CREATE TABLE g4a6.abilities(id uuid,ability_key text,target_type text,activation_mode text,status text);
-- Explicit dependency doubles; not Supabase Auth, tank selection or Combat1.
CREATE FUNCTION g4a6.owns_character(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM g4a6.characters WHERE id=cid AND deleted_at IS NULL
 AND user_id=nullif(current_setting('g4a7.actor',true),'')::uuid);
$$;
CREATE FUNCTION g4a6.combat_mode_is_open() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION g4a6.combat2_refresh_tanks(eid uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE TABLE g4a6.encounters(id uuid,status text);
CREATE TABLE g4a6.encounter_creatures(encounter_id uuid,creature_id uuid);
CREATE TABLE g4a6.combat_sessions(node_id uuid,engaged_creature_ids uuid[]);
CREATE TABLE g4a6.active_effects(target_id uuid,expires_at bigint);

-- Intent admission double behind the extracted source lock wrapper. Validates
-- fixture owner/target/replay, not the real catalogue/resource/stance authority.
CREATE FUNCTION g4a6.combat_intent_without_global_lock_order(eid uuid,actor uuid,kind text,ability text,stance text,target uuid,target_char uuid,request uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE prior g4a6.node_intent; cid uuid;
BEGIN
 IF NOT g4a6.owns_character(actor) OR current_setting('g4a7.refuse_intent',true)='on' THEN RETURN jsonb_build_object('ok',false,'kind','fixture_refusal'); END IF;
 SELECT * INTO prior FROM g4a6.node_intent WHERE request_id=request;
 IF FOUND THEN
   IF prior.character_id IS DISTINCT FROM actor OR prior.target_creature_id IS DISTINCT FROM target OR prior.intent_kind IS DISTINCT FROM kind
   THEN RETURN jsonb_build_object('ok',false,'kind','request_conflict'); END IF;
   RETURN jsonb_build_object('ok',true,'kind','already_accepted','intent_id',prior.id);
 END IF;
 SELECT c.id INTO STRICT cid FROM g4a6.creatures c JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq
 WHERE nc.encounter_id=eid AND c.id=target AND c.is_alive;
 PERFORM g4a6.lock_creature(cid);
 UPDATE g4a6.node_encounter SET claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL WHERE id=eid;
 PERFORM g4a6.settle(cid,g4a6.test_now());
 INSERT INTO g4a6.node_intent(encounter_id,character_id,intent_kind,ability_key,stance_key,target_creature_id,target_character_id,request_id,status)
 VALUES(eid,actor,kind,ability,stance,target,target_char,request,'pending') RETURNING * INTO prior;
 PERFORM g4a6.reconcile(cid,g4a6.test_now());
 RETURN jsonb_build_object('ok',true,'kind','accepted','intent_id',prior.id);
END $$;
