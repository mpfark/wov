-- G4A21 consolidated forward candidate. NOT INSTALLED; no automatic migration.
-- Replaces uninstalled G4A19/G4A20 candidates, never apply sequentially.
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
 AND (e.node_id IS DISTINCT FROM c.node_id OR e.status='active' OR e.claim_token IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.creatures c WHERE c.id=cid AND (
 EXISTS(SELECT 1 FROM public.encounter_creatures ec JOIN public.encounters e ON e.id=ec.encounter_id WHERE ec.creature_id=c.id AND e.status='active')
 OR EXISTS(SELECT 1 FROM public.combat_sessions s WHERE s.node_id=c.node_id AND c.id=ANY(s.engaged_creature_ids))
 OR EXISTS(SELECT 1 FROM public.active_effects ae WHERE ae.target_id=c.id AND ae.expires_at>floor(extract(epoch FROM now())*1000)::bigint)));
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


-- Acceptance contract from src/shared/combat2/boss-catalog.ts: adaptBossCast.
-- Disabled/null configurations remain valid non-casts. Only changed docs validate.
CREATE FUNCTION public.creature_admin_boss_valid(cast_doc jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF cast_doc IS NULL OR cast_doc='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(cast_doc)<>'object' THEN RETURN false; END IF;
 IF cast_doc?'enabled' AND jsonb_typeof(cast_doc->'enabled')<>'boolean' THEN RETURN false; END IF;
 IF cast_doc->'enabled'='false'::jsonb THEN RETURN true; END IF;
 IF (cast_doc?'label' AND cast_doc->'label'<>'null'::jsonb AND jsonb_typeof(cast_doc->'label')<>'string')
 OR (cast_doc?'ability_key' AND cast_doc->'ability_key'<>'null'::jsonb AND jsonb_typeof(cast_doc->'ability_key')<>'string') THEN RETURN false; END IF;
 IF coalesce(nullif(btrim(cast_doc->>'ability_key'),''),nullif(btrim(cast_doc->>'label'),'')) IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(cast_doc->'cast_ms') IS DISTINCT FROM 'number' OR (cast_doc->>'cast_ms')::numeric<=0 THEN RETURN false; END IF;
 IF ((jsonb_typeof(cast_doc->'base_amount')='number' AND (cast_doc->>'base_amount')::numeric>0)
   OR (coalesce(jsonb_typeof(cast_doc->'base_amount'),'null')<>'number' AND jsonb_typeof(cast_doc->'amount')='number' AND (cast_doc->>'amount')::numeric>0)) IS DISTINCT FROM true THEN RETURN false; END IF;
 IF cast_doc->'target_mode' IS NOT NULL AND cast_doc->'target_mode'<>'null'::jsonb
   AND cast_doc->>'target_mode' NOT IN('tank','aoe','random','tank_preferred','tank_strict','random_alive') THEN RETURN false; END IF;
 RETURN true;
END $$;
ALTER FUNCTION public.creature_admin_boss_valid(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_admin_boss_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
       IF desired.boss_cast IS DISTINCT FROM c.boss_cast AND NOT public.creature_admin_boss_valid(desired.boss_cast) THEN answer:='unsupported_boss'; END IF;
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
       ELSIF (_action='delete' OR (_action='move' AND dest IS NULL)) AND public.creature_admin_referenced(_creature_id) THEN answer:='retained_references';
       ELSIF EXISTS(SELECT 1 FROM public.node_creature WHERE creature_id=_creature_id AND spawn_seq<>c.spawn_seq) THEN
         answer:='integration_required'; -- safe-ended projection transfer/config awaits full HP cutover
       END IF;
       IF dest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=dest) THEN answer:='invalid_request'; END IF;
       IF _action='move' AND dest IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.node_encounter WHERE node_id=dest AND status='ended')
         OR EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.node_id=dest AND (
           EXISTS(SELECT 1 FROM public.node_effect x WHERE x.encounter_id=e.id)
           OR EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.encounter_id=e.id AND nc.pending_action IS NOT NULL)
           OR EXISTS(SELECT 1 FROM public.node_intent i WHERE i.encounter_id=e.id AND i.status='pending')
           OR EXISTS(SELECT 1 FROM public.node_pending_event p WHERE p.encounter_id=e.id AND p.consumed_at IS NULL))))
       THEN answer:='integration_required'; END IF;
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
           UPDATE public.node_creature SET encounter_id=(SELECT id FROM public.node_encounter WHERE node_id=dest),
             engaged=false,tank_fighter_id=NULL WHERE creature_id=_creature_id AND spawn_seq=c.spawn_seq;
           UPDATE public.creatures SET node_id=dest WHERE id=_creature_id;
           UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
             WHERE node_id=c.node_id OR node_id=dest;
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
         UPDATE public.node_creature SET hp=new_hp,is_alive=c.is_alive WHERE creature_id=_creature_id AND spawn_seq=c.spawn_seq;
         IF _action='save' THEN
           UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
             WHERE id IN(SELECT encounter_id FROM public.node_creature WHERE creature_id=_creature_id AND spawn_seq=c.spawn_seq);
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

