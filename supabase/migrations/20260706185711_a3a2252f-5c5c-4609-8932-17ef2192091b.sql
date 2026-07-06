CREATE TABLE public.world_slumber_log (
  id bigserial PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('awake','asleep')),
  awake_characters int NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX world_slumber_log_changed_at_idx ON public.world_slumber_log (changed_at DESC);

GRANT SELECT ON public.world_slumber_log TO authenticated;
GRANT ALL ON public.world_slumber_log TO service_role;

ALTER TABLE public.world_slumber_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Overlords can read slumber log"
ON public.world_slumber_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'overlord'));

CREATE OR REPLACE FUNCTION public.record_world_state()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
  v_now_state text;
  v_prev_state text;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.characters
  WHERE last_online > now() - interval '5 minutes';

  v_now_state := CASE WHEN v_count > 0 THEN 'awake' ELSE 'asleep' END;

  SELECT state INTO v_prev_state
  FROM public.world_slumber_log
  ORDER BY changed_at DESC
  LIMIT 1;

  IF v_prev_state IS DISTINCT FROM v_now_state THEN
    INSERT INTO public.world_slumber_log (state, awake_characters)
    VALUES (v_now_state, v_count);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tick_creatures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.record_world_state();
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.regen_creature_hp();
  PERFORM public.respawn_creatures();
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_return_unique_items()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.record_world_state();
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.return_unique_items();
END;
$$;

INSERT INTO public.world_slumber_log (state, awake_characters)
SELECT
  CASE WHEN c > 0 THEN 'awake' ELSE 'asleep' END,
  c
FROM (SELECT count(*)::int AS c FROM public.characters WHERE last_online > now() - interval '5 minutes') s;