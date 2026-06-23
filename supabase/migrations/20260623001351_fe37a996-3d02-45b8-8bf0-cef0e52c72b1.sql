
-- Wake-state check
CREATE OR REPLACE FUNCTION public.world_is_awake()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.characters
    WHERE last_online > now() - interval '5 minutes'
  );
$$;

-- Gate tick_creatures
CREATE OR REPLACE FUNCTION public.tick_creatures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.regen_creature_hp();
  PERFORM public.respawn_creatures();
END;
$$;

-- Wrap return_unique_items, expire_marketplace_listings, expire_king_slayer
-- by switching their cron commands to a guarded wrapper, leaving the underlying
-- functions untouched so admin tooling can still call them directly.
CREATE OR REPLACE FUNCTION public.guarded_return_unique_items()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.return_unique_items();
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_expire_marketplace_listings()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.expire_marketplace_listings();
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_expire_king_slayer()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.expire_king_slayer();
END;
$$;

-- Repoint the cron jobs to the guarded wrappers
SELECT cron.unschedule('return-unique-items');
SELECT cron.unschedule('expire-marketplace-listings');
SELECT cron.unschedule('expire-king-slayer');

SELECT cron.schedule('return-unique-items',         '*/30 * * * *', $$SELECT public.guarded_return_unique_items();$$);
SELECT cron.schedule('expire-marketplace-listings', '*/15 * * * *', $$SELECT public.guarded_expire_marketplace_listings();$$);
SELECT cron.schedule('expire-king-slayer',          '*/15 * * * *', $$SELECT public.guarded_expire_king_slayer();$$);

-- Make sure last_online index supports the awake check fast
CREATE INDEX IF NOT EXISTS idx_characters_last_online ON public.characters (last_online);
