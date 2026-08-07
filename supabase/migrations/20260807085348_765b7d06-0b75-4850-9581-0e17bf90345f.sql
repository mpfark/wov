-- 1. Status Application fields on the configured ability
ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS status_trigger text,
  ADD COLUMN IF NOT EXISTS status_chance_pct numeric,
  ADD COLUMN IF NOT EXISTS status_application_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.abilities
  DROP CONSTRAINT IF EXISTS abilities_status_trigger_check;
ALTER TABLE public.abilities
  ADD CONSTRAINT abilities_status_trigger_check
  CHECK (status_trigger IS NULL OR status_trigger IN
    ('ability_hit', 'weapon_hit', 'successful_pulse_hit', 'activation'));

ALTER TABLE public.abilities
  DROP CONSTRAINT IF EXISTS abilities_status_chance_pct_check;
ALTER TABLE public.abilities
  ADD CONSTRAINT abilities_status_chance_pct_check
  CHECK (status_chance_pct IS NULL OR (status_chance_pct >= 0 AND status_chance_pct <= 100));

-- An enabled Status Application must name a status and a trigger.
ALTER TABLE public.abilities
  DROP CONSTRAINT IF EXISTS abilities_status_application_complete_check;
ALTER TABLE public.abilities
  ADD CONSTRAINT abilities_status_application_complete_check
  CHECK (
    status_application_enabled = false
    OR (applied_status IS NOT NULL AND status_trigger IS NOT NULL)
  );

COMMENT ON COLUMN public.abilities.status_trigger IS
  'Successful qualifying event that applies applied_status: ability_hit | weapon_hit | successful_pulse_hit | activation. Misses, invalid targets and cancelled attacks never apply.';
COMMENT ON COLUMN public.abilities.status_chance_pct IS
  'NULL = chance comes from the ability''s own amount calc (stat-scaled). 0..100 = fixed chance. 0 means wired but never succeeds; status_application_enabled = false means no application exists at all.';

-- 2. Scorched: the reusable light burn that preserves Fireball''s current proc.
INSERT INTO public.applied_statuses (
  key, label, effect_type, classification, stack_noun,
  default_damage_type, magnitude, duration, stacks, admin_notes
) VALUES (
  'scorched', 'Scorched', 'scorched', 'dot', 'scorch',
  'fire',
  jsonb_build_object('flat', 3),
  jsonb_build_object('base_ms', 6000),
  jsonb_build_object('max_stacks_calc', jsonb_build_object('base', 3, 'terms', '[]'::jsonb, 'unit', 'count')),
  'Light, flat burn with no attribute scaling. Preserves Fireball''s legacy on-hit burn exactly (25% / 3 per tick / 6s / 3 stacks).'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Backfill existing status users onto the new Status Application fields.
UPDATE public.abilities SET
  status_trigger = 'ability_hit', status_chance_pct = 100, status_application_enabled = true
WHERE ability_key IN ('rend', 'frost_bolt') AND applied_status IS NOT NULL;

-- Stance appliers keep their stat-scaled proc chance (NULL = use the amount calc).
UPDATE public.abilities SET
  status_trigger = 'weapon_hit', status_chance_pct = NULL, status_application_enabled = true
WHERE ability_key = 'envenom' AND applied_status IS NOT NULL;

UPDATE public.abilities SET
  status_trigger = 'successful_pulse_hit', status_chance_pct = NULL, status_application_enabled = true
WHERE ability_key = 'ignite' AND applied_status IS NOT NULL;

-- Fireball is prepared but NOT enabled yet: it keeps running on the legacy
-- on_hit_effect until the runtime cutover ships, so its burn is never lost.
UPDATE public.abilities SET
  status_trigger = 'ability_hit', status_chance_pct = 25, status_application_enabled = false
WHERE ability_key = 'fireball';