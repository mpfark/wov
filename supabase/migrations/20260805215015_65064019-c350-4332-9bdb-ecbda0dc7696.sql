CREATE OR REPLACE FUNCTION public.ability_mechanic_params()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '{
    "weapon_attack": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "spell_attack": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "power_strike": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "aimed_shot": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "backstab": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "fireball": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "smite": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "cutting_words": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "consecrate": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "poison_buff": {"allowed": ["max_stacks"], "required": ["max_stacks"], "requires": ["amount"], "supports": ["amount"]},
    "execute_attack": {"allowed": ["per_stack_multiplier"], "required": ["per_stack_multiplier"], "requires": ["amount"], "supports": ["amount"]},
    "ignite_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "ignite_consume": {"allowed": ["per_stack_multiplier"], "required": ["per_stack_multiplier"], "requires": ["amount"], "supports": ["amount"]},
    "multi_attack": {"allowed": ["arrow_count"], "required": ["arrow_count"], "requires": ["amount"], "supports": ["amount"]},
    "burst_damage": {"allowed": ["crit_edge"], "required": ["crit_edge"], "requires": ["amount"], "supports": ["amount"]},
    "battle_cry": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "absorb_buff": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount", "duration"]},
    "ally_absorb": {"allowed": [], "required": [], "requires": ["amount", "duration"], "supports": ["amount", "duration"]},
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
    "self_heal": {"allowed": [], "required": [], "requires": ["amount"], "supports": ["amount"]},
    "hp_transfer": {"allowed": ["reserve_hp"], "required": ["reserve_hp"], "requires": ["amount"], "supports": ["amount"]},
    "party_regen": {"allowed": [], "required": [], "requires": ["amount", "duration", "interval"], "supports": ["amount", "duration", "interval"]},
    "regen_buff": {"allowed": ["cp_per_tick"], "required": ["cp_per_tick"], "requires": ["amount", "duration"], "supports": ["amount", "duration"]}
  }'::jsonb
$$;