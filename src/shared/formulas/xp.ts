/**
 * xp.ts — Experience math.
 *
 * CANONICAL OWNER for: XP_RARITY_MULTIPLIER, getXpForLevel, getCreatureXp,
 * and the two XP penalty curves.
 *
 * ── XP penalty: TWO curves coexist intentionally ─────────────────
 * The codebase historically used two different penalty curves at two
 * different call sites; we preserve both behaviors (no balance change in
 * this cleanup pass) and rename them so future readers can see the split:
 *
 *   `getXpPenaltySolo`  — lenient curve (rates 0.06 / 0.09 / 0.12)
 *                         used by the client when a solo player kills a
 *                         creature in `useCombatActions.awardKillRewards`.
 *   `getXpPenaltyParty` — harsher curve (rates 0.10 / 0.15 / 0.20)
 *                         used by the server in `reward-calculator.ts` when
 *                         distributing XP to party members.
 *
 * The legacy `getXpPenalty` export is kept as an alias of `getXpPenaltySolo`
 * (the historic client name from `game-data.ts`) so existing imports continue
 * to behave identically. Audit each call site before changing which curve it
 * uses; that is a balance decision, not a refactor.
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
 * Solo XP penalty (lenient).
 * - levels 1–5:  6% per level over creature
 * - levels 6–10: 9%
 * - level 11+:  12%
 * - floor: 10%
 */
export function getXpPenaltySolo(playerLevel: number, creatureLevel: number): number {
  const diff = Math.max(playerLevel - creatureLevel, 0);
  let rate = 0.12;
  if (playerLevel <= 5) rate = 0.06;
  else if (playerLevel <= 10) rate = 0.09;
  return Math.max(1 - diff * rate, 0.10);
}

/**
 * Party XP penalty (harsher).
 * - levels 1–5:  10% per level over creature
 * - levels 6–10: 15%
 * - level 11+:  20%
 * - floor: 10%
 */
export function getXpPenaltyParty(playerLevel: number, creatureLevel: number): number {
  const diff = Math.max(playerLevel - creatureLevel, 0);
  let rate = 0.20;
  if (playerLevel <= 5) rate = 0.10;
  else if (playerLevel <= 10) rate = 0.15;
  return Math.max(1 - diff * rate, 0.10);
}

/**
 * @deprecated Ambiguous: prefer `getXpPenaltySolo` or `getXpPenaltyParty`
 * depending on call site. Kept as an alias of the solo (lenient) curve to
 * preserve historic behavior of all client imports of `getXpPenalty` from
 * `@/lib/game-data`.
 */
export const getXpPenalty = getXpPenaltySolo;
