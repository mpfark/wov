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
  assassin:   { label: 'Backstab',      stat: 'dex', diceMin: 1, diceMax: 6,  critRange: 19, emoji: '🗡️', verb: 'strike from the shadows at' },
  healer:  { label: 'Smite',         stat: 'wis', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '⭐', verb: 'channel divine light against' },
  bard:    { label: 'Mock',          stat: 'cha', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '🎵', verb: 'unleash cutting words upon' },
  templar: { label: 'Judgment',      stat: 'wis', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '✝️', verb: 'pass divine judgment upon' },
};

export interface ClassAbility {
  label: string;
  emoji: string;
  description: string;
  /** Short one-liner shown in the center-panel ability tooltip. */
  tooltip: string;
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
    { label: 'Smite', emoji: '⭐', description: 'Channel a burst of divine light at your target, scaling with WIS', tooltip: 'Damage one target. Scales with WIS.', cpCost: 10, type: 'smite', tier: 0, levelRequired: 1 },
    { label: 'Heal', emoji: '💚', description: 'Restore HP based on your Wisdom', tooltip: 'Restore your HP. Scales with WIS.', cpCost: 15, type: 'heal', tier: 1, levelRequired: 5 },
    { label: 'Transfer Health', emoji: '💉', description: 'Sacrifice your own HP (amount = WIS) to heal a targeted ally. CON sets your safety floor — hardy healers can give more without dropping themselves low.', tooltip: 'Sacrifice HP to heal an ally. Scales with WIS; CON sets your safety floor.', cpCost: 25, type: 'hp_transfer', tier: 2, levelRequired: 10 },
    { label: 'Purifying Light', emoji: '🌟', description: 'A wave of divine radiance that heals all nearby allies over time. Heal/tick scales with WIS; duration scales with CON (stamina sustains the radiance).', tooltip: 'Heal nearby allies over time. Heal scales with WIS, duration with CON.', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Divine Aegis', emoji: '🛡️', description: 'Create an absorb shield on a targeted ally (or self). Pool scales with WIS; duration (up to 60s) scales with CON.', tooltip: 'Shield an ally with an absorb pool. Pool scales with WIS, duration with CON.', cpCost: 60, type: 'ally_absorb', tier: 4, levelRequired: 20 },
  ],
  warrior: [
    { label: 'Power Strike', emoji: '⚔️', description: 'A heavy, focused blow. Rolls your equipped weapon damage + STR + ability bonus (unarmed falls back to 1d4).', tooltip: 'Heavy blow. Rolls weapon damage + STR + bonus.', cpCost: 10, type: 'power_strike', tier: 0, levelRequired: 1 },
    { label: 'Second Wind', emoji: '💪', description: 'Catch your breath and recover HP based on CON', tooltip: 'Recover your HP. Scales with CON.', cpCost: 15, type: 'self_heal', tier: 1, levelRequired: 5 },
    { label: 'Battle Cry', emoji: '📯', description: '⚓ Stance. Reduces incoming damage and softens crits — magnitude scales with STR (with a small shield bonus), duration with DEX. Click again to drop.', tooltip: 'Reduce incoming damage and soften crits. Magnitude scales with STR, duration with DEX. Stance.', cpCost: 25, type: 'battle_cry', tier: 2, levelRequired: 10 },
    { label: 'Rend', emoji: '🩸', description: 'Slice your target, applying a bleed that ticks every 2s. Per-tick damage scales with your equipped weapon (bigger swords bleed harder) and STR. Duration scales with DEX (precision keeps the wound open).', tooltip: 'Bleed your target over time. Per-tick scales with weapon + STR, duration with DEX.', cpCost: 40, type: 'dot_debuff', tier: 3, levelRequired: 15 },
    { label: 'Sunder Armor', emoji: '🔨', description: "A crushing blow that reduces your target's AC by a STR-scaled amount. Duration scales with DEX (precise strike, lasting weakness).", tooltip: "Reduce target's AC. Amount scales with STR, duration with DEX.", cpCost: 60, type: 'sunder_debuff', tier: 4, levelRequired: 20 },
  ],
  ranger: [
    { label: 'Aimed Shot', emoji: '🎯', description: 'A careful shot. Rolls your equipped weapon damage + DEX + ability bonus (unarmed falls back to 1d4).', tooltip: 'Careful shot. Rolls weapon damage + DEX + bonus.', cpCost: 10, type: 'aimed_shot', tier: 0, levelRequired: 1 },
    { label: 'Eagle Eye', emoji: '🦅', description: '⚓ Stance. Widens your critical hit range based on a blend of DEX (precision) and WIS (attunement) while active. Click again to drop.', tooltip: 'Widen your crit range. Scales with DEX and WIS. Stance.', cpCost: 15, type: 'crit_buff', tier: 1, levelRequired: 5 },
    { label: 'Barrage', emoji: '🏹', description: 'Fire a volley of arrows. Each arrow rolls your equipped weapon damage (unarmed: 1d4) + half DEX. Arrow count scales with WIS: 2 base, +1 with DEX≥3, +1 more with WIS≥4 (max 4).', tooltip: 'Volley of arrows. Each rolls weapon damage + half DEX; count scales with WIS.', cpCost: 25, type: 'multi_attack', tier: 2, levelRequired: 10 },
    { label: "Nature's Snare", emoji: '🌿', description: "Entangle your target. Damage-reduction magnitude scales with DEX (precise binding), duration scales with WIS.", tooltip: "Reduce target's damage. Reduction scales with DEX, duration with WIS.", cpCost: 40, type: 'root_debuff', tier: 3, levelRequired: 15 },
    { label: 'Disengage', emoji: '🦘', description: 'Leap backward — dodge all attacks briefly. Dodge duration scales with DEX, next-strike bonus damage scales with WIS (calm aim).', tooltip: 'Dodge briefly; next strike deals bonus damage. Bonus scales with WIS, duration with DEX.', cpCost: 60, type: 'disengage_buff', tier: 4, levelRequired: 20 },
  ],
  bard: [
    { label: 'Cutting Words', emoji: '🎵', description: 'Unleash a barbed insult that wounds your target, scaling with CHA', tooltip: 'Damage one target. Scales with CHA.', cpCost: 10, type: 'cutting_words', tier: 0, levelRequired: 1 },
    { label: 'Inspire', emoji: '🎶', description: 'A song that grants you and your party flat HP & CP regen, scaling with your Charisma. Duration scales with Intelligence (60–180s). Recasting refreshes the duration and keeps the stronger regen values.', tooltip: 'Grant party HP & CP regen. Regen scales with CHA, duration with INT.', cpCost: 15, type: 'regen_buff', tier: 1, levelRequired: 5 },
    { label: 'Dissonance', emoji: '💢', description: "A discordant note that reduces your target's damage. Reduction magnitude scales with CHA (cutting cadence), duration scales with INT.", tooltip: "Reduce target's damage. Reduction scales with CHA, duration with INT.", cpCost: 25, type: 'root_debuff', tier: 2, levelRequired: 10 },
    { label: 'Crescendo', emoji: '✨', description: 'A rising melody that heals all nearby allies over time. Heal/tick scales with CHA; duration scales with INT.', tooltip: 'Heal nearby allies over time. Heal scales with CHA, duration with INT.', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Grand Finale', emoji: '💥', description: 'Unleash a devastating crescendo of sound (CHA-scaled damage). INT sharpens the killing note — each point of INT widens the crit-edge.', tooltip: 'Burst damage on one target. Damage scales with CHA, crit-edge with INT.', cpCost: 60, type: 'burst_damage', tier: 4, levelRequired: 20 },
  ],
  assassin: [
    { label: 'Backstab', emoji: '🗡️', description: 'Strike at a vital point. Rolls your equipped weapon damage + DEX + ability bonus (unarmed falls back to 1d4).', tooltip: 'Vital strike. Rolls weapon damage + DEX + bonus.', cpCost: 10, type: 'backstab', tier: 0, levelRequired: 1 },
    { label: 'Shadowstep', emoji: '🌑', description: 'Vanish into shadow — duration scales with DEX, and your next strike from stealth deals an ambush multiplier scaling with CHA (cap ×2.5).', tooltip: 'Vanish into stealth; next strike is an ambush. Duration scales with DEX, ambush with CHA.', cpCost: 15, type: 'stealth_buff', tier: 1, levelRequired: 5 },
    { label: 'Envenom', emoji: '🐍', description: '⚓ Stance. Each hit may apply a stackable poison DoT — proc chance scales with DEX, max stack ceiling scales with CHA. Mutually exclusive with Ignite. Click again to drop.', tooltip: 'Hits may apply stacking poison. Proc scales with DEX, max stacks with CHA. Stance.', cpCost: 50, type: 'poison_buff', tier: 2, levelRequired: 10 },
    { label: 'Eviscerate', emoji: '🔪', description: 'A vicious finisher. Rolls your equipped weapon damage + DEX + ability bonus, then multiplied by consumed poison stacks (per-stack bonus scales with CHA showmanship). Unarmed falls back to 1d4.', tooltip: 'Rolls weapon damage + DEX + bonus, multiplied by poison stacks (CHA).', cpCost: 40, type: 'execute_attack', tier: 3, levelRequired: 15 },
    { label: 'Cloak of Shadows', emoji: '🌫️', description: 'Wrap yourself in shadow. Dodge chance scales with CHA (theatrical misdirection), duration scales with DEX.', tooltip: 'Chance to dodge attacks. Dodge scales with CHA, duration with DEX.', cpCost: 60, type: 'evasion_buff', tier: 4, levelRequired: 20 },
  ],
  wizard: [
    { label: 'Fireball', emoji: '🔥', description: 'Hurl a ball of arcane flame at your target, scaling with INT', tooltip: 'Damage one target. Scales with INT.', cpCost: 10, type: 'fireball', tier: 0, levelRequired: 1 },
    { label: 'Force Shield', emoji: '🛡️', description: '⚓ Stance. Maintains an arcane absorb shield (WIS-scaled pool, INT-scaled regen) that re-forms out of combat. Click again to drop.', tooltip: 'Maintain an arcane absorb shield. Pool scales with WIS, regen with INT. Stance.', cpCost: 15, type: 'absorb_buff', tier: 1, levelRequired: 5 },
    { label: 'Arcane Surge', emoji: '✨', description: '⚓ Stance. All your damage is increased — bonus magnitude scales with INT. Click again to drop.', tooltip: 'Increase all your damage. Bonus scales with INT. Stance.', cpCost: 25, type: 'damage_buff', tier: 2, levelRequired: 10 },
    { label: 'Ignite', emoji: '🌋', description: '⚓ Stance. While in combat, an orb pulses each heartbeat at your target — proc chance and spark damage scale with INT, the applied burn DoT (stacks/duration) scales with WIS. Mutually exclusive with Envenom. Click again to drop.', tooltip: 'Orbs strike your target and apply burn. Proc/spark scale with INT, burn with WIS. Stance.', cpCost: 50, type: 'ignite_buff', tier: 3, levelRequired: 15 },
    { label: 'Conflagrate', emoji: '💥', description: 'Consume all burn stacks on your target for bonus damage per stack. Per-stack bonus scales with INT; stack count scales with WIS via Ignite.', tooltip: 'Consume burn stacks for bonus damage. Per-stack scales with INT.', cpCost: 60, type: 'ignite_consume', tier: 4, levelRequired: 20 },
  ],
  templar: [
    { label: 'Judgment',         emoji: '✝️',  description: 'Pass divine judgment, dealing holy damage scaling with WIS', tooltip: 'Holy damage to one target. Scales with WIS.', cpCost: 10, type: 'smite', tier: 0, levelRequired: 1 },
    { label: 'Holy Shield',      emoji: '⚡',  description: '⚓ Stance. Attackers who strike you take holy damage in return — magnitude scales with WIS, with a CON kicker (CON adds to retaliation damage). Once per attacker per tick. Click again to drop.', tooltip: 'Attackers take holy damage in return. Scales with WIS, CON adds a kicker. Stance.', cpCost: 15, type: 'reactive_holy', tier: 1, levelRequired: 5 },
    { label: 'Shield Wall',      emoji: '🛡️', description: '⚓ Stance. Dual-primary: WIS adds bonus block chance (+25.5% floor, up to +46.75% at high WIS), CON adds bonus block amount (+~4 floor, up to +~9 at high CON). Final block chance capped at 95%. Requires a shield equipped to benefit. Click again to drop.', tooltip: 'Boost block chance and amount. Chance scales with WIS, amount with CON. Stance.', cpCost: 25, type: 'block_buff', tier: 2, levelRequired: 10 },
    { label: 'Consecrate',       emoji: '🔆', description: 'Sanctify the ground — heals all party members on this node and burns engaged creatures with holy fire each tick. Heal/burn per tick scales with WIS; number of ticks scales with CON (3 base, +1 at CON≥3, +1 at CON≥6, cap 5 ticks / 10s).', tooltip: 'Heal allies and burn enemies each tick. Heal/burn scales with WIS, ticks with CON.', cpCost: 40, type: 'consecrate', tier: 3, levelRequired: 15 },
    { label: 'Divine Challenge', emoji: '⚜️', description: 'Reduces each incoming hit by a flat amount. Mitigation scales with WIS (min 3, up to ~12 at high WIS), duration scales with CON.', tooltip: 'Flat damage reduction per hit. Amount scales with WIS, duration with CON.', cpCost: 60, type: 'mitigation_buff', tier: 4, levelRequired: 20 },
  ],
};
