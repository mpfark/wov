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
    { label: 'Transfer Health', emoji: '💉', description: 'Sacrifice your own HP (amount = WIS) to heal a targeted ally. CON sets your safety floor — hardy healers can give more without dropping themselves low.', cpCost: 25, type: 'hp_transfer', tier: 2, levelRequired: 10 },
    { label: 'Purifying Light', emoji: '🌟', description: 'A wave of divine radiance that heals all nearby allies over time. Heal/tick scales with WIS; duration scales with CON (stamina sustains the radiance).', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Divine Aegis', emoji: '🛡️', description: 'Create an absorb shield on a targeted ally (or self). Pool scales with WIS; duration (up to 60s) scales with CON.', cpCost: 60, type: 'ally_absorb', tier: 4, levelRequired: 20 },
  ],
  warrior: [
    { label: 'Power Strike', emoji: '⚔️', description: 'A heavy, focused blow that deals damage scaling with STR', cpCost: 10, type: 'power_strike', tier: 0, levelRequired: 1 },
    { label: 'Second Wind', emoji: '💪', description: 'Catch your breath and recover HP based on CON', cpCost: 15, type: 'self_heal', tier: 1, levelRequired: 5 },
    { label: 'Battle Cry', emoji: '📯', description: '⚓ Stance (T2 — reserves 15% of max CP). Reduces incoming damage by 15% (20% with shield) and softens crits while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 25, type: 'battle_cry', tier: 2, levelRequired: 10 },
    { label: 'Rend', emoji: '🩸', description: 'Slice your target, applying a bleed that deals STR-scaled damage every 2s. Duration scales with DEX (precision keeps the wound open).', cpCost: 40, type: 'dot_debuff', tier: 3, levelRequired: 15 },
    { label: 'Sunder Armor', emoji: '🔨', description: "A crushing blow that reduces your target's AC by a STR-scaled amount. Duration scales with DEX (precise strike, lasting weakness).", cpCost: 60, type: 'sunder_debuff', tier: 4, levelRequired: 20 },
  ],
  ranger: [
    { label: 'Aimed Shot', emoji: '🎯', description: 'Take a careful shot at your target, scaling with DEX', cpCost: 10, type: 'aimed_shot', tier: 0, levelRequired: 1 },
    { label: 'Eagle Eye', emoji: '🦅', description: '⚓ Stance (T1 — reserves 10% of max CP). Widens your critical hit range based on a blend of DEX (precision) and WIS (attunement) while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 15, type: 'crit_buff', tier: 1, levelRequired: 5 },
    { label: 'Barrage', emoji: '🏹', description: 'Fire a volley of arrows at 70% damage each (scales with DEX). Arrow count: 2 base, +1 with DEX≥3, +1 more with WIS≥4 (max 4).', cpCost: 25, type: 'multi_attack', tier: 2, levelRequired: 10 },
    { label: "Nature's Snare", emoji: '🌿', description: 'Entangle your target, reducing its damage by 30%. Duration scales with WIS.', cpCost: 40, type: 'root_debuff', tier: 3, levelRequired: 15 },
    { label: 'Disengage', emoji: '🦘', description: 'Leap backward — dodge all attacks briefly and deal 50% bonus damage on your next strike', cpCost: 60, type: 'disengage_buff', tier: 4, levelRequired: 20 },
  ],
  bard: [
    { label: 'Cutting Words', emoji: '🎵', description: 'Unleash a barbed insult that wounds your target, scaling with CHA', cpCost: 10, type: 'cutting_words', tier: 0, levelRequired: 1 },
    { label: 'Inspire', emoji: '🎶', description: 'A song that grants you and your party flat HP & CP regen, scaling with your Charisma. Duration scales with Intelligence (60–180s). Recasting refreshes the duration and keeps the stronger regen values.', cpCost: 15, type: 'regen_buff', tier: 1, levelRequired: 5 },
    { label: 'Dissonance', emoji: '💢', description: "A discordant note that reduces your target's damage by 30%. Duration scales with INT (bards' attunement to the rhythm).", cpCost: 25, type: 'root_debuff', tier: 2, levelRequired: 10 },
    { label: 'Crescendo', emoji: '✨', description: 'A rising melody that heals all nearby allies over time. Heal/tick scales with CHA; duration scales with INT.', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Grand Finale', emoji: '💥', description: 'Unleash a devastating crescendo of sound (CHA-scaled damage). INT sharpens the killing note — each point of INT widens the crit-edge.', cpCost: 60, type: 'burst_damage', tier: 4, levelRequired: 20 },
  ],
  rogue: [
    { label: 'Backstab', emoji: '🗡️', description: 'Strike at a vital point for damage scaling with DEX', cpCost: 10, type: 'backstab', tier: 0, levelRequired: 1 },
    { label: 'Shadowstep', emoji: '🌑', description: 'Vanish into shadow — duration scales with DEX, and your next strike from stealth deals an ambush multiplier scaling with CHA (cap ×2.5).', cpCost: 15, type: 'stealth_buff', tier: 1, levelRequired: 5 },
    { label: 'Envenom', emoji: '🐍', description: '⚓ Stance (T3 — reserves 20% of max CP). Each hit has a 40% chance to apply a stackable poison DoT (max 5). Mutually exclusive with Ignite. Click again to drop. Reserved CP is NOT refunded.', cpCost: 50, type: 'poison_buff', tier: 2, levelRequired: 10 },
    { label: 'Eviscerate', emoji: '🔪', description: 'A vicious strike that consumes all poison stacks for bonus damage per stack. Per-stack bonus scales with CHA (showmanship per stack), capped at +65% per stack.', cpCost: 40, type: 'execute_attack', tier: 3, levelRequired: 15 },
    { label: 'Cloak of Shadows', emoji: '🌫️', description: 'Wrap yourself in shadow, gaining a 50% chance to dodge incoming attacks', cpCost: 60, type: 'evasion_buff', tier: 4, levelRequired: 20 },
  ],
  wizard: [
    { label: 'Fireball', emoji: '🔥', description: 'Hurl a ball of arcane flame at your target, scaling with INT', cpCost: 10, type: 'fireball', tier: 0, levelRequired: 1 },
    { label: 'Force Shield', emoji: '🛡️', description: '⚓ Stance (T1 — reserves 10% of max CP). Maintains an arcane absorb shield (WIS-scaled pool, INT-scaled regen) that re-forms out of combat. Click again to drop. Reserved CP is NOT refunded.', cpCost: 15, type: 'absorb_buff', tier: 1, levelRequired: 5 },
    { label: 'Arcane Surge', emoji: '✨', description: '⚓ Stance (T2 — reserves 15% of max CP). All your damage is increased by 15% while active. Click again to drop. Reserved CP is NOT refunded.', cpCost: 25, type: 'damage_buff', tier: 2, levelRequired: 10 },
    { label: 'Ignite', emoji: '🌋', description: '⚓ Stance (T3 — reserves 20% of max CP). While in combat, each heartbeat an orb has a 40% chance to strike your target — INT-scaled spark damage that also applies a WIS-scaled stackable burn (max 5, longer with more WIS). Mutually exclusive with Envenom. Click again to drop. Reserved CP is NOT refunded.', cpCost: 50, type: 'ignite_buff', tier: 3, levelRequired: 15 },
    { label: 'Conflagrate', emoji: '💥', description: 'Consume all burn stacks on your target for +50% bonus damage per stack', cpCost: 60, type: 'ignite_consume', tier: 4, levelRequired: 20 },
  ],
  templar: [
    { label: 'Judgment',         emoji: '✝️',  description: 'Pass divine judgment, dealing holy damage scaling with WIS', cpCost: 10, type: 'smite', tier: 0, levelRequired: 1 },
    { label: 'Holy Shield',      emoji: '⚡',  description: '⚓ Stance (T1 — reserves 10% of max CP). Attackers who strike you take holy damage in return — magnitude scales with WIS, with a CON kicker (CON adds to retaliation damage). Once per attacker per tick. Click again to drop. Reserved CP is NOT refunded.', cpCost: 15, type: 'reactive_holy', tier: 1, levelRequired: 5 },
    { label: 'Shield Wall',      emoji: '🛡️', description: '⚓ Stance (T2 — reserves 15% of max CP). Dual-primary: WIS adds bonus block chance (+30% floor, up to +55% at high WIS), CON adds bonus block amount (+5 floor, up to +11 at high CON). Final block chance capped at 95%. Requires a shield equipped to benefit. Click again to drop. Reserved CP is NOT refunded.', cpCost: 25, type: 'block_buff', tier: 2, levelRequired: 10 },
    { label: 'Consecrate',       emoji: '🔆', description: 'Sanctify the ground — heals all party members on this node and burns engaged creatures with holy fire each tick. Heal/burn per tick scales with WIS; number of ticks scales with CON (3 base, +1 at CON≥3, +1 at CON≥6, cap 5 ticks / 10s).', cpCost: 40, type: 'consecrate', tier: 3, levelRequired: 15 },
    { label: 'Divine Challenge', emoji: '⚜️', description: 'Take 30% less damage from all sources. Duration scales with CON (30s base, up to 45s).', cpCost: 60, type: 'mitigation_buff', tier: 4, levelRequired: 20 },
  ],
};
