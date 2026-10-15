-- DISPOSABLE LOCAL FIXTURE ONLY. Reduced tables, not a production schema copy.
DO $$ BEGIN
 IF current_database() NOT LIKE 'g4a6_fixture_%' THEN RAISE EXCEPTION 'local fixture database required'; END IF;
END $$;
CREATE SCHEMA g4a6;
CREATE TABLE g4a6.fixture_marker (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton));
INSERT INTO g4a6.fixture_marker VALUES(true);
CREATE TABLE g4a6.node_encounter (
 id uuid PRIMARY KEY, node_id uuid UNIQUE NOT NULL, status text NOT NULL CHECK(status IN('active','ended')),
 state_version bigint NOT NULL DEFAULT 0, tick integer NOT NULL DEFAULT 0,
 claim_token uuid, claim_expires_at timestamptz, claimed_tick integer
);
CREATE TABLE g4a6.creatures (
 id uuid PRIMARY KEY,node_id uuid,hp integer NOT NULL,max_hp integer NOT NULL CHECK(max_hp>0),
 is_alive boolean NOT NULL,spawn_seq integer NOT NULL DEFAULT 1,
 regen_bps integer NOT NULL DEFAULT 500 CHECK(regen_bps BETWEEN 0 AND 10000),
 eligible_since timestamptz,accounted_through timestamptz,
 fractional_credit bigint NOT NULL DEFAULT 0 CHECK(fractional_credit BETWEEN 0 AND 599999999999),
 CHECK(hp BETWEEN 0 AND max_hp),CHECK(is_alive=(hp>0))
);
CREATE TABLE g4a6.node_creature (
 id uuid PRIMARY KEY,encounter_id uuid NOT NULL REFERENCES g4a6.node_encounter,
 creature_id uuid NOT NULL REFERENCES g4a6.creatures,spawn_seq integer NOT NULL,hp integer NOT NULL,
 is_alive boolean NOT NULL,engaged boolean NOT NULL DEFAULT false,pending_action jsonb,tank_fighter_id uuid,
 UNIQUE(creature_id,spawn_seq)
);
CREATE TABLE g4a6.node_fighter (
 id uuid PRIMARY KEY,encounter_id uuid NOT NULL REFERENCES g4a6.node_encounter,
 character_id uuid NOT NULL,entry_seq bigint NOT NULL DEFAULT 1,present boolean NOT NULL,hp integer NOT NULL
);
CREATE TABLE g4a6.node_effect (
 id uuid PRIMARY KEY,encounter_id uuid NOT NULL REFERENCES g4a6.node_encounter,
 kind text NOT NULL,target_creature_id uuid,source_creature_id uuid,source_character_id uuid,
 config jsonb NOT NULL DEFAULT '{}',is_reservation boolean NOT NULL DEFAULT false
);
CREATE TABLE g4a6.node_intent (id uuid PRIMARY KEY,encounter_id uuid REFERENCES g4a6.node_encounter,status text NOT NULL);
CREATE TABLE g4a6.node_pending_event (id uuid PRIMARY KEY,encounter_id uuid REFERENCES g4a6.node_encounter,consumed_at timestamptz);
-- Fixture doubles omit Auth, parties, rewards, cron, lifecycle triggers and DDL.
