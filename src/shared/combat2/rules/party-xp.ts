/**
 * pure/party-xp.ts — party-size XP bonus, pure.
 *
 * Byte-equivalent to the legacy table in
 * `supabase/functions/_shared/reward-calculator.ts`: 1.00 / 1.15 / 1.30 / 1.40,
 * clamped at four members (`mem://game/combat-system/party-xp-bonus`).
 */

export const PARTY_XP_BONUS: Record<number, number> = {
  1: 1.0,
  2: 1.15,
  3: 1.3,
  4: 1.4,
};

export function getPartyXpBonus(memberCount: number): number {
  const n = Number.isFinite(memberCount) ? Math.max(1, Math.floor(memberCount)) : 1;
  return PARTY_XP_BONUS[Math.min(n, 4)] ?? 1.0;
}
