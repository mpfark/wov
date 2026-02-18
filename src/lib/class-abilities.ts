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
  type: 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff' | 'damage_buff' | 'hp_transfer' | 'multi_attack' | 'root_debuff' | 'battle_cry' | 'dot_debuff';
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
  ],
  wizard: [
    {
      label: 'Arcane Surge',
      emoji: '✨',
      description: 'Channel raw arcane energy to amplify your spell damage',
      cooldownMs: 60000,
      type: 'damage_buff',
      tier: 1,
      levelRequired: 5,
    },
  ],
};
