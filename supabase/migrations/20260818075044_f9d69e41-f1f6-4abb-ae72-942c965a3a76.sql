-- Missing lifecycle owner: an encounter whose participants all departed before
-- any tick resolved was never closed, because `encounter_end` is only reached
-- from a committed tick and `encounter_reconcile` is only called per visited
-- node. Add a bounded sweeper that closes such shells through the approved
-- lifecycle function only.
CREATE OR REPLACE FUNCTION public.sweep_stranded_encounters(
  _idle_seconds integer DEFAULT 300,
  _limit integer DEFAULT 200
)
RETURNS TABLE(encounter_id uuid, closed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT e.id
    FROM public.encounters e
    WHERE e.status IN ('active','idle')
      AND e.last_activity_at < now() - make_interval(secs => GREATEST(_idle_seconds, 60))
      AND NOT EXISTS (SELECT 1 FROM public.encounter_participants p WHERE p.encounter_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM public.encounter_engagements g WHERE g.encounter_id = e.id)
      AND NOT public.encounter_has_pending_work(e.id)
    ORDER BY e.last_activity_at
    LIMIT GREATEST(_limit, 1)
  LOOP
    -- `encounter_end` only closes `active`; promote an idle shell first so the
    -- single authoritative closer stays the only writer of `ended`.
    UPDATE public.encounters SET status = 'active' WHERE id = r.id AND status = 'idle';
    PERFORM public.encounter_end(r.id);
    RETURN QUERY
      SELECT r.id, (SELECT e2.status = 'ended' FROM public.encounters e2 WHERE e2.id = r.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_stranded_encounters(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_stranded_encounters(integer, integer) TO service_role;

SELECT cron.schedule(
  'sweep-stranded-encounters',
  '*/5 * * * *',
  $cron$SELECT public.sweep_stranded_encounters(300, 200);$cron$
);

-- Repair the observed shell now (created 06:28:41Z, zero participants,
-- zero engagements, zero pending work).
SELECT public.sweep_stranded_encounters(60, 50);