-- Passive world maintenance: discover/lock all affected nodes before any rows.
CREATE FUNCTION public.creature_hp_maintain() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE discovered jsonb; current_coverage jsonb; n uuid; cid uuid;
BEGIN
 SELECT jsonb_build_object('creatures',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.id,c.node_id,c.spawn_seq) ORDER BY c.id),'[]') FROM public.creatures c),'encounters',(SELECT coalesce(jsonb_agg(jsonb_build_array(e.id,e.node_id) ORDER BY e.id),'[]') FROM public.node_encounter e),'projections',(SELECT coalesce(jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id),'[]') FROM public.node_creature nc)) INTO discovered;
 FOR n IN SELECT DISTINCT v FROM (SELECT (c->>1)::uuid v FROM jsonb_array_elements(discovered->'creatures') c UNION SELECT (e->>1)::uuid FROM jsonb_array_elements(discovered->'encounters') e) s WHERE v IS NOT NULL ORDER BY v LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 PERFORM 1 FROM public.node_encounter WHERE id IN(SELECT (e->>0)::uuid FROM jsonb_array_elements(discovered->'encounters') e) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.node_creature WHERE id IN(SELECT (e->>0)::uuid FROM jsonb_array_elements(discovered->'projections') e) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.creatures WHERE id IN(SELECT (e->>0)::uuid FROM jsonb_array_elements(discovered->'creatures') e) ORDER BY id FOR UPDATE;
 SELECT jsonb_build_object('creatures',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.id,c.node_id,c.spawn_seq) ORDER BY c.id),'[]') FROM public.creatures c),'encounters',(SELECT coalesce(jsonb_agg(jsonb_build_array(e.id,e.node_id) ORDER BY e.id),'[]') FROM public.node_encounter e),'projections',(SELECT coalesce(jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id),'[]') FROM public.node_creature nc)) INTO current_coverage;
 IF discovered IS DISTINCT FROM current_coverage THEN RAISE EXCEPTION 'maintenance coverage changed' USING ERRCODE='40001'; END IF;
 FOR cid IN SELECT id FROM public.creatures ORDER BY id LOOP
   PERFORM public.creature_regen_settle(cid,now());
 END LOOP;
END $$;
ALTER FUNCTION public.creature_hp_maintain() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_hp_maintain() FROM PUBLIC,anon,authenticated,service_role;
-- Existing owner/ACLs must be verified before installation. CREATE OR REPLACE
-- preserves existing ownership/grants; no new browser or service grant is added.
DO $hp_legacy$ DECLARE function_oid regprocedure:=to_regprocedure('public.regen_creature_hp()'); s text; before record; after record; BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing legacy HP dependency: regen_creature_hp'; END IF;
 SELECT prosrc INTO s FROM pg_proc WHERE oid=function_oid;
 IF md5(regexp_replace(s,'\s+',' ','g')) IS DISTINCT FROM '06404acc8c6dc1aeeda6af3188aa63cf' THEN RAISE EXCEPTION 'legacy source drift: regen_creature_hp'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE oid=function_oid;
 EXECUTE 'CREATE OR REPLACE FUNCTION public.regen_creature_hp() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.creature_hp_maintain(); END $$';
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'legacy metadata drift: regen_creature_hp'; END IF;
 END $hp_legacy$;

