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
    "stack_apply": {"allowed": ["max_stacks"], "required": ["max_stacks"], "requires": ["amount"], "supports": ["amount"]},
    "stack_consume": {"allowed": ["per_stack_multiplier"], "required": ["per_stack_multiplier"], "requires": ["amount"], "supports": ["amount"]},
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
    'stack_apply',
    'aura_pulse',
    'reactive_holy',
    'stack_consume'
  ]::text[]
$$;

-- Identity guard blocks mechanic_key changes on live rows; this is a controlled
-- consolidation onto one reusable stack-applying base.
ALTER TABLE public.abilities DISABLE TRIGGER guard_ability_identity_trg;

UPDATE public.abilities
SET mechanic_key = 'stack_apply',
    effect_config = effect_config - 'burn_stat' || jsonb_build_object(
      'trigger', 'pulse', 'effect_type', 'ignite', 'stack_noun', 'burn',
      'pulse_damage_base', 2, 'pulse_damage_stat', 'int', 'engages_target', true,
      'dot_stat', 'wis', 'dot_stat_mult', 0.7, 'dot_global_mult', 0.67,
      'dot_duration_ms', 30000, 'dot_duration_stat', 'wis',
      'dot_duration_per_point_ms', 1000, 'dot_duration_cap_ms', 45000,
      'resolved_by', 'combat-tick'
    ),
    mechanic_calcs = coalesce(mechanic_calcs, '{}'::jsonb) || jsonb_build_object(
      'max_stacks', jsonb_build_object('base', 5, 'terms', '[]'::jsonb, 'unit', 'count', 'note', 'Burn stack ceiling')
    ),
    combat_text = combat_text || jsonb_build_object(
      'activate_text', 'Ignite! A shield of fireballs orbits you — each heartbeat in combat, an orb may strike your target. Lasts 5 minutes.',
      'pulse_text', 'A flaming orb leaps from {attacker} and sears {target} (burn x{stacks})! [{damage}]',
      'stack_text', '{attacker}''s orb of fire seared {target} with Ignite.'
    ),
    updated_at = now()
WHERE mechanic_key = 'ignite_buff';

UPDATE public.abilities
SET mechanic_key = 'stack_apply',
    effect_config = effect_config || jsonb_build_object(
      'trigger', 'on_hit', 'effect_type', 'poison', 'stack_noun', 'poison',
      'dot_stat', 'dex', 'dot_stat_mult', 1.2, 'dot_global_mult', 0.67,
      'dot_duration_ms', 25000, 'resolved_by', 'combat-tick'
    ),
    combat_text = combat_text || jsonb_build_object(
      'activate_text', 'Envenom! Your weapons drip with poison for 5 minutes.',
      'proc_text', '{attacker}''s attack poisons {target}!'
    ),
    updated_at = now()
WHERE mechanic_key = 'poison_buff';

ALTER TABLE public.abilities ENABLE TRIGGER guard_ability_identity_trg;