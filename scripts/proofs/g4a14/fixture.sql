-- LOCAL / NON-DEPLOYABLE. Reduced dependencies; no production grants or DDL.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_g4a14_%' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE TABLE g4a6.classes(class_key text PRIMARY KEY,base_hp integer NOT NULL,level_bonuses jsonb NOT NULL);
-- Observed configuration, progression-001C-installed-preflight.md class table.
INSERT INTO g4a6.classes VALUES('warrior',24,'{"dex":1,"str":1}');
