CREATE OR REPLACE FUNCTION public.world_is_awake()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.last_online > now() - interval '5 minutes'
      AND NOT public.has_role(c.user_id, 'overlord'::app_role)
      AND NOT public.has_role(c.user_id, 'steward'::app_role)
  );
$$;

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
  FROM public.characters c
  WHERE c.last_online > now() - interval '5 minutes'
    AND NOT public.has_role(c.user_id, 'overlord'::app_role)
    AND NOT public.has_role(c.user_id, 'steward'::app_role);

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