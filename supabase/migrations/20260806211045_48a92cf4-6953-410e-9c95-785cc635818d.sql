-- ── 1. Base Abilities gain ownership of the shared numbers ─────────
ALTER TABLE public.base_abilities
  ADD COLUMN IF NOT EXISTS cp_cost integer,
  ADD COLUMN IF NOT EXISTS cp_reserve_pct numeric,
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS amount_calc jsonb,
  ADD COLUMN IF NOT EXISTS duration_calc jsonb,
  ADD COLUMN IF NOT EXISTS interval_ms integer,
  ADD COLUMN IF NOT EXISTS mechanic_calcs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS effect_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supports_secondary_scaling boolean NOT NULL DEFAULT false;

-- ── 2. Configured uses gain identity-only ownership ────────────────
ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS class_scale numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS primary_attribute text,
  ADD COLUMN IF NOT EXISTS secondary_attribute text,
  ADD COLUMN IF NOT EXISTS applied_status text,
  ADD COLUMN IF NOT EXISTS on_hit_effect jsonb;

ALTER TABLE public.abilities
  ADD CONSTRAINT abilities_class_scale_range CHECK (class_scale > 0 AND class_scale <= 4);

-- ── 3. Reusable applied-status definitions ─────────────────────────
CREATE TABLE IF NOT EXISTS public.applied_statuses (
  key text PRIMARY KEY,
  label text NOT NULL,
  effect_type text NOT NULL,
  classification text NOT NULL DEFAULT 'dot',
  stack_noun text NOT NULL DEFAULT 'stack',
  tick_interval_ms integer,
  magnitude jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration jsonb NOT NULL DEFAULT '{}'::jsonb,
  stacks jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_damage_type text,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.applied_statuses TO anon;
GRANT SELECT ON public.applied_statuses TO authenticated;
GRANT ALL ON public.applied_statuses TO service_role;

ALTER TABLE public.applied_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Applied statuses are readable by everyone"
  ON public.applied_statuses FOR SELECT USING (true);
CREATE POLICY "Stewards manage applied statuses"
  ON public.applied_statuses FOR ALL TO authenticated
  USING (public.is_steward_or_overlord()) WITH CHECK (public.is_steward_or_overlord());

CREATE TRIGGER trg_applied_statuses_updated_at
  BEFORE UPDATE ON public.applied_statuses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Numbers below are lifted verbatim from the live stance configurations.
-- Attribute dependencies are expressed as ROLES ('primary' / 'secondary'),
-- which each configured use maps to a concrete attribute.
INSERT INTO public.applied_statuses
  (key, label, effect_type, classification, stack_noun, magnitude, duration, stacks, default_damage_type, admin_notes)
VALUES
  ('poison', 'Poison', 'poison', 'dot', 'poison',
   '{"stat_mult": 1.2, "global_mult": 0.67, "role": "primary"}'::jsonb,
   '{"base_ms": 25000, "role": null}'::jsonb,
   '{"role": "secondary", "max_stacks_calc": {"base": 3, "terms": [{"source":"stat","stat":"cha","role":"secondary","clampAtZero":true,"transform":{"kind":"diminishing","cap":4}}], "unit": "count"}}'::jsonb,
   'poison', 'Enemy-side DoT. Applied by the Assassin On-Hit Stance (Envenom).'),
  ('ignite', 'Ignite', 'ignite', 'dot', 'burn',
   '{"stat_mult": 0.7, "global_mult": 0.67, "role": "secondary"}'::jsonb,
   '{"base_ms": 30000, "per_point_ms": 1000, "cap_ms": 45000, "role": "secondary"}'::jsonb,
   '{"role": null, "max_stacks_calc": {"base": 5, "terms": [], "unit": "count"}}'::jsonb,
   'fire', 'Enemy-side fire DoT. Applied by successful Orbs of Fire orb attacks.'),
  ('bleed', 'Bleed', 'bleed', 'dot', 'bleed',
   '{"stat_mult": 1.0, "global_mult": 0.67, "role": "primary"}'::jsonb,
   '{"base_ms": 20000, "role": null}'::jsonb,
   '{"role": null, "max_stacks_calc": {"base": 5, "terms": [], "unit": "count"}}'::jsonb,
   'physical', 'Enemy-side physical DoT used by on-hit effects and Rend.')
ON CONFLICT (key) DO NOTHING;

-- ── 4. Split bases where the numbers are NOT inheritable ───────────
DO $$
DECLARE
  spec jsonb := '[
    {"base":"spell_bolt","src":"frost_bolt","label":"Spell Bolt"},
    {"base":"absorb_self","src":"force_shield","label":"Absorb Shield (Self Stance)"},
    {"base":"absorb_ally","src":"divine_aegis","label":"Absorb Shield (Ally)"},
    {"base":"mitigation_percent","src":"battle_cry","label":"Mitigation Stance (Percent)"},
    {"base":"mitigation_flat","src":"divine_challenge","label":"Mitigation (Flat)"},
    {"base":"offense_damage","src":"arcane_surge","label":"Offense Stance (Damage)"},
    {"base":"offense_crit","src":"eagle_eye","label":"Offense Stance (Crit Edge)"},
    {"base":"evasion_dodge","src":"cloak_of_shadows","label":"Evasion (Dodge Chance)"},
    {"base":"evasion_next_hit","src":"disengage","label":"Evasion (Next Hit)"},
    {"base":"control_reduction_light","src":"dissonance","label":"Control (Damage Reduction, Light)"},
    {"base":"control_reduction","src":"natures_snare","label":"Control (Damage Reduction)"},
    {"base":"control_armor","src":"sunder_armor","label":"Control (Armor)"},
    {"base":"stack_consume_weapon","src":"eviscerate","label":"Stack Finisher (Weapon)"},
    {"base":"stack_consume_spell","src":"conflagrate","label":"Stack Finisher (Spell)"}
  ]'::jsonb;
  item jsonb;
  v_new uuid;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(spec) LOOP
    IF EXISTS (SELECT 1 FROM public.base_abilities WHERE base_key = item->>'base') THEN
      CONTINUE;
    END IF;
    INSERT INTO public.base_abilities
      (base_key, label, description, mechanic_key, activation_mode, default_target_type,
       allowed_target_types, trigger_type, capabilities, on_hit_allowed, status, admin_notes)
    SELECT item->>'base', item->>'label', b.description, b.mechanic_key,
           a.activation_mode, a.target_type, b.allowed_target_types, b.trigger_type,
           b.capabilities, b.on_hit_allowed, 'active',
           'Split out of "' || b.base_key || '" — its numbers are not inheritable by the other uses.'
    FROM public.abilities a
    JOIN public.base_abilities b ON b.id = a.base_ability_id
    WHERE a.ability_key = item->>'src'
    RETURNING id INTO v_new;

    UPDATE public.abilities SET base_ability_id = v_new WHERE ability_key = item->>'src';
  END LOOP;
