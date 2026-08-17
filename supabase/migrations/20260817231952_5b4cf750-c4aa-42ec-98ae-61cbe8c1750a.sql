-- Attribution roster, tightened.
--
-- Membership grants REWARD ATTRIBUTION ONLY. Presence (characters.current_node_id
-- = encounters.node_id) still decides targeting/acting, so a rostered absentee is
-- never attacked, healed, or allowed to act, and no participant/engagement row is
-- recreated by this helper.
--
-- Admissible attribution sources are participants, plus the character owner of an
-- effect that is ALL of:
--   * not a stance (stances are CP reservations, not encounter contributions),
--   * finite and unexpired at call time,
--   * not fully consumed (pool/charge exhausted),
--   * bound to this encounter's node,
--   * targeting a LIVING creature of this encounter (current spawn generation) or
--     a living participant character of this encounter.
CREATE OR REPLACE FUNCTION public.encounter_attribution_roster(_encounter_id uuid)
RETURNS TABLE(character_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_jwt_role text;
  v_now_ms bigint := (extract(epoch FROM now()) * 1000)::bigint;
BEGIN
  -- Internal-only guard. Direct SQL / cron / service-role callers carry either no
  -- JWT role claim or 'service_role'; an end-user session carries 'authenticated'
  -- or 'anon' and is refused outright (EXECUTE is also revoked from those roles).
  v_jwt_role := coalesce(
    current_setting('request.jwt.claim.role', true),
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'
  );
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'encounter_attribution_roster is internal-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ep.character_id
  FROM public.encounter_participants ep
  WHERE ep.encounter_id = _encounter_id
  UNION
  SELECT ae.source_id
  FROM public.active_effects ae
  JOIN public.encounters e ON e.id = _encounter_id
  JOIN public.characters src ON src.id = ae.source_id
  WHERE ae.source_id IS NOT NULL
    AND coalesce(ae.lifetime, 'timed') <> 'stance'
    AND ae.expires_at IS NOT NULL
    AND ae.expires_at > v_now_ms
    AND (ae.remaining IS NULL OR ae.remaining > 0)
    AND (ae.node_id IS NULL OR ae.node_id = e.node_id)
    AND (
      EXISTS (
        SELECT 1
        FROM public.encounter_creatures ec
        JOIN public.creatures cr ON cr.id = ec.creature_id
        WHERE ec.encounter_id = _encounter_id
          AND ec.creature_id = ae.target_id
          AND cr.is_alive
          AND cr.hp > 0
          -- current generation only: an effect that predates the creature's last
          -- recorded death belongs to a retired spawn and cannot pay out.
          AND (cr.died_at IS NULL
               OR ae.started_at IS NULL
               OR ae.started_at >= (extract(epoch FROM cr.died_at) * 1000)::bigint)
      )
      OR EXISTS (
        SELECT 1
        FROM public.encounter_participants ep2
        JOIN public.characters c2 ON c2.id = ep2.character_id
        WHERE ep2.encounter_id = _encounter_id
          AND ep2.character_id = ae.target_id
          AND c2.hp > 0
      )
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.encounter_attribution_roster(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.encounter_attribution_roster(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.encounter_attribution_roster(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_attribution_roster(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_active_effects_source_target
  ON public.active_effects (source_id, target_id);