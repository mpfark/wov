-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 2: authoritative due-work discovery + internal encounter scope.
--
-- Discovery reads `active_effects` directly (no denormalised hint column can
-- therefore become hidden authority) and uses exactly the same live-eligibility
-- semantics as `claim_encounter_tick` via `encounter_live_owner_active`.
-- ─────────────────────────────────────────────────────────────────────────────

-- Explicit, service-role-only validation scope for maintenance soak runs.
CREATE TABLE IF NOT EXISTS public.combat_soak_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid,
  node_id uuid NOT NULL,
  character_ids uuid[] NOT NULL DEFAULT '{}',
  creature_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.combat_soak_scopes TO service_role;
ALTER TABLE public.combat_soak_scopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "soak scopes are service-role only" ON public.combat_soak_scopes;
CREATE POLICY "soak scopes are service-role only"
  ON public.combat_soak_scopes FOR ALL
  USING (false) WITH CHECK (false);

-- Whole-scope maintenance gate. During maintenance an internal effects-only
-- tick is permitted only when an unexpired grant covers the encounter/node AND
-- every effect source, effect target, creature at the node and participant is
-- explicitly listed in that grant. No name matching, no permission inferred
-- from a single effect source.
CREATE OR REPLACE FUNCTION public.effects_scope_grant_check(_encounter_id uuid, _node_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g public.combat_soak_scopes;
BEGIN
  SELECT * INTO g
  FROM public.combat_soak_scopes
  WHERE node_id = _node_id
    AND (encounter_id IS NULL OR encounter_id = _encounter_id)
    AND expires_at > now()
  ORDER BY expires_at DESC
  LIMIT 1;

  IF g.id IS NULL THEN
    RETURN false;
  END IF;

  -- Every effect at the node must be sourced by, and target, granted ids.
  IF EXISTS (
    SELECT 1 FROM public.active_effects ae
    WHERE ae.node_id = _node_id
      AND (
        (ae.source_id IS NOT NULL AND NOT (ae.source_id = ANY(g.character_ids)) AND NOT (ae.source_id = ANY(g.creature_ids)))
        OR (NOT (ae.target_id = ANY(g.character_ids)) AND NOT (ae.target_id = ANY(g.creature_ids)))
      )
  ) THEN
    RETURN false;
  END IF;

  -- Every creature at the node must be granted.
  IF EXISTS (
    SELECT 1 FROM public.creatures c
    WHERE c.node_id = _node_id AND NOT (c.id = ANY(g.creature_ids))
  ) THEN
    RETURN false;
  END IF;

  -- Every participant must be granted.
  IF EXISTS (
    SELECT 1 FROM public.encounter_participants p
    WHERE p.encounter_id = _encounter_id AND NOT (p.character_id = ANY(g.character_ids))
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.effects_scope_grant_check(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effects_scope_grant_check(uuid, uuid) TO service_role;

-- Bounded, indexed due-work discovery.
--
-- `due_count` counts rows that need an authoritative tick now: periodic rows
-- whose next_tick_at has arrived, and rows whose window has closed and still
-- need resolver-proposed, C2-committed expiry.
-- `pending_count` counts all non-stance work at the node, including future
-- rows, so the scheduler can stay armed without a further commit.
CREATE OR REPLACE FUNCTION public.effects_due_scopes(_limit integer DEFAULT 5, _now_ms bigint DEFAULT NULL)
RETURNS TABLE(
  encounter_id uuid,
  node_id uuid,
  due_at_ms bigint,
  earliest_ms bigint,
  due_count integer,
  pending_count integer,
  live_owner boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH now_ms AS (
    SELECT COALESCE(_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint) AS v
  ), work AS (
    SELECT e.id AS encounter_id,
           e.node_id,
           min(ae.next_tick_at) AS due_at_ms,
           min(least(ae.next_tick_at, ae.expires_at)) AS earliest_ms,
           count(*) FILTER (
             WHERE ae.next_tick_at <= (SELECT v FROM now_ms)
                OR ae.expires_at <= (SELECT v FROM now_ms)
           )::int AS due_count,
           count(*)::int AS pending_count
    FROM public.active_effects ae
    JOIN public.encounters e
      ON e.node_id = ae.node_id
     AND e.encounter_key = 'default'
     AND e.status IN ('active','idle')
    WHERE COALESCE(ae.lifetime, 'timed') <> 'stance'
      AND (
        EXISTS (SELECT 1 FROM public.creatures c WHERE c.id = ae.target_id AND c.is_alive)
        OR EXISTS (SELECT 1 FROM public.characters ch WHERE ch.id = ae.target_id)
      )
    GROUP BY e.id, e.node_id
  )
  SELECT w.encounter_id, w.node_id, w.due_at_ms, w.earliest_ms,
         w.due_count, w.pending_count,
         public.encounter_live_owner_active(w.encounter_id) AS live_owner
  FROM work w
  ORDER BY w.earliest_ms ASC
  LIMIT GREATEST(1, COALESCE(_limit, 5));
$function$;

REVOKE EXECUTE ON FUNCTION public.effects_due_scopes(integer, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effects_due_scopes(integer, bigint) TO service_role;

-- Request-time revalidation for the internal encounter scope. The worker never
-- trusts its own request body.
CREATE OR REPLACE FUNCTION public.effects_scope_revalidate(
  _encounter_id uuid,
  _node_id uuid,
  _due_at_ms bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_mode text;
  v_due int := 0;
BEGIN
  IF _encounter_id IS NULL OR _node_id IS NULL THEN
    RETURN 'invalid_scope';
  END IF;

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN RETURN 'no_encounter'; END IF;
  IF v_enc.node_id IS DISTINCT FROM _node_id THEN RETURN 'node_mismatch'; END IF;
  IF v_enc.status NOT IN ('active','idle') THEN RETURN 'no_encounter'; END IF;

  IF NOT public.world_is_awake() THEN RETURN 'world_asleep'; END IF;

  SELECT COALESCE(value, 'open') INTO v_mode FROM public.combat_config WHERE key = 'combat_mode';
  IF COALESCE(v_mode, 'open') <> 'open'
     AND NOT public.effects_scope_grant_check(_encounter_id, _node_id) THEN
    RETURN 'scope_not_granted';
  END IF;

  SELECT due_count INTO v_due
  FROM public.effects_due_scopes(50, NULL)
  WHERE encounter_id = _encounter_id;

  IF COALESCE(v_due, 0) = 0 THEN RETURN 'nothing_due'; END IF;

  RETURN 'ok';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.effects_scope_revalidate(uuid, uuid, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effects_scope_revalidate(uuid, uuid, bigint) TO service_role;