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
};

export interface ClassAbility {
  label: string;
  emoji: string;
  description: string;
  cooldownMs: number;
  type: 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff' | 'damage_buff' | 'hp_transfer' | 'multi_attack' | 'root_debuff' | 'battle_cry' | 'dot_debuff' | 'poison_buff' | 'execute_attack' | 'evasion_buff' | 'ignite_buff' | 'ignite_consume' | 'absorb_buff' | 'party_regen' | 'cooldown_reset' | 'ally_absorb' | 'sunder_debuff' | 'disengage_buff';
  tier: number;
  levelRequired: number;
}

export const CLASS_ABILITIES: Record<string, ClassAbility[]> = {
  healer: [
    {
      label: 'Transfer Health',
      emoji: '💉',
      description: 'Sacrifice your own HP to heal a targeted ally',
      cooldownMs: 15000,
      type: 'hp_transfer',
      tier: 1,
      levelRequired: 5,
    },
    {
      label: 'Heal',
      emoji: '💚',
      description: 'Restore HP based on your Wisdom',
      cooldownMs: 30000,
      type: 'heal',
      tier: 2,
      levelRequired: 10,
    },
    {
      label: 'Purifying Light',
      emoji: '✨💚',
      description: 'A wave of divine radiance that heals all nearby allies over time, scaling with WIS',
      cooldownMs: 60000,
      type: 'party_regen',
      tier: 3,
      levelRequired: 15,
    },
    {
      label: 'Divine Aegis',
      emoji: '🛡️💚',
      description: 'Create an absorb shield on a targeted ally (or self), soaking incoming damage based on WIS',
      cooldownMs: 90000,
      type: 'ally_absorb',
      tier: 4,
      levelRequired: 20,
    },
  ],
  warrior: [
    {
      label: 'Second Wind',
      emoji: '💪',
      description: 'Catch your breath and recover HP based on CON',
      cooldownMs: 45000,
      type: 'self_heal',
      tier: 1,
      levelRequired: 5,
    },
    {
      label: 'Battle Cry',
      emoji: '📯',
      description: 'Let out a war cry that boosts your AC based on STR',
      cooldownMs: 60000,
      type: 'battle_cry',
      tier: 2,
      levelRequired: 10,
    },
    {
      label: 'Rend',
      emoji: '🩸',
      description: 'Slice your target, applying a bleed that deals STR-based damage over time',
      cooldownMs: 90000,
      type: 'dot_debuff',
      tier: 3,
      levelRequired: 15,
    },
    {
      label: 'Sunder Armor',
      emoji: '🔨',
      description: 'A crushing blow that reduces your target\'s AC based on STR, making it easier to hit',
      cooldownMs: 90000,
      type: 'sunder_debuff',
      tier: 4,
      levelRequired: 20,
    },
  ],
  ranger: [
    {
      label: 'Eagle Eye',
      emoji: '🦅',
      description: 'Sharpen your focus to widen your critical hit range based on DEX',
      cooldownMs: 60000,
      type: 'crit_buff',
      tier: 1,
      levelRequired: 5,
    },
    {
      label: 'Barrage',
      emoji: '🏹🏹',
      description: 'Fire a volley of 2-3 arrows at 70% damage each, scaling with DEX',
      cooldownMs: 45000,
      type: 'multi_attack',
      tier: 2,
      levelRequired: 10,
    },
    {
      label: "Nature's Snare",
      emoji: '🌿',
      description: 'Entangle your target, reducing its damage by 30% for a duration scaling with WIS',
      cooldownMs: 90000,
      type: 'root_debuff',
      tier: 3,
      levelRequired: 15,
    },
    {
      label: 'Disengage',
      emoji: '🦘',
      description: 'Leap backward — dodge all attacks briefly and deal 50% bonus damage on your next strike',
      cooldownMs: 90000,
      type: 'disengage_buff',
      tier: 4,
      levelRequired: 20,
    },
  ],
  bard: [
    {
      label: 'Inspire',
      emoji: '🎶',
      description: 'A song that boosts HP regeneration',
      cooldownMs: 60000,
      type: 'regen_buff',
      tier: 1,
      levelRequired: 5,
    },
    {
      label: 'Dissonance',
      emoji: '🎵💢',
      description: 'A discordant note that reduces your target\'s damage by 30%',
      cooldownMs: 45000,
      type: 'root_debuff',
      tier: 2,
      levelRequired: 10,
    },
    {
      label: 'Crescendo',
      emoji: '🎶✨',
      description: 'A rising melody that heals all nearby allies over time, scaling with CHA',
      cooldownMs: 60000,
      type: 'party_regen',
      tier: 3,
      levelRequired: 15,
    },
    {
      label: 'Encore',
      emoji: '🔄🎭',
      description: 'Reset the cooldown of your most recently used ability',
      cooldownMs: 120000,
      type: 'cooldown_reset',
      tier: 4,
      levelRequired: 20,
    },
  ],
  rogue: [
    {
      label: 'Shadowstep',
      emoji: '🌑',
      description: 'Vanish into shadow — avoid attacks when fleeing and deal bonus damage on your next strike',
      cooldownMs: 60000,
      type: 'stealth_buff',
      tier: 1,
      levelRequired: 5,
    },
    {
      label: 'Envenom',
      emoji: '🧪',
      description: 'Coat your blade in poison — each hit has a 40% chance to apply a stackable poison DoT (max 5)',
      cooldownMs: 60000,
      type: 'poison_buff',
      tier: 2,
      levelRequired: 10,
    },
    {
      label: 'Eviscerate',
      emoji: '🔪',
      description: 'A vicious strike that consumes all poison stacks for +50% bonus damage per stack',
      cooldownMs: 45000,
      type: 'execute_attack',
      tier: 3,
      levelRequired: 15,
    },
    {
      label: 'Cloak of Shadows',
      emoji: '🌫️',
      description: 'Wrap yourself in shadow, gaining a 50% chance to dodge incoming attacks',
      cooldownMs: 90000,
      type: 'evasion_buff',
      tier: 4,
      levelRequired: 20,
    },
  ],
  wizard: [
    {
      label: 'Force Shield',
      emoji: '🛡️✨',
      description: 'Create an arcane shield that absorbs incoming damage based on INT',
      cooldownMs: 90000,
      type: 'absorb_buff',
      tier: 1,
      levelRequired: 5,
    },
    {
      label: 'Arcane Surge',
      emoji: '✨',
      description: 'Channel raw arcane energy to amplify your spell damage',
      cooldownMs: 60000,
      type: 'damage_buff',
      tier: 2,
      levelRequired: 10,
    },
    {
      label: 'Ignite',
      emoji: '🔥🔥',
      description: 'Imbue your spells with fire — each hit has a 40% chance to apply a stackable burn DoT (max 5)',
      cooldownMs: 60000,
      type: 'ignite_buff',
      tier: 3,
      levelRequired: 15,
    },
    {
      label: 'Conflagrate',
      emoji: '💥',
      description: 'Consume all burn stacks on your target for +50% bonus damage per stack',
      cooldownMs: 45000,
      type: 'ignite_consume',
      tier: 4,
      levelRequired: 20,
    },
  ],
};
