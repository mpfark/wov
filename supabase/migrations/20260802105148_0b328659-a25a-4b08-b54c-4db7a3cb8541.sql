ALTER TABLE public.active_effects
  ADD COLUMN IF NOT EXISTS source_ability_key text;

COMMENT ON COLUMN public.active_effects.source_ability_key IS
  'Canonical abilities.ability_key that created this effect. Nullable: legacy rows and non-ability effects have no source ability.';

CREATE OR REPLACE FUNCTION public.ability_mechanic_params()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '{
    "power_strike": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "aimed_shot": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "backstab": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "fireball": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "smite": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "cutting_words": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "consecrate": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "poison_buff": {"allowed": ["max_stacks"], "required": ["max_stacks"], "requires": ["amount"], "supports": ["amount"]},
    "execute_attack": {"allowed": ["per_stack_multiplier"], "required": ["per_stack_multiplier"], "requires": ["amount"], "supports": ["amount"]},
    "ignite_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "ignite_consume": {"allowed": ["per_stack_multiplier"], "required": ["per_stack_multiplier"], "requires": ["amount"], "supports": ["amount"]},
    "multi_attack": {"allowed": ["arrow_count"], "required": ["arrow_count"], "requires": ["amount"], "supports": ["amount"]},
    "burst_damage": {"allowed": ["crit_edge"], "required": ["crit_edge"], "requires": ["amount"], "supports": ["amount"]},
    "battle_cry": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "absorb_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "ally_absorb": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "damage_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "crit_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "block_buff": {"allowed": ["block_chance", "block_amount"], "required": ["block_chance", "block_amount"], "requires": [], "supports": ["amount", "duration"]},
    "reactive_holy": {"allowed": ["retaliation_damage"], "required": ["retaliation_damage"], "requires": [], "supports": ["amount", "duration"]},
    "mitigation_buff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "evasion_buff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "stealth_buff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "disengage_buff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "root_debuff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "sunder_debuff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "dot_debuff": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "heal": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "self_heal": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "hp_transfer": {"allowed": ["reserve_hp"], "required": ["reserve_hp"], "requires": ["amount"], "supports": ["amount"]},
    "party_regen": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "regen_buff": {"allowed": ["cp_per_tick"], "required": ["cp_per_tick"], "requires": ["amount", "duration"], "supports": ["amount", "duration"]}
  }'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.validate_ability_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  spec jsonb;
  allowed jsonb;
  required jsonb;
  requires jsonb;
  supports jsonb;
  param text;
  err text;
BEGIN
  IF NEW.mechanic_calcs IS NULL OR jsonb_typeof(NEW.mechanic_calcs) <> 'object' THEN
    RAISE EXCEPTION 'mechanic_calcs must be a JSON object';
  END IF;

  err := public.validate_ability_calc(NEW.amount_calc, 'amount_calc');
  IF err IS NOT NULL THEN RAISE EXCEPTION '%', err; END IF;
  err := public.validate_ability_calc(NEW.duration_calc, 'duration_calc');
  IF err IS NOT NULL THEN RAISE EXCEPTION '%', err; END IF;

  spec := public.ability_mechanic_params() -> NEW.mechanic_key;
  IF spec IS NULL THEN
    RAISE EXCEPTION 'unknown mechanic key "%"', NEW.mechanic_key;
  END IF;
  allowed  := spec -> 'allowed';
  required := spec -> 'required';
  requires := spec -> 'requires';
  supports := spec -> 'supports';

  FOR param IN SELECT jsonb_object_keys(NEW.mechanic_calcs) LOOP
    IF NOT (allowed @> to_jsonb(param)) THEN
      RAISE EXCEPTION 'mechanic_calcs.%: not a parameter of mechanic "%"', param, NEW.mechanic_key;
    END IF;
    err := public.validate_ability_calc(NEW.mechanic_calcs -> param, 'mechanic_calcs.' || param);
    IF err IS NOT NULL THEN RAISE EXCEPTION '%', err; END IF;
  END LOOP;

  IF NEW.amount_calc IS NOT NULL AND NOT (supports @> '["amount"]'::jsonb) THEN
    RAISE EXCEPTION 'mechanic "%" does not use amount_calc', NEW.mechanic_key;
  END IF;
  IF NEW.duration_calc IS NOT NULL AND NOT (supports @> '["duration"]'::jsonb) THEN
    RAISE EXCEPTION 'mechanic "%" does not use duration_calc', NEW.mechanic_key;
  END IF;
  IF NEW.interval_ms IS NOT NULL AND NOT (supports @> '["interval"]'::jsonb) THEN
    RAISE EXCEPTION 'mechanic "%" does not use interval_ms', NEW.mechanic_key;
  END IF;

  IF NEW.status = 'active' THEN
    FOR param IN SELECT jsonb_array_elements_text(required) LOOP
      IF NOT (NEW.mechanic_calcs ? param) THEN
        RAISE EXCEPTION 'cannot activate "%": mechanic_calcs.% is required for mechanic "%"',
          NEW.ability_key, param, NEW.mechanic_key;
      END IF;
    END LOOP;

    IF (requires @> '["amount"]'::jsonb) AND NEW.amount_calc IS NULL THEN
      RAISE EXCEPTION 'cannot activate "%": mechanic "%" requires amount_calc',
        NEW.ability_key, NEW.mechanic_key;
    END IF;
    IF (requires @> '["duration"]'::jsonb) AND NEW.duration_calc IS NULL THEN
      RAISE EXCEPTION 'cannot activate "%": mechanic "%" requires duration_calc',
        NEW.ability_key, NEW.mechanic_key;
    END IF;
    IF (requires @> '["interval"]'::jsonb) AND (NEW.interval_ms IS NULL OR NEW.interval_ms <= 0) THEN
      RAISE EXCEPTION 'cannot activate "%": mechanic "%" requires interval_ms',
        NEW.ability_key, NEW.mechanic_key;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;