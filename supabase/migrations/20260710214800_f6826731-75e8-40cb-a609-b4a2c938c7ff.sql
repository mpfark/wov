
-- 1. Consolidate expiration jobs
DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN ('expire-king-slayer','expire-marketplace-listings','return-unique-items','tick-creatures')
  LOOP PERFORM cron.unschedule(jid); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guarded_expire_timed_state()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.expire_king_slayer();
  PERFORM public.expire_marketplace_listings();
END;
$$;

SELECT cron.schedule('expire-timed-state', '*/15 * * * *', $$SELECT public.guarded_expire_timed_state();$$);
SELECT cron.schedule('return-unique-items', '0 * * * *', $$SELECT public.guarded_return_unique_items();$$);

-- 2. Event-driven tick-creatures scheduling
CREATE OR REPLACE FUNCTION public.schedule_tick_creatures()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tick-creatures') THEN
    PERFORM cron.schedule('tick-creatures', '*/2 * * * *', $c$SELECT public.tick_creatures();$c$);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.unschedule_tick_creatures()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'tick-creatures';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END;
$$;

-- Extend record_world_state to (un)schedule tick-creatures on transitions
CREATE OR REPLACE FUNCTION public.record_world_state()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $$
DECLARE
  v_count int;
  v_now_state text;
  v_prev_state text;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.characters c
  WHERE c.last_online > now() - interval '5 minutes'
    AND NOT public.has_role(c.user_id, 'overlord'::app_role)
    AND NOT public.has_role(c.user_id, 'steward'::app_role);

  v_now_state := CASE WHEN v_count > 0 THEN 'awake' ELSE 'asleep' END;

  SELECT state INTO v_prev_state FROM public.world_slumber_log ORDER BY changed_at DESC LIMIT 1;

  IF v_prev_state IS DISTINCT FROM v_now_state THEN
    INSERT INTO public.world_slumber_log (state, awake_characters) VALUES (v_now_state, v_count);
    IF v_now_state = 'asleep' THEN
      PERFORM public.unschedule_tick_creatures();
    ELSE
      PERFORM public.schedule_tick_creatures();
    END IF;
  END IF;
END;
$$;

-- Trigger on characters.last_online updates: wake up scheduling
CREATE OR REPLACE FUNCTION public.trg_wake_world_on_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.last_online IS NULL THEN RETURN NEW; END IF;
  IF OLD.last_online IS NOT NULL AND NEW.last_online - OLD.last_online < interval '30 seconds' THEN
    RETURN NEW;
  END IF;
  IF public.has_role(NEW.user_id, 'overlord'::app_role) OR public.has_role(NEW.user_id, 'steward'::app_role) THEN
    RETURN NEW;
  END IF;
  PERFORM public.record_world_state();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS characters_wake_world ON public.characters;
CREATE TRIGGER characters_wake_world
AFTER UPDATE OF last_online ON public.characters
FOR EACH ROW EXECUTE FUNCTION public.trg_wake_world_on_activity();

-- Safety-net watchdog: every 5 min, re-evaluate world state and (un)schedule
CREATE OR REPLACE FUNCTION public.world_watchdog()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $$
BEGIN
  PERFORM public.record_world_state();
  IF public.world_is_awake() THEN
    PERFORM public.schedule_tick_creatures();
  ELSE
    PERFORM public.unschedule_tick_creatures();
  END IF;
END;
$$;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'world-watchdog';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;
SELECT cron.schedule('world-watchdog', '*/5 * * * *', $$SELECT public.world_watchdog();$$);

-- Initial evaluation so state reflects reality right now
SELECT public.world_watchdog();

-- 3. Trim realtime publication
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.party_combat_log; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.xp_boost; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
