-- Combat2 scheduler lifecycle wiring only: world-state and combat-mode
-- transitions call the already-installed, idempotent scheduler controls.
-- No new scheduler, dispatcher, worker, table or secret is introduced, and
-- existing wake/sleep/combat-mode behaviour is untouched.

CREATE OR REPLACE FUNCTION public.combat2_sync_schedule_on_world_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF NEW.state = 'awake' THEN
      PERFORM public.combat2_dispatch_scheduler_enable();
    ELSE
      PERFORM public.combat2_dispatch_scheduler_disable();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'combat2 scheduler sync failed for world state transition';
  END;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.combat2_sync_schedule_on_combat_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF NEW.value = 'open' THEN
      PERFORM public.combat2_dispatch_scheduler_enable();
    ELSE
      PERFORM public.combat2_dispatch_scheduler_disable();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'combat2 scheduler sync failed for combat mode transition';
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.combat2_sync_schedule_on_world_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.combat2_sync_schedule_on_combat_mode() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS combat2_sync_schedule_on_world_state ON public.world_state;
CREATE TRIGGER combat2_sync_schedule_on_world_state
AFTER INSERT OR UPDATE OF state ON public.world_state
FOR EACH ROW
EXECUTE FUNCTION public.combat2_sync_schedule_on_world_state();

DROP TRIGGER IF EXISTS combat2_sync_schedule_on_combat_mode ON public.combat_config;
CREATE TRIGGER combat2_sync_schedule_on_combat_mode
AFTER INSERT OR UPDATE OF value ON public.combat_config
FOR EACH ROW
WHEN (NEW.key = 'combat_mode')
EXECUTE FUNCTION public.combat2_sync_schedule_on_combat_mode();