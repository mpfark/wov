-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 1: encounter lifecycle correction.
--
-- Before this migration an encounter ended as soon as no living engaged
-- creature remained (commit_encounter_tick_v2 -> encounter_end), regardless of
-- unfinished finite effects. `claim_encounter_tick` refuses every tick for a
-- non-active encounter, and `encounter_for_node` creates a NEW encounter when
-- the previous one ended — so pending `active_effects` rows became permanently
-- unownable and a fled source's DoT kill could never be attributed.
--
-- The correction is authoritative and central: `encounter_end` refuses while
-- pending work remains. Every caller (including the commit path) therefore
-- keeps the encounter `active` until effects and casts are genuinely finished.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pending effects-only work at an encounter's node.
--
-- Counted:
--   * due periodic effect            (next_tick_at <= now)
--   * future finite effect           (next_tick_at > now, expires_at > now)
--   * expired effect not yet removed (expires_at <= now) — expiry is
--     authoritative and must be proposed by the resolver and committed by C2,
--     never deleted by SQL.
--   * unresolved cast row
--
-- Deliberately NOT counted, so an abandoned encounter cannot be held open
-- forever:
--   * `lifetime = 'stance'` rows (persistent character stances)
--   * effects whose target creature no longer exists or is already dead
--     (stale generation / prior spawn_seq)
--   * effects whose target character no longer exists
CREATE OR REPLACE FUNCTION public.encounter_has_pending_work(_encounter_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_node uuid;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  SELECT node_id INTO v_node FROM public.encounters WHERE id = _encounter_id;
  IF v_node IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.active_effects ae
    WHERE ae.node_id = v_node
      AND COALESCE(ae.lifetime, 'timed') <> 'stance'
      AND (
        EXISTS (
          SELECT 1 FROM public.creatures c
          WHERE c.id = ae.target_id AND c.is_alive
        )
        OR EXISTS (
          SELECT 1 FROM public.characters ch WHERE ch.id = ae.target_id
        )
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.encounter_cast_events ce
    WHERE ce.encounter_id = _encounter_id
      AND ce.resolved_at IS NULL
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encounter_has_pending_work(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_has_pending_work(uuid) TO service_role;

-- Is a healthy LIVE owner eligible for this encounter right now?
--
-- Mirrors `claim_encounter_tick`'s live-presence test exactly (engagement +
-- living character + present at the encounter node + participant activity
-- inside the 15s grace) so discovery and claim can never disagree, plus an
-- unexpired live lease.
CREATE OR REPLACE FUNCTION public.encounter_live_owner_active(_encounter_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_grace_ms integer := 15000;
BEGIN
  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_enc.tick_state = 'resolving'
     AND v_enc.tick_mode = 'live'
     AND v_enc.lease_until IS NOT NULL
     AND v_enc.lease_until > v_now THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.encounter_engagements e
    JOIN public.characters c ON c.id = e.character_id
    JOIN public.encounter_participants p
      ON p.encounter_id = e.encounter_id AND p.character_id = e.character_id
    WHERE e.encounter_id = _encounter_id
      AND c.hp > 0
      AND c.current_node_id = v_enc.node_id
      AND p.last_action_at > (to_timestamp((v_now - v_grace_ms) / 1000.0))
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encounter_live_owner_active(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_live_owner_active(uuid) TO service_role;

-- Authoritative end: never end an encounter that still owes effects-only work.
CREATE OR REPLACE FUNCTION public.encounter_end(_encounter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.encounter_has_pending_work(_encounter_id) THEN
    -- Effects-pending: keep the encounter claimable so the internal
    -- effects-only owner can advance it. It ends on a later tick, once
    -- engagements, effects and casts are all genuinely finished.
    RETURN;
  END IF;

  UPDATE public.encounters
  SET status = 'ended', ended_at = now()
  WHERE id = _encounter_id AND status = 'active';
END;
$function$;

-- One-off repair: re-open any already-ended encounter that still holds
-- unfinished effects, so no pre-existing row is permanently stranded.
UPDATE public.encounters e
SET status = 'active', ended_at = NULL, last_activity_at = now()
WHERE e.status = 'ended'
  AND EXISTS (
    SELECT 1
    FROM public.active_effects ae
    WHERE ae.node_id = e.node_id
      AND COALESCE(ae.lifetime, 'timed') <> 'stance'
      AND (
        EXISTS (SELECT 1 FROM public.creatures c WHERE c.id = ae.target_id AND c.is_alive)
        OR EXISTS (SELECT 1 FROM public.characters ch WHERE ch.id = ae.target_id)
      )
  );

-- Discovery indexes (stage 2 uses them; created here so stage 1 tests run on
-- the final access path).
CREATE INDEX IF NOT EXISTS active_effects_next_tick_at_idx
  ON public.active_effects (next_tick_at);
CREATE INDEX IF NOT EXISTS active_effects_node_next_tick_idx
  ON public.active_effects (node_id, next_tick_at);
CREATE INDEX IF NOT EXISTS active_effects_node_expires_idx
  ON public.active_effects (node_id, expires_at);