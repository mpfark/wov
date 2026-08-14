-- 1. Death ends every stance (documented stance lifecycle policy).
--    A DEFERRED constraint trigger fires at transaction commit, i.e. AFTER the
--    tick's own effect upserts, so a stance materialised earlier in the same
--    tick is removed by `sync_stance_effects` instead of colliding with the
--    reservation guard mid-transaction.
CREATE OR REPLACE FUNCTION public.release_stances_on_death()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hp > 0 THEN RETURN NULL; END IF;
  IF COALESCE(NEW.reserved_buffs, '{}'::jsonb) = '{}'::jsonb THEN RETURN NULL; END IF;

  UPDATE public.characters
     SET reserved_buffs = '{}'::jsonb,
         stance_state = COALESCE(stance_state, '{}'::jsonb)
                        - 'force_shield_hp' - 'force_shield_updated_at'
   WHERE id = NEW.id
     AND hp <= 0
     AND COALESCE(reserved_buffs, '{}'::jsonb) <> '{}'::jsonb;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_release_stances_on_death ON public.characters;
CREATE CONSTRAINT TRIGGER trg_characters_release_stances_on_death
  AFTER UPDATE OF hp ON public.characters
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.release_stances_on_death();

-- 2. Force Shield pool: the absorb effect row is the authority, and the
--    out-of-combat regeneration path replenishes it (and mirrors it into
--    stance_state) instead of updating a value nothing reads.
CREATE OR REPLACE FUNCTION public.apply_force_shield_regen(_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  in_combat boolean;
  gear_int integer;
  gear_wis integer;
  int_total integer;
  wis_total integer;
  int_mod integer;
  wis_mod integer;
  cap integer;
  regen_per_tick integer;
  row_pool integer;
  current_hp integer;
  last_ts timestamptz;
  elapsed_ms bigint;
  ticks integer;
  next_hp integer;
  new_state jsonb;
BEGIN
  SELECT id, user_id, level, int, wis, reserved_buffs, stance_state, current_node_id
    INTO c
    FROM public.characters
    WHERE id = _character_id;

  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF c.user_id <> auth.uid() AND NOT public.is_steward_or_overlord() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT (coalesce(c.reserved_buffs, '{}'::jsonb) ? 'force_shield') THEN
    IF c.stance_state ? 'force_shield_hp' THEN
      UPDATE public.characters
        SET stance_state = (c.stance_state - 'force_shield_hp' - 'force_shield_updated_at')
        WHERE id = c.id;
    END IF;
    RETURN coalesce(c.stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.combat_sessions s
    WHERE s.node_id = c.current_node_id
      AND (
        s.character_id = c.id
        OR (
          s.party_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.party_members pm
            WHERE pm.party_id = s.party_id
              AND pm.character_id = c.id
              AND pm.status = 'accepted'
          )
        )
      )
  ) INTO in_combat;

  SELECT COALESCE(SUM(COALESCE((i.stats->>'int')::int, 0)), 0)
    INTO gear_int
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.character_id = c.id
      AND ci.equipped_slot IS NOT NULL;

  SELECT COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0)
    INTO gear_wis
    FROM public.character_inventory ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.character_id = c.id
      AND ci.equipped_slot IS NOT NULL;

  int_total := coalesce(c.int, 10) + coalesce(gear_int, 0);
  wis_total := coalesce(c.wis, 10) + coalesce(gear_wis, 0);
  int_mod := greatest(0, floor((int_total - 10)::numeric / 2)::int);
  wis_mod := greatest(0, floor((wis_total - 10)::numeric / 2)::int);
  cap := greatest(1, wis_mod + floor(coalesce(c.level, 1)::numeric / 2)::int);
  regen_per_tick := 1 + floor(int_mod::numeric / 2)::int;

  -- The live absorb row is the pool's authority (combat writes it every tick);
  -- stance_state is only the out-of-combat mirror.
  SELECT ae.remaining::int INTO row_pool
    FROM public.active_effects ae
   WHERE ae.target_id = c.id
     AND ae.lifetime = 'stance'
     AND ae.effect_type = 'force_shield'
   LIMIT 1;

  current_hp := least(cap, coalesce(row_pool, (c.stance_state->>'force_shield_hp')::int, cap));
  last_ts := coalesce((c.stance_state->>'force_shield_updated_at')::timestamptz, now());

  IF in_combat THEN
    next_hp := current_hp;
    new_state := coalesce(c.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', next_hp,
           'force_shield_updated_at', to_jsonb(now())
         );
  ELSE
    elapsed_ms := greatest(0, (extract(epoch from (now() - last_ts)) * 1000)::bigint);
    ticks := (elapsed_ms / 2000)::int;
    next_hp := least(cap, current_hp + ticks * regen_per_tick);
    new_state := coalesce(c.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', next_hp,
           'force_shield_updated_at', to_jsonb(last_ts + make_interval(secs => (ticks * 2)))
         );
  END IF;

  UPDATE public.characters
     SET stance_state = new_state
     WHERE id = c.id;

  -- Replenish the authoritative pool. `remaining` is the only mutable field of
  -- an absorb row, and it may never exceed the row's own magnitude.
  UPDATE public.active_effects ae
     SET remaining = least(COALESCE(ae.magnitude, next_hp), next_hp)
   WHERE ae.target_id = c.id
     AND ae.lifetime = 'stance'
     AND ae.effect_type = 'force_shield'
     AND ae.remaining IS DISTINCT FROM least(COALESCE(ae.magnitude, next_hp), next_hp);

  RETURN new_state;
END;
$$;