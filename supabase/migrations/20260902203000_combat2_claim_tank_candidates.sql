-- Capture the authoritative arrival-group tank fallback order in the same
-- fenced snapshot as the tick's fighters and actions.
DO $$
DECLARE
  definition text;
  needle text := '''boss_abilities'', ''[]''::jsonb,';
  projection text := $projection$
    'tank_candidates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fighter_id', representative.fighter_id,
        'character_id', representative.character_id,
        'entry_seq', representative.entry_seq
      ) ORDER BY representative.arrival_seq DESC, representative.group_id DESC,
                 representative.member_priority, representative.entry_seq DESC,
                 representative.fighter_id DESC)
      FROM (
        SELECT
          g.id AS group_id,
          g.arrival_seq,
          nf.id AS fighter_id,
          nf.character_id,
          nf.entry_seq,
          CASE
            WHEN g.party_id IS NULL THEN 0
            WHEN nf.character_id = p.tank_id THEN 0
            WHEN nf.character_id = p.leader_id THEN 1
            ELSE 2
          END AS member_priority
        FROM public.node_arrival_group g
        JOIN public.node_fighter nf
          ON nf.arrival_group_id = g.id AND nf.present
        JOIN public.characters ch
          ON ch.id = nf.character_id AND ch.hp > 0
        LEFT JOIN public.parties p ON p.id = g.party_id
        LEFT JOIN public.party_members pm
          ON pm.party_id = g.party_id
         AND pm.character_id = nf.character_id
         AND pm.status = 'accepted'
        WHERE g.encounter_id = e.id
          AND g.active
          AND (g.party_id IS NULL OR pm.character_id IS NOT NULL)
      ) representative
    ), '[]'::jsonb),
    'boss_abilities', '[]'::jsonb,$projection$;
BEGIN
  SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure)
    INTO definition;
  IF position(needle IN definition) = 0 OR position('''tank_candidates''' IN definition) > 0 THEN
    RAISE EXCEPTION 'unexpected node_tick_claim contract';
  END IF;
  EXECUTE replace(definition, needle, projection);
END
$$;

REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid, integer) TO service_role;
