-- Ability Correction Batch 1: authored configuration corrections.
-- Idempotent: every statement is a targeted JSON field rewrite.

-- 1. Divine Challenge: remove the stale taunt flag (WoV has no taunt).
UPDATE public.abilities
SET effect_config = (effect_config - 'is_taunt'),
    updated_at = now()
WHERE ability_key = 'divine_challenge'
  AND effect_config ? 'is_taunt';

-- 2. Nature's Snare: reduction magnitude scales with DEX, duration with WIS.
UPDATE public.abilities
SET effect_config = jsonb_set(effect_config, '{magnitude_stat}', '"dex"'::jsonb),
    amount_calc = jsonb_set(
      jsonb_set(
        amount_calc,
        '{terms,0,stat}', '"dex"'::jsonb
      ),
      '{note}', '"DEX-scaled outgoing-damage reduction"'::jsonb
    ),
    description = 'Entangle your target. Damage-reduction magnitude scales with DEX (precise binding), duration scales with WIS.',
    tooltip = 'Reduce target''s damage. Reduction scales with DEX, duration with WIS.',
    updated_at = now()
WHERE ability_key = 'natures_snare'
  AND amount_calc #>> '{terms,0,stat}' = 'wis';

-- 3. Dissonance: reduction magnitude scales with CHA, duration with INT.
UPDATE public.abilities
SET effect_config = jsonb_set(effect_config, '{magnitude_stat}', '"cha"'::jsonb),
    amount_calc = jsonb_set(
      jsonb_set(
        amount_calc,
        '{terms,0,stat}', '"cha"'::jsonb
      ),
      '{note}', '"CHA-scaled outgoing-damage reduction"'::jsonb
    ),
    description = 'A discordant note that reduces your target''s damage. Reduction magnitude scales with CHA (cutting cadence), duration scales with INT.',
    tooltip = 'Reduce target''s damage. Reduction scales with CHA, duration with INT.',
    updated_at = now()
WHERE ability_key = 'dissonance'
  AND amount_calc #>> '{terms,0,stat}' = 'int';