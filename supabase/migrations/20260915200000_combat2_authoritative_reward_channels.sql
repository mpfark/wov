-- ADM-025B authoritative creature reward channels.
ALTER TABLE public.creatures
 ADD COLUMN gold_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN gold_min integer NOT NULL DEFAULT 0 CHECK(gold_min>=0),
 ADD COLUMN gold_max integer NOT NULL DEFAULT 0 CHECK(gold_max>=gold_min),
 ADD COLUMN gold_chance numeric NOT NULL DEFAULT 0 CHECK(gold_chance BETWEEN 0 AND 1),
 ADD COLUMN salvage_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN item_source text NOT NULL DEFAULT 'none' CHECK(item_source IN('none','world_pool','assigned_table','unique_boss_drop')),
 ADD COLUMN unique_item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT,
 ADD COLUMN unique_drop_chance numeric CHECK(unique_drop_chance BETWEEN 0 AND 1);

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e WHERE e->>'type'='gold' GROUP BY c.id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e JOIN public.items i ON i.id=(e->>'item_id')::uuid WHERE i.rarity::text<>'unique')
 OR EXISTS(SELECT 1 FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e JOIN public.items i ON i.id=(e->>'item_id')::uuid WHERE i.rarity::text='unique' AND (c.loot_table_id IS NOT NULL OR c.loot_mode='item_pool'))
 OR EXISTS(SELECT 1 FROM public.creatures c WHERE c.loot_mode='item_pool' AND c.loot_table_id IS NOT NULL)
 THEN RAISE EXCEPTION 'ADM-025B preflight: ambiguous legacy creature rewards'; END IF;
END $$;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e JOIN public.items i ON i.id=(e->>'item_id')::uuid WHERE i.rarity::text='unique' GROUP BY c.id HAVING count(*)>1)
 OR EXISTS(SELECT (e->>'item_id')::uuid FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e JOIN public.items i ON i.id=(e->>'item_id')::uuid WHERE i.rarity::text='unique' GROUP BY (e->>'item_id')::uuid HAVING count(DISTINCT c.id)>1)
 OR EXISTS(SELECT 1 FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e JOIN public.items i ON i.id=(e->>'item_id')::uuid WHERE i.rarity::text='unique' AND (i.origin_type IS DISTINCT FROM 'creature' OR i.origin_id IS DISTINCT FROM c.id))
 THEN RAISE EXCEPTION 'ADM-025B preflight: ambiguous unique creature assignment'; END IF;
END $$;

UPDATE public.creatures c SET
 gold_enabled=EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.loot_table,'[]')) e WHERE e->>'type'='gold'),
 gold_min=COALESCE((SELECT (e->>'min')::int FROM jsonb_array_elements(COALESCE(c.loot_table,'[]')) e WHERE e->>'type'='gold'),0),
 gold_max=COALESCE((SELECT (e->>'max')::int FROM jsonb_array_elements(COALESCE(c.loot_table,'[]')) e WHERE e->>'type'='gold'),0),
 gold_chance=COALESCE((SELECT (e->>'chance')::numeric FROM jsonb_array_elements(COALESCE(c.loot_table,'[]')) e WHERE e->>'type'='gold'),0),
 salvage_enabled=c.loot_mode='salvage_only',
 item_source=CASE WHEN c.loot_mode='item_pool' THEN 'world_pool' WHEN c.loot_table_id IS NOT NULL THEN 'assigned_table' ELSE 'none' END;

WITH candidate AS (
 SELECT c.id creature_id,(e->>'item_id')::uuid item_id,COALESCE((e->>'chance')::numeric,c.drop_chance,0) chance
 FROM public.creatures c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.loot_table,'[]')) e
 JOIN public.items i ON i.id=(e->>'item_id')::uuid
 WHERE i.rarity::text='unique' AND i.origin_type='creature' AND i.origin_id=c.id
) UPDATE public.creatures c SET item_source='unique_boss_drop',loot_table_id=NULL,
 unique_item_id=x.item_id,unique_drop_chance=x.chance FROM candidate x WHERE c.id=x.creature_id;

ALTER TABLE public.creatures ALTER COLUMN drop_chance DROP NOT NULL;
ALTER TABLE public.creatures ALTER COLUMN drop_chance SET DEFAULT NULL;
UPDATE public.creatures SET drop_chance=NULL WHERE item_source IN('none','unique_boss_drop');

ALTER TABLE public.creatures ADD CONSTRAINT creature_reward_shape CHECK(
 (item_source='none' AND loot_table_id IS NULL AND drop_chance IS NULL AND unique_item_id IS NULL AND unique_drop_chance IS NULL) OR
 (item_source='world_pool' AND loot_table_id IS NULL AND unique_item_id IS NULL AND unique_drop_chance IS NULL) OR
 (item_source='assigned_table' AND loot_table_id IS NOT NULL AND drop_chance IS NOT NULL AND unique_item_id IS NULL AND unique_drop_chance IS NULL) OR
 (item_source='unique_boss_drop' AND rarity::text='boss' AND loot_table_id IS NULL AND drop_chance IS NULL AND unique_item_id IS NOT NULL AND unique_drop_chance IS NOT NULL));
