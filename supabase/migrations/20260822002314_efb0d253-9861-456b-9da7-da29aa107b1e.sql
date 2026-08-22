-- Publish gate: roll-based mechanics must nominate an accuracy attribute;
-- automatic mechanics must not carry one. Also keep effect_config in sync.
CREATE OR REPLACE FUNCTION public.ability_roll_based_mechanics()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT ARRAY['weapon_attack','spell_attack','multi_attack','burst_damage','stack_consume']::text[]
$$;

REVOKE ALL ON FUNCTION public.ability_roll_based_mechanics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ability_roll_based_mechanics() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_ability_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  spec jsonb;
  allowed jsonb;
  required jsonb;
  requires jsonb;
  supports jsonb;
  param text;
  err text;
  is_damaging boolean;
  rolls boolean;
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

  -- Accuracy policy: roll-based mechanics own an explicit accuracy attribute.
  rolls := NEW.mechanic_key = ANY (public.ability_roll_based_mechanics());
  IF NOT rolls AND NEW.accuracy_stat IS NOT NULL THEN
    RAISE EXCEPTION 'mechanic "%" does not roll to hit and must not set accuracy_stat',
      NEW.mechanic_key;
  END IF;

  -- Keep effect_config.accuracy_stat (what the combat loader reads) in sync.
  IF NEW.accuracy_stat IS NOT NULL THEN
    NEW.effect_config := COALESCE(NEW.effect_config, '{}'::jsonb)
      || jsonb_build_object('accuracy_stat', NEW.accuracy_stat);
  ELSIF NEW.effect_config ? 'accuracy_stat' THEN
    NEW.effect_config := NEW.effect_config - 'accuracy_stat';
  END IF;

  -- Damage-type classification (Phase 1).
  IF NEW.damage_type IS NOT NULL
     AND NOT (NEW.damage_type = ANY (public.ability_damage_type_keys())) THEN
    RAISE EXCEPTION 'unknown damage_type "%" on ability "%"', NEW.damage_type, NEW.ability_key;
  END IF;

  is_damaging := NEW.ability_type = 'damage'
    OR NEW.mechanic_key = ANY (public.ability_damaging_mechanics());

  IF NEW.status = 'active' THEN
    IF rolls AND NEW.accuracy_stat IS NULL THEN
      RAISE EXCEPTION 'cannot activate "%": roll-based mechanic "%" requires accuracy_stat',
        NEW.ability_key, NEW.mechanic_key;
    END IF;

    IF is_damaging AND NEW.damage_type IS NULL THEN
      RAISE EXCEPTION 'cannot activate "%": damaging mechanic "%" requires a damage_type',
        NEW.ability_key, NEW.mechanic_key;
    END IF;
    IF NOT is_damaging
       AND NEW.ability_type IN ('heal','buff')
       AND NEW.damage_type IS NOT NULL THEN
      RAISE EXCEPTION 'cannot activate "%": non-damaging % must not have a damage_type',
        NEW.ability_key, NEW.ability_type;
    END IF;

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
$function$;