DO $hp_legacy$ DECLARE function_oid regprocedure:=to_regprocedure('public.heal_creatures_on_wake()'); s text; before record; after record; BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing legacy HP dependency: heal_creatures_on_wake'; END IF;
 SELECT prosrc INTO s FROM pg_proc WHERE oid=function_oid;
 IF md5(regexp_replace(s,'\s+',' ','g')) IS DISTINCT FROM '2e72d0459dfc780eccf67b4e25f4d702' THEN RAISE EXCEPTION 'legacy source drift: heal_creatures_on_wake'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE oid=function_oid;
 EXECUTE 'CREATE OR REPLACE FUNCTION public.heal_creatures_on_wake() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- No instant heal and no late node locks inside wake''s character-trigger DDL.
 -- Eligible sleep time settles on the next ordinary maintenance or entry.
 RETURN 0;
END $$';
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'legacy metadata drift: heal_creatures_on_wake'; END IF;
 END $hp_legacy$;
-- Source fragment assembled into the consolidated forward candidate. Not installed.
CREATE FUNCTION public.creature_hp_discover(input_nodes uuid[], input_actors uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH actors AS(SELECT unnest(input_actors) id UNION SELECT f.character_id FROM public.node_fighter f
 JOIN public.node_encounter e ON e.id=f.encounter_id WHERE e.node_id=ANY(input_nodes)),
 parties AS(SELECT p.id,p.leader_id,p.tank_id FROM public.parties p WHERE p.leader_id IN(SELECT id FROM actors)
 OR EXISTS(SELECT 1 FROM public.party_members m WHERE m.party_id=p.id AND m.character_id IN(SELECT id FROM actors))),
 members AS(SELECT m.id,m.party_id,m.character_id,m.status,m.is_following FROM public.party_members m WHERE m.party_id IN(SELECT id FROM parties)),
 chars AS(SELECT c.id,c.current_node_id,c.deleted_at FROM public.characters c WHERE c.id IN(SELECT id FROM actors UNION SELECT character_id FROM members)),
 base AS(SELECT unnest(input_nodes) id UNION SELECT current_node_id FROM chars),
 creatures AS(SELECT c.id,c.node_id,c.spawn_seq FROM public.creatures c WHERE c.node_id IN(SELECT id FROM base)
 OR EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.node_encounter e ON e.id=nc.encounter_id
 WHERE nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq AND e.node_id IN(SELECT id FROM base))),
 refs AS(SELECT f.encounter_id id FROM public.node_fighter f WHERE f.character_id IN(SELECT id FROM chars)
 UNION SELECT nc.encounter_id FROM public.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
 UNION SELECT g.encounter_id FROM public.node_arrival_group g WHERE g.active AND g.party_id IN(SELECT id FROM parties)),
 encounters AS(SELECT e.id,e.node_id FROM public.node_encounter e WHERE e.node_id IN(SELECT id FROM base) OR e.id IN(SELECT id FROM refs)),
 nodes AS(SELECT id FROM base UNION SELECT node_id FROM encounters UNION SELECT node_id FROM creatures)
 SELECT jsonb_build_object('nodes',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM nodes WHERE id IS NOT NULL),'[]'),
 'parties',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM parties p),'[]'),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM members m),'[]'),
 'characters',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM chars c),'[]'),
 'encounters',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM encounters e),'[]'),
 'creatures',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM creatures c),'[]'),
 'projections',coalesce((SELECT jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id)
 FROM public.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq),'[]'))
$$;

CREATE FUNCTION public.creature_hp_cover(input_nodes uuid[],input_actors uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE coverage jsonb:=public.creature_hp_discover(input_nodes,input_actors); inherited jsonb; n uuid;
BEGIN
 inherited:=nullif(current_setting('app.creature_hp_coverage',true),'')::jsonb;
 IF inherited IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coverage->'nodes') v
 WHERE NOT(inherited->'nodes' ? v)) THEN RAISE EXCEPTION 'late creature HP node coverage' USING ERRCODE='40001'; END IF;
 FOR n IN SELECT value::uuid FROM jsonb_array_elements_text(coverage->'nodes') ORDER BY value::uuid LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 IF coverage IS DISTINCT FROM public.creature_hp_discover(input_nodes,input_actors) THEN RAISE EXCEPTION 'HP coverage changed before rows' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.node_encounter WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'encounters') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.node_creature WHERE id IN(SELECT (v->>0)::uuid FROM jsonb_array_elements(coverage->'projections') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.creatures WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v) ORDER BY id FOR UPDATE;
 IF coverage IS DISTINCT FROM public.creature_hp_discover(input_nodes,input_actors) THEN RAISE EXCEPTION 'HP coverage changed under rows' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
 JOIN public.node_encounter e ON e.id=nc.encounter_id WHERE c.id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v)
 AND c.node_id IS DISTINCT FROM e.node_id) THEN RAISE EXCEPTION 'foreign HP projection' USING ERRCODE='40001'; END IF;
 RETURN coverage;
