-- LOCAL REVIEWED INPUT ONLY. Standard Lovable/Drizzle tool, one transaction.
-- Owner-only installation. No public lifecycle execution or legacy cutover.
DO $dependencies$
BEGIN
  IF (SELECT relowner FROM pg_class WHERE oid='public.characters'::regclass)<>'postgres'::regrole
    OR to_regprocedure('public.character_create_c2(uuid,text,text,text,uuid,text,text)') IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.character_materials'::regclass
      AND conname='character_materials_character_id_c2_fkey' AND contype='f')
  THEN RAISE EXCEPTION 'P2-C requires installed 0010 dependencies'; END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.characters'::regclass AND NOT attisdropped
    AND attname IN ('deleted_at','restore_until','lifecycle_version'))
  THEN RAISE EXCEPTION 'lifecycle column collision; reconcile existing mechanism'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('character_lifecycle_receipt_guard','character_lifecycle_quiescent_internal',
      'character_lifecycle_command','character_purge_preflight_internal','character_lifecycle_purge_internal','character_lifecycle_expire_receipts_internal'))
  THEN RAISE EXCEPTION 'lifecycle function namespace collision'; END IF;
END $dependencies$;

-- Metadata-only constant/null defaults; no UPDATE/backfill of existing characters.
ALTER TABLE public.characters ADD deleted_at timestamptz,
  ADD restore_until timestamptz, ADD lifecycle_version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT characters_lifecycle_state_check CHECK (
    lifecycle_version BETWEEN 0 AND 9007199254740991 AND (
      (deleted_at IS NULL AND restore_until IS NULL AND lifecycle_version%2=0)
      OR (deleted_at IS NOT NULL AND restore_until IS NOT NULL AND lifecycle_version%2=1
        AND restore_until=deleted_at+interval '720 hours')));

