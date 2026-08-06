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
    "absorb_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "offense_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "block_buff": {"allowed": ["block_chance", "block_amount"], "required": ["block_chance", "block_amount"], "requires": [], "supports": ["amount", "duration"]},
    "reactive_holy": {"allowed": ["retaliation_damage"], "required": ["retaliation_damage"], "requires": [], "supports": ["amount", "duration"]},
    "mitigation_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "evasion_buff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "stealth_buff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "root_debuff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "sunder_debuff": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
    "dot_debuff": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "heal": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "hp_transfer": {"allowed": ["reserve_hp"], "required": ["reserve_hp"], "requires": ["amount"], "supports": ["amount"]},
    "party_regen": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "regen_buff": {"allowed": ["cp_per_tick"], "required": ["cp_per_tick"], "requires": ["amount", "duration"], "supports": ["amount", "duration"]}
  }'::jsonb
$function$;

ALTER TABLE public.abilities DISABLE TRIGGER guard_ability_identity_trg;

UPDATE public.abilities
SET mechanic_key = 'offense_buff',
    effect_config = coalesce(effect_config, '{}'::jsonb) || jsonb_build_object('offense_mode', 'damage_mult'),
    combat_text = coalesce(combat_text, '{}'::jsonb) || jsonb_build_object(
      'activate_text', 'Arcane Surge! Your damage is amplified (x{mult}).'
    ),
    updated_at = now()
WHERE mechanic_key = 'damage_buff';

UPDATE public.abilities
SET mechanic_key = 'offense_buff',
    effect_config = coalesce(effect_config, '{}'::jsonb) || jsonb_build_object('offense_mode', 'crit_edge'),
    combat_text = coalesce(combat_text, '{}'::jsonb) || jsonb_build_object(
      'activate_text', 'Eagle Eye! Your crit range is now {crit_low}-20 for {seconds}s.'
    ),
    updated_at = now()
WHERE mechanic_key = 'crit_buff';

ALTER TABLE public.abilities ENABLE TRIGGER guard_ability_identity_trg;