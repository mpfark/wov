export interface ClassCombat {
  label: string;
  stat: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  diceMin: number;
  diceMax: number;
  critRange: number;
  emoji: string;
  verb: string;
}

export const CLASS_COMBAT: Record<string, ClassCombat> = {
  warrior: { label: 'Strike',        stat: 'str', diceMin: 1, diceMax: 10, critRange: 20, emoji: '⚔️', verb: 'swing your blade at' },
  wizard:  { label: 'Cast Fireball', stat: 'int', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '🔥', verb: 'hurl arcane flame at' },
  ranger:  { label: 'Shoot',         stat: 'dex', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '🏹', verb: 'loose an arrow at' },
  rogue:   { label: 'Backstab',      stat: 'dex', diceMin: 1, diceMax: 6,  critRange: 19, emoji: '🗡️', verb: 'strike from the shadows at' },
  healer:  { label: 'Smite',         stat: 'wis', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '⭐', verb: 'channel divine light against' },
  bard:    { label: 'Mock',          stat: 'cha', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '🎵', verb: 'unleash cutting words upon' },
  templar: { label: 'Judgment',      stat: 'wis', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '✝️', verb: 'pass divine judgment upon' },
};

export interface ClassAbility {
  label: string;
  emoji: string;
  description: string;
  cpCost: number;
  type:
    | 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff' | 'damage_buff'
    | 'hp_transfer' | 'multi_attack' | 'root_debuff' | 'battle_cry' | 'dot_debuff'
    | 'poison_buff' | 'execute_attack' | 'evasion_buff' | 'ignite_buff' | 'ignite_consume'
    | 'absorb_buff' | 'party_regen' | 'ally_absorb' | 'sunder_debuff' | 'disengage_buff'
    | 'burst_damage'
    // Templar abilities (sword-and-shield holy defender)
    | 'reactive_holy' | 'block_buff' | 'consecrate' | 'mitigation_buff'
    // Phase 1 T0 class identity abilities (in-combat only, single-target damage)
    | 'fireball' | 'power_strike' | 'aimed_shot' | 'backstab' | 'smite' | 'cutting_words';
  tier: number;
  levelRequired: number;
}

// Phase 1 T0 abilities are class-specific (defined per-class below in CLASS_ABILITIES).
// Focus Strike has been removed; there are no universal abilities at present.

