-- A fighter is present only while its encounter generation is active. Preserve
-- the historical row, but close presence atomically when that generation ends.
BEGIN;

CREATE OR REPLACE FUNCTION public.combat2_close_inactive_encounter_fighters()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE public.node_fighter
       SET present = false,
           left_at = COALESCE(left_at, clock_timestamp()),
           updated_at = clock_timestamp()
     WHERE encounter_id = NEW.id
       AND present;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.combat2_close_inactive_encounter_fighters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_close_inactive_encounter_fighters() TO service_role;

DROP TRIGGER IF EXISTS combat2_close_inactive_encounter_fighters ON public.node_encounter;
CREATE TRIGGER combat2_close_inactive_encounter_fighters
AFTER UPDATE OF status ON public.node_encounter
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.combat2_close_inactive_encounter_fighters();

COMMIT;
