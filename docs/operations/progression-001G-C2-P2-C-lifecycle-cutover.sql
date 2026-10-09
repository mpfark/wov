-- LOCAL ACTIVATION-ONLY INPUT, not installed. Standard tool, one transaction.
-- Replaces deletion only; creation bridge/internal functions stay owner-only.
-- Review gameplay/selection and expiry-maintenance gates in P2-C handoff first.
DO $dependencies$
BEGIN
  IF to_regprocedure('public.character_lifecycle_command(uuid,uuid,bigint,text,text)') IS NULL
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
      AND (has_function_privilege(oid,'public.character_create_c2(uuid,text,text,text,uuid,text,text)','EXECUTE')
        OR has_function_privilege(oid,'public.character_create_c2_internal(uuid,text,text,text,uuid,text,text)','EXECUTE')))
  THEN RAISE EXCEPTION 'private lifecycle/paused creation dependency drift'; END IF;
  -- Otherwise legacy client-stat creation/direct INSERT could bypass the all-retained
  -- quota after tombstones disappear from the old selection UI. Do not enable C2 here.
  IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
      AND (has_table_privilege(r.oid,'public.characters','INSERT')
        OR has_any_column_privilege(r.oid,'public.characters','INSERT')))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.proname='character_create'
        AND r.rolname IN ('anon','authenticated','service_role') AND has_function_privilege(r.oid,p.oid,'EXECUTE'))
  THEN RAISE EXCEPTION 'lifecycle cutover requires prior legacy creation containment'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.settle_out_of_combat_resources(timestamptz)'::regprocedure
    AND prosrc LIKE '%FROM public.characters WHERE deleted_at IS NULL ORDER BY id FOR UPDATE%')
    OR EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.combat2_session_access(uuid,uuid)'::regprocedure,
      'public.combat2_presence_heartbeat(uuid)'::regprocedure) AND prosrc NOT LIKE '%c.deleted_at IS NULL%')
  THEN RAISE EXCEPTION 'lifecycle runtime exclusions must precede cutover'; END IF;
END $dependencies$;

CREATE FUNCTION public.character_lifecycle_character_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  -- Only the receipt inserted by the authorized purge in this exact transaction.
  -- No GUC/trigger-disable escape hatch; old receipts cannot authorize raw deletion.
  IF TG_OP='DELETE' THEN
    IF current_user<>'postgres' OR OLD.deleted_at IS NULL OR clock_timestamp()<OLD.restore_until
      OR NOT EXISTS(SELECT 1 FROM public.character_lifecycle_receipt r
        WHERE r.character_id=OLD.id AND r.owner_account_id=OLD.user_id
          AND r.operation='purge' AND r.expected_version=OLD.lifecycle_version
          AND r.actor_id=auth.uid() AND r.reason IS NOT NULL AND r.result->>'kind'='purged'
          AND r.purge_transaction=pg_current_xact_id())
    THEN RAISE EXCEPTION 'lifecycle_physical_purge_not_authorized'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM public.character_lifecycle_receipt WHERE character_id=NEW.id AND operation='purge')
      OR EXISTS(SELECT 1 FROM public.character_creation_log WHERE result_character_id=NEW.id AND replay_status='purged')
    THEN RAISE EXCEPTION 'lifecycle_purged_identity_reserved'; END IF;
    IF NEW.deleted_at IS NOT NULL OR NEW.restore_until IS NOT NULL OR NEW.lifecycle_version<>0
    THEN RAISE EXCEPTION 'lifecycle_insert_tombstone_forbidden'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.deleted_at,NEW.restore_until,NEW.lifecycle_version)
    IS DISTINCT FROM ROW(OLD.deleted_at,OLD.restore_until,OLD.lifecycle_version) THEN
    IF current_user<>'postgres' OR NEW.lifecycle_version<>OLD.lifecycle_version+1
      OR to_jsonb(NEW)-ARRAY['deleted_at','restore_until','lifecycle_version']
        IS DISTINCT FROM to_jsonb(OLD)-ARRAY['deleted_at','restore_until','lifecycle_version']
      OR NOT EXISTS(SELECT 1 FROM public.character_lifecycle_receipt r
        WHERE r.character_id=OLD.id AND r.owner_account_id=OLD.user_id AND r.expected_version=OLD.lifecycle_version
          AND r.result->>'version'=NEW.lifecycle_version::text
          AND (r.result->>'deletedAt')::timestamptz IS NOT DISTINCT FROM NEW.deleted_at
          AND (r.result->>'restoreUntil')::timestamptz IS NOT DISTINCT FROM NEW.restore_until
          AND r.operation=CASE WHEN NEW.deleted_at IS NULL THEN 'restore' ELSE 'soft_delete' END)
    THEN RAISE EXCEPTION 'lifecycle_transition_not_authorized'; END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'character_soft_deleted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER character_lifecycle_character_fence BEFORE INSERT OR UPDATE OR DELETE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_character_fence();

