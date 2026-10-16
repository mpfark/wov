-- LOCAL CANDIDATE ONLY. Not installed; not an automatic migration.
-- Forward-only Drizzle review lane after fresh installed parity and explicit GO.
-- Shared HP transition callers/legacy healer cutover are NOT installed by this file.
BEGIN;
ALTER TABLE public.creatures
 ADD COLUMN regen_percent_4s numeric(5,2) NOT NULL DEFAULT 2 CHECK(regen_percent_4s BETWEEN 0 AND 100),
 ADD COLUMN regen_eligible_since timestamptz,
 ADD COLUMN regen_accounted_at timestamptz,
 ADD COLUMN regen_generation integer,
 ADD COLUMN regen_credit numeric NOT NULL DEFAULT 0 CHECK(regen_credit >= 0 AND regen_credit < 1);

-- Discover first; never acquire an additional node gate after dependent rows.
CREATE FUNCTION public.creature_admin_cover(cid uuid, destination uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE before jsonb; after_gates jsonb; n uuid;
BEGIN
 SELECT jsonb_build_object('node',c.node_id,'generation',c.spawn_seq,'projections',
   coalesce((SELECT jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,e.node_id) ORDER BY nc.id)
    FROM public.node_creature nc JOIN public.node_encounter e ON e.id=nc.encounter_id WHERE nc.creature_id=cid),'[]'))
 INTO before FROM public.creatures c WHERE c.id=cid;
 FOR n IN SELECT DISTINCT v FROM (
   SELECT (before->>'node')::uuid v UNION SELECT destination
   UNION SELECT (p->>2)::uuid FROM jsonb_array_elements(coalesce(before->'projections','[]')) p
 ) s WHERE v IS NOT NULL ORDER BY v LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 PERFORM 1 FROM public.node_encounter e WHERE e.node_id IN (
   SELECT (before->>'node')::uuid UNION SELECT destination
   UNION SELECT (p->>2)::uuid FROM jsonb_array_elements(coalesce(before->'projections','[]')) p
 ) ORDER BY e.id FOR UPDATE;
 PERFORM 1 FROM public.node_creature WHERE creature_id=cid ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.creatures WHERE id=cid FOR UPDATE;
 SELECT jsonb_build_object('node',c.node_id,'generation',c.spawn_seq,'projections',
   coalesce((SELECT jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,e.node_id) ORDER BY nc.id)
    FROM public.node_creature nc JOIN public.node_encounter e ON e.id=nc.encounter_id WHERE nc.creature_id=cid),'[]'))
 INTO after_gates FROM public.creatures c WHERE c.id=cid;
 IF before IS DISTINCT FROM after_gates THEN RAISE EXCEPTION 'coverage changed; rediscover' USING ERRCODE='40001'; END IF;
END $$;

-- Conservative blockers: an active encounter is not made quiet by invisible
-- players. Retained effects/actions/events/claims also block ended encounters.
CREATE FUNCTION public.creature_regen_blocked(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.creatures c JOIN public.node_encounter e ON e.node_id=c.node_id
 WHERE c.id=cid AND (e.status='active' OR e.claim_token IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.encounter_id=e.id AND nc.pending_action IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.node_effect x WHERE x.encounter_id=e.id)
 OR EXISTS(SELECT 1 FROM public.node_intent i WHERE i.encounter_id=e.id AND i.status='pending')
 OR EXISTS(SELECT 1 FROM public.node_pending_event p WHERE p.encounter_id=e.id AND p.consumed_at IS NULL)))
 OR EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.creatures c ON c.id=nc.creature_id
 JOIN public.node_encounter e ON e.id=nc.encounter_id WHERE c.id=cid AND nc.spawn_seq=c.spawn_seq
 AND (e.node_id IS DISTINCT FROM c.node_id OR e.status='active' OR e.claim_token IS NOT NULL));
$$;

