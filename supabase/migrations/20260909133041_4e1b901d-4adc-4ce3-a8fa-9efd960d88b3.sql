-- Combat2 ordinary-world rewards. The resolver decides from this frozen claim;
-- node_tick_commit persists the accepted death, economy and ground loot atomically.
ALTER TABLE public.node_reward_claim
  ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS node_creature_id uuid REFERENCES public.node_creature(id) ON DELETE CASCADE;

CREATE TABLE public.node_death_loot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  node_creature_id uuid NOT NULL REFERENCES public.node_creature(id) ON DELETE CASCADE,
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  spawn_seq integer NOT NULL,
  loot_key text NOT NULL,
  item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('item_pool','legacy_table','inline','salvage_only')),
  outcome text NOT NULL CHECK (outcome IN ('dropped','no_drop','unique_rejected','no_eligible_item')),
  ground_loot_id uuid REFERENCES public.node_ground_loot(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (encounter_id,node_creature_id,spawn_seq,loot_key),
  CHECK ((outcome='dropped')=(item_id IS NOT NULL))
);
ALTER TABLE public.node_death_loot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.node_death_loot FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.node_death_loot TO service_role;

-- Extend, do not replace, the installed claim. Every reward input is captured
-- before resolution; the worker performs no mutable reward/loot reads.
DO $migration$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO d;
 IF position('''boss_death_cry'', cr.boss_death_cry' in d)=0 OR position('''reward_config''' in d)>0 THEN
   RAISE EXCEPTION 'unexpected node_tick_claim reward contract';
 END IF;
 d:=replace(d,'''boss_death_cry'', cr.boss_death_cry',
   '''boss_death_cry'', cr.boss_death_cry, ''loot_mode'', cr.loot_mode, ''loot_table_id'', cr.loot_table_id, ''drop_chance'', cr.drop_chance, ''loot_table'', COALESCE(cr.loot_table,''[]''::jsonb)');
 d:=replace(d,'''boss_abilities'', ''[]''::jsonb,', $p$
    'reward_config', (SELECT jsonb_build_object(
      'xp_boost_multiplier',COALESCE((SELECT multiplier FROM public.xp_boost WHERE expires_at>now() AND multiplier>0 ORDER BY expires_at DESC LIMIT 1),1),
      'drop_chance_regular',COALESCE(lpc.drop_chance_regular,0.5),'drop_chance_rare',COALESCE(lpc.drop_chance_rare,0.5),
      'drop_chance_boss',COALESCE(lpc.drop_chance_boss,0.5),'equip_level_min_offset',COALESCE(lpc.equip_level_min_offset,-3),
      'equip_level_max_offset',COALESCE(lpc.equip_level_max_offset,0),'common_pct',COALESCE(lpc.common_pct,80),
      'uncommon_pct',COALESCE(lpc.uncommon_pct,20),'consumable_drop_chance',COALESCE(lpc.consumable_drop_chance,0.15),
      'consumable_level_min_offset',COALESCE(lpc.consumable_level_min_offset,-5),'consumable_level_max_offset',COALESCE(lpc.consumable_level_max_offset,0))
      FROM public.loot_pool_config lpc WHERE lpc.id=1),
    'loot_items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'level',i.level,'rarity',i.rarity,
      'item_type',i.item_type,'world_drop',i.world_drop,'is_soulbound',i.is_soulbound,'drop_weight',i.drop_weight) ORDER BY i.id)
      FROM public.items i WHERE i.world_drop OR EXISTS(SELECT 1 FROM public.loot_table_entries lte JOIN public.node_creature nc ON nc.encounter_id=e.id JOIN public.creatures cr ON cr.id=nc.creature_id AND cr.loot_table_id=lte.loot_table_id WHERE lte.item_id=i.id)
      OR EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.creatures cr ON cr.id=nc.creature_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cr.loot_table,'[]'::jsonb)) le WHERE nc.encounter_id=e.id AND le->>'item_id'=i.id::text)),'[]'::jsonb),
    'loot_table_entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('loot_table_id',lte.loot_table_id,'item_id',lte.item_id,'weight',lte.weight) ORDER BY lte.loot_table_id,lte.id) FROM public.loot_table_entries lte WHERE EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.creatures cr ON cr.id=nc.creature_id WHERE nc.encounter_id=e.id AND cr.loot_table_id=lte.loot_table_id)),'[]'::jsonb),
    'boss_abilities', '[]'::jsonb,$p$);
 IF position('''reward_config''' in d)=0 THEN RAISE EXCEPTION 'node_tick_claim reward patch failed'; END IF;
 EXECUTE d;
END $migration$;

