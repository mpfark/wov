/**
 * xp.ts — Experience math.
 *
 * CANONICAL OWNER for: XP_RARITY_MULTIPLIER, getXpForLevel, getCreatureXp,
 * and the XP penalty curve.
 *
 * ── XP penalty: single curve, server-authoritative ───────────────
 * Kill rewards (XP, gold, Renown, salvage, loot) are written exclusively by
 * the `combat-tick` / `combat-catchup` Edge Functions via
 * `_shared/reward-calculator.ts`. The client no longer computes its own
 * solo XP — it just applies what the server returns.
 *
 * Historically there were two curves:
 *   - a lenient solo curve (rates 0.06 / 0.09 / 0.12), used by the old
 *     client-side `awardKillRewards` path (now removed)
 *   - a harsher party curve (rates 0.10 / 0.15 / 0.20), used by the server
 *
 * With the unified server-authoritative path, only the harsher curve is
 * live. We therefore keep ONE function — `getXpPenalty` — and removed the
 * dead `getXpPenaltySolo` / `getXpPenaltyParty` split. If you ever want to
 * change kill-reward generosity, edit this single function.
 */

export const XP_RARITY_MULTIPLIER: Record<string, number> = {
  regular: 1, rare: 1.5, boss: 2.5,
};

/** XP required to reach the next level */
export function getXpForLevel(level: number): number {
  return Math.floor(Math.pow(level, 2.0) * 50);
}

/** Base XP awarded for killing a creature (before penalties / boosts / splits). */
export function getCreatureXp(level: number, rarity: string): number {
  return Math.floor(level * 10 * (XP_RARITY_MULTIPLIER[rarity] || 1));
}

/**
 * XP penalty multiplier when a player is over a creature's level.
 * - levels 1–5:  10% per level over creature
 * - levels 6–10: 15%
 * - level 11+:  20%
 * - floor: 10%
 *
 * Returns a multiplier in [0.10, 1.00].
 */
export function getXpPenalty(playerLevel: number, creatureLevel: number): number {
  const diff = Math.max(playerLevel - creatureLevel, 0);
  let rate = 0.20;
  if (playerLevel <= 5) rate = 0.10;
  else if (playerLevel <= 10) rate = 0.15;
  return Math.max(1 - diff * rate, 0.10);
}
