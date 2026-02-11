
-- Create a function to respawn dead creatures whose timer has elapsed
CREATE OR REPLACE FUNCTION public.respawn_creatures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.creatures
  SET is_alive = true,
      hp = max_hp,
      died_at = NULL
  WHERE is_alive = false
    AND died_at IS NOT NULL
    AND died_at + (respawn_seconds || ' seconds')::interval <= now();
END;
$function$;
