-- NON-DEPLOYABLE LOCAL CANDIDATE. Own namespace, reduced fixture schema only.
-- Never register in migrations or apply against public/hosted objects.
DO $$ BEGIN
 IF current_database() NOT LIKE 'g4a6_fixture_%'
    OR to_regclass('g4a6.fixture_marker') IS NULL THEN
   RAISE EXCEPTION 'G4A6 disposable fixture required; not production SQL';
 END IF;
END $$;

CREATE FUNCTION g4a6.rate_bps(value text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,g4a6,pg_temp AS $$
BEGIN
 IF value IS NULL OR value !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
    OR length(value)>6 THEN RAISE EXCEPTION 'rate requires 0.00–100.00, at most two decimals'; END IF;
 IF value::numeric>100 THEN RAISE EXCEPTION 'rate out of bounds'; END IF;
 RETURN (value::numeric*100)::integer;
END $$;

-- Match the established node advisory namespace, then encounter, then dependent
-- rows. Discovery is revalidated; no late acquisition of additional node gates.
CREATE FUNCTION g4a6.lock_creature(cid uuid,destination uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE observed g4a6.creatures; current_row g4a6.creatures; nodes uuid[]; n uuid;
BEGIN
 SELECT * INTO STRICT observed FROM g4a6.creatures WHERE id=cid;
 SELECT array_agg(node_id ORDER BY node_id) INTO nodes FROM (
   SELECT observed.node_id node_id UNION SELECT destination
   UNION SELECT e.node_id FROM g4a6.node_creature nc JOIN g4a6.node_encounter e ON e.id=nc.encounter_id
     WHERE nc.creature_id=cid AND nc.spawn_seq=observed.spawn_seq
 ) discovered WHERE node_id IS NOT NULL;
 FOREACH n IN ARRAY coalesce(nodes,ARRAY[]::uuid[]) LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM 1 FROM g4a6.node_encounter WHERE node_id=ANY(nodes) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM g4a6.node_creature WHERE creature_id=cid AND spawn_seq=observed.spawn_seq ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT current_row FROM g4a6.creatures WHERE id=cid FOR UPDATE;
 IF current_row.node_id IS DISTINCT FROM observed.node_id OR current_row.spawn_seq<>observed.spawn_seq
    OR EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.node_encounter e ON e.id=nc.encounter_id
      WHERE nc.creature_id=cid AND nc.spawn_seq=current_row.spawn_seq AND NOT(e.node_id=ANY(coalesce(nodes,ARRAY[]::uuid[]))))
 THEN RAISE EXCEPTION 'coverage changed; restart discovery' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION g4a6.blocked(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,g4a6,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM g4a6.creatures c JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq
  JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.id=cid AND (
    nc.pending_action IS NOT NULL
    OR (e.status='active' AND nc.engaged AND EXISTS(SELECT 1 FROM g4a6.node_fighter f WHERE f.encounter_id=e.id AND f.present AND f.hp>0))
    OR EXISTS(SELECT 1 FROM g4a6.node_intent i WHERE i.encounter_id=e.id AND i.status='pending')
    OR EXISTS(SELECT 1 FROM g4a6.node_pending_event p WHERE p.encounter_id=e.id AND p.consumed_at IS NULL)
    OR EXISTS(SELECT 1 FROM g4a6.node_effect x WHERE x.encounter_id=e.id AND (
      (x.target_creature_id=c.id AND (
        (NOT(x.config?'node_creature_id') AND NOT(x.config?'spawn_seq'))
        OR (x.config->>'node_creature_id'=nc.id::text AND x.config->>'spawn_seq'=c.spawn_seq::text)))
      OR x.source_creature_id=c.id
      OR (x.kind='aura' AND EXISTS(SELECT 1 FROM g4a6.node_fighter f
        WHERE f.encounter_id=e.id AND f.present AND f.hp>0 AND f.character_id=x.source_character_id
        AND f.id::text=x.config->>'source_fighter_id' AND f.entry_seq::text=x.config->>'source_entry_seq'))
      OR (NOT x.is_reservation AND coalesce(x.config->>'persistent_stance','false')<>'true'
        AND x.kind NOT IN('autoattack','stack_source') AND EXISTS(SELECT 1 FROM g4a6.node_fighter f WHERE f.encounter_id=e.id AND f.present AND f.hp>0))
    ))
  )
 );
$$;

CREATE FUNCTION g4a6.active_attachment(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,g4a6,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM g4a6.creatures c JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq
   JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.id=cid AND e.status='active');
$$;

CREATE FUNCTION g4a6.reconcile(cid uuid,cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE c g4a6.creatures;
BEGIN
 IF cutoff IS NULL OR NOT isfinite(cutoff) THEN RAISE EXCEPTION 'finite cutoff required'; END IF;
 SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 IF c.accounted_through IS NOT NULL AND cutoff<c.accounted_through THEN RAISE EXCEPTION 'backward cutoff'; END IF;
 IF NOT c.is_alive OR g4a6.blocked(cid) THEN
   UPDATE g4a6.creatures SET eligible_since=NULL,fractional_credit=0,accounted_through=cutoff WHERE id=cid;
 ELSIF c.eligible_since IS NULL THEN
   UPDATE g4a6.creatures SET eligible_since=cutoff,accounted_through=cutoff WHERE id=cid;
 END IF;
END $$;

CREATE FUNCTION g4a6.settle(cid uuid,cutoff timestamptz) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE c g4a6.creatures; start_at timestamptz; elapsed_us numeric; earned numeric; whole numeric; new_hp integer; remainder bigint;
BEGIN
 IF cutoff IS NULL OR NOT isfinite(cutoff) THEN RAISE EXCEPTION 'finite cutoff required'; END IF;
 PERFORM g4a6.lock_creature(cid);
 SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature nc WHERE nc.creature_id=cid AND nc.spawn_seq=c.spawn_seq
   AND (nc.hp<>c.hp OR nc.is_alive<>c.is_alive)) THEN RAISE EXCEPTION 'projection mismatch requires disposition'; END IF;
 IF cutoff<c.accounted_through THEN RAISE EXCEPTION 'backward cutoff'; END IF;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.node_encounter e ON e.id=nc.encounter_id
   WHERE nc.creature_id=cid AND nc.spawn_seq=c.spawn_seq AND e.claim_token IS NOT NULL AND e.claim_expires_at>cutoff)
 THEN RETURN 'live_claim_deferred'; END IF;
 IF c.accounted_through IS NULL THEN
   UPDATE g4a6.creatures SET accounted_through=cutoff,eligible_since=NULL,fractional_credit=0 WHERE id=cid;
   PERFORM g4a6.reconcile(cid,cutoff); RETURN 'initialized_without_history';
 END IF;
 IF NOT c.is_alive OR g4a6.blocked(cid) OR c.eligible_since IS NULL THEN
   PERFORM g4a6.reconcile(cid,cutoff); RETURN 'blocked_or_newly_eligible';
 END IF;
 IF cutoff=c.accounted_through THEN RETURN 'already_settled'; END IF;
 start_at:=greatest(c.accounted_through,c.eligible_since+interval '60 seconds');
 elapsed_us:=greatest(extract(epoch FROM cutoff-start_at)*1000000,0);
 earned:=c.fractional_credit + c.max_hp::numeric*c.regen_bps*elapsed_us;
 whole:=floor(earned/600000000000);
 new_hp:=least(c.max_hp::numeric,c.hp::numeric+whole)::integer;
 remainder:=mod(earned,600000000000)::bigint;
 IF new_hp=c.max_hp THEN remainder:=0; END IF;
 -- Projection and durable state share the transaction; reward/generation untouched.
 UPDATE g4a6.node_creature SET hp=new_hp WHERE creature_id=cid AND spawn_seq=c.spawn_seq;
 UPDATE g4a6.creatures SET hp=new_hp,accounted_through=cutoff,fractional_credit=remainder WHERE id=cid;
 IF new_hp<>c.hp THEN
   UPDATE g4a6.node_encounter SET state_version=state_version+1,claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL
   WHERE id IN(SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=cid AND spawn_seq=c.spawn_seq);
 END IF;
 RETURN 'settled';
