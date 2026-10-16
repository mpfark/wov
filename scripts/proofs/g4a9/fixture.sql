-- LOCAL / NON-DEPLOYABLE reduced fixture; no production DDL or grants.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_%' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE SCHEMA g4a9;
CREATE FUNCTION g4a9.actor_uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('g4a7.actor',true),'')::uuid $$;
CREATE FUNCTION g4a9.actor_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
CREATE TABLE g4a6.nodes(id uuid PRIMARY KEY,connections jsonb DEFAULT '[]');
CREATE TABLE g4a6.items(id uuid PRIMARY KEY,name text,item_type text);
CREATE TABLE g4a6.character_inventory(character_id uuid,item_id uuid,equipped_slot text);
CREATE TABLE g4a6.parties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),leader_id uuid,tank_id uuid);
ALTER TABLE g4a6.party_members ADD id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ADD joined_at timestamptz DEFAULT g4a6.test_now(),ADD is_following boolean DEFAULT false;
CREATE TABLE g4a6.party_operation_request(request_id uuid PRIMARY KEY,caller_id uuid,actor_character_id uuid,operation text,party_id uuid,target_character_id uuid,membership_id uuid,result jsonb,created_at timestamptz DEFAULT g4a6.test_now());
CREATE TABLE g4a6.character_lifecycle_receipt(character_id uuid,owner_account_id uuid,operation text,actor_id uuid,reason text,result jsonb,purge_transaction xid8,expected_version bigint);
CREATE TABLE g4a6.character_creation_log(result_character_id uuid,replay_status text);
ALTER TABLE g4a6.characters ADD name text DEFAULT 'fixture',ADD str integer DEFAULT 10,ADD dex integer DEFAULT 10,
 ADD con integer DEFAULT 10,ADD int integer DEFAULT 10,ADD wis integer DEFAULT 10,ADD cha integer DEFAULT 10,
 ADD level integer DEFAULT 1,ADD xp bigint DEFAULT 0,ADD is_classless boolean DEFAULT false,ADD race text,
 ADD soulforged_item_created boolean DEFAULT false,ADD soulring_tier integer,ADD soulring_inventory_id uuid,ADD king_slayer_at timestamptz,
 ADD gold integer DEFAULT 0,ADD max_hp integer DEFAULT 100,ADD max_cp integer DEFAULT 100,ADD max_mp integer DEFAULT 100,
 ADD cp integer DEFAULT 100,ADD ac integer DEFAULT 10,ADD reserved_buffs jsonb DEFAULT '{}',ADD stance_state jsonb DEFAULT '{}',
 ADD bhp integer DEFAULT 0,ADD bhp_trained integer DEFAULT 0,ADD rp_total_earned integer DEFAULT 0,ADD respec_points integer DEFAULT 0,
 ADD unspent_stat_points integer DEFAULT 0,ADD family_id uuid,ADD family_name text,ADD family_changed_after_creation boolean DEFAULT false,
 ADD active_contract jsonb,ADD contracts_completed integer DEFAULT 0,ADD restore_until timestamptz,ADD lifecycle_version bigint DEFAULT 0,ADD updated_at timestamptz;
ALTER TABLE g4a6.node_pending_event ADD occurred_at timestamptz DEFAULT g4a6.test_now();
ALTER TABLE g4a6.node_fighter ADD UNIQUE(encounter_id,character_id);
-- Recreate before extracting finalizers: positional INSERT requires the exact
-- production field order. Full production FK/RLS is intentionally not copied.
DROP TABLE g4a6.combat2_party_departure_member,g4a6.combat2_party_departure_request,g4a6.combat2_departure_request;
DROP FUNCTION g4a6.combat2_party_departure_result(uuid);
DROP FUNCTION g4a6.combat2_refresh_tanks(uuid);
CREATE TABLE g4a6.combat2_departure_request(request_id uuid PRIMARY KEY,character_id uuid,origin_node_id uuid,destination_node_id uuid,direction text,encounter_id uuid,fighter_id uuid,fighter_entry_seq bigint,arrival_group_id uuid,cost integer,resource_kind text DEFAULT 'mp',status text,resolved_tick integer,created_at timestamptz DEFAULT g4a6.test_now(),resolved_at timestamptz);
CREATE TABLE g4a6.combat2_party_departure_request(request_id uuid PRIMARY KEY,caller_id uuid,leader_character_id uuid,party_id uuid,origin_node_id uuid,destination_node_id uuid,direction text,status text,result jsonb,created_at timestamptz DEFAULT g4a6.test_now(),resolved_at timestamptz);
CREATE TABLE g4a6.combat2_party_departure_member(request_id uuid,character_id uuid,display_name text,movement_order integer,departure_request_id uuid,encounter_id uuid,fighter_id uuid,fighter_entry_seq bigint,arrival_group_id uuid,cost integer,status text,resolved_tick integer,resolved_at timestamptz,PRIMARY KEY(request_id,character_id),UNIQUE(request_id,movement_order));
-- Explicit dependency doubles: allow the fixture nodes, fail closed on hidden
-- paths; neither is a production scope/visibility implementation.
CREATE FUNCTION g4a6.combat2_movement_scope_eligible(a uuid,b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT a IS NOT NULL AND b IS NOT NULL $$;
CREATE FUNCTION g4a6.hidden_connection_is_open(a uuid,b uuid,d text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
