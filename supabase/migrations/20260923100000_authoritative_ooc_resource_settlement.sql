-- Authoritative ordinary-world HP/CP/MP settlement. The existing Combat2
-- scheduler remains the single clock owner; this adds no cron job or Edge call.

CREATE TABLE public.character_resource_settlement_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  settled_bucket timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.character_resource_settlement_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.character_resource_settlement_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.character_resource_settlement_state TO service_role;

INSERT INTO public.character_resource_settlement_state(singleton, settled_bucket)
VALUES (true, date_bin(interval '4 seconds', clock_timestamp(), timestamptz 'epoch'));

DO $$
DECLARE scheduler text;
BEGIN
  IF to_regprocedure('public.combat2_dispatch_scheduler_fire()') IS NULL
     OR to_regprocedure('public.settle_out_of_combat_resources(timestamptz)') IS NOT NULL
     OR to_regprocedure('public.combat2_dispatch_scheduler_fire_without_resource_settlement()') IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected resource settlement installation state';
  END IF;
  SELECT pg_get_functiondef('public.combat2_dispatch_scheduler_fire()'::regprocedure) INTO scheduler;
  IF position('combat2-dispatch-once-fire' in scheduler) = 0
     OR position('combat2_dispatch_scheduler_eligible' in scheduler) = 0
     OR position('net.http_post' in scheduler) = 0 THEN
    RAISE EXCEPTION 'unexpected dispatcher scheduler contract';
  END IF;
END $$;