END $$;

-- Below: proposed LOCAL guards and integration doubles, not public RPC bodies.
CREATE FUNCTION g4a6.seed(cid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE c g4a6.creatures; eid uuid;
BEGIN
 PERFORM g4a6.lock_creature(cid); SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 SELECT id INTO STRICT eid FROM g4a6.node_encounter WHERE node_id=c.node_id;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature WHERE creature_id=cid AND spawn_seq=c.spawn_seq AND encounter_id<>eid)
 THEN RAISE EXCEPTION 'projection belongs to another encounter'; END IF;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature WHERE creature_id=cid AND spawn_seq=c.spawn_seq
   AND (hp<>c.hp OR is_alive<>c.is_alive)) THEN RAISE EXCEPTION 'seed mismatch requires disposition'; END IF;
 IF c.is_alive THEN
   INSERT INTO g4a6.node_creature(id,encounter_id,creature_id,spawn_seq,hp,is_alive)
   VALUES(md5(cid::text||':'||c.spawn_seq::text)::uuid,eid,cid,c.spawn_seq,c.hp,true)
   ON CONFLICT(creature_id,spawn_seq) DO NOTHING;
 END IF;
END $$;

CREATE FUNCTION g4a6.enter_combat(cid uuid,cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE eid uuid;
BEGIN
 PERFORM g4a6.lock_creature(cid);
 IF NOT (SELECT is_alive FROM g4a6.creatures WHERE id=cid) THEN RAISE EXCEPTION 'dead creature'; END IF;
 SELECT e.id INTO STRICT eid FROM g4a6.node_encounter e JOIN g4a6.creatures c ON c.node_id=e.node_id WHERE c.id=cid;
 -- Authoritative entry already fences a lease; passive maintenance alone cannot.
 UPDATE g4a6.node_encounter SET claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL,state_version=state_version+1 WHERE id=eid;
 PERFORM g4a6.settle(cid,cutoff); PERFORM g4a6.seed(cid);
 UPDATE g4a6.node_encounter SET status='active' WHERE id=eid;
 INSERT INTO g4a6.node_fighter VALUES(md5(cid::text||':fighter')::uuid,eid,md5(cid::text||':character')::uuid,1,true,100)
 ON CONFLICT(id) DO UPDATE SET present=true;
 UPDATE g4a6.node_creature SET engaged=true WHERE creature_id=cid AND spawn_seq=(SELECT spawn_seq FROM g4a6.creatures WHERE id=cid);
 PERFORM g4a6.reconcile(cid,cutoff);
END $$;

CREATE FUNCTION g4a6.leave_combat(cid uuid,cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
BEGIN
 PERFORM g4a6.lock_creature(cid);
 UPDATE g4a6.node_fighter SET present=false WHERE encounter_id IN(SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=cid);
 UPDATE g4a6.node_encounter SET claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL,state_version=state_version+1
 WHERE id IN(SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=cid);
 PERFORM g4a6.reconcile(cid,cutoff);
END $$;

CREATE FUNCTION g4a6.claim(cid uuid,cutoff timestamptz,token uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE c g4a6.creatures; e g4a6.node_encounter;
BEGIN
 IF token IS NULL THEN RAISE EXCEPTION 'claim token required'; END IF;
 PERFORM g4a6.lock_creature(cid); PERFORM g4a6.settle(cid,cutoff); PERFORM g4a6.seed(cid);
 SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 SELECT ne.* INTO STRICT e FROM g4a6.node_encounter ne JOIN g4a6.node_creature nc ON nc.encounter_id=ne.id WHERE nc.creature_id=cid AND nc.spawn_seq=c.spawn_seq;
 IF e.claim_token IS NOT NULL AND e.claim_expires_at>cutoff THEN RAISE EXCEPTION 'claim in flight'; END IF;
 UPDATE g4a6.node_encounter SET claim_token=token,claim_expires_at=cutoff+interval '5 seconds',claimed_tick=tick+1 WHERE id=e.id;
 RETURN jsonb_build_object('generation',c.spawn_seq,'version',e.state_version,'tick',e.tick+1,'hp',c.hp);
END $$;

CREATE FUNCTION g4a6.commit_result(cid uuid,token uuid,expected_version bigint,generation integer,candidate_tick integer,new_hp integer,cutoff timestamptz) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE c g4a6.creatures; e g4a6.node_encounter;
BEGIN
 IF token IS NULL OR expected_version IS NULL OR generation IS NULL OR candidate_tick IS NULL
   OR new_hp IS NULL OR cutoff IS NULL OR NOT isfinite(cutoff) THEN RAISE EXCEPTION 'complete commit metadata required'; END IF;
 PERFORM g4a6.lock_creature(cid); SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 SELECT ne.* INTO STRICT e FROM g4a6.node_encounter ne JOIN g4a6.node_creature nc ON nc.encounter_id=ne.id WHERE nc.creature_id=cid AND nc.spawn_seq=c.spawn_seq;
 IF e.tick>=candidate_tick THEN RETURN 'already_committed'; END IF;
 IF e.claim_token IS DISTINCT FROM token OR e.state_version IS DISTINCT FROM expected_version OR c.spawn_seq IS DISTINCT FROM generation
   OR e.claim_expires_at<=cutoff OR e.claimed_tick IS DISTINCT FROM candidate_tick OR e.claim_expires_at IS NULL THEN RAISE EXCEPTION 'stale claim'; END IF;
 IF NOT c.is_alive OR new_hp<0 OR new_hp>c.hp OR cutoff<c.accounted_through THEN RAISE EXCEPTION 'invalid damage result'; END IF;
 UPDATE g4a6.node_creature SET hp=new_hp,is_alive=(new_hp>0),pending_action=CASE WHEN new_hp=0 THEN NULL ELSE pending_action END
 WHERE creature_id=cid AND spawn_seq=generation;
 UPDATE g4a6.creatures SET hp=new_hp,is_alive=(new_hp>0) WHERE id=cid;
 UPDATE g4a6.node_encounter SET tick=candidate_tick,state_version=state_version+1,claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL WHERE id=e.id;
 PERFORM g4a6.reconcile(cid,cutoff); RETURN 'committed';
END $$;

CREATE FUNCTION g4a6.edit_rate(cid uuid,rate text,cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE bps integer:=g4a6.rate_bps(rate);
BEGIN
 PERFORM g4a6.lock_creature(cid);
 IF g4a6.active_attachment(cid) THEN RAISE EXCEPTION 'active rate edit refused'; END IF;
 IF g4a6.settle(cid,cutoff)='live_claim_deferred' THEN RAISE EXCEPTION 'claim outstanding'; END IF;
 -- Proposed remaining policy: preserve previously earned fraction on rate edit.
 UPDATE g4a6.creatures SET regen_bps=bps WHERE id=cid;
END $$;

CREATE FUNCTION g4a6.edit_max(cid uuid,new_max integer,cutoff timestamptz,allow_floor boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE c g4a6.creatures; new_hp integer;
BEGIN
 PERFORM g4a6.lock_creature(cid);
 IF new_max IS NULL OR new_max<1 OR g4a6.active_attachment(cid) THEN RAISE EXCEPTION 'invalid/active max edit'; END IF;
 IF g4a6.settle(cid,cutoff)='live_claim_deferred' THEN RAISE EXCEPTION 'claim outstanding'; END IF;
 SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 new_hp:=CASE WHEN c.is_alive THEN new_max-(c.max_hp-c.hp) ELSE 0 END;
 IF c.is_alive AND new_hp<1 THEN
   IF NOT allow_floor THEN RAISE EXCEPTION 'living floor requires explicit owner confirmation'; END IF;
   new_hp:=1;
 END IF;
 UPDATE g4a6.node_creature SET hp=new_hp WHERE creature_id=cid AND spawn_seq=c.spawn_seq;
 UPDATE g4a6.creatures SET max_hp=new_max,hp=new_hp,fractional_credit=CASE WHEN new_hp=new_max THEN 0 ELSE fractional_credit END WHERE id=cid;
 UPDATE g4a6.node_encounter SET state_version=state_version+1,claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL WHERE id IN(SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=cid AND spawn_seq=c.spawn_seq);
END $$;

CREATE FUNCTION g4a6.reassign(cid uuid,destination uuid,cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE eid uuid; c g4a6.creatures;
BEGIN
 PERFORM g4a6.lock_creature(cid,destination);
 IF g4a6.active_attachment(cid) OR g4a6.blocked(cid) OR EXISTS(
   SELECT 1 FROM g4a6.node_encounter e JOIN g4a6.node_creature nc ON nc.encounter_id=e.id
   JOIN g4a6.creatures cr ON cr.id=nc.creature_id AND cr.spawn_seq=nc.spawn_seq
   WHERE cr.id=cid AND e.claim_token IS NOT NULL) THEN RAISE EXCEPTION 'reassignment not quiescent'; END IF;
 SELECT id INTO STRICT eid FROM g4a6.node_encounter WHERE node_id=destination;
 IF (SELECT status FROM g4a6.node_encounter WHERE id=eid)<>'ended' THEN RAISE EXCEPTION 'destination active'; END IF;
 PERFORM g4a6.settle(cid,cutoff); SELECT * INTO STRICT c FROM g4a6.creatures WHERE id=cid;
 UPDATE g4a6.node_creature SET encounter_id=eid,engaged=false,tank_fighter_id=NULL WHERE creature_id=cid AND spawn_seq=c.spawn_seq;
 UPDATE g4a6.creatures SET node_id=destination WHERE id=cid;
 UPDATE g4a6.node_encounter SET state_version=state_version+1 WHERE node_id=c.node_id OR id=eid;
END $$;

CREATE FUNCTION g4a6.observe_due_respawn(cid uuid,cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
BEGIN
 PERFORM g4a6.lock_creature(cid);
 IF (SELECT is_alive FROM g4a6.creatures WHERE id=cid) THEN RAISE EXCEPTION 'ordinary dead respawn required'; END IF;
 -- Fixture assumes ordinary died_at+respawn_seconds selection already succeeded.
 -- Production generation bump remains its existing dead->alive trigger.
 UPDATE g4a6.creatures SET hp=max_hp,is_alive=true,spawn_seq=spawn_seq+1,
   eligible_since=cutoff,accounted_through=cutoff,fractional_credit=0 WHERE id=cid;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;
