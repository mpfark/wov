-- Separate reusable mechanical templates from class-facing ability identity.
-- Existing abilities receive a one-to-one template first; admins can merge
-- templates deliberately later without changing any canonical ability keys.

CREATE TABLE public.ability_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  mechanic_key text NOT NULL,
  ability_type text NOT NULL DEFAULT 'damage',
  target_type text NOT NULL DEFAULT 'enemy',
  activation_mode text NOT NULL DEFAULT 'instant',
  cp_cost integer NOT NULL DEFAULT 0,
  cp_reserve_pct numeric,
  amount_calc jsonb,
  duration_calc jsonb,
  interval_ms integer,
  effect_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  mechanic_calcs jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_overrides jsonb NOT NULL DEFAULT '["label","description","tooltip","combat_text","damage_type","scaling_attribute","class_scale"]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ability_templates_key_chk CHECK (template_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  CONSTRAINT ability_templates_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT ability_templates_activation_chk CHECK (activation_mode IN ('instant','queued','stance')),
  CONSTRAINT ability_templates_target_chk CHECK (target_type IN ('self','enemy','ally','party','node')),
  CONSTRAINT ability_templates_overrides_array_chk CHECK (jsonb_typeof(allowed_overrides) = 'array')
);

GRANT SELECT ON public.ability_templates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ability_templates TO authenticated;
GRANT ALL ON public.ability_templates TO service_role;
ALTER TABLE public.ability_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ability_templates_public_read" ON public.ability_templates FOR SELECT USING (true);
CREATE POLICY "ability_templates_overlord_write" ON public.ability_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'overlord'::app_role));
CREATE TRIGGER ability_templates_updated_at BEFORE UPDATE ON public.ability_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.ability_templates (
  template_key, name, description, mechanic_key, ability_type, target_type,
  activation_mode, cp_cost, cp_reserve_pct, amount_calc, duration_calc,
  interval_ms, effect_config, mechanic_calcs, status, admin_notes
)
SELECT
  ability_key, label || ' template', 'Mechanical template migrated from ' || label,
  mechanic_key, ability_type, target_type, activation_mode, cp_cost,
  cp_reserve_pct, amount_calc, duration_calc, interval_ms, effect_config,
  mechanic_calcs, status, admin_notes
FROM public.abilities;

ALTER TABLE public.abilities
  ADD COLUMN template_id uuid REFERENCES public.ability_templates(id) ON DELETE RESTRICT;

UPDATE public.abilities a
SET template_id = t.id
FROM public.ability_templates t
WHERE t.template_key = a.ability_key;

ALTER TABLE public.abilities ALTER COLUMN template_id SET NOT NULL;
CREATE INDEX abilities_template_id_idx ON public.abilities(template_id);

ALTER TABLE public.class_ability_assignments
  ADD COLUMN class_scale numeric NOT NULL DEFAULT 1,
  ADD CONSTRAINT caa_class_scale_chk CHECK (class_scale > 0 AND class_scale <= 10);

-- Move the two existing class balance riders out of the shared formula.
UPDATE public.class_ability_assignments caa
SET class_scale = CASE a.ability_key
  WHEN 'judgment' THEN 0.8
  WHEN 'consecrate' THEN 0.65
  ELSE 1
END
FROM public.abilities a
WHERE a.id = caa.ability_id;

UPDATE public.ability_templates
SET amount_calc = amount_calc - 'finalMult',
    description = replace(description, 'Mechanical template migrated from ', 'Reusable mechanics for ')
WHERE template_key IN ('judgment', 'consecrate');

UPDATE public.abilities
SET amount_calc = amount_calc - 'finalMult'
WHERE ability_key IN ('judgment', 'consecrate');

-- Templates are authoritative. The abilities columns remain a compatibility
-- cache for the existing runtime and are synchronised whenever a template is
-- edited. This lets the admin split land without a risky combat rewrite.
CREATE OR REPLACE FUNCTION public.sync_ability_template_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.abilities
  SET mechanic_key = NEW.mechanic_key,
      ability_type = NEW.ability_type,
      target_type = NEW.target_type,
      activation_mode = NEW.activation_mode,
      cp_cost = NEW.cp_cost,
      cp_reserve_pct = NEW.cp_reserve_pct,
      amount_calc = NEW.amount_calc,
      duration_calc = NEW.duration_calc,
      interval_ms = NEW.interval_ms,
      effect_config = NEW.effect_config,
      mechanic_calcs = NEW.mechanic_calcs
  WHERE template_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ability_template_sync_cache
AFTER UPDATE ON public.ability_templates
FOR EACH ROW EXECUTE FUNCTION public.sync_ability_template_cache();
