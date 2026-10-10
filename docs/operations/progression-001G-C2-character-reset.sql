-- One-time owner-approved disposable test-character reset. NOT INSTALLED/EXECUTED.
-- ONLY the coordinated reset + existing B artifact may be installed, in ONE Drizzle transaction.
-- Separate unchanged inactive support A must already be installed. Recovery checkpoint +
-- fresh metadata review + explicit destructive/cutover approval are external execution gates.
-- No CASCADE reset, trigger disable, constraint drop, account deletion or history rewrite.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
CREATE TEMP TABLE c2_reset_allowlist(name text PRIMARY KEY, relation oid, mode text NOT NULL,
 done boolean NOT NULL DEFAULT false) ON COMMIT DROP;
INSERT INTO c2_reset_allowlist(name,mode) VALUES
('active_effects','all'),
('character_ability_loadout','all'),
('character_class_bonds','all'),
('character_creation_log','all'),
('character_creation_origin','all'),
('character_guide_reads','all'),
('character_inventory','all'),
('character_inventory_action_request','all'),
('character_lifecycle_receipt','all'),
('character_materials','all'),
('character_npc_gifts','all'),
('character_special_travel_request','all'),
('character_stance','all'),
('character_stance_request','all'),
('character_visited_nodes','all'),
('character_waymark','all'),
('characters','all'),
('combat2_departure_request','all'),
('combat2_diagnostic_server_event','all'),
('combat2_diagnostic_session','all'),
('combat2_party_departure_member','all'),
('combat2_party_departure_request','all'),
('combat2_player_presence','all'),
('combat2_respawn_request','all'),
('combat2_test_arena_access','all'),
('combat2_test_arena_stance_snapshot','all'),
('combat2_test_arena_stance_snapshot_header','all'),
('combat2_test_presence','all'),
('combat2_tick_notification','all'),
('combat_actions','all'),
('combat_audit_log','all'),
('combat_sessions','all'),
('combat_soak_access','all'),
('combat_soak_scopes','all'),
('effects_catchup_dispatch','all'),
('effects_catchup_log','all'),
('encounter_access_grants','all'),
('encounter_cast_events','all'),
('encounter_contributions','all'),
('encounter_creatures','all'),
('encounter_death_loot','all'),
('encounter_engagements','all'),
('encounter_kill_awards','all'),
('encounter_participants','all'),
('encounter_tick_batches','all'),
('encounters','all'),
('hidden_path_search_request','all'),
('marketplace_listings','all'),
('node_arrival_group','all'),
('node_boss_ability_cooldown','all'),
('node_creature','all'),
('node_death_loot','all'),
('node_effect','all'),
('node_encounter','all'),
('node_fighter','all'),
('node_ground_loot','all'),
('node_intent','all'),
('node_participation','all'),
('node_pending_event','all'),
('node_reward_claim','all'),
('node_tick_batch','all'),
('node_tick_log','all'),
('parties','all'),
('party_combat_log','all'),
('party_members','all'),
('party_operation_request','all'),
('progression_character_state','all'),
('progression_class_growth_milestone','all'),
('progression_receipt','all'),
('progression_respec_milestone','all'),
('summon_requests','all'),
('unique_item_instance','all'),
('combat2_test_run','recording'),('combat2_test_run_batch','recording'),
('combat2_test_run_event','recording'),('issue_reports','unlink');
UPDATE c2_reset_allowlist SET relation=to_regclass('public.'||quote_ident(name));
CREATE TEMP TABLE c2_reset_preserved(name text NOT NULL, row_value jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE c2_reset_trigger_body(name text PRIMARY KEY, body_md5 text NOT NULL) ON COMMIT DROP;
INSERT INTO c2_reset_trigger_body VALUES
('unique_holder_before_delete','b526d9a05105dbb635cc8198ef966777'),
('unique_holder_finalize_delete','a53c5505f41b99178789ab88831fa56d'),
('combat2_refuse_invalid_stance_equipment_change','5cb5bdf9f5adb09288b9f7a229d7fc80');
DO $reset$
DECLARE target_record record; next_table text; n bigint; problem text;
 preserved_names text[]:=ARRAY['items','vendor_inventory','nodes','node_connections','worlds','regions','areas',
  'creatures','node_creature_spawns','boss_abilities','node_boss_config','families','family_members','family_requests',
  'user_roles','combat_config','combat2_respawn_config','combat2_canary_node','combat2_dispatch_schedule_state',
  'combat2_test_arena','combat2_test_arena_node','combat2_test_arena_creature','combat2_test_arena_request',
  'character_resource_settlement_state','progression_command_control','world_slumber_log'];
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'C2 reset requires postgres installer'; END IF;
 IF to_regclass('public.characters') IS NULL OR to_regclass('public.character_materials') IS NULL
  OR to_regclass('public.character_creation_origin') IS NULL OR to_regclass('public.progression_character_state') IS NULL
  OR to_regclass('auth.users') IS NULL THEN RAISE EXCEPTION 'C2 reset missing core dependency'; END IF;
 -- Ordinary installed relations only; missing legacy source candidates are recorded by preflight.
 SELECT a.name INTO problem FROM c2_reset_allowlist a JOIN pg_class c ON c.oid=a.relation
 WHERE c.relkind<>'r' OR c.relispartition OR EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid) LIMIT 1;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'C2 reset unsupported relation: %',problem; END IF;
 -- Deterministic maintenance locks retained through cutover/commit, no writer window.
 FOR target_record IN SELECT name FROM c2_reset_allowlist WHERE relation IS NOT NULL ORDER BY name LOOP
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',target_record.name);
  IF row_security_active(('public.'||quote_ident(target_record.name))::regclass) THEN
   RAISE EXCEPTION 'C2 reset incomplete visibility: %',target_record.name; END IF;
 END LOOP;
 -- Any edge from outside the allowlist into a deleted table is a preservation blocker,
 -- regardless of delete action. Archival rows cannot be rewritten by SET NULL either.
 SELECT k.conname||' on '||k.conrelid::regclass INTO problem FROM pg_constraint k
 JOIN c2_reset_allowlist parent ON parent.relation=k.confrelid
 LEFT JOIN c2_reset_allowlist child ON child.relation=k.conrelid
 WHERE k.contype='f' AND (child.relation IS NULL OR child.mode<>'all' AND parent.mode='all')
 AND NOT coalesce((child.name='issue_reports' AND parent.name='characters'
  AND k.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=k.conrelid AND attname='character_id')]::smallint[]),false)
 LIMIT 1;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'C2 reset preserved incoming FK: %',problem; END IF;
 -- Catch a new sidecar omitted from the reviewed inventory even if it has no FK.
 SELECT c.oid::regclass::text INTO problem FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
 JOIN pg_attribute p ON p.attrelid=c.oid AND p.attnum>0 AND NOT p.attisdropped
 WHERE s.nspname='public' AND c.relkind IN ('r','p') AND p.attname IN
  ('character_id','source_character_id','target_character_id','actor_character_id','leader_character_id',
   'seller_character_id','buyer_character_id','summoner_character_id','result_character_id')
 AND NOT EXISTS(SELECT 1 FROM c2_reset_allowlist a WHERE a.relation=c.oid)
 LIMIT 1;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'C2 reset unlisted character dependency: %',problem; END IF;
 -- Preserve ordinary holder DELETE triggers. Unexpected or drifted enabled user triggers
 -- (including an already-attached lifecycle fence) refuse, never bypass.
 SELECT t.tgname||' on '||t.tgrelid::regclass INTO problem FROM pg_trigger t
 JOIN c2_reset_allowlist a ON a.relation=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
 LEFT JOIN c2_reset_trigger_body b ON b.name=p.proname
 WHERE NOT t.tgisinternal AND t.tgenabled<>'D'
 AND ((t.tgtype::integer & 8)<>0 OR (a.mode='unlink' OR a.name='unique_item_instance') AND (t.tgtype::integer & 16)<>0)
 AND NOT coalesce((a.mode='all' AND t.tgenabled='O' AND (t.tgtype::integer & 1)<>0
  AND p.pronamespace='public'::regnamespace AND p.proowner='postgres'::regrole AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
  AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=b.body_md5 AND
  ((p.proname IN ('unique_holder_before_delete','unique_holder_finalize_delete')
    AND a.name IN ('character_inventory','node_ground_loot','marketplace_listings'))
   OR (p.proname='combat2_refuse_invalid_stance_equipment_change' AND a.name='character_inventory'))),false)
 LIMIT 1;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'C2 reset unreviewed DELETE/update trigger: %',problem; END IF;
 IF current_setting('session_replication_role')<>'origin' THEN RAISE EXCEPTION 'C2 reset requires enabled ordinary triggers'; END IF;
 IF to_regclass('public.unique_item_instance') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.unique_item_instance WHERE location_kind IS NULL
    OR location_kind NOT IN ('inventory','ground','marketplace','transit')) THEN
   RAISE EXCEPTION 'C2 reset unknown persistent unique location'; END IF;
 END IF;
 -- Account/auth identity preservation reads identifiers ONLY, never credential columns.
 LOCK TABLE auth.users IN SHARE MODE;
 INSERT INTO c2_reset_preserved SELECT 'auth.users',jsonb_build_object('id',id) FROM auth.users;
 IF to_regclass('public.profiles') IS NOT NULL THEN
  EXECUTE 'LOCK TABLE public.profiles IN SHARE MODE';
  EXECUTE 'INSERT INTO c2_reset_preserved SELECT ''profiles'',jsonb_build_object(''id'',id) FROM public.profiles';
 END IF;
 -- No access, hash or snapshot of progression_renown_key or auth secret material.
 FOREACH next_table IN ARRAY preserved_names LOOP
  IF to_regclass('public.'||quote_ident(next_table)) IS NOT NULL THEN
   EXECUTE format('LOCK TABLE public.%I IN SHARE MODE',next_table);
   EXECUTE format('INSERT INTO c2_reset_preserved SELECT %L,to_jsonb(x) FROM public.%I x',next_table,next_table);
  END IF;
 END LOOP;
 IF to_regclass('public.combat2_test_run') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.combat2_test_run WHERE status IS NULL OR status NOT IN ('recording','completed')) THEN
   RAISE EXCEPTION 'C2 reset unknown Arena report status'; END IF;
  INSERT INTO c2_reset_preserved SELECT 'combat2_test_run',to_jsonb(x) FROM public.combat2_test_run x WHERE status='completed';
  INSERT INTO c2_reset_preserved SELECT 'combat2_test_run_batch',to_jsonb(x) FROM public.combat2_test_run_batch x
   WHERE EXISTS(SELECT 1 FROM public.combat2_test_run r WHERE r.id=x.run_id AND r.status='completed');
  INSERT INTO c2_reset_preserved SELECT 'combat2_test_run_event',to_jsonb(x) FROM public.combat2_test_run_event x
   WHERE EXISTS(SELECT 1 FROM public.combat2_test_run r WHERE r.id=x.run_id AND r.status='completed');
  IF EXISTS(SELECT 1 FROM public.combat2_test_run_batch x WHERE NOT EXISTS(SELECT 1 FROM public.combat2_test_run r WHERE r.id=x.run_id))
   OR EXISTS(SELECT 1 FROM public.combat2_test_run_event x WHERE NOT EXISTS(SELECT 1 FROM public.combat2_test_run r WHERE r.id=x.run_id)) THEN
   RAISE EXCEPTION 'C2 reset detached Arena archive'; END IF;
  DELETE FROM public.combat2_test_run_event e USING public.combat2_test_run r WHERE e.run_id=r.id AND r.status='recording';
  DELETE FROM public.combat2_test_run_batch b USING public.combat2_test_run r WHERE b.run_id=r.id AND r.status='recording';
  DELETE FROM public.combat2_test_run WHERE status='recording';
 END IF;
 IF to_regclass('public.issue_reports') IS NOT NULL THEN
  INSERT INTO c2_reset_preserved SELECT 'issue_reports',to_jsonb(x)-ARRAY['character_id','character_name'] FROM public.issue_reports x;
  UPDATE public.issue_reports SET character_id=NULL,character_name=NULL WHERE character_id IS NOT NULL OR character_name IS NOT NULL;
 END IF;
 -- Leaves before parents according to actual FKs, but only allowlisted tables.
 -- Clear stances before shield inventory; registry after ordinary holder deletion.
 UPDATE c2_reset_allowlist SET done=true WHERE relation IS NULL OR mode<>'all';
 WHILE EXISTS(SELECT 1 FROM c2_reset_allowlist WHERE NOT done) LOOP
  SELECT a.name INTO next_table FROM c2_reset_allowlist a WHERE NOT a.done
   AND NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN c2_reset_allowlist child ON child.relation=k.conrelid
    WHERE k.contype='f' AND k.confrelid=a.relation AND k.conrelid<>k.confrelid AND NOT child.done)
   AND NOT (a.name='character_inventory' AND EXISTS(SELECT 1 FROM c2_reset_allowlist WHERE name='character_stance' AND NOT done))
   AND NOT (a.name='unique_item_instance' AND EXISTS(SELECT 1 FROM c2_reset_allowlist
      WHERE name IN ('character_inventory','node_ground_loot','marketplace_listings') AND NOT done))
   ORDER BY a.name LIMIT 1;
  IF next_table IS NULL THEN RAISE EXCEPTION 'C2 reset cyclic or unreviewed dependency order'; END IF;
  EXECUTE format('DELETE FROM public.%I',next_table);
  UPDATE c2_reset_allowlist SET done=true WHERE name=next_table;
 END LOOP;
 -- Flush FK/holder deferred finalization while assertions and cutover can still roll back.
 SET CONSTRAINTS ALL IMMEDIATE;
 FOR target_record IN SELECT name FROM c2_reset_allowlist WHERE relation IS NOT NULL AND mode='all' LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',target_record.name) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'C2 reset nonempty target: %',target_record.name; END IF;
 END LOOP;
 CREATE TEMP TABLE c2_reset_after (LIKE c2_reset_preserved) ON COMMIT DROP;
 INSERT INTO c2_reset_after SELECT 'auth.users',jsonb_build_object('id',id) FROM auth.users;
 IF to_regclass('public.profiles') IS NOT NULL THEN
  EXECUTE 'INSERT INTO c2_reset_after SELECT ''profiles'',jsonb_build_object(''id'',id) FROM public.profiles'; END IF;
 FOREACH next_table IN ARRAY preserved_names LOOP
  IF to_regclass('public.'||quote_ident(next_table)) IS NOT NULL THEN
   EXECUTE format('INSERT INTO c2_reset_after SELECT %L,to_jsonb(x) FROM public.%I x',next_table,next_table); END IF;
 END LOOP;
 IF to_regclass('public.combat2_test_run') IS NOT NULL THEN
  INSERT INTO c2_reset_after SELECT 'combat2_test_run',to_jsonb(x) FROM public.combat2_test_run x;
  INSERT INTO c2_reset_after SELECT 'combat2_test_run_batch',to_jsonb(x) FROM public.combat2_test_run_batch x;
  INSERT INTO c2_reset_after SELECT 'combat2_test_run_event',to_jsonb(x) FROM public.combat2_test_run_event x;
 END IF;
 IF to_regclass('public.issue_reports') IS NOT NULL THEN
  INSERT INTO c2_reset_after SELECT 'issue_reports',to_jsonb(x)-ARRAY['character_id','character_name'] FROM public.issue_reports x;
 END IF;
 IF EXISTS((SELECT * FROM c2_reset_preserved EXCEPT ALL SELECT * FROM c2_reset_after)
  UNION ALL (SELECT * FROM c2_reset_after EXCEPT ALL SELECT * FROM c2_reset_preserved)) THEN
  RAISE EXCEPTION 'C2 reset preserved data changed'; END IF;
END $reset$;
-- No COMMIT here. Corrected B follows under the SAME transaction and retained locks.
