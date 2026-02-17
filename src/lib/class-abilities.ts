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
  type: 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff' | 'damage_buff';
  tier: number;
  levelRequired: number;
}

export const CLASS_ABILITIES: Record<string, ClassAbility> = {
  warrior: {
    label: 'Second Wind',
    emoji: '💪',
    description: 'Catch your breath and recover HP based on CON',
    cooldownMs: 45000,
    type: 'self_heal',
    tier: 1,
    levelRequired: 5,
  },
  healer: {
    label: 'Heal',
    emoji: '💚',
    description: 'Restore HP based on your Wisdom',
    cooldownMs: 30000,
    type: 'heal',
    tier: 1,
    levelRequired: 5,
  },
  ranger: {
    label: 'Eagle Eye',
    emoji: '🦅',
    description: 'Sharpen your focus to widen your critical hit range based on DEX',
    cooldownMs: 60000,
    type: 'crit_buff',
    tier: 1,
    levelRequired: 5,
  },
  bard: {
    label: 'Inspire',
    emoji: '🎶',
    description: 'A song that boosts HP regeneration',
    cooldownMs: 60000,
    type: 'regen_buff',
    tier: 1,
    levelRequired: 5,
  },
  rogue: {
    label: 'Shadowstep',
    emoji: '🌑',
    description: 'Vanish into shadow — avoid attacks when fleeing and deal bonus damage on your next strike',
    cooldownMs: 60000,
    type: 'stealth_buff',
    tier: 1,
    levelRequired: 5,
  },
  wizard: {
    label: 'Arcane Surge',
    emoji: '✨',
    description: 'Channel raw arcane energy to amplify your spell damage',
    cooldownMs: 60000,
    type: 'damage_buff',
    tier: 1,
    levelRequired: 5,
  },
};
