CREATE OR REPLACE FUNCTION public.ability_mechanic_params()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT '{
    "weapon_attack": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "spell_attack": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "aura_pulse": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "poison_buff": {"allowed": ["max_stacks"], "required": ["max_stacks"], "requires": ["amount"], "supports": ["amount"]},
    "stack_consume": {"allowed": ["per_stack_multiplier"], "required": ["per_stack_multiplier"], "requires": ["amount"], "supports": ["amount"]},
    "ignite_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "multi_attack": {"allowed": ["arrow_count"], "required": ["arrow_count"], "requires": ["amount"], "supports": ["amount"]},
    "burst_damage": {"allowed": ["crit_edge"], "required": ["crit_edge"], "requires": ["amount"], "supports": ["amount"]},
    "battle_cry": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "absorb_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
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
    "hp_transfer": {"allowed": ["reserve_hp"], "required": ["reserve_hp"], "requires": ["amount"], "supports": ["amount"]},
    "party_regen": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "regen_buff": {"allowed": ["cp_per_tick"], "required": ["cp_per_tick"], "requires": ["amount", "duration"], "supports": ["amount", "duration"]}
  }'::jsonb
$function$;

CREATE OR REPLACE FUNCTION public.ability_damaging_mechanics()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT ARRAY[
    'dot_debuff',
    'ignite_buff',
    'poison_buff',
    'aura_pulse',
    'reactive_holy',
    'stack_consume'
  ]::text[]
$$;

-- Identity guard blocks mechanic_key changes on live rows; this is a controlled
-- consolidation onto reusable ticking bases.
ALTER TABLE public.abilities DISABLE TRIGGER guard_ability_identity_trg;

UPDATE public.abilities
SET mechanic_key = 'aura_pulse',
    effect_config = effect_config
      || jsonb_build_object('heals_allies', true, 'damages_enemies', true),
    combat_text = combat_text || jsonb_build_object(
      'cast_text', 'You consecrate the ground — hallowed light wells up beneath your feet for {duration}s, mending allies and searing the unholy.',
      'heal_text', 'Consecrated ground soothes {ally}. [{amount}]',
      'burn_text', 'Holy fire sears {target}! [{amount}]'
    ),
    updated_at = now()
WHERE mechanic_key = 'consecrate';

UPDATE public.abilities
SET effect_config = effect_config
      || jsonb_build_object('effect_type', 'bleed', 'effect_noun', 'bleed', 'weapon_based', true,
                            'magnitude_stat', 'str', 'duration_stat', 'dex', 'max_stacks', 5),
    combat_text = combat_text || jsonb_build_object(
      'apply_text', 'rends {target} — blood weeps from the gash! [{damage}/tick]',
      'miss_text', 'Rend glances off {target} — no wound opens.'
    ),
    updated_at = now()
WHERE mechanic_key = 'dot_debuff';

ALTER TABLE public.abilities ENABLE TRIGGER guard_ability_identity_trg;