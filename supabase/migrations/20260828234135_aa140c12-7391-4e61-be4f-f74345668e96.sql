-- ============================================================
-- B0. Maintenance boundary (non-destructive)
-- ============================================================
UPDATE public.combat_config SET value = 'maintenance' WHERE key = 'combat_mode';

-- ============================================================
-- B1. New combat runtime schema (isolated; no legacy names)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.node_encounter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL UNIQUE REFERENCES public.nodes(id) ON DELETE CASCADE,
  tick integer NOT NULL DEFAULT 0,
  claimed_tick integer,
  state_version bigint NOT NULL DEFAULT 0,
  claim_token uuid,
  claim_expires_at timestamptz,
  intent_cutoff_seq bigint,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_encounter_status_chk CHECK (status IN ('active','ended')),
  CONSTRAINT node_encounter_claim_chk CHECK (claimed_tick IS NULL OR claimed_tick = tick + 1)
);
CREATE INDEX IF NOT EXISTS node_encounter_due_idx
  ON public.node_encounter (next_due_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.node_creature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  spawn_seq integer NOT NULL,
  hp integer NOT NULL,
  is_alive boolean NOT NULL DEFAULT true,
  pending_action jsonb,
  tank_fighter_id uuid,
  last_damaged_at timestamptz,
  died_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_creature_spawn_uniq UNIQUE (creature_id, spawn_seq)
);
CREATE INDEX IF NOT EXISTS node_creature_encounter_idx ON public.node_creature (encounter_id);

CREATE TABLE IF NOT EXISTS public.node_fighter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  entry_seq bigserial NOT NULL,
  present boolean NOT NULL DEFAULT true,
  party_id_at_entry uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS node_fighter_encounter_present_idx
  ON public.node_fighter (encounter_id, present, entry_seq DESC);
CREATE INDEX IF NOT EXISTS node_fighter_character_idx ON public.node_fighter (character_id);

CREATE TABLE IF NOT EXISTS public.node_effect (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  kind text NOT NULL,
  effect_type text NOT NULL,
  ability_key text,
  target_character_id uuid REFERENCES public.characters(id) ON DELETE CASCADE,
  target_creature_id uuid REFERENCES public.creatures(id) ON DELETE CASCADE,
  source_character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  source_creature_id uuid REFERENCES public.creatures(id) ON DELETE SET NULL,
  stacks integer NOT NULL DEFAULT 1,
  magnitude numeric,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  next_due_at timestamptz,
  interval_ms integer,
  last_pulse_tick integer,
  is_reservation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_effect_target_chk CHECK (
    (target_character_id IS NOT NULL) <> (target_creature_id IS NOT NULL)
  ),
  CONSTRAINT node_effect_reservation_chk CHECK (
    NOT is_reservation OR expires_at IS NULL
  )
);
CREATE INDEX IF NOT EXISTS node_effect_encounter_idx ON public.node_effect (encounter_id);
CREATE INDEX IF NOT EXISTS node_effect_char_idx ON public.node_effect (target_character_id);
CREATE INDEX IF NOT EXISTS node_effect_due_idx ON public.node_effect (next_due_at);

