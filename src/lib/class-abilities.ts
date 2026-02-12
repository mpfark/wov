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
