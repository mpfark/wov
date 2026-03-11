-- Add base_aggressive column
ALTER TABLE public.creatures ADD COLUMN base_aggressive boolean NOT NULL DEFAULT false;

-- Backfill from current is_aggressive
UPDATE public.creatures SET base_aggressive = is_aggressive;

-- Update damage_creature to set is_aggressive = true on damage
CREATE OR REPLACE FUNCTION public.damage_creature(_creature_id uuid, _new_hp integer, _killed boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _killed THEN
    UPDATE creatures SET hp = 0, is_alive = false, died_at = now() WHERE id = _creature_id;
  ELSE
    UPDATE creatures SET hp = _new_hp, is_aggressive = true WHERE id = _creature_id;
  END IF;
END;
$function$;

-- Update respawn_creatures to reset is_aggressive back to base_aggressive
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
      is_aggressive = base_aggressive
  WHERE is_alive = false
    AND died_at IS NOT NULL
    AND died_at + (respawn_seconds || ' seconds')::interval <= now();
END;
$function$;