END $$;

-- Retire bases that no longer have any configured use.
UPDATE public.base_abilities b SET status = 'retired'
WHERE NOT EXISTS (SELECT 1 FROM public.abilities a WHERE a.base_ability_id = b.id)
  AND b.status <> 'retired';

-- ── 5. Split the shared Weapon Attack row into three configured uses ──
DO $$
DECLARE
  spec jsonb := '[
    {"key":"power_strike","class":"warrior"},
    {"key":"backstab","class":"assassin"},
    {"key":"aimed_shot","class":"ranger"}
  ]'::jsonb;
  item jsonb;
  v_src public.abilities;
  v_ovr jsonb;
  v_new uuid;
BEGIN
  SELECT * INTO v_src FROM public.abilities WHERE ability_key = 'weapon_attack';
  IF v_src.id IS NULL THEN RETURN; END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(spec) LOOP
    IF EXISTS (SELECT 1 FROM public.abilities WHERE ability_key = item->>'key') THEN
      CONTINUE;
    END IF;
    SELECT COALESCE(ca.overrides, '{}'::jsonb) INTO v_ovr
    FROM public.class_ability_assignments ca
    WHERE ca.ability_id = v_src.id AND ca.class_key = item->>'class';

    INSERT INTO public.abilities
      (ability_key, label, description, tooltip, mechanic_key, ability_type, damage_type,
       target_type, activation_mode, cp_cost, cp_reserve_pct, amount_calc, duration_calc,
       interval_ms, effect_config, combat_text, status, admin_notes, mechanic_calcs,
       calc_version, base_ability_id)
    VALUES (
      item->>'key',
      COALESCE(v_ovr->>'label', v_src.label),
      COALESCE(v_ovr->>'description', v_src.description),
      COALESCE(v_ovr->>'tooltip', v_src.tooltip),
      v_src.mechanic_key, v_src.ability_type, v_src.damage_type,
      v_src.target_type, v_src.activation_mode, v_src.cp_cost, v_src.cp_reserve_pct,
      v_src.amount_calc, v_src.duration_calc, v_src.interval_ms, v_src.effect_config,
      COALESCE(v_src.combat_text, '{}'::jsonb) || COALESCE(v_ovr->'combat_text', '{}'::jsonb),
      'active',
      'Configured use of the shared weapon_attack base (split from the multi-class row).',
      v_src.mechanic_calcs, v_src.calc_version, v_src.base_ability_id
    )
    RETURNING id INTO v_new;

    UPDATE public.class_ability_assignments
    SET ability_id = v_new,
        class_ability_key = item->>'key',
        overrides = '{}'::jsonb
    WHERE ability_id = v_src.id AND class_key = item->>'class';
  END LOOP;

  UPDATE public.abilities SET status = 'retired',
    admin_notes = 'Retired: split into power_strike / backstab / aimed_shot configured uses.'
  WHERE id = v_src.id;