CREATE TABLE IF NOT EXISTS public.node_intent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  ability_key text,
  target_creature_id uuid REFERENCES public.creatures(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_intent_status_chk CHECK (status IN ('pending','consumed','rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS node_intent_one_pending_per_character
  ON public.node_intent (character_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS node_intent_pending_seq_idx
  ON public.node_intent (encounter_id, seq) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.node_reward_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  spawn_seq integer NOT NULL,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  xp_awarded integer NOT NULL DEFAULT 0,
  gold_awarded integer NOT NULL DEFAULT 0,
  is_killer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_reward_claim_uniq UNIQUE (creature_id, spawn_seq, character_id)
);
CREATE INDEX IF NOT EXISTS node_reward_claim_character_idx ON public.node_reward_claim (character_id);

CREATE TABLE IF NOT EXISTS public.node_tick_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  tick integer NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_tick_batch_uniq UNIQUE (encounter_id, tick)
);
CREATE INDEX IF NOT EXISTS node_tick_batch_cursor_idx ON public.node_tick_batch (encounter_id, tick DESC);

CREATE TABLE IF NOT EXISTS public.boss_ability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  ability_key text NOT NULL,
  label text,
  weight integer NOT NULL DEFAULT 1,
  windup_ticks integer NOT NULL DEFAULT 0,
  targeting text NOT NULL DEFAULT 'tank',
  magnitude numeric,
  amount_calc jsonb,
  damage_type text,
  effect jsonb,
  telegraph_text text,
  resolution_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boss_ability_uniq UNIQUE (creature_id, ability_key),
  CONSTRAINT boss_ability_targeting_chk CHECK (targeting IN ('tank','aoe','random')),
  CONSTRAINT boss_ability_windup_chk CHECK (windup_ticks >= 0)
);
CREATE INDEX IF NOT EXISTS boss_ability_creature_idx ON public.boss_ability (creature_id);

CREATE TABLE IF NOT EXISTS public.node_tick_log (
  id bigserial PRIMARY KEY,
  encounter_id uuid,
  tick integer,
  result_kind text,
  build_id text,
  elapsed_ms integer,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS node_tick_log_created_idx ON public.node_tick_log (created_at DESC);

-- ============================================================
-- Grants: read-only for authenticated; full access for server role.
-- No client writes anywhere: all mutation goes through server functions.
-- ============================================================
GRANT SELECT ON public.node_encounter    TO authenticated;
GRANT SELECT ON public.node_creature     TO authenticated;
GRANT SELECT ON public.node_fighter      TO authenticated;
GRANT SELECT ON public.node_effect       TO authenticated;
GRANT SELECT ON public.node_intent       TO authenticated;
GRANT SELECT ON public.node_reward_claim TO authenticated;
GRANT SELECT ON public.node_tick_batch   TO authenticated;
GRANT SELECT ON public.boss_ability      TO authenticated;

GRANT ALL ON public.node_encounter    TO service_role;
GRANT ALL ON public.node_creature     TO service_role;
GRANT ALL ON public.node_fighter      TO service_role;
GRANT ALL ON public.node_effect       TO service_role;
GRANT ALL ON public.node_intent       TO service_role;
GRANT ALL ON public.node_reward_claim TO service_role;
GRANT ALL ON public.node_tick_batch   TO service_role;
GRANT ALL ON public.boss_ability      TO service_role;
GRANT ALL ON public.node_tick_log     TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.node_fighter_entry_seq_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.node_intent_seq_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.node_tick_log_id_seq TO service_role;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.node_encounter    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_creature     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_fighter      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_effect       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_intent       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_reward_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_tick_batch   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_ability      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_tick_log     ENABLE ROW LEVEL SECURITY;

-- Helper: is the caller standing in this encounter's node?
CREATE OR REPLACE FUNCTION public.encounter_visible_to_caller(_encounter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.node_encounter e
    JOIN public.characters c ON c.current_node_id = e.node_id
    WHERE e.id = _encounter_id
      AND c.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.encounter_visible_to_caller(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_visible_to_caller(uuid) TO authenticated, service_role;

CREATE POLICY "read encounter at own node" ON public.node_encounter
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.user_id = auth.uid() AND c.current_node_id = node_encounter.node_id
  ));

CREATE POLICY "read creature state at own node" ON public.node_creature
  FOR SELECT TO authenticated
  USING (public.encounter_visible_to_caller(encounter_id));

CREATE POLICY "read fighters at own node" ON public.node_fighter
  FOR SELECT TO authenticated
  USING (public.encounter_visible_to_caller(encounter_id));

CREATE POLICY "read effects at own node" ON public.node_effect
  FOR SELECT TO authenticated
  USING (public.encounter_visible_to_caller(encounter_id));

CREATE POLICY "read batches at own node" ON public.node_tick_batch
  FOR SELECT TO authenticated
  USING (public.encounter_visible_to_caller(encounter_id));

CREATE POLICY "read own intents" ON public.node_intent
  FOR SELECT TO authenticated
  USING (public.owns_character(character_id));

CREATE POLICY "read own reward claims" ON public.node_reward_claim
  FOR SELECT TO authenticated
  USING (public.owns_character(character_id));

CREATE POLICY "read boss abilities" ON public.boss_ability
  FOR SELECT TO authenticated
  USING (true);

-- node_tick_log: no client policy at all (server-only diagnostics).

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.combat2_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS node_encounter_touch ON public.node_encounter;
CREATE TRIGGER node_encounter_touch BEFORE UPDATE ON public.node_encounter
  FOR EACH ROW EXECUTE FUNCTION public.combat2_touch_updated_at();
DROP TRIGGER IF EXISTS node_creature_touch ON public.node_creature;
CREATE TRIGGER node_creature_touch BEFORE UPDATE ON public.node_creature
  FOR EACH ROW EXECUTE FUNCTION public.combat2_touch_updated_at();
DROP TRIGGER IF EXISTS node_fighter_touch ON public.node_fighter;
CREATE TRIGGER node_fighter_touch BEFORE UPDATE ON public.node_fighter
  FOR EACH ROW EXECUTE FUNCTION public.combat2_touch_updated_at();
DROP TRIGGER IF EXISTS node_effect_touch ON public.node_effect;
CREATE TRIGGER node_effect_touch BEFORE UPDATE ON public.node_effect
  FOR EACH ROW EXECUTE FUNCTION public.combat2_touch_updated_at();
DROP TRIGGER IF EXISTS boss_ability_touch ON public.boss_ability;
CREATE TRIGGER boss_ability_touch BEFORE UPDATE ON public.boss_ability
  FOR EACH ROW EXECUTE FUNCTION public.combat2_touch_updated_at();