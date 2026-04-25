-- Add idempotency marker for offscreen reward claiming
ALTER TABLE public.creatures
  ADD COLUMN IF NOT EXISTS rewards_awarded_at timestamp with time zone;

-- Reset marker when creatures respawn so future kills can award again
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
      died_at = NULL,
      is_aggressive = base_aggressive,
      rewards_awarded_at = NULL
  WHERE is_alive = false
    AND died_at IS NOT NULL
    AND died_at + (respawn_seconds || ' seconds')::interval <= now();
END;
$function$;