-- ── Phase 1: per-class ability identity ────────────────────────────────
ALTER TABLE public.class_ability_assignments
  ADD COLUMN IF NOT EXISTS class_ability_key text;

UPDATE public.class_ability_assignments caa
SET class_ability_key = a.ability_key
FROM public.abilities a
WHERE a.id = caa.ability_id AND caa.class_ability_key IS NULL;

ALTER TABLE public.class_ability_assignments
  ALTER COLUMN class_ability_key SET NOT NULL;

ALTER TABLE public.class_ability_assignments
  DROP CONSTRAINT IF EXISTS class_ability_key_format;
ALTER TABLE public.class_ability_assignments
  ADD CONSTRAINT class_ability_key_format
  CHECK (class_ability_key ~ '^[a-z][a-z0-9_]*$');

CREATE UNIQUE INDEX IF NOT EXISTS class_ability_assignments_class_key_identity
  ON public.class_ability_assignments (class_key, class_ability_key)
  WHERE status = 'active';

-- ── Phase 2: controlled optional On-Hit Effect ─────────────────────────
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
  oh jsonb;
  allowed jsonb;
BEGIN
  IF NEW.overrides IS NULL OR jsonb_typeof(NEW.overrides) <> 'object' THEN
    RAISE EXCEPTION 'overrides must be a JSON object';
  END IF;

  FOR k IN SELECT jsonb_object_keys(NEW.overrides) LOOP
    IF k NOT IN ('label','description','tooltip','combat_text','scaling','mechanic_calcs','on_hit_effect') THEN
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

  -- On-Hit Effect: at most one, only from the base ability's allowlist.
  IF NEW.overrides ? 'on_hit_effect' THEN
    oh := NEW.overrides -> 'on_hit_effect';
    IF jsonb_typeof(oh) <> 'object' THEN
      RAISE EXCEPTION 'overrides.on_hit_effect must be a JSON object';
    END IF;
    FOR sk IN SELECT jsonb_object_keys(oh) LOOP
      IF sk NOT IN ('effect','chance_pct','duration_ms','damage_per_tick','max_stacks') THEN
        RAISE EXCEPTION 'overrides.on_hit_effect.%: unknown field', sk;
      END IF;
    END LOOP;

    sv := oh ->> 'effect';
    IF sv IS NULL OR sv NOT IN ('bleed','poison','ignite') THEN
      RAISE EXCEPTION 'overrides.on_hit_effect.effect: invalid effect "%"', coalesce(sv, 'null');
    END IF;

    SELECT a.effect_config -> 'on_hit_allowed' INTO allowed
    FROM public.abilities a WHERE a.id = NEW.ability_id;
    IF allowed IS NULL OR jsonb_typeof(allowed) <> 'array'
       OR NOT (allowed @> to_jsonb(ARRAY[sv])) THEN
      RAISE EXCEPTION 'overrides.on_hit_effect.effect: base ability does not allow on-hit effect "%"', sv;
    END IF;

    IF jsonb_typeof(oh -> 'chance_pct') <> 'number'
       OR (oh ->> 'chance_pct')::numeric < 1 OR (oh ->> 'chance_pct')::numeric > 100 THEN
      RAISE EXCEPTION 'overrides.on_hit_effect.chance_pct must be a number between 1 and 100';
    END IF;
    IF jsonb_typeof(oh -> 'duration_ms') <> 'number'
       OR (oh ->> 'duration_ms')::numeric < 1000 OR (oh ->> 'duration_ms')::numeric > 60000 THEN
      RAISE EXCEPTION 'overrides.on_hit_effect.duration_ms must be a number between 1000 and 60000';
    END IF;
    IF oh ? 'damage_per_tick' THEN
      IF jsonb_typeof(oh -> 'damage_per_tick') <> 'number'
         OR (oh ->> 'damage_per_tick')::numeric < 0 OR (oh ->> 'damage_per_tick')::numeric > 200 THEN
        RAISE EXCEPTION 'overrides.on_hit_effect.damage_per_tick must be a number between 0 and 200';
      END IF;
    END IF;
    IF oh ? 'max_stacks' THEN
      IF jsonb_typeof(oh -> 'max_stacks') <> 'number'
         OR (oh ->> 'max_stacks')::numeric < 1 OR (oh ->> 'max_stacks')::numeric > 10 THEN
        RAISE EXCEPTION 'overrides.on_hit_effect.max_stacks must be a number between 1 and 10';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;