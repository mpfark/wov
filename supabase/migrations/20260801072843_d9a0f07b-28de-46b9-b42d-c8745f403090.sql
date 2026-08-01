-- ── Checkpoint 4: schema for configurable ability calculations ────────────────

ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS mechanic_calcs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS calc_version smallint NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.abilities.mechanic_calcs IS
  'Named typed mechanic calculations: { <param_key>: AbilityCalcV2 }. Allowed keys per mechanic come from public.ability_mechanic_params().';
COMMENT ON COLUMN public.abilities.calc_version IS
  'Ability calculation contract version. 2 = current (dice/context terms, finalMult, multiplierCalc).';

-- Allowed + required named mechanic params per mechanic key.
-- Mirrors src/shared/config/mechanic-templates.ts.
CREATE OR REPLACE FUNCTION public.ability_mechanic_params()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '{
    "power_strike":     {"allowed": [], "required": []},
    "aimed_shot":       {"allowed": [], "required": []},
    "backstab":         {"allowed": [], "required": []},
    "fireball":         {"allowed": [], "required": []},
    "cutting_words":    {"allowed": [], "required": []},
    "smite":            {"allowed": ["final_multiplier"], "required": []},
    "consecrate":       {"allowed": ["final_multiplier"], "required": []},
    "poison_buff":      {"allowed": ["proc_chance","max_stacks","stacks_applied"], "required": []},
    "execute_attack":   {"allowed": ["per_stack_multiplier"], "required": []},
    "ignite_buff":      {"allowed": ["orb_chance"], "required": []},
    "ignite_consume":   {"allowed": ["per_stack_multiplier"], "required": []},
    "multi_attack":     {"allowed": ["arrow_count","per_arrow_multiplier"], "required": ["arrow_count"]},
    "burst_damage":     {"allowed": ["crit_edge"], "required": []},
    "battle_cry":       {"allowed": ["damage_reduction","crit_reduction"], "required": []},
    "absorb_buff":      {"allowed": [], "required": []},
    "ally_absorb":      {"allowed": [], "required": []},
    "damage_buff":      {"allowed": ["damage_multiplier"], "required": []},
    "crit_buff":        {"allowed": [], "required": []},
    "block_buff":       {"allowed": ["block_chance","block_amount"], "required": []},
    "reactive_holy":    {"allowed": ["retaliation_damage"], "required": []},
    "mitigation_buff":  {"allowed": ["flat_reduction"], "required": []},
    "evasion_buff":     {"allowed": ["dodge_chance"], "required": []},
    "stealth_buff":     {"allowed": ["damage_multiplier"], "required": []},
    "disengage_buff":   {"allowed": ["damage_multiplier"], "required": []},
    "root_debuff":      {"allowed": ["root_reduction"], "required": []},
    "sunder_debuff":    {"allowed": [], "required": []},
    "dot_debuff":       {"allowed": [], "required": []},
    "heal":             {"allowed": [], "required": []},
    "self_heal":        {"allowed": [], "required": []},
    "hp_transfer":      {"allowed": ["reserve_hp"], "required": []},
    "party_regen":      {"allowed": ["regen_per_tick","cp_per_tick"], "required": []},
    "regen_buff":       {"allowed": ["regen_per_tick","cp_per_tick"], "required": []}
  }'::jsonb;
$$;

-- Structural validation of one AbilityCalcV2 object. Returns an error string, or NULL when valid.
CREATE OR REPLACE FUNCTION public.validate_ability_calc(_calc jsonb, _label text, _depth int DEFAULT 0)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  term jsonb;
  src text;
  nested text;
