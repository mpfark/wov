DO $mig$
DECLARE
  d text;
BEGIN
  ---------------------------------------------------------------------------
  -- encounter_snapshot_v2 -> contract version 3
  ---------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'encounter_snapshot_v2';
  IF d IS NULL THEN RAISE EXCEPTION 'encounter_snapshot_v2 not found'; END IF;

  IF position($q$'snapshotVersion', 2,$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: snapshotVersion';
  END IF;
  d := replace(d, $q$'snapshotVersion', 2,$q$, $q$'snapshotVersion', 3,$q$);

  IF position($q$'intervalMs', ae.tick_rate_ms, 'lastTickAtMs', ae.next_tick_at,$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: effect tick time';
  END IF;
  d := replace(d,
    $q$'intervalMs', ae.tick_rate_ms, 'lastTickAtMs', ae.next_tick_at,$q$,
    $q$'intervalMs', ae.tick_rate_ms, 'nextTickAtMs', ae.next_tick_at,$q$);

  IF position($q$'mp', c.mp, 'maxMp', c.max_mp, 'ac', c.ac,$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: participant projection';
  END IF;
  d := replace(d,
    $q$'mp', c.mp, 'maxMp', c.max_mp, 'ac', c.ac,$q$,
    $q$'mp', c.mp, 'maxMp', c.max_mp, 'ac', c.ac,
        'xp', COALESCE(c.xp, 0),
        'unspentStatPoints', COALESCE(c.unspent_stat_points, 0),
        'respecPoints', COALESCE(c.respec_points, 0),
        'bhp', COALESCE(c.bhp, 0),$q$);

  EXECUTE d;

  ---------------------------------------------------------------------------
  -- commit_encounter_tick_v2 -> contract version 3 + progression block
  ---------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'commit_encounter_tick_v2';
  IF d IS NULL THEN RAISE EXCEPTION 'commit_encounter_tick_v2 not found'; END IF;

  IF position($q$IF _snapshot_version <> 2$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: version gate';
  END IF;
  d := replace(d,
    $q$IF _snapshot_version <> 2
     OR COALESCE((_proposed->>'proposedTickVersion')::integer, 0) <> 2 THEN$q$,
    $q$IF _snapshot_version <> 3
     OR COALESCE((_proposed->>'proposedTickVersion')::integer, 0) <> 3 THEN$q$);

  IF position($q$(e->>'lastTickAtMs')::bigint,$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: effect upsert tick time';
  END IF;
  d := replace(d, $q$(e->>'lastTickAtMs')::bigint,$q$, $q$(e->>'nextTickAtMs')::bigint,$q$);

  IF position($q$"levelAfter" integer)$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: reward bounds';
  END IF;
  d := replace(d,
    $q$         AS r("characterId" uuid, "deathId" uuid, xp integer, gold integer, renown integer,
              "levelAfter" integer)
    WHERE r.xp < 0 OR r.gold < 0 OR r.renown < 0
       OR COALESCE(r."levelAfter", 1) < 1 OR COALESCE(r."levelAfter", 1) > 42
       OR r."deathId" IS NULL$q$,
    $q$         AS r("characterId" uuid, "deathId" uuid, xp integer, gold integer, renown integer)
    WHERE r.xp < 0 OR r.gold < 0 OR r.renown < 0
       OR r."deathId" IS NULL$q$);

  IF position($q$    SELECT 'durability:' || d."inventoryId"$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: durability validation';
  END IF;
  d := replace(d,
    $q$    SELECT 'durability:' || d."inventoryId"$q$,
    $q$    SELECT 'unknown_progression_character:' || g."characterId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'progression', '[]'::jsonb))
         AS g("characterId" uuid)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_participants ep
                      WHERE ep.encounter_id = _encounter_id AND ep.character_id = g."characterId")
    UNION ALL
    SELECT 'progression_bounds:' || g."characterId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'progression', '[]'::jsonb))
         AS g("characterId" uuid, "levelBefore" integer, "levelAfter" integer,
              "xpAfter" integer, "maxHpAfter" integer, "maxCpAfter" integer,
              "maxMpAfter" integer, "hpAfter" integer, "cpAfter" integer,
              "mpAfter" integer, "unspentStatPointsDelta" integer,
              "respecPointsDelta" integer)
    JOIN public.characters c2 ON c2.id = g."characterId"
    WHERE g."levelBefore" IS DISTINCT FROM c2.level
       OR g."levelAfter" < g."levelBefore" OR g."levelAfter" > g."levelBefore" + 1
       OR g."levelAfter" < 1 OR g."levelAfter" > 42
       OR (g."levelAfter" = g."levelBefore" AND NOT (g."levelAfter" = 42 AND g."xpAfter" = 0))
       OR g."xpAfter" < 0
       OR (g."levelAfter" = 42 AND g."xpAfter" <> 0)
       OR g."maxHpAfter" < 1 OR g."maxCpAfter" < 0 OR g."maxMpAfter" < 0
       OR g."hpAfter" < 0 OR g."hpAfter" > g."maxHpAfter"
       OR g."cpAfter" < 0 OR g."cpAfter" > g."maxCpAfter"
       OR g."mpAfter" < 0 OR g."mpAfter" > g."maxMpAfter"
       OR g."unspentStatPointsDelta" < 0 OR g."unspentStatPointsDelta" > 1
       OR g."respecPointsDelta" < 0 OR g."respecPointsDelta" > 1
    UNION ALL
    SELECT 'progression_attribute_bounds:' || (p2->>'characterId')
    FROM jsonb_array_elements(COALESCE(_proposed->'progression', '[]'::jsonb)) AS p2,
         jsonb_each_text(COALESCE(p2->'attributeDeltas', '{}'::jsonb)) AS d2(k, v)
    WHERE d2.k NOT IN ('str','dex','con','int','wis','cha')
       OR (d2.v)::numeric < 0 OR (d2.v)::numeric > 3
    UNION ALL
    SELECT 'durability:' || d."inventoryId"$q$);

  IF position($q$level = COALESCE((v_item->>'levelAfter')::integer, level),$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: reward apply';
  END IF;
  d := replace(d,
    $q$          level = COALESCE((v_item->>'levelAfter')::integer, level),
          max_hp = COALESCE((v_item->>'maxHpAfter')::integer, max_hp),
          max_cp = COALESCE((v_item->>'maxCpAfter')::integer, max_cp),
          max_mp = COALESCE((v_item->>'maxMpAfter')::integer, max_mp),
          unspent_stat_points = COALESCE((v_item->>'unspentStatPoints')::integer, unspent_stat_points),
          bhp$q$,
    $q$          bhp$q$);

  IF position($q$  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'materials', '[]'::jsonb)) LOOP$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'anchor missing: materials loop';
  END IF;
  d := replace(d,
    $q$  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'materials', '[]'::jsonb)) LOOP$q$,
    $q$  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'progression', '[]'::jsonb)) LOOP
    UPDATE public.characters
    SET level = (v_item->>'levelAfter')::integer,
        xp = (v_item->>'xpAfter')::integer,
        max_hp = (v_item->>'maxHpAfter')::integer,
        max_cp = (v_item->>'maxCpAfter')::integer,
        max_mp = (v_item->>'maxMpAfter')::integer,
        hp = (v_item->>'hpAfter')::integer,
        cp = (v_item->>'cpAfter')::integer,
        mp = (v_item->>'mpAfter')::integer,
        str = str + COALESCE((v_item#>>'{attributeDeltas,str}')::integer, 0),
        dex = dex + COALESCE((v_item#>>'{attributeDeltas,dex}')::integer, 0),
        con = con + COALESCE((v_item#>>'{attributeDeltas,con}')::integer, 0),
        int = int + COALESCE((v_item#>>'{attributeDeltas,int}')::integer, 0),
        wis = wis + COALESCE((v_item#>>'{attributeDeltas,wis}')::integer, 0),
        cha = cha + COALESCE((v_item#>>'{attributeDeltas,cha}')::integer, 0),
        unspent_stat_points = COALESCE(unspent_stat_points, 0)
                              + COALESCE((v_item->>'unspentStatPointsDelta')::integer, 0),
        respec_points = COALESCE(respec_points, 0)
                        + COALESCE((v_item->>'respecPointsDelta')::integer, 0),
        updated_at = now()
    WHERE id = (v_item->>'characterId')::uuid
      AND level = (v_item->>'levelBefore')::integer;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'materials', '[]'::jsonb)) LOOP$q$);

  EXECUTE d;
END
$mig$;