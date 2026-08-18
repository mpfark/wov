CREATE OR REPLACE FUNCTION public.prune_terminal_combat_actions(
  _older_than_seconds integer DEFAULT 3600,
  _limit integer DEFAULT 2000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT a.id
    FROM public.combat_actions a
    JOIN public.encounters e ON e.id = a.encounter_id
    WHERE e.status = 'ended'
      AND e.ended_at < now() - make_interval(secs => GREATEST(_older_than_seconds, 60))
      AND a.status IN ('cancelled','consumed','rejected','expired')
    ORDER BY a.updated_at
    LIMIT GREATEST(_limit, 1)
  ), del AS (
    DELETE FROM public.combat_actions a USING doomed d WHERE a.id = d.id RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_terminal_combat_actions(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_terminal_combat_actions(integer, integer) TO service_role;

SELECT cron.schedule(
  'prune-terminal-combat-actions',
  '37 * * * *',
  $cron$SELECT public.prune_terminal_combat_actions(3600, 2000);$cron$
);

-- Clear the observed orphan now (encounter ended 07:50Z, action cancelled 06:28Z).
SELECT public.prune_terminal_combat_actions(60, 100);