-- Integration helper, private to cooperating engine/Admin callers. No scheduler
-- or trigger is added: transition composition must be reviewed before activation.
CREATE FUNCTION public.creature_regen_settle(cid uuid, cutoff timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.creatures; periods numeric; earned numeric; next_hp integer;
BEGIN
 IF cutoff IS NULL OR NOT isfinite(cutoff) THEN RAISE EXCEPTION 'finite cutoff required'; END IF;
 PERFORM public.creature_admin_cover(cid);
 SELECT * INTO STRICT c FROM public.creatures WHERE id=cid;
 IF c.regen_accounted_at IS NOT NULL AND cutoff<c.regen_accounted_at THEN RAISE EXCEPTION 'backward cutoff'; END IF;
 IF EXISTS(SELECT 1 FROM public.node_creature WHERE creature_id=cid AND spawn_seq=c.spawn_seq
   AND (hp<>c.hp OR is_alive<>c.is_alive)) THEN RAISE EXCEPTION 'HP parity requires disposition'; END IF;
 IF NOT c.is_alive OR public.creature_regen_blocked(cid) THEN
   UPDATE public.creatures SET regen_eligible_since=NULL,regen_accounted_at=cutoff,regen_credit=0,regen_generation=spawn_seq WHERE id=cid;
   RETURN;
 END IF;
 IF c.regen_generation IS DISTINCT FROM c.spawn_seq OR c.regen_eligible_since IS NULL OR c.regen_accounted_at IS NULL THEN
   UPDATE public.creatures SET regen_eligible_since=cutoff,regen_accounted_at=cutoff,regen_credit=0,regen_generation=spawn_seq WHERE id=cid;
   RETURN; -- no retroactive initialization or blocked-period credit
 END IF;
 periods:=floor(extract(epoch FROM cutoff-c.regen_accounted_at)/4);
 IF periods<=0 THEN RETURN; END IF;
 earned:=c.regen_credit+c.max_hp::numeric*c.regen_percent_4s*periods/100;
 next_hp:=least(c.max_hp::numeric,c.hp::numeric+floor(earned))::integer;
 UPDATE public.creatures SET hp=next_hp,regen_credit=CASE WHEN next_hp=c.max_hp THEN 0 ELSE earned-floor(earned) END,
   regen_accounted_at=c.regen_accounted_at+periods*interval '4 seconds' WHERE id=cid;
 UPDATE public.node_creature SET hp=next_hp WHERE creature_id=cid AND spawn_seq=c.spawn_seq;
 IF next_hp<>c.hp THEN
   UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL
   WHERE id IN(SELECT encounter_id FROM public.node_creature WHERE creature_id=cid AND spawn_seq=c.spawn_seq);
 END IF;
END $$;

-- Includes real FK references even when their action would cascade/set NULL.
-- Known non-FK histories are checked separately; no history is removed.
CREATE FUNCTION public.creature_admin_referenced(cid uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record; hit boolean; t text;
BEGIN
 FOR r IN SELECT conrelid::regclass tab, a.attname col, cardinality(conkey) n
 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[1]
 WHERE k.contype='f' AND k.confrelid='public.creatures'::regclass LOOP
   IF r.n<>1 THEN RETURN true; END IF; -- unknown composite reference, fail closed
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',r.tab,r.col) INTO hit USING cid;
   IF hit THEN RETURN true; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['node_creature','node_effect','node_participation','node_reward_claim','node_death_loot',
 'node_intent','node_pending_event','node_boss_ability_cooldown','node_ground_loot','encounter_creatures','combat_sessions',
 'characters','items','admin_creature_reward_request'] LOOP
   IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
   EXECUTE format($q$SELECT EXISTS(SELECT 1 FROM public.%I x WHERE
     to_jsonb(x)->>'creature_id'=$1 OR to_jsonb(x)->>'source_creature_id'=$1
     OR to_jsonb(x)->>'target_creature_id'=$1 OR to_jsonb(x)->>'actor_creature_id'=$1
     OR to_jsonb(x)->>'assassin_contract_target'=$1
     OR to_jsonb(x)->>'contract_target_id'=$1
     OR to_jsonb(x)->'active_contract'->>'creature_id'=$1
     OR (to_jsonb(x)->>'origin_type'='creature' AND to_jsonb(x)->>'origin_id'=$1)
     OR coalesce(to_jsonb(x)->'engaged_creature_ids','[]') ? $1)$q$,t) INTO hit USING cid::text;
   IF hit THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;

CREATE FUNCTION public.admin_creature_mutate(_action text,_creature_id uuid,_expected jsonb,_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.creatures; desired public.creatures; key text; answer text; protected boolean; multiplier numeric;
 hp_mult numeric; ac_add integer; base integer; generated_max integer; new_hp integer; dest uuid; all_match boolean;
BEGIN
 IF auth.uid() IS NULL OR public.is_steward_or_overlord() IS DISTINCT FROM true THEN
   answer:='not_authorized';
 ELSIF _creature_id IS NULL OR _action IS NULL OR _action NOT IN('save','create','move','delete')
 OR jsonb_typeof(_expected) IS DISTINCT FROM 'object' OR jsonb_typeof(_patch) IS DISTINCT FROM 'object' THEN
   answer:='invalid_request';
 ELSE
   IF _action IN('save','create') THEN
     IF EXISTS(SELECT 1 FROM jsonb_object_keys(_patch) k WHERE k NOT IN('name','description','node_id','level','rarity',
       'is_aggressive','is_humanoid','respawn_seconds','boss_crit_flavors','boss_death_cry','boss_cast','regen_percent_4s','max_hp'))
       OR (_action='save' AND _patch?'node_id') OR (_action='create' AND _patch?'max_hp') THEN
       RAISE EXCEPTION 'invalid config fields' USING ERRCODE='22023';
     END IF;
     IF EXISTS(SELECT 1 FROM jsonb_each(_patch) v WHERE v.key IN('level','respawn_seconds','max_hp') AND coalesce(v.value#>>'{}','') !~ '^[0-9]+$') THEN RAISE EXCEPTION 'integer config required' USING ERRCODE='22023'; END IF;
     IF _patch?'regen_percent_4s' AND (coalesce(_patch->>'regen_percent_4s','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
       OR length(_patch->>'regen_percent_4s')>6) THEN RAISE EXCEPTION 'invalid rate' USING ERRCODE='22023'; END IF;
   ELSIF (_action='move' AND (_patch-'node_id'<>'{}' OR NOT _patch?'node_id'))
      OR (_action='delete' AND _patch<>'{}') THEN RAISE EXCEPTION 'invalid action fields' USING ERRCODE='22023'; END IF;
   protected:=_action<>'save' OR EXISTS(SELECT 1 FROM jsonb_object_keys(_patch) k WHERE k NOT IN('name','description'));
   dest:=CASE WHEN _action IN('move','create') THEN (_patch->>'node_id')::uuid END;
   IF protected THEN
     -- Serialize concurrent creation of this one stable identity BEFORE coverage;
     -- no other supported branch takes this request-independent creation key.
     IF _action='create' THEN PERFORM pg_advisory_xact_lock(hashtextextended('creature-create:'||_creature_id::text,0)); END IF;
     PERFORM public.creature_admin_cover(_creature_id,dest);
   END IF;
   SELECT * INTO c FROM public.creatures WHERE id=_creature_id FOR UPDATE;
   IF _action='create' AND FOUND THEN answer:='identity_exists';
   ELSIF _action<>'create' AND NOT FOUND THEN answer:=CASE WHEN _action='delete' THEN 'already_absent' ELSE 'not_found' END;
   ELSE
     IF _action='create' THEN
       SELECT * INTO c FROM jsonb_populate_record(NULL::public.creatures,
         '{"description":"","level":1,"rarity":"regular","is_aggressive":false,"is_humanoid":false,"respawn_seconds":300,"regen_percent_4s":2,"boss_crit_flavors":[],"boss_death_cry":"","boss_cast":null}');
     END IF;
     desired:=jsonb_populate_record(c,_patch);
     IF _action IN('save','create') THEN
       IF desired.name IS NULL OR btrim(desired.name)='' OR desired.description IS NULL
         OR desired.level IS NULL OR desired.level<1
         OR desired.rarity IS NULL OR desired.rarity::text NOT IN('regular','rare','boss') OR desired.respawn_seconds IS NULL OR desired.respawn_seconds<0
         OR desired.is_aggressive IS NULL OR desired.is_humanoid IS NULL OR desired.regen_percent_4s IS NULL
         OR desired.regen_percent_4s<0 OR desired.regen_percent_4s>100 THEN RAISE EXCEPTION 'invalid config' USING ERRCODE='22023'; END IF;
       -- Existing rich boss documents need the real catalogue validator, not a
       -- permissive JSON recreation here. Unchanged documents are preserved.
       IF desired.boss_cast IS DISTINCT FROM c.boss_cast THEN answer:='unsupported_boss'; END IF;
       IF _patch?'boss_crit_flavors' AND (jsonb_typeof(desired.boss_crit_flavors) IS DISTINCT FROM 'array') THEN
         RAISE EXCEPTION 'flavor array required' USING ERRCODE='22023';
       END IF;
     END IF;
     all_match:=_action='save';
     FOR key IN SELECT jsonb_object_keys(_patch) LOOP
       IF (CASE WHEN key='is_aggressive' THEN to_jsonb(c.base_aggressive) ELSE to_jsonb(c)->key END)
          IS DISTINCT FROM to_jsonb(desired)->key THEN all_match:=false; END IF;
     END LOOP;
     IF _action='move' THEN all_match:=c.node_id IS NOT DISTINCT FROM dest; END IF;
     IF answer IS NULL AND all_match THEN answer:='already_matches'; END IF;
     IF answer IS NULL AND _action<>'create' THEN
       -- Exactly touched fields, plus derived-max dependencies or displayed delete identity.
       IF _action='delete' THEN
         IF NOT (_expected ?& ARRAY['name','node_id']) OR _expected-ARRAY['name','node_id']<>'{}' THEN answer:='invalid_request'; END IF;
       ELSIF _action='move' THEN
         IF NOT _expected?'node_id' OR _expected-'node_id'<>'{}' THEN answer:='invalid_request'; END IF;
       ELSE
         IF EXISTS(SELECT 1 FROM jsonb_object_keys(_patch) k WHERE NOT _expected?k)
           OR EXISTS(SELECT 1 FROM jsonb_object_keys(_expected) k WHERE NOT _patch?k AND NOT
             ((_patch?'level' OR _patch?'rarity') AND k IN('level','rarity','max_hp')))
           OR ((_patch?'level' OR _patch?'rarity') AND NOT _expected ?& ARRAY['level','rarity','max_hp'])
           THEN answer:='invalid_request'; END IF;
       END IF;
       FOR key IN SELECT jsonb_object_keys(_expected) LOOP
         IF (CASE WHEN key='regen_percent_4s' THEN to_jsonb(c.regen_percent_4s) WHEN key='is_aggressive' THEN to_jsonb(c.base_aggressive) ELSE to_jsonb(c)->key END) IS DISTINCT FROM (CASE WHEN key='regen_percent_4s' THEN to_jsonb((_expected->>key)::numeric) ELSE _expected->key END) THEN answer:=coalesce(answer,'stale'); END IF;
       END LOOP;
     END IF;
     IF answer IS NULL AND protected THEN
       IF public.creature_regen_blocked(_creature_id) OR (dest IS NOT NULL AND EXISTS(
         SELECT 1 FROM public.node_encounter WHERE node_id=dest AND (status='active' OR claim_token IS NOT NULL)))
         THEN answer:='combat_active';
       ELSIF _action IN('delete','move') AND public.creature_admin_referenced(_creature_id) THEN answer:='retained_references';
       ELSIF EXISTS(SELECT 1 FROM public.node_creature WHERE creature_id=_creature_id) THEN
         answer:='integration_required'; -- safe-ended projection transfer/config awaits full HP cutover
       END IF;
       IF dest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=dest) THEN answer:='invalid_request'; END IF;
     END IF;
     IF answer IS NULL THEN
       IF _action='create' OR (_action='save' AND (_patch?'level' OR _patch?'rarity')) THEN
         IF _patch?'max_hp' THEN RAISE EXCEPTION 'derived and explicit max conflict' USING ERRCODE='22023'; END IF;
         multiplier:=CASE desired.rarity::text WHEN 'rare' THEN 1.3 WHEN 'boss' THEN 2.5 ELSE 1 END;
         hp_mult:=CASE desired.rarity::text WHEN 'rare' THEN 1.5 WHEN 'boss' THEN 6 ELSE 1 END;
         ac_add:=CASE desired.rarity::text WHEN 'boss' THEN 6 ELSE 2 END;
         base:=8+floor(desired.level::numeric*0.7)::integer;
         desired.stats:=jsonb_build_object('str',round(base*multiplier),'dex',round((base-1)*multiplier));
         desired.ac:=round(10+desired.level::numeric*0.575+ac_add)::integer;
         desired.max_hp:=round((15+desired.level::numeric*8)*hp_mult)::integer;
       END IF;
       IF _action='create' THEN
         INSERT INTO public.creatures(id,name,description,node_id,level,rarity,hp,max_hp,stats,ac,is_aggressive,base_aggressive,
           is_humanoid,respawn_seconds,boss_crit_flavors,boss_death_cry,boss_cast,regen_percent_4s,regen_eligible_since,regen_accounted_at)
         VALUES(_creature_id,btrim(desired.name),desired.description,dest,desired.level,desired.rarity,desired.max_hp,desired.max_hp,
           desired.stats,desired.ac,desired.is_aggressive,desired.is_aggressive,desired.is_humanoid,desired.respawn_seconds,
           desired.boss_crit_flavors,desired.boss_death_cry,desired.boss_cast,desired.regen_percent_4s,now(),now());
         UPDATE public.creatures SET regen_generation=spawn_seq WHERE id=_creature_id;
         answer:='created';
       ELSIF _action='delete' THEN DELETE FROM public.creatures WHERE id=_creature_id; answer:='deleted';
       ELSIF NOT protected THEN
         UPDATE public.creatures SET name=desired.name,description=desired.description WHERE id=_creature_id; answer:='updated';
       ELSE
         PERFORM public.creature_regen_settle(_creature_id,now());
         SELECT * INTO STRICT c FROM public.creatures WHERE id=_creature_id;
         IF desired.max_hp IS NULL OR desired.max_hp<1 THEN RAISE EXCEPTION 'invalid maximum' USING ERRCODE='22023'; END IF;
         new_hp:=CASE WHEN c.is_alive THEN greatest(1,desired.max_hp-(c.max_hp-c.hp)) ELSE 0 END;
         IF _action='move' THEN
           UPDATE public.creatures SET node_id=dest WHERE id=_creature_id;
         ELSE
           UPDATE public.creatures SET name=desired.name,description=desired.description,level=desired.level,rarity=desired.rarity,
           stats=desired.stats,ac=desired.ac,is_aggressive=CASE WHEN _patch?'is_aggressive' THEN desired.is_aggressive ELSE c.is_aggressive END,
           base_aggressive=CASE WHEN _patch?'is_aggressive' THEN desired.is_aggressive ELSE c.base_aggressive END,
           is_humanoid=desired.is_humanoid,respawn_seconds=desired.respawn_seconds,boss_crit_flavors=desired.boss_crit_flavors,
           boss_death_cry=desired.boss_death_cry,boss_cast=desired.boss_cast,max_hp=desired.max_hp,hp=new_hp,
           regen_percent_4s=desired.regen_percent_4s,
           regen_credit=CASE WHEN desired.regen_percent_4s<>c.regen_percent_4s OR new_hp=desired.max_hp THEN 0 ELSE regen_credit END,
           regen_accounted_at=CASE WHEN desired.regen_percent_4s<>c.regen_percent_4s OR desired.max_hp<>c.max_hp THEN now() ELSE regen_accounted_at END
           WHERE id=_creature_id;
         END IF;
         answer:='updated';
       END IF;
     END IF;
   END IF;
 END IF;
 RETURN jsonb_build_object('ok',answer IN('updated','created','already_matches','deleted','already_absent'),
   'kind',answer,'creatureId',_creature_id);
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN
 RETURN jsonb_build_object('ok',false,'kind','invalid_request','creatureId',_creature_id);
END $$;

ALTER FUNCTION public.creature_admin_cover(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.creature_regen_blocked(uuid) OWNER TO postgres;
ALTER FUNCTION public.creature_regen_settle(uuid,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.creature_admin_referenced(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_creature_mutate(text,uuid,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_admin_cover(uuid,uuid),public.creature_regen_blocked(uuid),
 public.creature_regen_settle(uuid,timestamptz),public.creature_admin_referenced(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_creature_mutate(text,uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_creature_mutate(text,uuid,jsonb,jsonb) TO authenticated;

-- Cutover candidate only: preserve existing service/postgres/internal authority.
-- Column grants can survive a table REVOKE, so remove both and assert effective denial.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.creatures FROM PUBLIC,anon,authenticated;
DO $$ DECLARE cols text; role_name text; BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute
 WHERE attrelid='public.creatures'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE 'REVOKE INSERT ('||cols||'), UPDATE ('||cols||') ON public.creatures FROM PUBLIC,anon,authenticated';
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_table_privilege(role_name,'public.creatures','INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_any_column_privilege(role_name,'public.creatures','INSERT,UPDATE') THEN
     RAISE EXCEPTION 'inherited browser creature DML remains; installation refused';
   END IF;
 END LOOP;
END $$;
COMMIT;