END $$;

-- ── 6. Backfill base numbers from the representative configured use ──
DO $$
DECLARE
  rep jsonb := '{
    "spell_attack":"fireball","spell_bolt":"frost_bolt","weapon_attack":"power_strike",
    "heal":"heal","party_regen":"purifying_light","absorb_self":"force_shield",
    "absorb_ally":"divine_aegis","mitigation_percent":"battle_cry",
    "mitigation_flat":"divine_challenge","offense_damage":"arcane_surge",
    "offense_crit":"eagle_eye","evasion_dodge":"cloak_of_shadows",
    "evasion_next_hit":"disengage","control_reduction_light":"dissonance",
    "control_reduction":"natures_snare","control_armor":"sunder_armor",
    "stack_consume_weapon":"eviscerate","stack_consume_spell":"conflagrate",
    "dot_debuff":"rend","aura_pulse":"consecrate","block_buff":"shield_wall",
    "reactive_holy":"holy_shield","multi_attack":"barrage","burst_damage":"grand_finale",
    "hp_transfer":"transfer_health","regen_buff":"inspire","stealth_buff":"shadowstep",
    "on_hit_stance":"envenom","orb_stance":"ignite"
  }'::jsonb;
  -- Keys that belong to the applied-status layer, not the base.
  status_keys text[] := ARRAY['effect_type','stack_noun','dot_stat','dot_stat_mult',
    'dot_global_mult','dot_duration_ms','dot_duration_stat','dot_duration_per_point_ms',
    'dot_duration_cap_ms','max_stacks_calc','on_hit_allowed','on_hit_effect'];
  -- Attribute-selection keys: replaced by named roles on the base.
  attr_keys text[] := ARRAY['stat','magnitude_stat','duration_stat','regen_stat',
    'chance_stat','amount_stat','crit_edge_stat','pulse_damage_stat','dodge_stat'];
  v_base_key text;
  src_key text;
  v_a public.abilities;
  v_primary text;
  v_secondary text;
  v_cfg jsonb;
  v_roles jsonb;
  k text;
  v_val text;
