DO $mig$
DECLARE
  d text;
  old_where text;
  old_join text;
BEGIN
  d := pg_get_functiondef('public.encounter_snapshot_v2(uuid,uuid,bigint)'::regprocedure);

  old_where := $r1$      WHERE ep.encounter_id = _encounter_id
        AND c.current_node_id = v_enc.node_id), '[]'::jsonb),$r1$;
  IF position(old_where in d) = 0 THEN RAISE EXCEPTION 'participants where anchor not found'; END IF;

  -- Restore complete participation: off-node participants stay in the snapshot
  -- so their durable effects, kill attribution and reward rights survive, and
  -- physical presence travels as an explicit flag instead.
  d := replace(d, old_where, $r2$      WHERE ep.encounter_id = _encounter_id), '[]'::jsonb),$r2$);

  old_join := $r3$        'joinedAtMs', (extract(epoch from ep.joined_at) * 1000)::bigint,$r3$;
  IF position(old_join in d) = 0 THEN RAISE EXCEPTION 'joinedAtMs anchor not found'; END IF;

  d := replace(d, old_join, $r4$        'joinedAtMs', (extract(epoch from ep.joined_at) * 1000)::bigint,
        -- Target eligibility: only characters standing on the encounter node
        -- can be hit, healed, or caught by a telegraphed cast. Never derived
        -- from delivery/RLS grace.
        'presentAtNode', (c.current_node_id = v_enc.node_id),$r4$);

  EXECUTE d;
END
$mig$;