-- Lock order: encounter (already locked by commit), then reward characters in
-- UUID order. Participation/node-creature rows are validation reads; loot ledger
-- and ground rows are inserts only. No item, inventory, party or gold lock is
-- acquired after a character lock, avoiding reversed pairs with economy RPCs.
DO $migration$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
 IF position('-- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------' in d)=0
    OR position('-- rewards: exactly once per (creature, spawn_seq, character)' in d)=0
    OR position('node_death_loot' in d)>0 THEN RAISE EXCEPTION 'unexpected node_tick_commit reward contract'; END IF;
 d:=replace(d,'jsonb_array_length(COALESCE(_proposed->''rewards'',''[]''::jsonb))<>0',
   '(jsonb_array_length(COALESCE(_proposed->''rewards'',''[]''::jsonb))<>0 OR jsonb_array_length(COALESCE(_proposed->''loot'',''[]''::jsonb))<>0)');
 d:=replace(d,'  -- intents must be pending intents of this encounter, within the cutoff', $p$
  SELECT string_agg(DISTINCT x.node_creature_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'node_creature_id')::uuid node_creature_id,(value->>'creature_id')::uuid creature_id,
      (value->>'spawn_seq')::int spawn_seq,(value->>'character_id')::uuid character_id,
      (value->>'xp_awarded')::int xp_awarded,(value->>'gold_awarded')::int gold_awarded
    FROM jsonb_array_elements(COALESCE(_proposed->'rewards','[]'::jsonb))) x
  WHERE x.xp_awarded<0 OR x.gold_awarded<0
    OR NOT EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.id=x.node_creature_id AND nc.encounter_id=_encounter_id AND nc.creature_id=x.creature_id AND nc.spawn_seq=x.spawn_seq)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'creatures','[]'::jsonb)) c WHERE (c->>'id')::uuid=x.node_creature_id AND (c->>'creature_id')::uuid=x.creature_id AND (c->>'spawn_seq')::int=x.spawn_seq AND (c->>'is_alive')::boolean=false);
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','foreign_reference','relation','reward_death','ids',v_bad); END IF;

  -- Loot is fenced to the exact proposed death identity. Items may be referenced
  -- only for a dropped result; their generation properties were frozen in claim.
  SELECT string_agg(DISTINCT x.node_creature_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'node_creature_id')::uuid node_creature_id,(value->>'creature_id')::uuid creature_id,
      (value->>'spawn_seq')::int spawn_seq,NULLIF(value->>'item_id','')::uuid item_id,value->>'outcome' outcome
    FROM jsonb_array_elements(COALESCE(_proposed->'loot','[]'::jsonb))) x
  WHERE NOT EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.id=x.node_creature_id AND nc.encounter_id=_encounter_id AND nc.creature_id=x.creature_id AND nc.spawn_seq=x.spawn_seq)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'creatures','[]'::jsonb)) c WHERE (c->>'id')::uuid=x.node_creature_id AND (c->>'creature_id')::uuid=x.creature_id AND (c->>'spawn_seq')::int=x.spawn_seq AND (c->>'is_alive')::boolean=false)
    OR ((x.outcome='dropped') IS DISTINCT FROM (x.item_id IS NOT NULL))
    OR (x.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.items i WHERE i.id=x.item_id));
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','foreign_reference','relation','loot','ids',v_bad); END IF;

  -- intents must be pending intents of this encounter, within the cutoff$p$);
 d:=replace(d,'  -- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------', $p$
  -- Deterministic encounter -> character lock order for all economic mutations.
  PERFORM 1 FROM public.characters ch WHERE ch.id IN (SELECT (value->>'character_id')::uuid FROM jsonb_array_elements(COALESCE(_proposed->'rewards','[]'::jsonb))) ORDER BY ch.id FOR UPDATE;

  -- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------$p$);
 d:=replace(d,'(creature_id, spawn_seq, character_id, xp_awarded, gold_awarded, is_killer)',
   '(encounter_id, node_creature_id, creature_id, spawn_seq, character_id, xp_awarded, gold_awarded, is_killer)');
 d:=replace(d,'VALUES ((rec->>''creature_id'')::uuid, (rec->>''spawn_seq'')::int,',
   'VALUES (_encounter_id, (rec->>''node_creature_id'')::uuid, (rec->>''creature_id'')::uuid, (rec->>''spawn_seq'')::int,');
 d:=replace(d,'  -- ---- committed batch: exactly one per (encounter_id, tick). Pending', $p$
  -- One durable outcome per death/category; dropped templates become ordinary
  -- node ground loot in the same transaction. Capacity is enforced on pickup,
  -- so a full bag cannot destroy an earned drop.
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'loot','[]'::jsonb)) LOOP
    INSERT INTO public.node_death_loot(encounter_id,node_creature_id,creature_id,spawn_seq,loot_key,item_id,mode,outcome)
    VALUES(_encounter_id,(rec->>'node_creature_id')::uuid,(rec->>'creature_id')::uuid,(rec->>'spawn_seq')::int,rec->>'loot_key',NULLIF(rec->>'item_id','')::uuid,rec->>'mode',rec->>'outcome')
    ON CONFLICT(encounter_id,node_creature_id,spawn_seq,loot_key) DO NOTHING;
    IF FOUND AND rec->>'outcome'='dropped' THEN
      WITH inserted AS (INSERT INTO public.node_ground_loot(node_id,item_id,creature_name)
        VALUES(e.node_id,(rec->>'item_id')::uuid,rec->>'creature_name') RETURNING id)
      UPDATE public.node_death_loot SET ground_loot_id=(SELECT id FROM inserted)
      WHERE encounter_id=_encounter_id AND node_creature_id=(rec->>'node_creature_id')::uuid
        AND spawn_seq=(rec->>'spawn_seq')::int AND loot_key=rec->>'loot_key';
    END IF;
  END LOOP;

  -- ---- committed batch: exactly one per (encounter_id, tick). Pending$p$);
 IF position('node_death_loot' in d)=0 OR position('node_creature_id, creature_id' in d)=0 THEN RAISE EXCEPTION 'node_tick_commit reward patch failed'; END IF;
 EXECUTE d;
END $migration$;

REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;