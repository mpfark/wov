ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS stance_state jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Lazy-regen RPC: applies elapsed-time Force Shield regen for a single character
-- and returns the up-to-date shield value. Used by the client when fetching its
-- own character so the OOC bar always reflects "what it should be right now"
-- without depending on cron granularity.
CREATE OR REPLACE FUNCTION public.apply_force_shield_regen(_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  in_combat boolean;
  int_total integer;
  int_mod integer;
  cap integer;
  regen_per_tick integer;
  current_hp integer;
  last_ts timestamptz;
  elapsed_ms bigint;
  ticks integer;
  next_hp integer;
  new_state jsonb;
BEGIN
  SELECT id, user_id, level, int, reserved_buffs, stance_state
    INTO c
    FROM public.characters
    WHERE id = _character_id;

  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Only the owner (or admins) may trigger their own regen via this path.
  IF c.user_id <> auth.uid() AND NOT public.is_steward_or_overlord() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Stance not active → wipe any stale shield state.
  IF NOT (coalesce(c.reserved_buffs, '{}'::jsonb) ? 'force_shield') THEN
    IF c.stance_state ? 'force_shield_hp' THEN
      UPDATE public.characters
        SET stance_state = (c.stance_state - 'force_shield_hp' - 'force_shield_updated_at')
        WHERE id = c.id;
    END IF;
    RETURN coalesce(c.stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at';
  END IF;

  -- In combat? combat-tick is the sole writer; do not double-apply OOC regen.
  SELECT EXISTS (
    SELECT 1 FROM public.combat_sessions s
      WHERE s.character_id = c.id
         OR (s.party_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.party_members pm
              WHERE pm.party_id = s.party_id
                AND pm.character_id = c.id
                AND pm.status = 'accepted'
            ))
  ) INTO in_combat;

  -- Compute cap and regen rate from base INT (equipment bonuses are applied
  -- inside combat-tick; here we use the column value as a stable baseline so
  -- the OOC bar doesn't jitter when gear is swapped).
  int_total := coalesce(c.int, 10);
  int_mod := greatest(0, ((int_total - 10) / 2));
  cap := greatest(1, int_mod + (coalesce(c.level, 1) / 2));
  regen_per_tick := 1 + (int_mod / 2);

  current_hp := coalesce((c.stance_state->>'force_shield_hp')::int, cap);
  last_ts := coalesce((c.stance_state->>'force_shield_updated_at')::timestamptz, now());

  IF in_combat THEN
    -- Don't regen, but ensure we have a recent timestamp so OOC tick math
    -- starts from "now" once combat ends.
    new_state := coalesce(c.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', current_hp,
           'force_shield_updated_at', to_jsonb(now())
         );
  ELSE
    elapsed_ms := greatest(0, (extract(epoch from (now() - last_ts)) * 1000)::bigint);
    ticks := (elapsed_ms / 2000)::int; -- 2s tick cadence
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

  RETURN new_state;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_force_shield_regen(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_force_shield_regen(uuid) TO authenticated;