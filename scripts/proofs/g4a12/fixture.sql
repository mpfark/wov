-- LOCAL ONLY. Extends reduced G4A9 tables, never a production schema/migration.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'private fixture only'; END IF; END $$;
CREATE SCHEMA g4a12;
ALTER TABLE g4a6.node_encounter ADD created_at timestamptz DEFAULT g4a6.test_now(),ADD test_arena_id uuid;
ALTER TABLE g4a6.characters ADD last_death_at timestamptz;
ALTER TABLE g4a6.creatures ADD boss_cast jsonb,ADD loot_table_id uuid,ADD loot_table jsonb DEFAULT '[]',ADD gold integer DEFAULT 0;
ALTER TABLE g4a6.node_pending_event ADD actor_creature_id uuid,ADD target_creature_id uuid,ADD target_character_id uuid;
ALTER TABLE g4a6.node_effect ADD created_at timestamptz DEFAULT g4a6.test_now(),ADD effect_type text,ADD ability_key text,
 ADD stacks integer DEFAULT 1,ADD magnitude numeric,ADD expires_at timestamptz,ADD next_due_at timestamptz,
 ADD interval_ms integer,ADD last_pulse_tick integer;
ALTER TABLE g4a6.node_effect ALTER id SET DEFAULT gen_random_uuid();
ALTER TABLE g4a6.items ADD stats jsonb DEFAULT '{}',ADD procs jsonb DEFAULT '[]',ADD rarity text DEFAULT 'common',
 ADD level integer DEFAULT 1,ADD weapon_tag text,ADD hands integer,ADD max_durability integer DEFAULT 100,
 ADD world_drop boolean DEFAULT false,ADD is_soulbound boolean DEFAULT false,ADD drop_weight integer DEFAULT 1;
ALTER TABLE g4a6.character_inventory ADD id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ADD current_durability integer DEFAULT 100,
 ADD applied_gems jsonb DEFAULT '{}',ADD stat_override jsonb,ADD crafted_level integer;
CREATE TABLE g4a6.node_participation(id uuid DEFAULT gen_random_uuid(),encounter_id uuid,creature_id uuid,spawn_seq integer,
 character_id uuid,qualification text,qualified_by text,party_id_at_qualification uuid,first_at timestamptz DEFAULT g4a6.test_now(),last_at timestamptz,
 UNIQUE(encounter_id,creature_id,spawn_seq,character_id));
CREATE TABLE g4a6.node_reward_claim(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encounter_id uuid,node_creature_id uuid,creature_id uuid,
 spawn_seq integer,character_id uuid,xp_awarded integer,gold_awarded integer,is_killer boolean,UNIQUE(creature_id,spawn_seq,character_id));
CREATE TABLE g4a6.node_death_loot(encounter_id uuid,node_creature_id uuid,creature_id uuid,spawn_seq integer,loot_key text,item_id uuid,mode text,outcome text,ground_loot_id uuid,UNIQUE(encounter_id,node_creature_id,spawn_seq,loot_key));
CREATE TABLE g4a6.node_ground_loot(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),node_id uuid,item_id uuid,creature_name text);
CREATE TABLE g4a6.node_tick_batch(encounter_id uuid,tick integer,events jsonb,PRIMARY KEY(encounter_id,tick));
CREATE TABLE g4a6.node_boss_ability_cooldown(encounter_id uuid,node_creature_id uuid,creature_id uuid,spawn_seq bigint,ability_key text,next_available_tick bigint,PRIMARY KEY(encounter_id,node_creature_id,spawn_seq,ability_key));
CREATE TABLE g4a6.character_stance(character_id uuid,ability_key text,reserve_pct numeric,version bigint DEFAULT 0,state jsonb,activated_at timestamptz,updated_at timestamptz,PRIMARY KEY(character_id,ability_key));
CREATE TABLE g4a6.character_stance_request(request_id uuid,intent_id uuid,character_id uuid,ability_key text,action text,encounter_id uuid,committed_at timestamptz);
CREATE TABLE g4a6.xp_boost(expires_at timestamptz,multiplier numeric);
CREATE TABLE g4a6.loot_pool_config(id integer,drop_chance_regular numeric,drop_chance_rare numeric,drop_chance_boss numeric,
 equip_level_min_offset integer,equip_level_max_offset integer,common_pct integer,uncommon_pct integer,consumable_drop_chance numeric,
 consumable_level_min_offset integer,consumable_level_max_offset integer);
INSERT INTO g4a6.loot_pool_config VALUES(1,0,0,0,-3,0,80,20,0,-5,0);
CREATE TABLE g4a6.loot_table_entries(id uuid,loot_table_id uuid,item_id uuid,weight integer);
-- Explicit scope double, not production mode/Arena authorization.
CREATE FUNCTION g4a6.combat2_node_runtime_eligible(n uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM g4a6.nodes WHERE id=n) $$;
-- Progression is outside this bounded fixture. Record calls and fail on demand;
-- no fake claim that XP/progression authorities executed or runtime XP works.
CREATE TABLE g4a12.progression_calls(claim_id uuid PRIMARY KEY,encounter_id uuid);
CREATE FUNCTION g4a6.combat2_apply_claim_progression_internal(c uuid,e uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('g4a12.fail_progression',true)='on' THEN RAISE EXCEPTION 'fixture progression failure' USING ERRCODE='P0001'; END IF;
 INSERT INTO g4a12.progression_calls VALUES(c,e);
END $$;
-- Candidate's reduced fighter HP cache is not a production field/authority.
CREATE FUNCTION g4a12.mirror_fixture_fighter_hp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE g4a6.node_fighter SET hp=NEW.hp WHERE character_id=NEW.id; RETURN NEW; END $$;
CREATE TRIGGER g4a12_cache AFTER UPDATE OF hp ON g4a6.characters FOR EACH ROW EXECUTE FUNCTION g4a12.mirror_fixture_fighter_hp();
ALTER TABLE g4a6.creatures ADD gold_enabled boolean DEFAULT false,ADD gold_min integer DEFAULT 0,ADD gold_max integer DEFAULT 0,
 ADD gold_chance numeric DEFAULT 0,ADD salvage_enabled boolean DEFAULT false,ADD item_source text DEFAULT 'pool',ADD loot_mode text DEFAULT 'none',ADD drop_chance numeric DEFAULT 0;
ALTER TABLE g4a6.node_intent ADD target_fighter_id uuid,ADD target_entry_seq bigint;
