/**
 * pure/party-xp.ts — party-size XP bonus, pure.
 *
 * Mirrors the legacy curve in `supabase/functions/_shared/reward-calculator.ts`
 * (`mem://game/combat-system/party-xp-bonus`): 1.00 / 1.15 / 1.25 / 1.40.
 */

export const PARTY_XP_BONUS: readonly number[] = [1.0, 1.0, 1.15, 1.25, 1.4];

export function getPartyXpBonus(partySize: number): number {
  const n = Number.isFinite(partySize) ? Math.floor(partySize) : 1;
  if (n <= 1) return PARTY_XP_BONUS[1];
  return PARTY_XP_BONUS[Math.min(n, PARTY_XP_BONUS.length - 1)];
}
