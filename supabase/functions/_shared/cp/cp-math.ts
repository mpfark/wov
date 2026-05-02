/**
 * cp-math.ts — Canonical CP arithmetic helpers.
 *
 * INVARIANTS:
 * - rawCp is always server-authoritative.
 * - reservedCp comes from characters.reserved_buffs (server-owned).
 * - queuedCp is client-only preview and must NEVER be persisted.
 * - available CP must never be negative.
 *
 * Pure TS, zero deps. Mirrored byte-for-byte from
 * `src/shared/cp/cp-math.ts` for Deno consumption.
 */

export interface ReservedBuffEntry {
  tier?: number;
  reserved?: number;
  activated_at?: number;
}

export type ReservedBuffsMap = Record<string, ReservedBuffEntry | undefined | null>;

/** Defensive sum: tolerates malformed/partial reserved_buffs maps. */
export function sumReservedCp(map: ReservedBuffsMap | null | undefined): number {
  if (!map) return 0;
  let total = 0;
  for (const entry of Object.values(map)) {
    total += Math.max(Number(entry?.reserved) || 0, 0);
  }
  return total;
}

/** Self-clamping: result is always >= 0. */
export function getAvailableCp(rawCp: number, reservedCp: number, queuedCp = 0): number {
  return Math.max((rawCp ?? 0) - (reservedCp ?? 0) - (queuedCp ?? 0), 0);
}
