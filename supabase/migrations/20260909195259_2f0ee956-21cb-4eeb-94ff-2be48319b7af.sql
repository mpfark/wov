-- Authoritative Combat2 equipment and durability. Equipment is frozen by the
-- claim; commit locks and compares the same instances before applying one tick.
DO $migration$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO d;
 IF position('''rarity'', it.rarity' in d)=0 OR position('''max_durability'', it.max_durability' in d)>0 THEN
   RAISE EXCEPTION 'unexpected node_tick_claim equipment contract';
 END IF;
 d:=replace(d,'''hands'', it.hands, ''item_level'', it.level, ''rarity'', it.rarity',
   '''hands'', it.hands, ''item_level'', it.level, ''rarity'', it.rarity, ''max_durability'', it.max_durability, ''base_stats'', COALESCE(it.stats,''{}''::jsonb), ''procs'', COALESCE(it.procs,''[]''::jsonb)');
 IF position('''max_durability'', it.max_durability' in d)=0 THEN RAISE EXCEPTION 'node_tick_claim equipment patch failed'; END IF;
 EXECUTE d;
END $migration$;

DO $migration$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
 IF position('-- intents must be pending intents of this encounter, within the cutoff' in d)=0
    OR position('durability_before' in d)>0 THEN RAISE EXCEPTION 'unexpected node_tick_commit equipment contract'; END IF;

 -- The encounter row is already locked by the installed commit. Follow every
 -- inventory/economy action's order: character UUID order, then inventory UUID
 -- order. Repair/equip cannot interleave between validation and mutation.
 d:=replace(d,
   $a$jsonb_array_length(COALESCE(_proposed->'loot','[]'::jsonb))<>0)$a$,
   $b$jsonb_array_length(COALESCE(_proposed->'loot','[]'::jsonb))<>0 OR jsonb_array_length(COALESCE(_proposed->'durability','[]'::jsonb))<>0)$b$);

 d:=replace(d,
   'PERFORM 1 FROM public.characters ch WHERE ch.id IN (SELECT (value->>''character_id'')::uuid FROM jsonb_array_elements(COALESCE(_proposed->''rewards'',''[]''::jsonb))) ORDER BY ch.id FOR UPDATE;',
   'PERFORM 1 FROM public.characters ch WHERE ch.id IN (SELECT (value->>''character_id'')::uuid FROM jsonb_array_elements(COALESCE(_proposed->''rewards'',''[]''::jsonb)) UNION SELECT (value->>''character_id'')::uuid FROM jsonb_array_elements(COALESCE(_proposed->''equipment_fence'',''[]''::jsonb))) ORDER BY ch.id FOR UPDATE; PERFORM 1 FROM public.character_inventory ci WHERE ci.id IN (SELECT (value->>''inventory_id'')::uuid FROM jsonb_array_elements(COALESCE(_proposed->''equipment_fence'',''[]''::jsonb))) ORDER BY ci.id FOR UPDATE;');

 d:=replace(d,'  -- intents must be pending intents of this encounter, within the cutoff', $p$
  -- A stale repair, transfer, delete, equip/unequip, break, or fighter entry
  -- generation rejects the whole transaction before any combat mutation.
  SELECT string_agg(x.inventory_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'inventory_id')::uuid inventory_id,(value->>'character_id')::uuid character_id,
      (value->>'fighter_id')::uuid fighter_id,(value->>'entry_seq')::int entry_seq,
      (value->>'item_id')::uuid item_id,value->>'slot' slot,(value->>'durability')::int durability,
      value->'applied_gems' applied_gems,value->'stat_override' stat_override,(value->>'crafted_level')::int crafted_level,
      (value->>'item_present')::boolean item_present,value->>'item_type' item_type,value->>'weapon_tag' weapon_tag,
      (value->>'hands')::int hands,(value->>'item_level')::int item_level,value->>'rarity' rarity,
      (value->>'max_durability')::int max_durability,value->'base_stats' base_stats,value->'procs' procs
    FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence','[]'::jsonb))) x
  WHERE NOT x.item_present
    OR NOT EXISTS(SELECT 1 FROM public.node_fighter nf WHERE nf.id=x.fighter_id AND nf.encounter_id=_encounter_id
      AND nf.character_id=x.character_id AND nf.entry_seq=x.entry_seq AND nf.present)
    OR NOT EXISTS(SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
      WHERE ci.id=x.inventory_id AND ci.character_id=x.character_id AND ci.item_id=x.item_id
        AND ci.equipped_slot::text=x.slot AND ci.current_durability=x.durability
        AND ci.applied_gems=x.applied_gems AND ci.stat_override IS NOT DISTINCT FROM x.stat_override
        AND ci.crafted_level IS NOT DISTINCT FROM x.crafted_level AND i.item_type::text=x.item_type
        AND i.weapon_tag IS NOT DISTINCT FROM x.weapon_tag AND i.hands IS NOT DISTINCT FROM x.hands
        AND i.level IS NOT DISTINCT FROM x.item_level AND i.rarity::text=x.rarity
        AND i.max_durability=x.max_durability AND COALESCE(i.stats,'{}'::jsonb)=x.base_stats
        AND COALESCE(i.procs,'[]'::jsonb)=x.procs);
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','stale_equipment','ids',v_bad); END IF;

  -- There must be no additional equipped row omitted from the claimed fence.
  IF EXISTS(SELECT 1 FROM public.node_fighter nf JOIN public.character_inventory ci ON ci.character_id=nf.character_id
    WHERE nf.encounter_id=_encounter_id AND nf.present AND ci.equipped_slot IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence','[]'::jsonb)) x
        WHERE (x->>'inventory_id')::uuid=ci.id)) THEN
    RETURN jsonb_build_object('ok',false,'kind','stale_equipment','ids','loadout_changed');
  END IF;

  SELECT string_agg(x.inventory_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'inventory_id')::uuid inventory_id,(value->>'character_id')::uuid character_id,
      (value->>'fighter_id')::uuid fighter_id,(value->>'entry_seq')::int entry_seq,
      (value->>'item_id')::uuid item_id,value->>'slot' slot,value->>'rarity' rarity,
      (value->>'durability_before')::int durability_before,(value->>'durability_after')::int durability_after
    FROM jsonb_array_elements(COALESCE(_proposed->'durability','[]'::jsonb))) x
  WHERE x.durability_before<1 OR x.durability_after<>GREATEST(0,x.durability_before-1)
    OR NOT EXISTS(SELECT 1 FROM public.node_fighter nf WHERE nf.id=x.fighter_id AND nf.encounter_id=_encounter_id
      AND nf.character_id=x.character_id AND nf.entry_seq=x.entry_seq AND nf.present)
    OR NOT EXISTS(SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
      WHERE ci.id=x.inventory_id AND ci.character_id=x.character_id AND ci.item_id=x.item_id
        AND ci.equipped_slot::text=x.slot AND ci.current_durability=x.durability_before
        AND i.rarity::text=x.rarity AND i.max_durability>=x.durability_before);
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','stale_equipment','ids',v_bad); END IF;

  -- intents must be pending intents of this encounter, within the cutoff$p$);

 d:=replace(d,'  -- ---- committed batch: exactly one per (encounter_id, tick). Pending', $p$
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'durability','[]'::jsonb)) LOOP
    IF (rec->>'durability_after')::int=0 AND rec->>'rarity'='unique' THEN
      DELETE FROM public.character_inventory WHERE id=(rec->>'inventory_id')::uuid
        AND character_id=(rec->>'character_id')::uuid AND current_durability=(rec->>'durability_before')::int;
    ELSIF (rec->>'durability_after')::int=0 THEN
      UPDATE public.character_inventory SET current_durability=0,equipped_slot=NULL
      WHERE id=(rec->>'inventory_id')::uuid AND character_id=(rec->>'character_id')::uuid
        AND current_durability=(rec->>'durability_before')::int;
    ELSE
      UPDATE public.character_inventory SET current_durability=(rec->>'durability_after')::int
      WHERE id=(rec->>'inventory_id')::uuid AND character_id=(rec->>'character_id')::uuid
        AND current_durability=(rec->>'durability_before')::int;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'combat2 durability fence changed after validation'; END IF;
  END LOOP;

  -- ---- committed batch: exactly one per (encounter_id, tick). Pending$p$);
 IF position('durability_before' in d)=0 OR position('stale_equipment' in d)=0 THEN RAISE EXCEPTION 'node_tick_commit equipment patch failed'; END IF;
 EXECUTE d;
END $migration$;

REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;