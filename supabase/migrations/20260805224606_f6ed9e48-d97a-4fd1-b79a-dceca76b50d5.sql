CREATE OR REPLACE FUNCTION public.ability_mechanic_params()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT '{
    "weapon_attack": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "spell_attack": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "consecrate": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
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
    'consecrate',
    'reactive_holy',
    'stack_consume'
  ]::text[]
$$;

-- Identity guard blocks mechanic_key changes on live rows; this is a controlled
-- consolidation of two live rows onto one shared base mechanic.
ALTER TABLE public.abilities DISABLE TRIGGER guard_ability_identity_trg;

UPDATE public.abilities
SET mechanic_key = 'stack_consume',
    effect_config = effect_config
      || jsonb_build_object('stack_type', 'poison', 'stack_noun', 'poison', 'weapon_based', true, 'stat', 'dex'),
    combat_text = combat_text || jsonb_build_object(
      'hit_text', 'eviscerates {target}, detonating {stacks} poison stack{plural}! [{damage}]',
      'hit_no_stacks_text', 'eviscerates {target} (no poison stacks). [{damage}]',
      'miss_text', 'Eviscerate misses {target}{stacknote}!'
    ),
    updated_at = now()
WHERE mechanic_key = 'execute_attack';

UPDATE public.abilities
SET mechanic_key = 'stack_consume',
    effect_config = effect_config
      || jsonb_build_object('stack_type', 'ignite', 'stack_noun', 'burn', 'weapon_based', false, 'stat', 'int'),
    combat_text = combat_text || jsonb_build_object(
      'hit_text', 'detonates {stacks} burn stack{plural} on {target}! [{damage}]',
      'hit_no_stacks_text', 'blasts {target} (no burn stacks). [{damage}]',
      'miss_text', 'Conflagrate gutters out against {target}{stacknote}!'
    ),
    updated_at = now()
WHERE mechanic_key = 'ignite_consume';

ALTER TABLE public.abilities ENABLE TRIGGER guard_ability_identity_trg;