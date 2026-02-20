// D&D-style stat modifiers by race
export const RACE_STATS: Record<string, Record<string, number>> = {
  human:    { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
  elf:      { str: 0, dex: 2, con: 0, int: 1, wis: 1, cha: 0 },
  dwarf:    { str: 2, dex: 0, con: 2, int: 0, wis: 1, cha: -1 },
  halfling: { str: -1, dex: 2, con: 1, int: 0, wis: 1, cha: 1 },
  edain:    { str: 1, dex: 0, con: 2, int: 1, wis: 1, cha: 1 },
  half_elf: { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 2 },
};

// Base stats by class
export const CLASS_STATS: Record<string, Record<string, number>> = {
  warrior: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
  wizard:  { str: 0, dex: 0, con: 0, int: 3, wis: 2, cha: 1 },
  ranger:  { str: 1, dex: 3, con: 1, int: 0, wis: 2, cha: 0 },
  rogue:   { str: 0, dex: 3, con: 0, int: 1, wis: 0, cha: 2 },
  healer:  { str: 0, dex: 0, con: 1, int: 1, wis: 3, cha: 2 },
  bard:    { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 3 },
};

// HP by class
export const CLASS_BASE_HP: Record<string, number> = {
  warrior: 24, wizard: 16, ranger: 20, rogue: 16, healer: 18, bard: 16,
};

// AC by class
export const CLASS_BASE_AC: Record<string, number> = {
  warrior: 14, wizard: 11, ranger: 12, rogue: 12, healer: 11, bard: 11,
};

// Class-based stat bonuses awarded every 3 levels
export const CLASS_LEVEL_BONUSES: Record<string, Record<string, number>> = {
  warrior: { str: 1, dex: 1 },
  wizard:  { int: 1, wis: 1 },
  ranger:  { dex: 1, wis: 1 },
  rogue:   { dex: 1, cha: 1 },
  healer:  { wis: 1, con: 1 },
  bard:    { cha: 1, int: 1 },
};

export const RACE_LABELS: Record<string, string> = {
  human: 'Human', elf: 'Elf', dwarf: 'Dwarf', halfling: 'Halfling',
  edain: 'Edain', half_elf: 'Half-Elf',
};

export const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger',
  rogue: 'Rogue', healer: 'Healer', bard: 'Bard',
};

export const RACE_DESCRIPTIONS: Record<string, string> = {
  human: 'Versatile and adaptable, the race of Men brings balanced abilities to any endeavor.',
  elf: 'Graceful and wise, the Elder Folk excel in dexterity and have keen minds.',
  dwarf: 'Stout and hardy, the Mountain Clans are strong of arm and iron of constitution.',
  halfling: 'Small but nimble, Halflings possess surprising resilience and charm.',
  edain: 'Noble descendants of the Old Kingdom, blessed with endurance and long life.',
  half_elf: 'Children of two worlds, Half-Elves combine elvish grace with human charisma.',
};

export const CLASS_DESCRIPTIONS: Record<string, string> = {
  warrior: 'Masters of martial combat, clad in heavy armor with devastating melee power.',
  wizard: 'Wielders of ancient lore and arcane power drawn from the fabric of the world.',
  ranger: 'Swift hunters and trackers of the wild, deadly with bow and blade.',
  rogue: 'Shadow-walkers skilled in stealth, cunning strikes, and misdirection.',
  healer: 'Servants of light who mend wounds and bolster allies through divine grace.',
  bard: 'Loremasters whose songs inspire courage and whose words can shape fate.',
};

export const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};

export function calculateStats(race: string, charClass: string) {
  const baseStats = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  const raceBonus = RACE_STATS[race] || {};
  const classBonus = CLASS_STATS[charClass] || {};
  const stats: Record<string, number> = {};
  for (const stat of Object.keys(baseStats)) {
    stats[stat] = (baseStats as any)[stat] + (raceBonus[stat] || 0) + (classBonus[stat] || 0);
  }
  return stats;
}

export function calculateHP(charClass: string, con: number) {
  const baseHP = CLASS_BASE_HP[charClass] || 18;
  const conMod = Math.floor((con - 10) / 2);
  return baseHP + conMod;
}

export function calculateAC(charClass: string, dex: number) {
  const baseAC = CLASS_BASE_AC[charClass] || 10;
  const dexMod = Math.floor((dex - 10) / 2);
  return baseAC + dexMod;
}

// Item stat budget system
export const ITEM_RARITY_MULTIPLIER: Record<string, number> = {
  common: 1.0, uncommon: 1.5, rare: 2.0, unique: 3.0,
};

export const ITEM_STAT_COSTS: Record<string, number> = {
  str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, ac: 3, hp: 0.5, hp_regen: 2,
};

export const ITEM_STAT_CAPS: Record<string, number> = {
  str: 5, dex: 5, con: 5, int: 5, wis: 5, cha: 5, ac: 3, hp: 10, hp_regen: 3,
};

