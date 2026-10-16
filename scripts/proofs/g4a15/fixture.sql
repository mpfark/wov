-- LOCAL / NON-DEPLOYABLE. No production namespace, roles, grants or policies.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_g4a14_g4a15_%' THEN RAISE EXCEPTION 'private fixture only'; END IF; END $$;
CREATE SCHEMA g4a15;
CREATE TYPE g4a6.app_role AS ENUM ('player','steward','overlord');
CREATE TABLE g4a6.user_roles(user_id uuid,role g4a6.app_role);
ALTER TABLE g4a6.creatures ADD description text DEFAULT '',ADD unique_item_id uuid,ADD unique_drop_chance numeric;
ALTER TABLE g4a6.creatures ALTER item_source SET DEFAULT 'none',ALTER drop_chance SET DEFAULT NULL;
ALTER TABLE g4a6.creatures ALTER is_alive SET DEFAULT true;
ALTER TABLE g4a6.items ADD origin_type text,ADD origin_id uuid;