-- One private lifecycle store: 12-month details, minimal terminal purge replay.
-- No character/account FK: deletion must not erase unexpired administrative history.
-- Soft-delete/restore retries use character version; purge keeps its request binding.
CREATE TABLE public.character_lifecycle_receipt (
  actor_id uuid NOT NULL, request_id uuid NOT NULL, character_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('soft_delete','restore','purge')),
  expected_version bigint NOT NULL CHECK(expected_version BETWEEN 0 AND 9007199254740990),
  reason text CHECK(reason IS NULL OR (btrim(reason)=reason AND reason ~ '[^[:space:]]' AND length(reason)<=2000)),
  reason_digest bytea NOT NULL CHECK(octet_length(reason_digest)=32),
  purge_transaction xid8,
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  occurred_at timestamptz NOT NULL,
  details_expires_at timestamptz NOT NULL,
  PRIMARY KEY(actor_id,request_id),
  CHECK(operation<>'restore' OR reason IS NOT NULL),
  CHECK((operation='purge')=(purge_transaction IS NOT NULL)),
  CHECK(details_expires_at=((occurred_at AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC')
);
CREATE INDEX character_lifecycle_receipt_character_idx ON public.character_lifecycle_receipt(character_id,occurred_at);
CREATE INDEX character_lifecycle_receipt_expiry_idx ON public.character_lifecycle_receipt(details_expires_at);
ALTER TABLE public.character_lifecycle_receipt OWNER TO postgres;
ALTER TABLE public.character_lifecycle_receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.character_lifecycle_receipt FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.character_lifecycle_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  -- Purge replay keeps a reason digest, never the expired administrative text.
  IF OLD.operation='purge' AND OLD.details_expires_at<=statement_timestamp()
    AND OLD.reason IS NOT NULL AND NEW.reason IS NULL
    AND to_jsonb(NEW)-'reason' IS NOT DISTINCT FROM to_jsonb(OLD)-'reason'
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'lifecycle receipt is immutable';
END $$;
CREATE TRIGGER character_lifecycle_receipt_immutable BEFORE UPDATE ON public.character_lifecycle_receipt
  FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_receipt_guard();

CREATE FUNCTION public.character_lifecycle_quiescent_internal(_character uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.characters%ROWTYPE;
BEGIN
  SELECT * INTO STRICT c FROM public.characters WHERE id=_character FOR UPDATE;
  -- Refuse instead of cancelling combat, markets, parties, effects or pending work.
  -- Uses the direct F lifecycle dependencies, with a stricter no-present-fighter gate.
  IF c.movement_locked_until>clock_timestamp()
    OR EXISTS(SELECT 1 FROM public.combat2_player_presence WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.combat2_test_presence WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.node_fighter WHERE character_id=c.id AND present)
    OR EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
      WHERE f.character_id=c.id AND e.claim_token IS NOT NULL AND e.claim_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.character_stance WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.character_stance_request WHERE character_id=c.id AND intent_id IS NOT NULL AND committed_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.node_intent WHERE character_id=c.id AND status='pending')
    OR EXISTS(SELECT 1 FROM public.combat2_departure_request WHERE character_id=c.id AND status IN ('queued','finalizing'))
    OR EXISTS(SELECT 1 FROM public.combat2_party_departure_member m JOIN public.combat2_party_departure_request p ON p.request_id=m.request_id
      WHERE m.character_id=c.id AND (m.status IN ('waiting','queued') OR p.status IN ('queued','finalizing')))
    OR EXISTS(SELECT 1 FROM public.combat_sessions cs WHERE cs.character_id=c.id OR cs.party_id IN
      (SELECT party_id FROM public.party_members WHERE character_id=c.id AND status='accepted'))
    OR EXISTS(SELECT 1 FROM public.party_members WHERE character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.parties WHERE leader_id=c.id OR tank_id=c.id)
    OR EXISTS(SELECT 1 FROM public.summon_requests WHERE (summoner_id=c.id OR target_id=c.id) AND status='pending')
    OR EXISTS(SELECT 1 FROM public.combat_actions WHERE (character_id=c.id OR target_character_id=c.id) AND status='pending')
    OR EXISTS(SELECT 1 FROM public.node_pending_event WHERE (actor_character_id=c.id OR target_character_id=c.id) AND consumed_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.marketplace_listings WHERE seller_character_id=c.id OR buyer_character_id=c.id)
    OR EXISTS(SELECT 1 FROM public.active_effects WHERE target_id=c.id OR source_id=c.id)
    OR EXISTS(SELECT 1 FROM public.node_effect WHERE target_character_id=c.id OR source_character_id=c.id)
  THEN RAISE EXCEPTION 'lifecycle_not_quiescent'; END IF;
END $$;

-- Called only after the command inserts its authorized receipt, under the same locks.
-- No trigger disabling, session flag, dynamic FK cascader or global orphan cleanup.
CREATE FUNCTION public.character_lifecycle_purge_internal(_character uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE table_name text; remains boolean; owned text[]:=ARRAY[
  'character_materials','character_inventory','character_class_bonds','character_visited_nodes',
  'character_stance','character_stance_request','character_ability_loadout',
  'character_inventory_action_request','character_special_travel_request','character_waymark',
  'character_npc_gifts','character_guide_reads','hidden_path_search_request',
  'combat2_player_presence','combat2_test_presence',
  'combat_sessions','party_members','combat2_departure_request','combat2_party_departure_member',
  'node_intent','node_reward_claim','node_fighter',
  'combat_actions','combat_audit_log','combat_soak_access','combat2_diagnostic_session',
  'combat2_respawn_request','combat2_test_arena_access','combat2_test_arena_stance_snapshot_header',
  'encounter_access_grants','encounter_engagements','encounter_participants','node_participation',
  'progression_respec_milestone','progression_class_growth_milestone','progression_receipt','progression_character_state'];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.characters c JOIN public.character_lifecycle_receipt r ON r.character_id=c.id
    WHERE c.id=_character AND c.deleted_at IS NOT NULL AND clock_timestamp()>=c.restore_until
      AND r.operation='purge' AND r.actor_id=auth.uid() AND r.reason IS NOT NULL
      AND r.expected_version=c.lifecycle_version AND r.owner_account_id=c.user_id
      AND r.result->>'kind'='purged' AND r.purge_transaction=pg_current_xact_id())
  THEN RAISE EXCEPTION 'lifecycle_purge_not_authorized'; END IF;
  -- Unknown direct character/state dependencies stop instead of guessing their ownership.
  IF EXISTS(SELECT 1 FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid
    JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_attribute col ON col.attrelid=child.oid AND col.attnum=fk.conkey[1]
    WHERE fk.contype='f' AND fk.confrelid IN ('public.characters'::regclass,'public.progression_character_state'::regclass)
      AND (ns.nspname<>'public' OR child.relname<>ALL(owned||ARRAY['character_creation_origin',
        'marketplace_listings','active_effects','node_effect','node_ground_loot','issue_reports',
        'node_pending_event','parties','summon_requests','combat2_party_departure_request'])
        OR cardinality(fk.conkey)<>1
        OR fk.confkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=fk.confrelid
          AND attname=CASE WHEN fk.confrelid='public.characters'::regclass THEN 'id' ELSE 'character_id' END)]
        OR NOT (CASE
          WHEN child.relname IN ('combat_actions','node_intent') THEN col.attname IN ('character_id','target_character_id')
          WHEN child.relname=ANY(owned) OR child.relname IN ('character_creation_origin','issue_reports') THEN col.attname='character_id'
          WHEN child.relname='marketplace_listings' THEN col.attname IN ('seller_character_id','buyer_character_id')
          WHEN child.relname='active_effects' THEN col.attname IN ('target_id','source_id')
          WHEN child.relname='node_effect' THEN col.attname IN ('target_character_id','source_character_id')
          WHEN child.relname='node_ground_loot' THEN col.attname='dropped_by'
          WHEN child.relname='node_pending_event' THEN col.attname IN ('actor_character_id','target_character_id')
          WHEN child.relname='parties' THEN col.attname IN ('leader_id','tank_id')
          WHEN child.relname='summon_requests' THEN col.attname IN ('summoner_id','target_id')
          WHEN child.relname='combat2_party_departure_request' THEN col.attname='leader_character_id'
          ELSE false END)))
  THEN RAISE EXCEPTION 'lifecycle_purge_dependency_drift'; END IF;
  -- The two nested owned cascades are diagnostics events and Arena stance snapshots.
  -- All other known incoming links stay within the explicit cleanup list; unknown
  -- nested cascades must never erase another character/account's records implicitly.
  IF EXISTS(WITH allowed(child,parent,columns,action) AS (VALUES
    ('character_stance_request','node_intent','intent_id','n'),
    ('combat2_departure_request','node_fighter','fighter_id','n'),
    ('combat2_party_departure_member','node_fighter','fighter_id','a'),
    ('node_intent','node_fighter','target_fighter_id','n'),
    ('combat2_diagnostic_server_event','combat2_diagnostic_session','session_id','c'),
    ('combat2_test_arena_stance_snapshot','combat2_test_arena_stance_snapshot_header','arena_id,character_id','c'),
    ('progression_receipt','progression_character_state','character_id','c'),
    ('progression_respec_milestone','progression_character_state','character_id','c'),
    ('progression_class_growth_milestone','progression_character_state','character_id','c'),
    ('progression_respec_milestone','progression_receipt','character_id,source,event_id','a'),
    ('progression_class_growth_milestone','progression_receipt','character_id,source,event_id','a'))
    SELECT 1 FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace ns ON ns.oid=child.relnamespace JOIN pg_class parent ON parent.oid=fk.confrelid
    WHERE fk.contype='f' AND fk.confrelid IN (SELECT to_regclass('public.'||v)
      FROM unnest(owned||ARRAY['combat2_diagnostic_server_event','combat2_test_arena_stance_snapshot']) v)
      AND NOT EXISTS(SELECT 1 FROM allowed a WHERE ns.nspname='public' AND a.child=child.relname
        AND a.parent=parent.relname AND a.action=fk.confdeltype::text
        AND a.columns=array_to_string(ARRAY(SELECT col.attname FROM unnest(fk.conkey) WITH ORDINALITY k(num,ord)
          JOIN pg_attribute col ON col.attrelid=child.oid AND col.attnum=k.num ORDER BY k.ord),',')))
  THEN RAISE EXCEPTION 'lifecycle_purge_nested_dependency_drift'; END IF;
  -- Shared parties, active effects/markets/work are refused by the quiescent helper.
  -- World loot, account-owned issues and other characters' target references survive.
  UPDATE public.node_ground_loot SET dropped_by=NULL WHERE dropped_by=_character;
  UPDATE public.issue_reports SET character_id=NULL,character_name='' WHERE character_id=_character;
  UPDATE public.combat_actions SET target_character_id=NULL WHERE target_character_id=_character AND character_id<>_character;
  UPDATE public.node_intent SET target_character_id=NULL WHERE target_character_id=_character AND character_id<>_character;
  UPDATE public.node_pending_event SET actor_character_id=NULL WHERE actor_character_id=_character;
  UPDATE public.node_pending_event SET target_character_id=NULL WHERE target_character_id=_character;
  DELETE FROM public.summon_requests WHERE summoner_id=_character OR target_id=_character;
  -- A leader's departure may include another character: refuse rather than cascade it.
  IF EXISTS(SELECT 1 FROM public.combat2_party_departure_request r
    JOIN public.combat2_party_departure_member m ON m.request_id=r.request_id
    WHERE r.leader_character_id=_character AND m.character_id<>_character)
  THEN RAISE EXCEPTION 'lifecycle_purge_shared_departure'; END IF;
  FOREACH table_name IN ARRAY owned LOOP
    EXECUTE format('DELETE FROM public.%I WHERE character_id=$1',table_name) USING _character;
  END LOOP;
  DELETE FROM public.combat2_party_departure_request WHERE leader_character_id=_character;
  DELETE FROM public.character_creation_origin WHERE character_id=_character;
  DELETE FROM public.characters WHERE id=_character;
  IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle_purge_character_missing'; END IF;
  -- Existing 0007 guard allows this only after the result no longer exists.
  UPDATE public.character_creation_log SET replay_status='purged'
    WHERE result_character_id=_character AND replay_status='applied';
  -- No complete progression history or opaque baseline survives this transaction.
  FOREACH table_name IN ARRAY owned LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE character_id=$1)',table_name) INTO remains USING _character;
    IF remains THEN RAISE EXCEPTION 'lifecycle_purge_dependent_drift'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.character_lifecycle_command(
  _character uuid,_request uuid,_expected_version bigint,_operation text,_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); owner_id uuid; k integer; c public.characters%ROWTYPE;
  prior public.character_lifecycle_receipt%ROWTYPE; reason text:=nullif(btrim(_reason),'');
  t timestamptz; deadline timestamptz; result jsonb;
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
  THEN RAISE EXCEPTION 'lifecycle_not_authorized' USING ERRCODE='42501'; END IF;
  IF _character IS NULL OR _request IS NULL OR _expected_version IS NULL
    OR _expected_version NOT BETWEEN 0 AND 9007199254740990
    OR _operation IS NULL OR _operation NOT IN ('soft_delete','restore','purge')
    OR (reason IS NOT NULL AND (length(reason)>2000 OR reason !~ '[^[:space:]]'))
  THEN RAISE EXCEPTION 'invalid_lifecycle_request' USING ERRCODE='22023'; END IF;
  IF current_setting('transaction_isolation')<>'read committed'
  THEN RAISE EXCEPTION 'lifecycle_requires_read_committed'; END IF;
  SELECT user_id INTO owner_id FROM public.characters WHERE id=_character;
  IF owner_id IS NULL AND _operation='purge' THEN
    SELECT owner_account_id INTO owner_id FROM public.character_lifecycle_receipt
      WHERE actor_id=actor AND request_id=_request AND operation='purge';
  END IF;
  IF owner_id IS NULL OR (_operation='soft_delete' AND owner_id<>actor)
    OR (_operation IN ('restore','purge') AND (reason IS NULL OR NOT public.has_role(actor,'overlord'::public.app_role)))
  THEN RAISE EXCEPTION 'lifecycle_not_authorized' USING ERRCODE='42501'; END IF;
  -- Distinct request namespace; same sorted actor/target account locks as creation.
  PERFORM pg_advisory_xact_lock(173203,hashtext(actor::text||':'||_request::text));
  FOR k IN SELECT DISTINCT hashtext(v::text) FROM unnest(ARRAY[actor,owner_id]) v ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(173202,k);
  END LOOP;
  PERFORM id FROM auth.users WHERE id IN (actor,owner_id) ORDER BY id FOR KEY SHARE;
  IF _operation IN ('restore','purge') THEN
    PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role='overlord'::public.app_role FOR SHARE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
    OR (_operation<>'purge' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id))
    OR (_operation IN ('restore','purge') AND NOT public.has_role(actor,'overlord'::public.app_role))
  THEN RAISE EXCEPTION 'lifecycle_not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;
  IF c.id IS NOT NULL AND c.user_id<>owner_id THEN RAISE EXCEPTION 'lifecycle_ownership_changed'; END IF;
  SELECT * INTO prior FROM public.character_lifecycle_receipt WHERE actor_id=actor AND request_id=_request FOR UPDATE;
  IF FOUND THEN
    IF ROW(prior.character_id,prior.operation,prior.expected_version,prior.reason_digest)
      IS DISTINCT FROM ROW(_character,_operation,_expected_version,sha256(convert_to(coalesce(reason,''),'UTF8')))
    THEN RAISE EXCEPTION 'lifecycle_request_conflict'; END IF;
    IF prior.operation='purge' OR prior.details_expires_at>statement_timestamp() THEN RETURN prior.result; END IF;
    -- Expired details are never projected. Stale version below still prevents reapplication.
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'lifecycle_character_missing'; END IF;
  IF _operation='purge' THEN
    IF c.lifecycle_version<>_expected_version THEN RAISE EXCEPTION 'lifecycle_stale_version'; END IF;
    PERFORM public.character_lifecycle_quiescent_internal(c.id);
    t:=clock_timestamp();
    IF c.deleted_at IS NULL OR t<c.restore_until THEN RAISE EXCEPTION 'lifecycle_purge_window_not_elapsed'; END IF;
    result:=jsonb_build_object('kind','purged','characterId',c.id,'version',c.lifecycle_version);
    INSERT INTO public.character_lifecycle_receipt VALUES(actor,_request,c.id,c.user_id,_operation,
      _expected_version,reason,sha256(convert_to(reason,'UTF8')),pg_current_xact_id(),result,t,((t AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC');
    PERFORM public.character_lifecycle_purge_internal(c.id);
    RETURN result;
  END IF;
  IF _operation='soft_delete' AND c.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('kind','unchanged','characterId',c.id,'version',c.lifecycle_version,
      'deletedAt',c.deleted_at,'restoreUntil',c.restore_until);
  END IF;
  IF _operation='restore' AND c.deleted_at IS NULL THEN
    IF c.lifecycle_version=_expected_version+1 AND c.lifecycle_version>0 THEN
      RETURN jsonb_build_object('kind','unchanged','characterId',c.id,'version',c.lifecycle_version);
    END IF;
    RAISE EXCEPTION 'lifecycle_not_deleted';
  END IF;
  IF c.lifecycle_version<>_expected_version THEN RAISE EXCEPTION 'lifecycle_stale_version'; END IF;
  IF _operation='restore' AND (
    ((EXISTS(SELECT 1 FROM public.character_creation_origin WHERE character_id=c.id)
      OR EXISTS(SELECT 1 FROM public.character_creation_log WHERE result_character_id=c.id))
      AND (NOT EXISTS(SELECT 1 FROM public.character_creation_origin WHERE character_id=c.id)
        OR NOT EXISTS(SELECT 1 FROM public.progression_character_state WHERE character_id=c.id)))
    OR EXISTS(SELECT 1 FROM public.progression_character_state s WHERE s.character_id=c.id AND s.version>0
      AND NOT EXISTS(SELECT 1 FROM public.progression_receipt p WHERE p.character_id=c.id
        AND (p.receipt->>'versionAfter')::numeric=s.version)))
  THEN RAISE EXCEPTION 'lifecycle_missing_provenance'; END IF;
  PERFORM public.character_lifecycle_quiescent_internal(c.id);
  -- Deadline checked after locks and safety checks, using current time, not transaction start.
  t:=clock_timestamp();
  IF _operation='restore' AND t>=c.restore_until THEN RAISE EXCEPTION 'lifecycle_restore_window_expired'; END IF;
  deadline:=CASE WHEN _operation='soft_delete' THEN t+interval '720 hours' ELSE NULL END;
  result:=jsonb_build_object('kind',CASE WHEN _operation='soft_delete' THEN 'soft_deleted' ELSE 'restored' END,
    'characterId',c.id,'version',c.lifecycle_version+1,
    'deletedAt',CASE WHEN _operation='soft_delete' THEN t ELSE NULL END,'restoreUntil',deadline);
  INSERT INTO public.character_lifecycle_receipt VALUES(actor,_request,c.id,c.user_id,_operation,
    _expected_version,reason,sha256(convert_to(coalesce(reason,''),'UTF8')),NULL,result,t,((t AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC');
  UPDATE public.characters SET deleted_at=CASE WHEN _operation='soft_delete' THEN t ELSE NULL END,
    restore_until=deadline,lifecycle_version=lifecycle_version+1 WHERE id=c.id;
  -- Other BEFORE/AFTER triggers may run; do not report success if any data changed.
  IF (SELECT to_jsonb(x)-ARRAY['deleted_at','restore_until','lifecycle_version'] FROM public.characters x WHERE id=c.id)
    IS DISTINCT FROM (to_jsonb(c)-ARRAY['deleted_at','restore_until','lifecycle_version'])
    OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=c.id AND lifecycle_version=c.lifecycle_version+1
      AND deleted_at IS NOT DISTINCT FROM CASE WHEN _operation='soft_delete' THEN t ELSE NULL END
      AND restore_until IS NOT DISTINCT FROM deadline)
  THEN RAISE EXCEPTION 'lifecycle_character_drift'; END IF;
  RETURN result;
END $$;

-- Read-only owner-private eligibility preparation; never performs physical cleanup.
CREATE FUNCTION public.character_purge_preflight_internal(_character uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.characters%ROWTYPE; eligible boolean;
BEGIN
  SELECT * INTO STRICT c FROM public.characters WHERE id=_character;
  eligible:=c.deleted_at IS NOT NULL AND clock_timestamp()>=c.restore_until;
  RETURN jsonb_build_object('kind',CASE WHEN eligible THEN 'eligible' ELSE 'ineligible' END,'eligibleByTime',eligible,
    'reason',CASE WHEN NOT eligible THEN 'purge_window_not_elapsed' ELSE 'explicit_overlord_command_required' END,
    'characterId',c.id,'materials',(SELECT count(*) FROM public.character_materials WHERE character_id=c.id),
    'inventory',(SELECT count(*) FROM public.character_inventory WHERE character_id=c.id),
    'origin',(SELECT count(*) FROM public.character_creation_origin WHERE character_id=c.id),
    'creationReceipts',(SELECT count(*) FROM public.character_creation_log WHERE result_character_id=c.id),
    'progressionReceipts',(SELECT count(*) FROM public.progression_receipt WHERE character_id=c.id),
    'progressionState',(SELECT count(*) FROM public.progression_character_state WHERE character_id=c.id));
END $$;

CREATE FUNCTION public.character_lifecycle_expire_receipts_internal() RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n bigint; cleared bigint;
BEGIN
  UPDATE public.character_lifecycle_receipt SET reason=NULL
    WHERE operation='purge' AND reason IS NOT NULL AND details_expires_at<=statement_timestamp();
  GET DIAGNOSTICS cleared=ROW_COUNT;
  DELETE FROM public.character_lifecycle_receipt WHERE operation<>'purge' AND details_expires_at<=statement_timestamp();
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n+cleared;
END $$;

-- New objects only: explicit owner-only ACLs including nonstandard default grants.
DO $private_acl$
DECLARE f record; g oid; col text; role_row record;
BEGIN
  FOR f IN SELECT p.oid,p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('character_lifecycle_receipt_guard','character_lifecycle_quiescent_internal',
      'character_lifecycle_command','character_purge_preflight_internal','character_lifecycle_purge_internal','character_lifecycle_expire_receipts_internal') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.identity);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);
    FOR g IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=f.oid AND a.grantee<>p.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.identity,CASE WHEN g=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g)) END);
    END LOOP;
    IF EXISTS(WITH RECURSIVE app(oid) AS (
      SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
      UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
      SELECT 1 FROM pg_roles r WHERE r.rolname<>'postgres' AND (NOT r.rolsuper OR r.oid IN (SELECT oid FROM app))
      AND has_function_privilege(r.oid,f.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'lifecycle private EXECUTE leak: %',f.identity; END IF;
  END LOOP;
  FOR g IN SELECT DISTINCT a.grantee FROM pg_class c,LATERAL aclexplode(c.relacl) a
    WHERE c.oid='public.character_lifecycle_receipt'::regclass AND a.grantee<>c.relowner LOOP
    EXECUTE format('REVOKE ALL ON public.character_lifecycle_receipt FROM %s',CASE WHEN g=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g)) END);
  END LOOP;
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.character_lifecycle_receipt'::regclass AND attnum>0 AND NOT attisdropped LOOP
    FOR g IN SELECT DISTINCT a.grantee FROM pg_attribute a0,LATERAL aclexplode(a0.attacl) a
      WHERE a0.attrelid='public.character_lifecycle_receipt'::regclass AND a0.attname=col LOOP
      EXECUTE format('REVOKE ALL (%I) ON public.character_lifecycle_receipt FROM %s',col,CASE WHEN g=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g)) END);
    END LOOP;
  END LOOP;
  FOR role_row IN SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    IF has_table_privilege(role_row.oid,'public.character_lifecycle_receipt','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(role_row.oid,'public.character_lifecycle_receipt','SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege(role_row.oid,'public.characters','UPDATE') AND EXISTS(
        SELECT 1 FROM unnest(ARRAY['deleted_at','restore_until','lifecycle_version']) c
        WHERE has_column_privilege(role_row.oid,'public.characters',c,'UPDATE'))
    THEN RAISE EXCEPTION 'lifecycle private storage/column effective leak'; END IF;
  END LOOP;
END $private_acl$;