CREATE FUNCTION public.settle_out_of_combat_resources(_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
DECLARE
  state public.character_resource_settlement_state%ROWTYPE;
  bucket timestamptz := date_bin(interval '4 seconds', _now, timestamptz 'epoch');
  elapsed integer;
  steps integer;
  c public.characters%ROWTYPE;
  bonus_hp integer;
  bonus_con integer;
  bonus_int integer;
  bonus_wis integer;
  bonus_dex integer;
  bonus_hp_regen integer;
  effective_con integer;
  effective_wis integer;
  effective_dex integer;
  con_mod integer;
  int_mod integer;
  wis_mod integer;
  dex_mod integer;
  base_hp integer;
  hp_cap integer;
  cp_cap integer;
  mp_cap integer;
  hp_per_tick integer;
  cp_per_tick integer;
  mp_per_tick integer;
  inn_bonus integer;
  eligible_count integer := 0;
  settled_count integer := 0;
BEGIN
  IF _now > clock_timestamp() + interval '5 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_time');
  END IF;

  SELECT * INTO state FROM public.character_resource_settlement_state
  WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'resource settlement state missing'; END IF;

  -- Advancing the cursor while ineligible prevents sleep or maintenance time
  -- from becoming banked regeneration when the world next wakes.
  IF NOT public.world_state_is_awake()
     OR NOT public.combat_mode_is_open()
     OR NOT EXISTS (
       SELECT 1 FROM cron.job
       WHERE jobname = 'combat2-dispatch-once'
         AND schedule = '2 seconds'
         AND command = 'SELECT public.combat2_dispatch_scheduler_fire();'
     ) THEN
    UPDATE public.character_resource_settlement_state
      SET settled_bucket = GREATEST(settled_bucket, bucket), updated_at = clock_timestamp()
      WHERE singleton;
    RETURN jsonb_build_object('ok', false, 'kind', 'ineligible', 'steps', 0);
  END IF;

  elapsed := floor(extract(epoch FROM (bucket - state.settled_bucket)) / 4.0)::integer;
  IF elapsed <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'kind', 'already_settled', 'steps', 0);
  END IF;
  -- Ordinary scheduler jitter catches up at most three four-second intervals.
  -- A longer gap represents downtime: award one current interval, never the gap.
  steps := CASE WHEN elapsed <= 3 THEN elapsed ELSE 1 END;
  UPDATE public.character_resource_settlement_state
    SET settled_bucket = bucket, updated_at = clock_timestamp() WHERE singleton;

  -- Lock order is character UUID only. No encounter row is locked here. Combat
  -- entry/commit/movement may lock encounter then character, so this cannot add
  -- a reversed encounter/character lock pair; after the character lock, all
  -- ownership and transition predicates are re-read before mutation.
  FOR c IN SELECT * FROM public.characters ORDER BY id FOR UPDATE LOOP
    IF c.hp <= 0 OR c.current_node_id IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.combat2_test_arena_node t WHERE t.node_id = c.current_node_id) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.combat2_departure_request d
      WHERE d.character_id = c.id AND (d.status = 'queued' OR d.resolved_at >= bucket)) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.combat2_party_departure_member m
      JOIN public.combat2_party_departure_request r ON r.request_id = m.request_id
      WHERE m.character_id = c.id AND ((r.status = 'queued' AND m.status IN ('waiting','queued'))
        OR m.resolved_at >= bucket)) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.combat2_respawn_request rr
      WHERE rr.character_id = c.id AND rr.created_at >= bucket) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.node_fighter released
      WHERE released.character_id = c.id AND released.left_at >= bucket) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.node_fighter f
      JOIN public.node_encounter e ON e.id = f.encounter_id
      WHERE f.character_id = c.id AND e.status = 'active' AND (
        (f.present AND EXISTS (SELECT 1 FROM public.node_creature nc
          WHERE nc.node_id = e.node_id AND nc.is_alive AND nc.hp > 0 AND nc.engaged))
        OR (e.claim_token IS NOT NULL AND e.claim_expires_at > _now)
      )) THEN CONTINUE; END IF;

    eligible_count := eligible_count + 1;
    SELECT
      COALESCE(sum(COALESCE((base->>'hp')::integer, 0)), 0)::integer,
      COALESCE(sum(COALESCE((base->>'con')::integer, 0) + COALESCE((gems->>'emerald')::integer, 0)), 0)::integer,
      COALESCE(sum(COALESCE((base->>'int')::integer, 0) + COALESCE((gems->>'sapphire')::integer, 0)), 0)::integer,
      COALESCE(sum(COALESCE((base->>'wis')::integer, 0) + COALESCE((gems->>'pearl')::integer, 0)), 0)::integer,
      COALESCE(sum(COALESCE((base->>'dex')::integer, 0) + COALESCE((gems->>'topaz')::integer, 0)), 0)::integer,
      COALESCE(sum(COALESCE((base->>'hp_regen')::integer, 0)), 0)::integer
    INTO bonus_hp, bonus_con, bonus_int, bonus_wis, bonus_dex, bonus_hp_regen
    FROM (
      SELECT COALESCE(NULLIF(ci.stat_override, '{}'::jsonb), i.stats, '{}'::jsonb) base,
             COALESCE(ci.applied_gems, '{}'::jsonb) gems
      FROM public.character_inventory ci JOIN public.items i ON i.id = ci.item_id
      WHERE ci.character_id = c.id AND ci.equipped_slot IS NOT NULL AND ci.current_durability > 0
    ) equipped;

    effective_con := c.con + bonus_con;
    effective_wis := c.wis + bonus_wis;
    effective_dex := c.dex + bonus_dex;
    con_mod := floor((effective_con - 10) / 2.0)::integer;
    int_mod := greatest(floor(((c.int + bonus_int) - 10) / 2.0)::integer, 0);
    wis_mod := greatest(floor((effective_wis - 10) / 2.0)::integer, 0);
    dex_mod := greatest(floor((effective_dex - 10) / 2.0)::integer, 0);
    base_hp := CASE c.class::text WHEN 'warrior' THEN 24 WHEN 'wizard' THEN 16
      WHEN 'ranger' THEN 20 WHEN 'rogue' THEN 16 WHEN 'assassin' THEN 16
      WHEN 'healer' THEN 18 WHEN 'bard' THEN 16 WHEN 'templar' THEN 22 ELSE 18 END;
    hp_cap := least(greatest(base_hp + con_mod * 2 + (c.level - 1) * 5 + bonus_hp, 1), 10000);
    cp_cap := least(greatest(30 + (c.level - 1) * 3 + (int_mod + wis_mod) * 3, 0), 5000);
    mp_cap := least(greatest(100 + dex_mod * 10 + floor((c.level - 1) * 2)::integer, 0), 5000);
    SELECT CASE WHEN n.is_inn THEN 10 ELSE 0 END INTO inn_bonus
      FROM public.nodes n WHERE n.id = c.current_node_id;
    inn_bonus := COALESCE(inn_bonus, 0);

    hp_per_tick := 2 + floor(sqrt(greatest(effective_con - 10, 0)))::integer
      + bonus_hp_regen + CASE WHEN c.level >= 40 THEN 10 WHEN c.level >= 35 THEN 8
        WHEN c.level >= 30 THEN 6 WHEN c.level >= 25 THEN 4 WHEN c.level >= 20 THEN 2 ELSE 0 END
      + inn_bonus;
    cp_per_tick := 2 + floor(sqrt(greatest(effective_wis - 10, 0)))::integer
      + CASE WHEN c.level >= 40 THEN 5 WHEN c.level >= 35 THEN 4 WHEN c.level >= 30 THEN 3
        WHEN c.level >= 25 THEN 2 WHEN c.level >= 20 THEN 1 ELSE 0 END + inn_bonus;
    mp_per_tick := round((5 + dex_mod) * 0.67)::integer * 2 + inn_bonus;

    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE public.characters SET
      hp = CASE WHEN hp < hp_cap THEN least(hp_cap, hp + hp_per_tick * steps) ELSE hp END,
      cp = CASE WHEN cp < cp_cap THEN least(cp_cap, cp + cp_per_tick * steps) ELSE cp END,
      mp = CASE WHEN mp < mp_cap THEN least(mp_cap, mp + mp_per_tick * steps) ELSE mp END
    WHERE id = c.id AND hp > 0;
    IF FOUND THEN settled_count := settled_count + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'kind', 'settled', 'steps', steps,
    'eligible_count', eligible_count, 'settled_count', settled_count, 'bucket', bucket);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_out_of_combat_resources(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_out_of_combat_resources(timestamptz) TO service_role;

-- Preserve the installed dispatcher implementation byte-for-byte behind an
-- internal name, then compose settlement before dispatch. Dispatcher failure
-- is isolated in a subtransaction so an already successful settlement commits.
ALTER FUNCTION public.combat2_dispatch_scheduler_fire() RENAME TO combat2_dispatch_scheduler_fire_without_resource_settlement;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire_without_resource_settlement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_fire_without_resource_settlement() TO service_role;

CREATE FUNCTION public.combat2_dispatch_scheduler_fire()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE settlement jsonb; dispatch jsonb;
BEGIN
  settlement := public.settle_out_of_combat_resources(clock_timestamp());
  BEGIN
    dispatch := public.combat2_dispatch_scheduler_fire_without_resource_settlement();
  EXCEPTION WHEN OTHERS THEN
    dispatch := jsonb_build_object('ok', false, 'classification', 'scheduler_error', 'code', SQLSTATE);
  END;
  RETURN dispatch || jsonb_build_object('resource_settlement', settlement);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_fire() TO service_role;