CREATE UNIQUE INDEX creature_unique_drop_once ON public.creatures(unique_item_id) WHERE item_source='unique_boss_drop';
CREATE OR REPLACE FUNCTION public.validate_creature_reward_config() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('app.admin_reward_write',true) IS DISTINCT FROM 'true' THEN
  IF TG_OP='UPDATE' OR NEW.gold_enabled OR NEW.gold_min<>0 OR NEW.gold_max<>0 OR NEW.gold_chance<>0 OR NEW.salvage_enabled OR NEW.item_source<>'none' OR NEW.loot_table_id IS NOT NULL OR NEW.drop_chance IS NOT NULL OR NEW.unique_item_id IS NOT NULL OR NEW.unique_drop_chance IS NOT NULL
  THEN RAISE EXCEPTION 'creature reward configuration requires admin_set_creature_rewards'; END IF;
 END IF;
 IF NEW.item_source='unique_boss_drop' AND NOT EXISTS(SELECT 1 FROM public.items i WHERE i.id=NEW.unique_item_id AND i.rarity::text='unique' AND i.origin_type='creature' AND i.origin_id=NEW.id)
 THEN RAISE EXCEPTION 'invalid unique creature item'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creature_reward_validate BEFORE INSERT OR UPDATE OF item_source,unique_item_id,unique_drop_chance,loot_table_id ON public.creatures FOR EACH ROW EXECUTE FUNCTION public.validate_creature_reward_config();
REVOKE ALL ON FUNCTION public.validate_creature_reward_config() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.node_reward_claim ADD COLUMN salvage_awarded integer NOT NULL DEFAULT 0 CHECK(salvage_awarded>=0);
ALTER TABLE public.node_death_loot DROP CONSTRAINT IF EXISTS node_death_loot_mode_check;
ALTER TABLE public.node_death_loot DROP CONSTRAINT IF EXISTS node_death_loot_outcome_check;
ALTER TABLE public.node_death_loot DROP CONSTRAINT IF EXISTS node_death_loot_check;
ALTER TABLE public.node_death_loot ADD CHECK(mode IN('item_pool','legacy_table','inline','salvage_only','unique_boss_drop'));
ALTER TABLE public.node_death_loot ADD CHECK(outcome IN('dropped','no_drop','unique_rejected','no_eligible_item','unique_candidate','unique_created','unique_already_exists'));
ALTER TABLE public.node_death_loot ADD CHECK((outcome IN('dropped','unique_candidate','unique_created','unique_already_exists'))=(item_id IS NOT NULL));

