-- LOCAL / NON-DEPLOYABLE reduced schema. Does not reproduce production FK/RLS.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_%' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE SCHEMA g4a8;
ALTER TABLE g4a6.encounters ADD COLUMN node_id uuid, ADD COLUMN created_at timestamptz DEFAULT now();
CREATE TABLE g4a6.encounter_engagements(encounter_id uuid,character_id uuid);
CREATE TABLE g4a6.encounter_participants(encounter_id uuid,character_id uuid);
CREATE TABLE g4a6.combat_actions(encounter_id uuid,character_id uuid,status text,reject_reason text,updated_at timestamptz);
-- Combat1 scheduler and advisory-key delegates are doubles, not repaired or
-- asserted source-equivalent. Only uncontented cleanup is exercised.
CREATE FUNCTION g4a6.arm_effects_catchup_for_node(n uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION g4a6.encounter_lock_key(e uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT hashtextextended('fixture-combat1:'||e::text,0) $$;
ALTER TABLE g4a6.characters ADD COLUMN mp integer DEFAULT 100;
ALTER TABLE g4a6.node_effect ADD COLUMN target_character_id uuid;
ALTER TABLE g4a6.node_arrival_group ADD COLUMN arrival_seq bigserial;
CREATE TABLE g4a6.combat2_departure_request(
 request_id uuid PRIMARY KEY,character_id uuid,origin_node_id uuid,destination_node_id uuid,
 encounter_id uuid,fighter_id uuid,fighter_entry_seq bigint,cost integer DEFAULT 1,
 resource_kind text DEFAULT 'mp',status text DEFAULT 'queued',resolved_tick integer,resolved_at timestamptz);
CREATE TABLE g4a6.combat2_party_departure_request(
 request_id uuid PRIMARY KEY,origin_node_id uuid,destination_node_id uuid,status text DEFAULT 'queued',result jsonb,resolved_at timestamptz);
CREATE TABLE g4a6.combat2_party_departure_member(
 request_id uuid,character_id uuid,display_name text,movement_order integer,departure_request_id uuid,cost integer DEFAULT 1,
 status text DEFAULT 'queued',resolved_at timestamptz,PRIMARY KEY(request_id,character_id));
-- Replay result helper double; ordered source finalizer itself is extracted.
CREATE FUNCTION g4a6.combat2_party_departure_result(r uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('ok',true,'kind','already_moved','members',result) FROM g4a6.combat2_party_departure_request WHERE request_id=r $$;
