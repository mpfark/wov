
-- Function to passively regenerate creature HP over time
CREATE OR REPLACE FUNCTION public.regen_creature_hp()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Regen 5% of max_hp for alive creatures not at full health
  UPDATE public.creatures
  SET hp = LEAST(hp + GREATEST(CEIL(max_hp * 0.05), 1), max_hp)
  WHERE is_alive = true
    AND hp < max_hp;
END;
$$;
