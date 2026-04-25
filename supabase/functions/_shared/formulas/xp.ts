/**
 * xp.ts — Experience math (server mirror of src/shared/formulas/xp.ts).
 *
 * Keep this byte-identical (modulo .ts extensions) with the client copy.
 * See client file for full ownership notes.
 */

export const XP_RARITY_MULTIPLIER: Record<string, number> = {
  regular: 1, rare: 1.5, boss: 2.5,
};

export function getXpForLevel(level: number): number {
  return Math.floor(Math.pow(level, 2.0) * 50);
}

export function getCreatureXp(level: number, rarity: string): number {
  return Math.floor(level * 10 * (XP_RARITY_MULTIPLIER[rarity] || 1));
}

/**
 * XP penalty multiplier when a player is over a creature's level.
 * - levels 1–5:  10% per level over creature
 * - levels 6–10: 15%
 * - level 11+:  20%
 * - floor: 10%
 */
export function getXpPenalty(playerLevel: number, creatureLevel: number): number {
  const diff = Math.max(playerLevel - creatureLevel, 0);
  let rate = 0.20;
  if (playerLevel <= 5) rate = 0.10;
  else if (playerLevel <= 10) rate = 0.15;
  return Math.max(1 - diff * rate, 0.10);
}