END $$;

CREATE FUNCTION public.creature_hp_account(coverage jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cid uuid;
BEGIN
 FOR cid IN SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v ORDER BY (v->>'id')::uuid LOOP
   PERFORM public.creature_regen_settle(cid,now());
 END LOOP;
END $$;
ALTER FUNCTION public.creature_hp_discover(uuid[],uuid[]) OWNER TO postgres;
ALTER FUNCTION public.creature_hp_cover(uuid[],uuid[]) OWNER TO postgres;
ALTER FUNCTION public.creature_hp_account(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_hp_discover(uuid[],uuid[]),public.creature_hp_cover(uuid[],uuid[]),public.creature_hp_account(jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $hp_commit$ DECLARE function_oid regprocedure:=to_regprocedure('public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'); s text; d text; BEGIN
 SELECT prosrc,pg_get_functiondef(function_oid) INTO s,d FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(s,'\s+',' ','g')) IS DISTINCT FROM '034653cd83ee9af0b802f027805705fc' THEN RAISE EXCEPTION 'commit source drift'; END IF;
 EXECUTE replace(d,s,replace(s,'           is_alive        = COALESCE((rec->>''is_alive'')::boolean, nc.is_alive) AND nc.is_alive,','           is_alive        = COALESCE((rec->>''is_alive'')::boolean, nc.is_alive) AND nc.is_alive,
           engaged         = COALESCE((rec->>''engaged'')::boolean, nc.engaged),'));
END $hp_commit$;
-- combat_enter: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.combat_enter(uuid,uuid)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: combat_enter'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM '2a7982c1338248adb7b642c3e7c30536' THEN RAISE EXCEPTION 'source drift: combat_enter'; END IF;
 body:=old_body;
 IF position('RETURN jsonb_build_object(''ok'', false, ''kind'', ''mode_refused'', ''reason'', ''maintenance'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat_enter'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'', false, ''kind'', ''mode_refused'', ''reason'', ''maintenance'');','hp_result := jsonb_build_object(''ok'', false, ''kind'', ''mode_refused'', ''reason'', ''maintenance''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'', false, ''kind'', ''invalid_request'', ''reason'', ''request_id_required'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat_enter'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'', false, ''kind'', ''invalid_request'', ''reason'', ''request_id_required'');','hp_result := jsonb_build_object(''ok'', false, ''kind'', ''invalid_request'', ''reason'', ''request_id_required''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'', false, ''kind'', ''not_authorized'', ''reason'', ''character'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat_enter'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'', false, ''kind'', ''not_authorized'', ''reason'', ''character'');','hp_result := jsonb_build_object(''ok'', false, ''kind'', ''not_authorized'', ''reason'', ''character''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'', false, ''kind'', ''no_engagement'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat_enter'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'', false, ''kind'', ''no_engagement'');','hp_result := jsonb_build_object(''ok'', false, ''kind'', ''no_engagement''); EXIT hp_original;');
 IF position('RETURN public.combat_enter_without_engagement_gate(_character_id, _request_id);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat_enter'; END IF;
 body:=replace(body,'RETURN public.combat_enter_without_engagement_gate(_character_id, _request_id);','hp_result := public.combat_enter_without_engagement_gate(_character_id, _request_id); EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY[(SELECT current_node_id FROM public.characters WHERE id=_character_id)],ARRAY[_character_id]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
PERFORM public.creature_hp_account(hp_scope);
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: combat_enter'; END IF;
END $hp_patch$;

-- combat2_hostile_action: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.combat2_hostile_action(uuid,text,text,uuid,uuid)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: combat2_hostile_action'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM 'bb2580c6e57b5daf3fb1a86b4c310155' THEN RAISE EXCEPTION 'source drift: combat2_hostile_action'; END IF;
 body:=old_body;
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_request'',''reason'',''request_id_required'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_request'',''reason'',''request_id_required'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''invalid_request'',''reason'',''request_id_required''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''not_authorized'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''not_authorized'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''not_authorized''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''not_living_at_node'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''not_living_at_node'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''not_living_at_node''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''node_changed'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''node_changed'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''node_changed''); EXIT hp_original;');
 IF position('RETURN v_intent;' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN v_intent;','hp_result := v_intent; EXIT hp_original;');
 IF position('RETURN v_intent||jsonb_build_object(''encounter_id'',v_existing.encounter_id,
      ''fighter_id'',v_existing_fighter.id,''entry_seq'',v_existing_fighter.entry_seq,
      ''entry_kind'',''already_entered'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN v_intent||jsonb_build_object(''encounter_id'',v_existing.encounter_id,
      ''fighter_id'',v_existing_fighter.id,''entry_seq'',v_existing_fighter.entry_seq,
      ''entry_kind'',''already_entered'');','hp_result := v_intent||jsonb_build_object(''encounter_id'',v_existing.encounter_id,
      ''fighter_id'',v_existing_fighter.id,''entry_seq'',v_existing_fighter.entry_seq,
      ''entry_kind'',''already_entered''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''non_hostile_action'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''non_hostile_action'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''non_hostile_action''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_target'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_target'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''invalid_target''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''ability_unavailable'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''ability_unavailable'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''ability_unavailable''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',SQLERRM);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',SQLERRM);','hp_result := jsonb_build_object(''ok'',false,''kind'',SQLERRM); EXIT hp_original;');
 IF position('RETURN v_intent||jsonb_build_object(''encounter_id'',v_entry->>''encounter_id'',
    ''fighter_id'',v_entry->>''fighter_id'',''entry_seq'',(v_entry->>''entry_seq'')::bigint,
    ''entry_kind'',v_entry->>''kind'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_hostile_action'; END IF;
 body:=replace(body,'RETURN v_intent||jsonb_build_object(''encounter_id'',v_entry->>''encounter_id'',
    ''fighter_id'',v_entry->>''fighter_id'',''entry_seq'',(v_entry->>''entry_seq'')::bigint,
    ''entry_kind'',v_entry->>''kind'');','hp_result := v_intent||jsonb_build_object(''encounter_id'',v_entry->>''encounter_id'',
    ''fighter_id'',v_entry->>''fighter_id'',''entry_seq'',(v_entry->>''entry_seq'')::bigint,
    ''entry_kind'',v_entry->>''kind''); EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY[(SELECT current_node_id FROM public.characters WHERE id=_character_id)],ARRAY[_character_id]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
PERFORM public.creature_hp_account(hp_scope);
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: combat2_hostile_action'; END IF;
END $hp_patch$;

-- combat2_depart: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.combat2_depart(uuid,uuid,uuid)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: combat2_depart'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM '33c059fef5ead1f68b5299bd98ed54cb' THEN RAISE EXCEPTION 'source drift: combat2_depart'; END IF;
 body:=old_body;
 IF position('RETURN public.combat2_finish_immediate_departure(_request_id);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_depart'; END IF;
 body:=replace(body,'RETURN public.combat2_finish_immediate_departure(_request_id);','hp_result := public.combat2_finish_immediate_departure(_request_id); EXIT hp_original;');
 IF position('RETURN result;' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_depart'; END IF;
 body:=replace(body,'RETURN result;','hp_result := result; EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY[_destination_node_id,(SELECT current_node_id FROM public.characters WHERE id=_character_id)],ARRAY[_character_id]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
PERFORM public.creature_hp_account(hp_scope);
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: combat2_depart'; END IF;
END $hp_patch$;

-- combat2_party_depart: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.combat2_party_depart(uuid,uuid,uuid)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: combat2_party_depart'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM 'e37e5e1867075ed6a28bea0771eab809' THEN RAISE EXCEPTION 'source drift: combat2_party_depart'; END IF;
 body:=old_body;
 IF position('RETURN public.combat2_finish_immediate_party_departure(_request_id);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_party_depart'; END IF;
 body:=replace(body,'RETURN public.combat2_finish_immediate_party_departure(_request_id);','hp_result := public.combat2_finish_immediate_party_departure(_request_id); EXIT hp_original;');
 IF position('RETURN result;' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_party_depart'; END IF;
 body:=replace(body,'RETURN result;','hp_result := result; EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY[_destination_node_id,(SELECT current_node_id FROM public.characters WHERE id=_leader_character_id)],ARRAY[_leader_character_id]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
PERFORM public.creature_hp_account(hp_scope);
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: combat2_party_depart'; END IF;
END $hp_patch$;

-- combat2_arrive_after_relocation: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.combat2_arrive_after_relocation(uuid,uuid)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: combat2_arrive_after_relocation'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM '44461bebe12101b7326dda099ee2567f' THEN RAISE EXCEPTION 'source drift: combat2_arrive_after_relocation'; END IF;
 body:=old_body;
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''not_authorized'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''not_authorized'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''not_authorized''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''mode_refused'',''reason'',''maintenance'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''mode_refused'',''reason'',''maintenance'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''mode_refused'',''reason'',''maintenance''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_request'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_request'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''invalid_request''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_request'',''reason'',''request_id_conflict'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''invalid_request'',''reason'',''request_id_conflict'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''invalid_request'',''reason'',''request_id_conflict''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',true,''kind'',''already_entered'',''encounter_id'',prior.encounter_id,
      ''event_id'',prior.id,''fighter_id'',prior.payload->>''fighter_id'',''entry_seq'',(prior.payload->>''entry_seq'')::bigint);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',true,''kind'',''already_entered'',''encounter_id'',prior.encounter_id,
      ''event_id'',prior.id,''fighter_id'',prior.payload->>''fighter_id'',''entry_seq'',(prior.payload->>''entry_seq'')::bigint);','hp_result := jsonb_build_object(''ok'',true,''kind'',''already_entered'',''encounter_id'',prior.encounter_id,
      ''event_id'',prior.id,''fighter_id'',prior.payload->>''fighter_id'',''entry_seq'',(prior.payload->>''entry_seq'')::bigint); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''not_living_at_node'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''not_living_at_node'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''not_living_at_node''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''node_changed'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''node_changed'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''node_changed''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''no_engagement'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''no_engagement'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''no_engagement''); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''already_present'',''encounter_id'',e.id,
      ''fighter_id'',f.id,''entry_seq'',f.entry_seq);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''already_present'',''encounter_id'',e.id,
      ''fighter_id'',f.id,''entry_seq'',f.entry_seq);','hp_result := jsonb_build_object(''ok'',false,''kind'',''already_present'',''encounter_id'',e.id,
      ''fighter_id'',f.id,''entry_seq'',f.entry_seq); EXIT hp_original;');
 IF position('RETURN jsonb_build_object(''ok'',true,''kind'',CASE WHEN v_reentry THEN ''reentered'' ELSE ''entered'' END,
    ''encounter_id'',e.id,''node_id'',v_node,''reactivated'',v_reactivated,''fighter_id'',v_fighter,
    ''entry_seq'',v_seq,''event_id'',v_event,''state_version'',v_version);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: combat2_arrive_after_relocation'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',true,''kind'',CASE WHEN v_reentry THEN ''reentered'' ELSE ''entered'' END,
    ''encounter_id'',e.id,''node_id'',v_node,''reactivated'',v_reactivated,''fighter_id'',v_fighter,
    ''entry_seq'',v_seq,''event_id'',v_event,''state_version'',v_version);','hp_result := jsonb_build_object(''ok'',true,''kind'',CASE WHEN v_reentry THEN ''reentered'' ELSE ''entered'' END,
    ''encounter_id'',e.id,''node_id'',v_node,''reactivated'',v_reactivated,''fighter_id'',v_fighter,
    ''entry_seq'',v_seq,''event_id'',v_event,''state_version'',v_version); EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
IF nullif(hp_inherited,'''') IS NULL THEN RAISE EXCEPTION ''arrival requires early HP coverage'' USING ERRCODE=''40001''; END IF;
hp_scope:=public.creature_hp_cover(ARRAY[(SELECT current_node_id FROM public.characters WHERE id=_character_id)],ARRAY[_character_id]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
PERFORM public.creature_hp_account(hp_scope);
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: combat2_arrive_after_relocation'; END IF;
END $hp_patch$;

-- node_tick_claim: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.node_tick_claim(uuid,integer)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: node_tick_claim'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM '86fe2c34cfc05934ce64c20b8e8fabf4' THEN RAISE EXCEPTION 'source drift: node_tick_claim'; END IF;
 body:=old_body;
 IF position('RETURN out;' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: node_tick_claim'; END IF;
 body:=replace(body,'RETURN out;','hp_result := out; EXIT hp_original;');
 IF position('RETURN jsonb_set(jsonb_set(out,''{snapshot,character_stances}'',stances,true),''{snapshot,stance_transitions}'',transitions,true);' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: node_tick_claim'; END IF;
 body:=replace(body,'RETURN jsonb_set(jsonb_set(out,''{snapshot,character_stances}'',stances,true),''{snapshot,stance_transitions}'',transitions,true);','hp_result := jsonb_set(jsonb_set(out,''{snapshot,character_stances}'',stances,true),''{snapshot,stance_transitions}'',transitions,true); EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY[_node_id],ARRAY[]::uuid[]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
PERFORM public.creature_hp_account(hp_scope);
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: node_tick_claim'; END IF;
END $hp_patch$;

-- node_tick_commit: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: node_tick_commit'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM 'ce5ca40961a2d81d83abcd55ad29a580' THEN RAISE EXCEPTION 'source drift: node_tick_commit'; END IF;
 body:=old_body;
 IF position('RETURN jsonb_build_object(''ok'',false,''kind'',''stale_stance'');' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: node_tick_commit'; END IF;
 body:=replace(body,'RETURN jsonb_build_object(''ok'',false,''kind'',''stale_stance'');','hp_result := jsonb_build_object(''ok'',false,''kind'',''stale_stance''); EXIT hp_original;');
 IF position('RETURN result;' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: node_tick_commit'; END IF;
 body:=replace(body,'RETURN result;','hp_result := result; EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY[(SELECT node_id FROM public.node_encounter WHERE id=_encounter_id)] || ARRAY(SELECT (v->>''destination_node_id'')::uuid FROM jsonb_array_elements(coalesce(_proposed->''departures'',''[]'')) v WHERE v->>''outcome''=''moved''),ARRAY[]::uuid[]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
IF (SELECT tick FROM public.node_encounter WHERE id=_encounter_id)<_candidate_tick THEN PERFORM public.creature_hp_account(jsonb_set(hp_scope,''{creatures}'',coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(hp_scope->''creatures'') v WHERE (v->>''node_id'')::uuid IS DISTINCT FROM (SELECT node_id FROM public.node_encounter WHERE id=_encounter_id)),''[]''))); END IF;
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
IF hp_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''HP boundary refusal'' USING ERRCODE=''P1021''; END IF;
IF hp_result->>''kind''=''committed'' THEN PERFORM public.creature_hp_account(hp_scope); END IF;
EXCEPTION WHEN SQLSTATE ''P1021'' THEN NULL;
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN hp_result;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: node_tick_commit'; END IF;
END $hp_patch$;

-- respawn_creatures: exact source guard; existing identity/owner/settings/ACL retained.
DO $hp_patch$
DECLARE function_oid regprocedure:=to_regprocedure('public.respawn_creatures()'); old_body text; body text; definition text; before record; after record;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: respawn_creatures'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;
 SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF md5(regexp_replace(old_body,'\s+',' ','g')) IS DISTINCT FROM '7448b371e1226644818dfd29c78cbb0f' THEN RAISE EXCEPTION 'source drift: respawn_creatures'; END IF;
 body:=old_body;
 IF position('RETURN;' IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: respawn_creatures'; END IF;
 body:=replace(body,'RETURN;','EXIT hp_original;');
 body:='DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting(''app.creature_hp_coverage'',true);
BEGIN
hp_scope:=public.creature_hp_cover(ARRAY(SELECT DISTINCT node_id FROM public.creatures WHERE node_id IS NOT NULL),ARRAY[]::uuid[]);
PERFORM set_config(''app.creature_hp_coverage'',hp_scope::text,true);
BEGIN
PERFORM public.creature_hp_account(hp_scope);
<<hp_original>>
'||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||'
UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL WHERE id IN(SELECT nc.encounter_id FROM public.node_creature nc JOIN public.creatures c ON c.id=nc.creature_id JOIN jsonb_array_elements(hp_scope->''creatures'') v ON (v->>''id'')::uuid=c.id WHERE (v->>''spawn_seq'')::integer IS DISTINCT FROM c.spawn_seq);
PERFORM public.creature_hp_account(hp_scope);
END;
PERFORM set_config(''app.creature_hp_coverage'',coalesce(hp_inherited,''''),true);
RETURN;
END;
';
 EXECUTE replace(definition,old_body,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: respawn_creatures'; END IF;
END $hp_patch$;

-- G4A24 approved wake-healer browser EXECUTE containment; trusted server rights retained.
REVOKE EXECUTE ON FUNCTION public.heal_creatures_on_wake() FROM anon, authenticated, PUBLIC;