export const CLASS_ABILITIES: Record<string, ClassAbility[]> = {
  healer: [
    { label: 'Smite', emoji: '⭐', description: 'Channel a burst of divine light at your target, scaling with WIS', cpCost: 10, type: 'smite', tier: 0, levelRequired: 1 },
    { label: 'Heal', emoji: '💚', description: 'Restore HP based on your Wisdom', cpCost: 15, type: 'heal', tier: 1, levelRequired: 5 },
    { label: 'Transfer Health', emoji: '💉', description: 'Sacrifice your own HP to heal a targeted ally', cpCost: 25, type: 'hp_transfer', tier: 2, levelRequired: 10 },
    { label: 'Purifying Light', emoji: '✨💚', description: 'A wave of divine radiance that heals all nearby allies over time, scaling with WIS', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Divine Aegis', emoji: '🛡️💚', description: 'Create an absorb shield on a targeted ally (or self), soaking incoming damage based on WIS', cpCost: 60, type: 'ally_absorb', tier: 4, levelRequired: 20 },
  ],
  warrior: [
    { label: 'Power Strike', emoji: '⚔️', description: 'A heavy, focused blow that deals damage scaling with STR', cpCost: 10, type: 'power_strike', tier: 0, levelRequired: 1 },
    { label: 'Second Wind', emoji: '💪', description: 'Catch your breath and recover HP based on CON', cpCost: 15, type: 'self_heal', tier: 1, levelRequired: 5 },
    { label: 'Battle Cry', emoji: '📯', description: '⚓ Stance (T2 — reserves 15% of max CP). Reduces incoming damage by 15% (20% with shield) and softens crits while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 25, type: 'battle_cry', tier: 2, levelRequired: 10 },
    { label: 'Rend', emoji: '🩸', description: 'Slice your target, applying a bleed that deals STR-based damage over time', cpCost: 40, type: 'dot_debuff', tier: 3, levelRequired: 15 },
    { label: 'Sunder Armor', emoji: '🔨', description: "A crushing blow that reduces your target's AC based on STR, making it easier to hit", cpCost: 60, type: 'sunder_debuff', tier: 4, levelRequired: 20 },
  ],
  ranger: [
    { label: 'Aimed Shot', emoji: '🎯', description: 'Take a careful shot at your target, scaling with DEX', cpCost: 10, type: 'aimed_shot', tier: 0, levelRequired: 1 },
    { label: 'Eagle Eye', emoji: '🦅', description: '⚓ Stance (T1 — reserves 10% of max CP). Widens your critical hit range based on DEX while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 15, type: 'crit_buff', tier: 1, levelRequired: 5 },
    { label: 'Barrage', emoji: '🏹🏹', description: 'Fire a volley of 2-3 arrows at 70% damage each, scaling with DEX', cpCost: 25, type: 'multi_attack', tier: 2, levelRequired: 10 },
    { label: "Nature's Snare", emoji: '🌿', description: 'Entangle your target, reducing its damage by 30% for a duration scaling with WIS', cpCost: 40, type: 'root_debuff', tier: 3, levelRequired: 15 },
    { label: 'Disengage', emoji: '🦘', description: 'Leap backward — dodge all attacks briefly and deal 50% bonus damage on your next strike', cpCost: 60, type: 'disengage_buff', tier: 4, levelRequired: 20 },
  ],
  bard: [
    { label: 'Cutting Words', emoji: '🎵', description: 'Unleash a barbed insult that wounds your target, scaling with CHA', cpCost: 10, type: 'cutting_words', tier: 0, levelRequired: 1 },
    { label: 'Inspire', emoji: '🎶', description: 'A song that grants you and your party flat HP & CP regen, scaling with your Charisma. Duration scales with Intelligence (60–180s). Recasting refreshes the duration and keeps the stronger regen values.', cpCost: 15, type: 'regen_buff', tier: 1, levelRequired: 5 },
    { label: 'Dissonance', emoji: '🎵💢', description: "A discordant note that reduces your target's damage by 30%", cpCost: 25, type: 'root_debuff', tier: 2, levelRequired: 10 },
    { label: 'Crescendo', emoji: '🎶✨', description: 'A rising melody that heals all nearby allies over time, scaling with CHA', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Grand Finale', emoji: '🎵💥', description: 'Unleash a devastating crescendo of sound, dealing massive CHA-scaling damage to your target', cpCost: 60, type: 'burst_damage', tier: 4, levelRequired: 20 },
  ],
  rogue: [
    { label: 'Backstab', emoji: '🗡️', description: 'Strike at a vital point for damage scaling with DEX', cpCost: 10, type: 'backstab', tier: 0, levelRequired: 1 },
    { label: 'Shadowstep', emoji: '🌑', description: 'Vanish into shadow — avoid attacks when fleeing and deal bonus damage on your next strike', cpCost: 15, type: 'stealth_buff', tier: 1, levelRequired: 5 },
    { label: 'Envenom', emoji: '🐍', description: '⚓ Stance (T3 — reserves 20% of max CP). Each hit has a 40% chance to apply a stackable poison DoT (max 5). Mutually exclusive with Ignite. Click again to drop. Reserved CP is NOT refunded.', cpCost: 50, type: 'poison_buff', tier: 2, levelRequired: 10 },
    { label: 'Eviscerate', emoji: '🔪', description: 'A vicious strike that consumes all poison stacks for +50% bonus damage per stack', cpCost: 40, type: 'execute_attack', tier: 3, levelRequired: 15 },
    { label: 'Cloak of Shadows', emoji: '🌫️', description: 'Wrap yourself in shadow, gaining a 50% chance to dodge incoming attacks', cpCost: 60, type: 'evasion_buff', tier: 4, levelRequired: 20 },
  ],
  wizard: [
    { label: 'Fireball', emoji: '🔥', description: 'Hurl a ball of arcane flame at your target, scaling with INT', cpCost: 10, type: 'fireball', tier: 0, levelRequired: 1 },
    { label: 'Force Shield', emoji: '🛡️✨', description: '⚓ Stance (T1 — reserves 10% of max CP). Maintains an arcane absorb shield (INT-scaled) that re-forms while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 15, type: 'absorb_buff', tier: 1, levelRequired: 5 },
    { label: 'Arcane Surge', emoji: '✨', description: '⚓ Stance (T2 — reserves 15% of max CP). All your damage is increased by 15% while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 25, type: 'damage_buff', tier: 2, levelRequired: 10 },
    { label: 'Ignite', emoji: '🔥🔥', description: '⚓ Stance (T3 — reserves 20% of max CP). While in combat, each heartbeat an orb has a 40% chance to strike your target — INT-scaled fire damage with a stackable burn (max 5). Mutually exclusive with Envenom. Click again to drop. Reserved CP is NOT refunded.', cpCost: 50, type: 'ignite_buff', tier: 3, levelRequired: 15 },
    { label: 'Conflagrate', emoji: '💥', description: 'Consume all burn stacks on your target for +50% bonus damage per stack', cpCost: 60, type: 'ignite_consume', tier: 4, levelRequired: 20 },
  ],
  templar: [
    { label: 'Judgment',         emoji: '✝️',   description: 'Pass divine judgment, dealing holy damage scaling with WIS', cpCost: 10, type: 'smite', tier: 0, levelRequired: 1 },
    { label: 'Holy Shield',      emoji: '🛡️✝️', description: '⚓ Stance (T1 — reserves 10% of max CP). Attackers who strike you take holy damage in return (WIS-scaled, once per attacker per tick). Click again to drop. Reserved CP is NOT refunded.', cpCost: 15, type: 'reactive_holy', tier: 1, levelRequired: 5 },
    { label: 'Shield Wall',      emoji: '🛡️',  description: '⚓ Stance (T2 — reserves 15% of max CP). While active, your shield block chance gains a flat +50% (added to your base block chance, capped at 95%). Block amount unchanged. Requires a shield equipped to benefit. Click again to drop. Reserved CP is NOT refunded.', cpCost: 25, type: 'block_buff', tier: 2, levelRequired: 10 },
    { label: 'Consecrate',       emoji: '✨🟡', description: 'Sanctify the ground for 3 ticks (~6s) — heals all party members on this node and burns engaged creatures with holy fire each tick. Scales with WIS.', cpCost: 40, type: 'consecrate', tier: 3, levelRequired: 15 },
    { label: 'Divine Challenge', emoji: '⚜️',  description: 'For 30s, the Templar takes 30% less damage from all sources.', cpCost: 60, type: 'mitigation_buff', tier: 4, levelRequired: 20 },
  ],
};
