CREATE OR REPLACE FUNCTION public.activate_cheat_xp_boost()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO cur FROM public.xp_boost LIMIT 1;

  IF cur.multiplier > 1 AND cur.expires_at IS NOT NULL AND cur.expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_active',
      'multiplier', cur.multiplier, 'expires_at', cur.expires_at);
  END IF;

  UPDATE public.xp_boost
     SET multiplier = 2,
         expires_at = now() + interval '1 hour';

  RETURN jsonb_build_object('ok', true, 'multiplier', 2, 'expires_at', now() + interval '1 hour');
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_cheat_xp_boost() TO authenticated;