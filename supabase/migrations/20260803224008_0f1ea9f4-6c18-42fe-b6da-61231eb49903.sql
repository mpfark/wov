-- 1. Assignment overrides ---------------------------------------------------
ALTER TABLE public.class_ability_assignments
  ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Explicit class attribute identity ---------------------------------------
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS primary_attribute text,
  ADD COLUMN IF NOT EXISTS secondary_attribute text;

CREATE OR REPLACE FUNCTION public.validate_class_attributes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.primary_attribute IS NOT NULL
     AND NEW.primary_attribute NOT IN ('str','dex','con','int','wis','cha') THEN
    RAISE EXCEPTION 'invalid primary_attribute "%"', NEW.primary_attribute;
  END IF;
  IF NEW.secondary_attribute IS NOT NULL
     AND NEW.secondary_attribute NOT IN ('str','dex','con','int','wis','cha') THEN
    RAISE EXCEPTION 'invalid secondary_attribute "%"', NEW.secondary_attribute;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_class_attributes_trg ON public.classes;
CREATE TRIGGER validate_class_attributes_trg
  BEFORE INSERT OR UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.validate_class_attributes();

-- Backfill: annotation only, matching the attributes current formulas use.
UPDATE public.classes SET primary_attribute = 'str', secondary_attribute = 'dex' WHERE class_key = 'warrior';
UPDATE public.classes SET primary_attribute = 'int', secondary_attribute = NULL  WHERE class_key = 'wizard';
UPDATE public.classes SET primary_attribute = 'dex', secondary_attribute = 'wis' WHERE class_key = 'ranger';
UPDATE public.classes SET primary_attribute = 'dex', secondary_attribute = 'cha' WHERE class_key = 'assassin';
UPDATE public.classes SET primary_attribute = 'wis', secondary_attribute = 'con' WHERE class_key = 'healer';
UPDATE public.classes SET primary_attribute = 'cha', secondary_attribute = 'int' WHERE class_key = 'bard';
UPDATE public.classes SET primary_attribute = 'wis', secondary_attribute = 'con' WHERE class_key = 'templar';

-- 3. Structural validation for assignment overrides -------------------------
CREATE OR REPLACE FUNCTION public.validate_assignment_overrides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  sk text;
  sv text;
  tv jsonb;
BEGIN
  IF NEW.overrides IS NULL OR jsonb_typeof(NEW.overrides) <> 'object' THEN
    RAISE EXCEPTION 'overrides must be a JSON object';
  END IF;

  FOR k IN SELECT jsonb_object_keys(NEW.overrides) LOOP
    IF k NOT IN ('label','description','tooltip','combat_text','scaling','mechanic_calcs') THEN
      RAISE EXCEPTION 'overrides.%: not an overridable field', k;
    END IF;
  END LOOP;

  FOR k IN SELECT unnest(ARRAY['label','description','tooltip']) LOOP
    IF NEW.overrides ? k THEN
      IF jsonb_typeof(NEW.overrides -> k) <> 'string' THEN
        RAISE EXCEPTION 'overrides.% must be a string', k;
      END IF;
      IF length(NEW.overrides ->> k) > 500 THEN
        RAISE EXCEPTION 'overrides.% exceeds 500 characters', k;
      END IF;
    END IF;
  END LOOP;

  IF NEW.overrides ? 'scaling' THEN
    IF jsonb_typeof(NEW.overrides -> 'scaling') <> 'object' THEN
      RAISE EXCEPTION 'overrides.scaling must be a JSON object';
    END IF;
    FOR sk IN SELECT jsonb_object_keys(NEW.overrides -> 'scaling') LOOP
      IF sk NOT IN ('primary_attribute','secondary_attribute') THEN
        RAISE EXCEPTION 'overrides.scaling.%: only primary_attribute and secondary_attribute are allowed', sk;
      END IF;
      sv := NEW.overrides -> 'scaling' ->> sk;
      IF sv IS NULL OR sv NOT IN ('str','dex','con','int','wis','cha') THEN
        RAISE EXCEPTION 'overrides.scaling.%: invalid attribute "%"', sk, sv;
      END IF;
    END LOOP;
  END IF;

  IF NEW.overrides ? 'combat_text' THEN
    IF jsonb_typeof(NEW.overrides -> 'combat_text') <> 'object' THEN
      RAISE EXCEPTION 'overrides.combat_text must be a JSON object';
    END IF;
    FOR sk IN SELECT jsonb_object_keys(NEW.overrides -> 'combat_text') LOOP
      tv := NEW.overrides -> 'combat_text' -> sk;
      IF jsonb_typeof(tv) = 'string' THEN
        IF length(tv #>> '{}') > 500 THEN
          RAISE EXCEPTION 'overrides.combat_text.% exceeds 500 characters', sk;
        END IF;
      ELSIF jsonb_typeof(tv) = 'array' THEN
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements(tv) e
          WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') > 500
        ) THEN
          RAISE EXCEPTION 'overrides.combat_text.%: array entries must be strings up to 500 characters', sk;
        END IF;
      ELSE
        RAISE EXCEPTION 'overrides.combat_text.% must be a string or array of strings', sk;
      END IF;
    END LOOP;
  END IF;

  IF NEW.overrides ? 'mechanic_calcs' THEN
    IF jsonb_typeof(NEW.overrides -> 'mechanic_calcs') <> 'object' THEN
      RAISE EXCEPTION 'overrides.mechanic_calcs must be a JSON object';
    END IF;
    FOR sk IN SELECT jsonb_object_keys(NEW.overrides -> 'mechanic_calcs') LOOP
      IF sk IN ('amount_calc','duration_calc','interval_ms','cp_cost',
                'primary_coefficient','secondary_coefficient') THEN
        RAISE EXCEPTION 'overrides.mechanic_calcs.%: whole-formula and cost overrides are not permitted', sk;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_assignment_overrides_trg ON public.class_ability_assignments;
CREATE TRIGGER validate_assignment_overrides_trg
  BEFORE INSERT OR UPDATE ON public.class_ability_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_assignment_overrides();

-- 4. Canonical identity protection on abilities -----------------------------
CREATE OR REPLACE FUNCTION public.guard_ability_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ability_key IS DISTINCT FROM OLD.ability_key THEN
    RAISE EXCEPTION 'ability_key is immutable ("%" cannot be renamed to "%")',
      OLD.ability_key, NEW.ability_key;
  END IF;

  IF NEW.mechanic_key IS DISTINCT FROM OLD.mechanic_key THEN
    IF OLD.status = 'active' THEN
      RAISE EXCEPTION 'cannot change mechanic_key of active ability "%": retire it first', OLD.ability_key;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.class_ability_assignments a
      WHERE a.ability_id = OLD.id AND a.status <> 'retired'
    ) THEN
      RAISE EXCEPTION 'cannot change mechanic_key of ability "%": it is still assigned to a class slot', OLD.ability_key;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ability_identity_trg ON public.abilities;
CREATE TRIGGER guard_ability_identity_trg
  BEFORE UPDATE ON public.abilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_ability_identity();

-- 5. Frost Bolt authored cast text ------------------------------------------
UPDATE public.abilities
SET combat_text = jsonb_build_object(
  'cast', jsonb_build_array(
    'Frost gathers into a jagged shard above your palm, angled at {target}…',
    'The air whitens and cracks as you shape a lance of ice for {target}…'
  )
)
WHERE ability_key = 'frost_bolt';