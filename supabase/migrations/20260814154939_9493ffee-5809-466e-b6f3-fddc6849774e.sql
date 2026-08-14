-- ── Semantic effect contract on public.active_effects ────────────────
-- `active_effects` is the ONE authority for combat state that must survive a
-- tick boundary. `characters.reserved_buffs` / `characters.stance_state` stay
-- strictly stance-activation and CP-reservation bookkeeping.

ALTER TABLE public.active_effects
  ADD COLUMN IF NOT EXISTS mechanic       text,
  ADD COLUMN IF NOT EXISTS magnitude      numeric,
  ADD COLUMN IF NOT EXISTS remaining      numeric,
  ADD COLUMN IF NOT EXISTS params         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS params_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.active_effects.mechanic IS
  'Closed vocabulary of semantic effect mechanics (see pure/effect-contract.ts). NULL = legacy periodic damage row.';
COMMENT ON COLUMN public.active_effects.magnitude IS
  'Immutable scalar payload set at application time (shield pool, mitigation amount, dodge chance, ...).';
COMMENT ON COLUMN public.active_effects.remaining IS
  'Mutable pool/charge state rewritten every tick (unspent absorb HP, remaining charges). NULL when the mechanic has none.';
COMMENT ON COLUMN public.active_effects.params IS
  'Mechanic-scoped, validated parameters only. Never a free-form escape hatch: unknown keys fail closed.';

-- Row-level fail-closed validation. Mirrors the TypeScript registry.
CREATE OR REPLACE FUNCTION public.validate_active_effect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed_mechanics text[] := ARRAY[
    'absorb_buff','mitigation_buff','offense_buff','stealth_buff','block_buff',
    'evasion_buff','reactive_holy','regen_buff','party_regen','aura_pulse',
    'stack_apply','dot_debuff','control_debuff'
  ];
BEGIN
  IF NEW.mechanic IS NOT NULL AND NOT (NEW.mechanic = ANY (allowed_mechanics)) THEN
    RAISE EXCEPTION 'active_effects.mechanic: unknown mechanic %', NEW.mechanic
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.params IS NULL OR jsonb_typeof(NEW.params) <> 'object' THEN
    RAISE EXCEPTION 'active_effects.params: must be a JSON object';
  END IF;

  IF NEW.mechanic IS NULL AND NEW.params <> '{}'::jsonb THEN
    RAISE EXCEPTION 'active_effects.params: params require a registered mechanic';
  END IF;

  IF NEW.params_version <> 1 THEN
    RAISE EXCEPTION 'active_effects.params_version: unsupported version %', NEW.params_version;
  END IF;

  IF NEW.magnitude IS NOT NULL AND (NEW.magnitude < 0 OR NEW.magnitude > 1000000) THEN
    RAISE EXCEPTION 'active_effects.magnitude: out of bounds (%)', NEW.magnitude;
  END IF;

  IF NEW.remaining IS NOT NULL AND (NEW.remaining < 0 OR NEW.remaining > 1000000) THEN
    RAISE EXCEPTION 'active_effects.remaining: out of bounds (%)', NEW.remaining;
  END IF;

  IF NEW.stacks IS NOT NULL AND (NEW.stacks < 0 OR NEW.stacks > 99) THEN
    RAISE EXCEPTION 'active_effects.stacks: out of bounds (%)', NEW.stacks;
  END IF;

  -- Friendly, character-targeted semantic state must carry its source.
  IF NEW.mechanic IS NOT NULL
     AND NEW.mechanic IN ('absorb_buff','mitigation_buff','offense_buff','stealth_buff',
                          'block_buff','evasion_buff','reactive_holy','regen_buff',
                          'party_regen','aura_pulse','stack_apply')
     AND NEW.source_id IS NULL THEN
    RAISE EXCEPTION 'active_effects.source_id: required for mechanic %', NEW.mechanic;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_active_effect_trg ON public.active_effects;
CREATE TRIGGER validate_active_effect_trg
  BEFORE INSERT OR UPDATE ON public.active_effects
  FOR EACH ROW EXECUTE FUNCTION public.validate_active_effect();

-- Runtime-only in-fight rows are incompatible with the new contract and are
-- never backfilled with invented semantics. Combat is in maintenance.
DELETE FROM public.active_effects;
