-- Test instrumentation only: nontransactional sequence counts attempted
-- accounting even when a source refusal rolls its transaction writes back.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_%' THEN RAISE EXCEPTION 'private fixture only'; END IF; END $$;
CREATE SEQUENCE g4a13.accounting_attempt;
CREATE FUNCTION g4a13.observe_accounting() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('g4a13.watch_accounting',true)='on' THEN PERFORM nextval('g4a13.accounting_attempt'); END IF;RETURN NEW;
END $$;
CREATE TRIGGER g4a13_accounting AFTER UPDATE OF accounted_through ON g4a6.creatures FOR EACH ROW EXECUTE FUNCTION g4a13.observe_accounting();
CREATE FUNCTION g4a13.fail_relocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('g4a13.fail_relocation',true)='on' AND NEW.current_node_id IS DISTINCT FROM OLD.current_node_id THEN RAISE EXCEPTION 'controlled fixture relocation failure' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER g4a13_fail_relocation BEFORE UPDATE OF current_node_id ON g4a6.characters FOR EACH ROW EXECUTE FUNCTION g4a13.fail_relocation();
