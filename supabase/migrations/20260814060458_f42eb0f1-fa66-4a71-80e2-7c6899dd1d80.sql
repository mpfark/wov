-- C4: delivery-layer hardening. No change to resolution, formulas or authority.

-- 1. Batch envelope v3
DO $do$
DECLARE
  d text;
  old_blk text := $old$    'v', 2, 'tick', _tick, 'batch_id', _batch_id, 'mode', _proposed->>'mode',
    'events', COALESCE(_proposed->'events', '[]'::jsonb),
    'characters', COALESCE(_proposed->'characters', '[]'::jsonb),
    'creatures', COALESCE(_proposed->'creatures', '[]'::jsonb),
    'deaths', COALESCE(_proposed->'deaths', '[]'::jsonb),
    'kills', COALESCE(_proposed->'kills', '[]'::jsonb)));$old$;
  new_blk text := $new$    'v', 3, 'tick', _tick, 'batch_id', _batch_id, 'mode', _proposed->>'mode',
    'ticks_processed', COALESCE((_proposed->>'ticksProcessed')::int, 1),
    'events', COALESCE(_proposed->'events', '[]'::jsonb),
    'characters', COALESCE(_proposed->'characters', '[]'::jsonb),
    'creatures', COALESCE(_proposed->'creatures', '[]'::jsonb),
    'deaths', COALESCE(_proposed->'deaths', '[]'::jsonb),
    'kills', COALESCE(_proposed->'kills', '[]'::jsonb),
    'rewards', COALESCE(_proposed->'rewards', '[]'::jsonb),
    'progression', COALESCE(_proposed->'progression', '[]'::jsonb),
    'consumedBuffs', COALESCE(_proposed->'consumedBuffs', '[]'::jsonb),
    'rejectedActions', COALESCE(_proposed->'rejectedActions', '[]'::jsonb),
    'consumedActionIds', COALESCE(_proposed->'consumedActionIds', '[]'::jsonb),
    'effectUpserts', COALESCE(_proposed->'effectUpserts', '[]'::jsonb),
    'effectDeleteTargetIds', COALESCE(_proposed->'effectDeleteTargetIds', '[]'::jsonb),
    'session', COALESCE(_proposed->'session', jsonb_build_object('ended', false, 'nextDueAtMs', 0))));$new$;
BEGIN
  d := pg_get_functiondef('public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)'::regprocedure);
  IF position(old_blk in d) = 0 THEN
    RAISE EXCEPTION 'C4: batch payload projection block not found - refusing to patch';
  END IF;
  EXECUTE replace(d, old_blk, new_blk);
END $do$;

GRANT EXECUTE ON FUNCTION public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb) TO service_role;

-- 2. Participation grace grants
CREATE TABLE IF NOT EXISTS public.encounter_access_grants (
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '300 seconds',
  PRIMARY KEY (encounter_id, character_id)
);

CREATE INDEX IF NOT EXISTS encounter_access_grants_expires_idx
  ON public.encounter_access_grants (expires_at);

GRANT SELECT ON public.encounter_access_grants TO authenticated;
GRANT ALL ON public.encounter_access_grants TO service_role;
ALTER TABLE public.encounter_access_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Players read their own encounter access grants" ON public.encounter_access_grants;
CREATE POLICY "Players read their own encounter access grants"
  ON public.encounter_access_grants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.characters c
                 WHERE c.id = encounter_access_grants.character_id AND c.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.grant_encounter_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.encounter_access_grants (encounter_id, character_id, expires_at)
  VALUES (NEW.encounter_id, NEW.character_id, now() + interval '300 seconds')
  ON CONFLICT (encounter_id, character_id)
  DO UPDATE SET expires_at = GREATEST(public.encounter_access_grants.expires_at,
                                      now() + interval '300 seconds');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS encounter_participants_grant_access ON public.encounter_participants;
CREATE TRIGGER encounter_participants_grant_access
AFTER INSERT OR UPDATE ON public.encounter_participants
FOR EACH ROW EXECUTE FUNCTION public.grant_encounter_access();

-- 3. Batch read access: current participant OR unexpired grace grant
DROP POLICY IF EXISTS "Participants read their encounter batches" ON public.encounter_tick_batches;
CREATE POLICY "Participants read their encounter batches"
  ON public.encounter_tick_batches FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.encounter_participants p
            JOIN public.characters c ON c.id = p.character_id
            WHERE p.encounter_id = encounter_tick_batches.encounter_id
              AND c.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.encounter_access_grants g
               JOIN public.characters c ON c.id = g.character_id
               WHERE g.encounter_id = encounter_tick_batches.encounter_id
                 AND g.expires_at > now()
                 AND c.user_id = auth.uid())
  );

-- 4. Bounded cleanup + scheduled pruning outside the tick
CREATE OR REPLACE FUNCTION public.prune_encounter_access_grants(_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  WITH victims AS (
    SELECT encounter_id, character_id FROM public.encounter_access_grants
    WHERE expires_at < now() - interval '60 seconds'
    ORDER BY expires_at
    LIMIT GREATEST(1, COALESCE(_limit, 1000))
  )
  DELETE FROM public.encounter_access_grants g
  USING victims v
  WHERE g.encounter_id = v.encounter_id AND g.character_id = v.character_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_encounter_access_grants(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_encounter_access_grants(integer) TO service_role;

SELECT cron.unschedule('prune-encounter-tick-batches')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-encounter-tick-batches');
SELECT cron.schedule('prune-encounter-tick-batches', '* * * * *',
  $$SELECT public.prune_encounter_tick_batches(180, 2000);$$);

SELECT cron.unschedule('prune-encounter-access-grants')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-encounter-access-grants');
SELECT cron.schedule('prune-encounter-access-grants', '*/5 * * * *',
  $$SELECT public.prune_encounter_access_grants(2000);$$);