BEGIN
  FOR v_base_key, src_key IN SELECT key, value #>> '{}' FROM jsonb_each(rep) LOOP
    SELECT * INTO v_a FROM public.abilities WHERE ability_key = src_key;
    CONTINUE WHEN v_a.id IS NULL;

    SELECT c.primary_attribute, c.secondary_attribute
      INTO v_primary, v_secondary
    FROM public.class_ability_assignments ca
    JOIN public.classes c ON c.class_key = ca.class_key
    WHERE ca.ability_id = v_a.id
    LIMIT 1;

    v_cfg := COALESCE(v_a.effect_config, '{}'::jsonb);
    v_roles := '{}'::jsonb;

    FOREACH k IN ARRAY attr_keys LOOP
      IF v_cfg ? k THEN
        v_val := v_cfg ->> k;
        IF v_val = v_primary THEN
          v_roles := jsonb_set(v_roles, ARRAY[k], '"primary"'::jsonb, true);
        ELSIF v_val = v_secondary THEN
          v_roles := jsonb_set(v_roles, ARRAY[k], '"secondary"'::jsonb, true);
        END IF;
        v_cfg := v_cfg - k;
      END IF;
    END LOOP;

    FOREACH k IN ARRAY status_keys LOOP
      v_cfg := v_cfg - k;
    END LOOP;

    IF v_roles <> '{}'::jsonb THEN
      v_cfg := jsonb_set(v_cfg, '{stat_roles}', v_roles, true);
    END IF;

    UPDATE public.base_abilities SET
      cp_cost = v_a.cp_cost,
      cp_reserve_pct = v_a.cp_reserve_pct,
      target_type = v_a.target_type,
      default_target_type = v_a.target_type,
      activation_mode = v_a.activation_mode,
      amount_calc = v_a.amount_calc,
      duration_calc = v_a.duration_calc,
      interval_ms = v_a.interval_ms,
      mechanic_calcs = COALESCE(v_a.mechanic_calcs, '{}'::jsonb),
      effect_config = v_cfg
    WHERE base_abilities.base_key = v_base_key;
  END LOOP;
END $$;

-- Judgment's live ×0.8 rider becomes class_scale; the shared spell_attack calc
-- carries no rider (its representative is Fireball).
UPDATE public.abilities SET class_scale = 0.8 WHERE ability_key = 'judgment';

-- ── 7. Configured-use identity: scaling attributes + applied status ──
UPDATE public.abilities a SET
  primary_attribute = COALESCE(
    NULLIF(x.overrides #>> '{scaling,primary_attribute}', ''), x.primary_attribute),
  secondary_attribute = COALESCE(
    NULLIF(x.overrides #>> '{scaling,secondary_attribute}', ''), x.secondary_attribute),
  applied_status = COALESCE(a.effect_config ->> 'effect_type', a.applied_status)
FROM (
  SELECT ca.ability_id, ca.overrides, c.primary_attribute, c.secondary_attribute
  FROM public.class_ability_assignments ca
  JOIN public.classes c ON c.class_key = ca.class_key
) x
WHERE x.ability_id = a.id;

-- Orbs of Fire: Ignite burn damage and duration scale from WIS (secondary),
-- while orb proc chance and orb damage scale from INT (primary).
UPDATE public.abilities SET secondary_attribute = 'wis' WHERE ability_key = 'ignite';

-- Bases that genuinely use a second attribute.
UPDATE public.base_abilities SET supports_secondary_scaling = true
WHERE base_key IN ('party_regen','absorb_self','absorb_ally','evasion_dodge','evasion_next_hit',
  'control_armor','aura_pulse','block_buff','reactive_holy','multi_attack','burst_damage',
  'hp_transfer','regen_buff','stealth_buff','on_hit_stance','orb_stance');

UPDATE public.abilities a SET secondary_attribute = NULL
FROM public.base_abilities b
WHERE b.id = a.base_ability_id AND NOT b.supports_secondary_scaling;

-- ── 8. On-hit permissions live only on the base ────────────────────
DROP TRIGGER IF EXISTS trg_sync_ability_on_hit_allowed ON public.abilities;
DROP TRIGGER IF EXISTS trg_sync_base_on_hit_allowed_children ON public.base_abilities;
DROP FUNCTION IF EXISTS public.sync_ability_on_hit_allowed();
DROP FUNCTION IF EXISTS public.sync_base_on_hit_allowed_children();

UPDATE public.abilities
SET effect_config = effect_config - 'on_hit_allowed'
WHERE effect_config ? 'on_hit_allowed';

-- ── 9. One class assignment per configured use ─────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS class_ability_assignments_one_use
  ON public.class_ability_assignments (ability_id)
  WHERE status <> 'retired';