CREATE TABLE public.admin_creature_reward_request(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,creature_id uuid NOT NULL,arguments jsonb NOT NULL,result jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.admin_creature_reward_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_creature_reward_request FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.admin_creature_reward_request TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_creature_rewards(_creature_id uuid,_expected jsonb,_desired jsonb,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.admin_creature_reward_request; current jsonb; answer jsonb; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT public.is_steward_or_overlord() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-creature-reward-request:'||_request_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-creature-reward:'||_creature_id::text,0));
 SELECT * INTO prior FROM public.admin_creature_reward_request WHERE request_id=_request_id;
 IF FOUND THEN IF prior.actor_id<>uid OR prior.creature_id<>_creature_id OR prior.arguments<>jsonb_build_object('expected',_expected,'desired',_desired) THEN RETURN jsonb_build_object('ok',false,'kind','request_conflict'); END IF; RETURN prior.result; END IF;
 IF jsonb_typeof(_expected)<>'object' OR jsonb_typeof(_desired)<>'object'
    OR NOT (_desired ?& ARRAY['gold_enabled','gold_min','gold_max','gold_chance','salvage_enabled','item_source','loot_table_id','drop_chance','unique_item_id','unique_drop_chance'])
 THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
 SELECT jsonb_build_object('gold_enabled',gold_enabled,'gold_min',gold_min,'gold_max',gold_max,'gold_chance',gold_chance,'salvage_enabled',salvage_enabled,'item_source',item_source,'loot_table_id',loot_table_id,'drop_chance',drop_chance,'unique_item_id',unique_item_id,'unique_drop_chance',unique_drop_chance) INTO current FROM public.creatures WHERE id=_creature_id FOR UPDATE;
 IF current IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_found'); END IF;
 INSERT INTO public.admin_creature_reward_request VALUES(_request_id,uid,_creature_id,jsonb_build_object('expected',_expected,'desired',_desired),NULL,now());
 IF current<>_expected THEN answer:=jsonb_build_object('ok',false,'kind','stale','current',current);
 ELSE
  BEGIN
   PERFORM set_config('app.admin_reward_write','true',true);
   UPDATE public.creatures SET gold_enabled=(_desired->>'gold_enabled')::boolean,gold_min=(_desired->>'gold_min')::int,gold_max=(_desired->>'gold_max')::int,gold_chance=(_desired->>'gold_chance')::numeric,salvage_enabled=(_desired->>'salvage_enabled')::boolean,item_source=_desired->>'item_source',loot_table_id=NULLIF(_desired->>'loot_table_id','')::uuid,drop_chance=NULLIF(_desired->>'drop_chance','')::numeric,unique_item_id=NULLIF(_desired->>'unique_item_id','')::uuid,unique_drop_chance=NULLIF(_desired->>'unique_drop_chance','')::numeric WHERE id=_creature_id;
   answer:=jsonb_build_object('ok',true,'kind','updated');
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR numeric_value_out_of_range OR raise_exception THEN
   answer:=jsonb_build_object('ok',false,'kind','invalid_config');
  END;
 END IF;
 UPDATE public.admin_creature_reward_request SET result=answer WHERE request_id=_request_id; RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_creature_rewards(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_creature_rewards(uuid,jsonb,jsonb,uuid) TO authenticated;
REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_creature_reward_request FROM service_role;

DO $m$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO d;
 d:=replace(d,'''loot_mode'', cr.loot_mode,', '''gold_enabled'',cr.gold_enabled,''gold_min'',cr.gold_min,''gold_max'',cr.gold_max,''gold_chance'',cr.gold_chance,''salvage_enabled'',cr.salvage_enabled,''item_source'',cr.item_source,''unique_item_id'',cr.unique_item_id,''unique_drop_chance'',cr.unique_drop_chance,''loot_mode'', cr.loot_mode,');
 d:=replace(d,'FROM public.items i WHERE i.world_drop OR', 'FROM public.items i WHERE i.world_drop OR EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.creatures cr ON cr.id=nc.creature_id WHERE nc.encounter_id=e.id AND cr.unique_item_id=i.id) OR');
 IF position('''gold_enabled''' in d)=0 THEN RAISE EXCEPTION 'claim reward patch failed'; END IF; EXECUTE d;
END $m$;

-- Commit awards salvage exactly once through node_reward_claim and lets the
-- ADM-025A holder trigger allocate the sole instance for unique candidates.
DO $m$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
 d:=replace(d,'gold_awarded, is_killer)', 'gold_awarded, salvage_awarded, is_killer)');
 d:=replace(d,'(value->>''gold_awarded'')::int gold_awarded', '(value->>''gold_awarded'')::int gold_awarded,(value->>''salvage_awarded'')::int salvage_awarded');
 d:=replace(d,'WHERE x.xp_awarded<0 OR x.gold_awarded<0', 'WHERE x.xp_awarded<0 OR x.gold_awarded<0 OR x.salvage_awarded<0 OR x.salvage_awarded>4');
 d:=replace(d,'COALESCE((rec->>''gold_awarded'')::int, 0),', 'COALESCE((rec->>''gold_awarded'')::int, 0), COALESCE((rec->>''salvage_awarded'')::int, 0),');
 d:=replace(d,'gold = gold + COALESCE((rec->>''gold_awarded'')::int, 0)', 'gold = gold + COALESCE((rec->>''gold_awarded'')::int, 0)');
 d:=replace(d,'       WHERE id = (rec->>''character_id'')::uuid;', $p$
       WHERE id = (rec->>'character_id')::uuid;
      IF COALESCE((rec->>'salvage_awarded')::int,0)>0 THEN
        PERFORM public.add_material((rec->>'character_id')::uuid,'salvage',COALESCE((rec->>'salvage_awarded')::int,0));
      END IF;$p$);
 d:=replace(d,'''outcome''=''dropped'') IS DISTINCT FROM', '''outcome'' IN (''dropped'',''unique_candidate'')) IS DISTINCT FROM');
 d:=replace(d,'    IF FOUND AND rec->>''outcome''=''dropped'' THEN', $p$
    IF FOUND AND rec->>'outcome'='unique_candidate' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('unique-item:'||(rec->>'item_id'),0));
      IF EXISTS(SELECT 1 FROM public.unique_item_instance WHERE item_id=(rec->>'item_id')::uuid) THEN
        UPDATE public.node_death_loot SET outcome='unique_already_exists'
        WHERE encounter_id=_encounter_id AND node_creature_id=(rec->>'node_creature_id')::uuid AND spawn_seq=(rec->>'spawn_seq')::int AND loot_key=rec->>'loot_key';
      ELSE
        WITH inserted AS (INSERT INTO public.node_ground_loot(node_id,item_id,creature_name)
          VALUES(e.node_id,(rec->>'item_id')::uuid,rec->>'creature_name') RETURNING id)
        UPDATE public.node_death_loot SET ground_loot_id=(SELECT id FROM inserted),outcome='unique_created'
        WHERE encounter_id=_encounter_id AND node_creature_id=(rec->>'node_creature_id')::uuid AND spawn_seq=(rec->>'spawn_seq')::int AND loot_key=rec->>'loot_key';
      END IF;
    ELSIF FOUND AND rec->>'outcome'='dropped' THEN$p$);
 IF position('unique_already_exists' in d)=0 OR position('salvage_awarded' in d)=0 THEN RAISE EXCEPTION 'commit reward patch failed'; END IF; EXECUTE d;
END $m$;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;
