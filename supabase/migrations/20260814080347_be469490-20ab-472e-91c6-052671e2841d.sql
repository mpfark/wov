DO $mig$
DECLARE
  d text;
  old_from text;
BEGIN
  d := pg_get_functiondef('public.encounter_snapshot_v2(uuid,uuid,bigint)'::regprocedure);

  old_from := $r1$      FROM public.encounter_participants ep
      JOIN public.characters c ON c.id = ep.character_id
      WHERE ep.encounter_id = _encounter_id), '[]'::jsonb),$r1$;

  IF position(old_from in d) = 0 THEN RAISE EXCEPTION 'participants anchor not found'; END IF;

  d := replace(d, old_from, $r2$      FROM public.encounter_participants ep
      JOIN public.characters c ON c.id = ep.character_id
      -- Presence, not participation: a character who walked off the node is not
      -- a legal target for anything resolved here (telegraphed casts included),
      -- even while their delivery/RLS grace still lets them watch the fight.
      WHERE ep.encounter_id = _encounter_id
        AND c.current_node_id = v_enc.node_id), '[]'::jsonb),$r2$);

  EXECUTE d;
END
$mig$;