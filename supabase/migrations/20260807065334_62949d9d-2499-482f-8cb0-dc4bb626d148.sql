-- 1. applied_statuses: damage-amplification support
ALTER TABLE public.applied_statuses
  ADD COLUMN IF NOT EXISTS modifier jsonb;

ALTER TABLE public.applied_statuses
  ADD COLUMN IF NOT EXISTS is_periodic boolean
  GENERATED ALWAYS AS (classification = 'dot') STORED;

CREATE OR REPLACE FUNCTION public.validate_applied_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_value numeric;
  v_sources jsonb;
BEGIN
  IF NEW.classification = 'dot' THEN
    IF NEW.magnitude IS NULL OR NEW.magnitude = '{}'::jsonb THEN
      RAISE EXCEPTION 'dot statuses require magnitude';
    END IF;
    IF NEW.modifier IS NOT NULL THEN
      RAISE EXCEPTION 'dot statuses must not define modifier';
    END IF;
  ELSIF NEW.classification = 'damage_amp' THEN
    IF NEW.modifier IS NULL THEN
      RAISE EXCEPTION 'damage_amp statuses require modifier';
    END IF;
    v_kind := NEW.modifier->>'kind';
    IF v_kind IS DISTINCT FROM 'damage_taken_pct' THEN
      RAISE EXCEPTION 'unsupported modifier kind: %', v_kind;
    END IF;
    BEGIN
      v_value := (NEW.modifier->>'value')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'modifier.value must be numeric';
    END;
    IF v_value IS NULL OR v_value <= 0 OR v_value <> trunc(v_value) THEN
      RAISE EXCEPTION 'modifier.value must be a positive integer percent';
    END IF;
    v_sources := NEW.modifier->'eligible_sources';
    IF v_sources IS NULL OR jsonb_typeof(v_sources) <> 'array' OR jsonb_array_length(v_sources) = 0 THEN
      RAISE EXCEPTION 'modifier.eligible_sources must be a non-empty array';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_sources) s
      WHERE s IN ('reflect', 'self', 'environment')
    ) THEN
      RAISE EXCEPTION 'reflect, self and environment damage can never be amplified';
    END IF;
    IF NEW.tick_interval_ms IS NOT NULL THEN
      RAISE EXCEPTION 'damage_amp statuses must not define a tick interval';
    END IF;
    IF NEW.magnitude IS NOT NULL AND NEW.magnitude <> '{}'::jsonb AND NEW.magnitude <> 'null'::jsonb THEN
      RAISE EXCEPTION 'damage_amp statuses must not define periodic magnitude';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_applied_status ON public.applied_statuses;
CREATE TRIGGER trg_validate_applied_status
  BEFORE INSERT OR UPDATE ON public.applied_statuses
  FOR EACH ROW EXECUTE FUNCTION public.validate_applied_status();

-- 2. active_effects: non-periodic representation + activation window
ALTER TABLE public.active_effects
  ALTER COLUMN next_tick_at DROP NOT NULL;

ALTER TABLE public.active_effects
  ADD COLUMN IF NOT EXISTS started_at bigint;

-- 3. Seed the reusable Chilled status
INSERT INTO public.applied_statuses (
  key, label, effect_type, classification, stack_noun,
  tick_interval_ms, magnitude, duration, stacks, modifier,
  default_damage_type, admin_notes
) VALUES (
  'chilled', 'Chilled', 'chilled', 'damage_amp', 'chill',
  NULL, '{}'::jsonb,
  '{"duration_ticks": 3, "role": null}'::jsonb,
  '{"max_stacks_calc": {"base": 1, "terms": [], "unit": "count"}}'::jsonb,
  '{"kind": "damage_taken_pct", "value": 10, "eligible_sources": ["weapon","ability","stance","dot","proc"]}'::jsonb,
  NULL,
  'Reusable damage-amplification debuff. Duration is authoritative as combat ticks.'
)
ON CONFLICT (key) DO UPDATE SET
  classification = EXCLUDED.classification,
  modifier = EXCLUDED.modifier,
  duration = EXCLUDED.duration,
  stacks = EXCLUDED.stacks,
  tick_interval_ms = NULL,
  magnitude = '{}'::jsonb,
  updated_at = now();

-- 4. Frost Bolt applies Chilled on a successful hit
UPDATE public.abilities
   SET applied_status = 'chilled', updated_at = now()
 WHERE ability_key = 'frost_bolt';