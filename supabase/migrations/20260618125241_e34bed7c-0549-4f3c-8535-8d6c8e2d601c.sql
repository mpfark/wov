CREATE OR REPLACE FUNCTION public.damage_creature(
  _creature_id uuid, _new_hp integer, _killed boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _killed THEN
    UPDATE creatures
       SET hp = 0,
           is_alive = false,
           died_at = now(),
           is_aggressive = base_aggressive
     WHERE id = _creature_id;
  ELSE
    UPDATE creatures
       SET hp = _new_hp
     WHERE id = _creature_id;
  END IF;
END;
$$;

UPDATE public.creatures
   SET is_aggressive = base_aggressive
 WHERE is_aggressive <> base_aggressive;