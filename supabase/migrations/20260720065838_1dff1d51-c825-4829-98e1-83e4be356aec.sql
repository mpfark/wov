CREATE OR REPLACE FUNCTION public.idle_shutdown_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.characters WHERE last_online > now() - interval '30 minutes'
  ) THEN
    -- Final reclaim sweep before shutdown; otherwise the next pass only
    -- runs when the world wakes again, which can be many hours away and
    -- lets holders keep unique items far longer than intended.
    BEGIN
      PERFORM public.return_unique_items();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'return_unique_items() failed during shutdown: %', SQLERRM;
    END;

    PERFORM public.shutdown_world();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.idle_shutdown_check() FROM public;
GRANT EXECUTE ON FUNCTION public.idle_shutdown_check() TO service_role;