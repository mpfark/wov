
-- 1. Trace flag on characters
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS combat_trace_enabled boolean NOT NULL DEFAULT false;

-- 2. Audit log table
CREATE TABLE IF NOT EXISTS public.combat_audit_log (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  character_name text,
  node_id      uuid,
  event_type   text,
  message      text NOT NULL,
  payload      jsonb
);

CREATE INDEX IF NOT EXISTS idx_combat_audit_char_created
  ON public.combat_audit_log (character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_audit_id_desc
  ON public.combat_audit_log (id DESC);

GRANT SELECT ON public.combat_audit_log TO authenticated;
GRANT ALL ON public.combat_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.combat_audit_log_id_seq TO service_role;

ALTER TABLE public.combat_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Overlords read combat audit" ON public.combat_audit_log;
CREATE POLICY "Overlords read combat audit"
  ON public.combat_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'::app_role));

-- 3. Toggle RPC (overlord only)
CREATE OR REPLACE FUNCTION public.set_character_combat_trace(
  _character_id uuid,
  _enabled boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'overlord'::app_role) THEN
    RAISE EXCEPTION 'Only overlords can toggle combat trace';
  END IF;
  UPDATE public.characters
     SET combat_trace_enabled = _enabled
   WHERE id = _character_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_character_combat_trace(uuid, boolean) TO authenticated;

-- 4. Prune function + cron
CREATE OR REPLACE FUNCTION public.prune_combat_audit_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff_id bigint;
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  SELECT id INTO cutoff_id
    FROM public.combat_audit_log
    ORDER BY id DESC
    OFFSET 20000 LIMIT 1;
  IF cutoff_id IS NOT NULL THEN
    DELETE FROM public.combat_audit_log WHERE id <= cutoff_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune-combat-audit')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-combat-audit');
    PERFORM cron.schedule(
      'prune-combat-audit',
      '17 * * * *',
      $c$SELECT public.prune_combat_audit_log();$c$
    );
  END IF;
END $$;
