import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
const extract=(path,name)=>{
 const source=read(path),start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
 if(start<0)throw Error('Missing fixture source '+name);
 const end=source.indexOf('END $$;',start);if(end<0)throw Error('Missing source delimiter');
 return source.slice(start,end+8);
};
export const original=extract('supabase/migrations/20260913100000_combat2_production_cutover.sql','idle_shutdown_check');
export const activation=extract('drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql','combat2_session_access');
export const candidate=read('docs/operations/legacy-001G3B-idle-activation-lock.sql');
export const ids={actor:'10000000-0000-4000-8000-000000000001',character:'20000000-0000-4000-8000-000000000001',node:'30000000-0000-4000-8000-000000000001',arena:'40000000-0000-4000-8000-000000000001'};
// Dependency doubles ONLY: no cron, Vault, network, real world or gameplay data.
// The two target routine definitions above are extracted unmodified.
export const fixture=`
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE characters(id uuid PRIMARY KEY,user_id uuid,current_node_id uuid,deleted_at timestamptz);
CREATE TABLE combat_config(key text PRIMARY KEY,value text);
CREATE TABLE world_state(id int PRIMARY KEY,state text);
CREATE TABLE fixture_state(id int PRIMARY KEY,enabled boolean,wakes int DEFAULT 0,shutdowns int DEFAULT 0,reclaims int DEFAULT 0);
CREATE TABLE combat2_player_presence(character_id uuid PRIMARY KEY,user_id uuid,seen_at timestamptz);
CREATE TABLE combat2_test_presence(arena_id uuid,character_id uuid,user_id uuid,seen_at timestamptz,PRIMARY KEY(arena_id,character_id));
CREATE TABLE combat2_test_arena(id uuid PRIMARY KEY,active boolean);
CREATE TABLE combat2_test_arena_node(arena_id uuid,node_id uuid,active boolean);
CREATE TABLE combat2_test_arena_access(arena_id uuid,character_id uuid,user_id uuid,active boolean,revoked_at timestamptz);
CREATE TABLE node_encounter(claim_token uuid,claim_expires_at timestamptz);
INSERT INTO characters VALUES('${ids.character}','${ids.actor}','${ids.node}',NULL);
INSERT INTO combat_config VALUES('combat_mode','open');
INSERT INTO world_state VALUES(1,'awake');INSERT INTO fixture_state(id,enabled) VALUES(1,true);
CREATE FUNCTION combat2_test_arena_access_allowed(a uuid,c uuid,n uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM combat2_test_arena_access x JOIN combat2_test_arena_node t ON t.arena_id=x.arena_id
 WHERE x.user_id=a AND x.character_id=c AND t.node_id=n AND x.active AND x.revoked_at IS NULL AND t.active) $$;
CREATE FUNCTION return_unique_items() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('test.idle_barrier',true)='on' THEN PERFORM pg_advisory_xact_lock(73193001); END IF;
 UPDATE fixture_state SET reclaims=reclaims+1;
END $$;
CREATE FUNCTION wake_world() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
 UPDATE world_state SET state='awake';UPDATE fixture_state SET wakes=wakes+1;
 RETURN '{"state":"awake"}'::jsonb;
END $$;
CREATE FUNCTION combat2_dispatch_scheduler_enable() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('combat2-dispatch-once-schedule'));
 IF current_setting('test.activation_barrier',true)='on' THEN PERFORM pg_advisory_xact_lock(73193002); END IF;
 IF current_setting('test.scheduler',true)='throw' THEN RAISE EXCEPTION 'fixture scheduler error'; END IF;
 IF current_setting('test.scheduler',true)='refuse' THEN RETURN '{"ok":false}'::jsonb; END IF;
 UPDATE fixture_state SET enabled=true;RETURN '{"ok":true}'::jsonb;
END $$;
CREATE FUNCTION combat2_dispatch_scheduler_disable() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('combat2-dispatch-once-schedule'));
 UPDATE fixture_state SET enabled=false;RETURN '{"ok":true}'::jsonb;
END $$;
CREATE FUNCTION shutdown_world() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 UPDATE world_state SET state='asleep';UPDATE fixture_state SET shutdowns=shutdowns+1;
 IF current_setting('test.shutdown_failure',true)='on' THEN RAISE EXCEPTION 'fixture shutdown failure'; END IF;
END $$;
${original}
REVOKE ALL ON FUNCTION idle_shutdown_check() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION idle_shutdown_check() TO service_role;
${activation}
REVOKE ALL ON FUNCTION combat2_session_access(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION combat2_session_access(uuid,uuid) TO authenticated,service_role;
GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
`;