CREATE FUNCTION public.character_lifecycle_child_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE data jsonb; col text; subject uuid; deleted timestamptz;
BEGIN
  -- Check both source and destination of a transfer; holds row locks to transaction end.
  FOR data IN SELECT x FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) ELSE NULL END]) x WHERE x IS NOT NULL LOOP
    FOREACH col IN ARRAY TG_ARGV LOOP
      subject:=(data->>col)::uuid;
      IF subject IS NOT NULL THEN
        SELECT deleted_at INTO deleted FROM public.characters WHERE characters.id=subject FOR KEY SHARE;
        IF FOUND AND deleted IS NOT NULL AND NOT (TG_OP IN ('UPDATE','DELETE') AND EXISTS(
          SELECT 1 FROM public.character_lifecycle_receipt r WHERE r.character_id=subject AND r.operation='purge'
            AND r.actor_id=auth.uid() AND r.reason IS NOT NULL AND r.result->>'kind'='purged'
            AND r.purge_transaction=pg_current_xact_id()))
        THEN RAISE EXCEPTION 'character_soft_deleted'; END IF;
        -- Shared creature/character target columns may legitimately name a creature.
        -- FK/normal domain authorities, not this fence, validate missing/other targets.
      END IF;
    END LOOP;
  END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DO $child_fences$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'character_materials','character_inventory','character_class_bonds','character_visited_nodes',
    'character_stance','character_stance_request','progression_character_state','progression_receipt',
    'progression_respec_milestone','progression_class_growth_milestone',
    'node_fighter','node_intent','node_reward_claim','combat_sessions','party_members',
    'combat2_departure_request','combat2_party_departure_member'] LOOP
    -- Mandatory source dependencies. Missing objects/columns must abort, not be skipped.
    IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=('public.'||table_name)::regclass
      AND attname='character_id' AND atttypid='uuid'::regtype AND NOT attisdropped)
    THEN RAISE EXCEPTION 'lifecycle child dependency drift: %',table_name; END IF;
    EXECUTE format('CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence(''character_id'')',table_name);
  END LOOP;
END $child_fences$;
DO $other_children$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['character_ability_loadout','character_inventory_action_request',
    'character_special_travel_request','character_waymark','character_npc_gifts','character_guide_reads',
    'hidden_path_search_request','combat2_player_presence','combat2_test_presence',
    'combat_audit_log','combat_soak_access','combat2_diagnostic_session','combat2_respawn_request',
    'combat2_test_arena_access','combat2_test_arena_stance_snapshot_header',
    'encounter_access_grants','encounter_engagements','encounter_participants','node_participation'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=('public.'||table_name)::regclass
      AND attname='character_id' AND atttypid='uuid'::regtype AND NOT attisdropped)
    THEN RAISE EXCEPTION 'lifecycle child dependency drift: %',table_name; END IF;
    EXECUTE format('CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence(''character_id'')',table_name);
  END LOOP;
END $other_children$;
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.combat_actions
  FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id','target_character_id');
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.node_effect
  FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('target_character_id','source_character_id');
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('seller_character_id','buyer_character_id');
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.active_effects
  FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('target_id','source_id');

-- Additive restrictive policy: do not replace the existing ownership/steward policies.
CREATE POLICY characters_lifecycle_active_read ON public.characters AS RESTRICTIVE FOR SELECT
  TO anon,authenticated USING(deleted_at IS NULL);

DO $private_trigger_acl$
DECLARE f record; g oid;
BEGIN
  FOR f IN SELECT p.oid,p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('character_lifecycle_character_fence','character_lifecycle_child_fence') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.identity);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);
    FOR g IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a
      WHERE p.oid=f.oid AND a.grantee<>p.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.identity,
        CASE WHEN g=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g)) END);
    END LOOP;
  END LOOP;
END $private_trigger_acl$;

-- Only confirmed hard-delete RPC and direct parent DELETE; no unrelated UPDATE changes.
DO $legacy_delete_acl$
DECLARE f oid; g oid; r oid;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('delete_character_cascade','c2_harness_run','c2_harness_run_c') LOOP
  IF (SELECT proowner FROM pg_proc WHERE oid=f)<>'postgres'::regrole
  THEN RAISE EXCEPTION 'legacy delete owner drift'; END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f::regprocedure);
  FOR g IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a
    WHERE p.oid=f AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f::regprocedure,
      CASE WHEN g=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g)) END);
  END LOOP;
  FOR r IN WITH RECURSIVE app(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
    UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
    SELECT oid FROM app WHERE oid<>'postgres'::regrole LOOP
    IF has_function_privilege(r,f,'EXECUTE') THEN RAISE EXCEPTION 'lifecycle legacy EXECUTE leak'; END IF;
  END LOOP;
  END LOOP;
  REVOKE DELETE,TRUNCATE ON public.characters FROM PUBLIC,anon,authenticated,service_role;
  FOR r IN WITH RECURSIVE app(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
    UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
    SELECT oid FROM app WHERE oid<>'postgres'::regrole LOOP
    IF has_table_privilege(r,'public.characters','DELETE,TRUNCATE')
    THEN RAISE EXCEPTION 'lifecycle hard-delete privilege leak: %',pg_get_userbyid(r); END IF;
  END LOOP;
END $legacy_delete_acl$;

-- Application access goes through runtime owner/Overlord checks, never direct fields/storage.
GRANT EXECUTE ON FUNCTION public.character_lifecycle_command(uuid,uuid,bigint,text,text) TO authenticated;
DO $public_boundary$
BEGIN
  IF has_function_privilege('anon','public.character_lifecycle_command(uuid,uuid,bigint,text,text)','EXECUTE')
    OR has_function_privilege('service_role','public.character_lifecycle_command(uuid,uuid,bigint,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'lifecycle command execution boundary drift'; END IF;
END $public_boundary$;