export function getBaseRegen(con: number): number {
  return 1 + Math.floor((con - 10) / 4);
}

// CP (Concentration Points) system
export function getMaxCp(level: number): number {
  return 100 + (level - 1) * 3;
}

// Primary stat mapping per class for CP regen bonus
export const CLASS_PRIMARY_STAT: Record<string, string> = {
  warrior: 'con', wizard: 'int', ranger: 'dex',
  rogue: 'dex', healer: 'wis', bard: 'cha',
};

export function getCpRegenRate(primaryStatValue: number): number {
  const mod = getStatModifier(primaryStatValue);
  return 1 + Math.floor(mod / 2) * 0.5;
}

export function getItemStatBudget(level: number, rarity: string, hands: number = 1): number {
  const mult = ITEM_RARITY_MULTIPLIER[rarity] || 1;
  const handsMult = hands === 2 ? 1.5 : 1;
  return Math.floor(1 + (level - 1) * 0.3 * mult * handsMult);
}

export function calculateItemStatCost(stats: Record<string, number>): number {
  return Object.entries(stats).reduce(
    (sum, [key, val]) => sum + val * (ITEM_STAT_COSTS[key] || 1), 0
  );
}

export function getItemStatCap(statKey: string, level: number = 1): number {
  if (statKey === 'ac' || statKey === 'hp_regen') {
    return 2 + Math.floor(level / 10);
  }
  if (statKey === 'hp') {
    return 6 + Math.floor(level / 5) * 2;
  }
  // Primary stats: str, dex, con, int, wis, cha
  return 3 + Math.floor(level / 5);
}

export function suggestItemGoldValue(level: number, rarity: string): number {
  const mult = ITEM_RARITY_MULTIPLIER[rarity] || 1;
  return Math.round(level * 2.5 * mult * mult);
}

// Repair cost calculation
const REPAIR_RARITY_MULT: Record<string, number> = {
  common: 1, uncommon: 1.5, rare: 0, unique: 0,
};

export function calculateRepairCost(maxDurability: number, currentDurability: number, value: number, rarity: string): number {
  const mult = REPAIR_RARITY_MULT[rarity] ?? 1;
  if (mult === 0) return 0; // unique = unrepairable
  return Math.max(1, Math.ceil((maxDurability - currentDurability) * value * mult / 100));
}

// XP curve and rarity multipliers
export const XP_RARITY_MULTIPLIER: Record<string, number> = {
  regular: 1, rare: 1.5, boss: 2.5,
};

export function getXpForLevel(level: number): number {
  return Math.floor(Math.pow(level, 2.0) * 50);
}

export function getCreatureXp(level: number, rarity: string): number {
  return Math.floor(level * 10 * (XP_RARITY_MULTIPLIER[rarity] || 1));
}

// Dice rolling
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function rollDamage(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getStatModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

// Humanoid gold scaling
const HUMANOID_GOLD_RARITY_MULT: Record<string, number> = {
  regular: 1, rare: 1.5, boss: 3,
};

export function calculateHumanoidGold(level: number, rarity: string): { min: number; max: number; chance: number } {
  const mult = HUMANOID_GOLD_RARITY_MULT[rarity] || 1;
  return {
    min: Math.round(level * 1 * mult),
    max: Math.round(level * 3 * mult),
    chance: 1.0,
  };
}

// Generate creature stats based on level and rarity
const RARITY_MULTIPLIER: Record<string, { stat: number; hp: number; ac: number }> = {
  regular: { stat: 1, hp: 1, ac: 0 },
  rare:    { stat: 1.3, hp: 1.5, ac: 2 },
  boss:    { stat: 1.6, hp: 2.5, ac: 4 },
};

// Creature damage dice base by rarity
const CREATURE_DAMAGE_BASE: Record<string, number> = {
  regular: 4, rare: 6, boss: 8,
};

export function getCreatureDamageDie(level: number, rarity: string): number {
  const base = CREATURE_DAMAGE_BASE[rarity] || 4;
  return base + Math.floor(level / 2);
}

export function generateCreatureStats(level: number, rarity: string) {
  const mult = RARITY_MULTIPLIER[rarity] || RARITY_MULTIPLIER.regular;
  const baseStat = 8 + Math.floor(level * 0.7);
  const stats = {
    str: Math.round(baseStat * mult.stat),
    dex: Math.round((baseStat - 1) * mult.stat),
    con: Math.round((baseStat + 1) * mult.stat),
    int: Math.round((baseStat - 2) * mult.stat),
    wis: Math.round((baseStat - 1) * mult.stat),
    cha: Math.round((baseStat - 3) * mult.stat),
  };
  const hp = Math.round((15 + level * 8) * mult.hp);
  const ac = 8 + Math.floor(level * 0.6) + mult.ac;
  return { stats, hp, ac };
}