BEGIN
  IF _calc IS NULL OR _calc = 'null'::jsonb THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_calc) <> 'object' THEN
    RETURN _label || ': must be an object';
  END IF;
  IF _depth > 2 THEN
    RETURN _label || ': nesting depth above 2 is not allowed';
  END IF;
  IF jsonb_typeof(_calc -> 'base') <> 'number' THEN
    RETURN _label || ': base must be a number';
  END IF;
  IF jsonb_typeof(_calc -> 'terms') <> 'array' THEN
    RETURN _label || ': terms must be an array';
  END IF;
  IF jsonb_array_length(_calc -> 'terms') > 12 THEN
    RETURN _label || ': no more than 12 terms are allowed';
  END IF;
  IF (_calc ? 'finalMult') AND (_calc ? 'postMult') THEN
    RETURN _label || ': use finalMult only (postMult is the legacy spelling)';
  END IF;

  FOR term IN SELECT * FROM jsonb_array_elements(_calc -> 'terms') LOOP
    src := term ->> 'source';
    IF src IS NULL OR src NOT IN ('const','stat','level','stat_threshold','dice','context') THEN
      RETURN _label || ': unknown term source ' || coalesce(src, 'null');
    END IF;
    IF src IN ('stat','stat_threshold')
       AND coalesce(term ->> 'stat','') NOT IN ('str','dex','con','int','wis','cha') THEN
      RETURN _label || ': term source ' || src || ' requires a valid stat';
    END IF;
    IF src = 'stat_threshold'
       AND (jsonb_typeof(term -> 'steps') <> 'array' OR jsonb_array_length(term -> 'steps') = 0) THEN
      RETURN _label || ': stat_threshold requires at least one step';
    END IF;
    IF src = 'dice' THEN
      IF (term ? 'die') AND (term ->> 'die') NOT IN ('weapon_main','d4','d6','d8','d10','d12') THEN
        RETURN _label || ': unknown die ' || (term ->> 'die');
      END IF;
      IF (term ? 'count') AND (coalesce((term ->> 'count')::numeric, 0) < 1
                               OR coalesce((term ->> 'count')::numeric, 0) > 20) THEN
        RETURN _label || ': dice count must be between 1 and 20';
      END IF;
    END IF;
    IF src = 'context'
       AND coalesce(term ->> 'contextKey','') NOT IN ('active_stacks','consumed_stacks') THEN
      RETURN _label || ': unknown context key ' || coalesce(term ->> 'contextKey','null');
    END IF;
  END LOOP;

  IF _calc ? 'multiplierCalc' THEN
    nested := public.validate_ability_calc(_calc -> 'multiplierCalc', _label || '.multiplierCalc', _depth + 1);
    IF nested IS NOT NULL THEN
      RETURN nested;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Row-level validation + publish gating.
CREATE OR REPLACE FUNCTION public.validate_ability_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  spec jsonb;
  allowed jsonb;
  required jsonb;
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
  allowed := spec -> 'allowed';
  required := spec -> 'required';

  FOR param IN SELECT jsonb_object_keys(NEW.mechanic_calcs) LOOP
    IF NOT (allowed @> to_jsonb(param)) THEN
      RAISE EXCEPTION 'mechanic_calcs.%: not a parameter of mechanic "%"', param, NEW.mechanic_key;
    END IF;
    err := public.validate_ability_calc(NEW.mechanic_calcs -> param, 'mechanic_calcs.' || param);
    IF err IS NOT NULL THEN RAISE EXCEPTION '%', err; END IF;
  END LOOP;

  -- Publish gate: an active row must carry every required mechanic calc.
  IF NEW.status = 'active' THEN
    FOR param IN SELECT jsonb_array_elements_text(required) LOOP
      IF NOT (NEW.mechanic_calcs ? param) THEN
        RAISE EXCEPTION 'cannot activate "%": mechanic_calcs.% is required for mechanic "%"',
          NEW.ability_key, param, NEW.mechanic_key;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_ability_row_trg ON public.abilities;
CREATE TRIGGER validate_ability_row_trg
  BEFORE INSERT OR UPDATE ON public.abilities
  FOR EACH ROW EXECUTE FUNCTION public.validate_ability_row();