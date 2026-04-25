/**
 * creatures.ts — Creature generation formulas.
 *
 * CANONICAL OWNER for: generateCreatureStats, calculateHumanoidGold,
 * RARITY_MULTIPLIER, HUMANOID_GOLD_RARITY_MULT.
 *
 * NOTE: getCreatureDamageDie & getCreatureAttackBonus live in `combat.ts`
 * because they are part of the live damage pipeline.
 */

const RARITY_MULTIPLIER: Record<string, { stat: number; hp: number; ac: number }> = {
  regular: { stat: 1,   hp: 1,   ac: 2 },
  rare:    { stat: 1.3, hp: 1.5, ac: 2 },
  boss:    { stat: 2.5, hp: 6.0, ac: 6 },
};

const HUMANOID_GOLD_RARITY_MULT: Record<string, number> = {
  regular: 1, rare: 1.5, boss: 3,
};

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
  const ac = Math.round(10 + level * 0.575 + mult.ac);
  return { stats, hp, ac };
}

export function calculateHumanoidGold(level: number, rarity: string): { type: string; min: number; max: number; chance: number } {
  const mult = HUMANOID_GOLD_RARITY_MULT[rarity] || 1;
  return {
    type: 'gold',
    min: Math.round(level * 1 * mult),
    max: Math.round(level * 3 * mult),
    chance: 1.0,
  };
}
