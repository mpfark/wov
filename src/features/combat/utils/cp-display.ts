/**
 * Centralized CP math for the UI and ability affordability.
 *
 * Three CP "segments" can occupy the bar:
 *   - Usable: what the player can spend right now.
 *   - Stance reservation: locked by active CP-reservation stances. Cannot be
 *     spent. Released only by dropping the stance (and is NOT refunded).
 *   - Queued ability cost: an in-flight ability the server hasn't processed
 *     yet. Will be deducted shortly.
 *
 * Display rule:
 *   - Filled (usable) portion: max(0, raw - stanceReserved - queuedReserved)
 *   - Stance overlay segment: clamped so it can't exceed (raw - queued)
 *   - Queued overlay segment: clamped so it can't exceed raw
 *
 * Affordability rule:
 *   - A new ability is affordable iff cost <= (raw - stanceReserved - queued)
 */

export interface CpDisplay {
  /** Authoritative current CP from the character row */
  rawCp: number;
  /** Effective max CP (gear-adjusted) */
  maxCp: number;
  /** Locked by active stances */
  stanceReservedCp: number;
  /** In-flight queued ability cost */
  queuedReservedCp: number;
  /** Legacy alias for queuedReservedCp (kept for back-compat) */
  reservedCp: number;
  /** What the player can still spend on a new ability */
  availableCp: number;
  /** What the filled portion of the bar shows */
  displayedCp: number;
  /** Filled CP percentage (0-100) */
  cpPercent: number;
  /** Stance overlay percentage (0-100) — pinned-right reserved tail width */
  stancePercent: number;
  /** Effective max CP after subtracting stance reservation */
  usableMaxCp: number;
  /** Percentage of max that is usable (0-100) = 100 - stancePercent (approx) */
  usableMaxPercent: number;
  /** Queued overlay percentage (0-100) */
  queuedPercent: number;
  /** Legacy alias for queuedPercent (kept for back-compat) */
  reservedPercent: number;
  /** Stance reserved amount actually shown next to the number */
  stanceShown: number;
  /** Queued reserved amount actually shown next to the number */
  queuedShown: number;
  /** Legacy alias for queuedShown (kept for back-compat) */
  reservedShown: number;
}

export function getCpDisplay(
  rawCp: number,
  maxCp: number,
  queuedReservedCp: number,
  stanceReservedCp = 0,
): CpDisplay {
  const safeMax = Math.max(1, maxCp);
  const safeRaw = Math.max(0, rawCp);
  const safeQueued = Math.max(0, queuedReservedCp);
  const safeStance = Math.max(0, stanceReservedCp);
  const queuedShown = Math.min(safeQueued, safeRaw);
  const stanceShown = Math.min(safeStance, Math.max(0, safeRaw - queuedShown));
  const displayedCp = Math.max(0, safeRaw - safeQueued - safeStance);
  const availableCp = displayedCp;
  const cpPercent = Math.round((displayedCp / safeMax) * 100);
  const stancePercent = Math.max(0, Math.min(100, Math.round((stanceShown / safeMax) * 100)));
  const queuedPercent = Math.max(0, Math.min(100, Math.round((queuedShown / safeMax) * 100)));
  const usableMaxCp = Math.max(0, safeMax - safeStance);
  const usableMaxPercent = Math.max(0, Math.min(100, Math.round((usableMaxCp / safeMax) * 100)));
  return {
    rawCp: safeRaw,
    maxCp: safeMax,
    stanceReservedCp: safeStance,
    queuedReservedCp: safeQueued,
    reservedCp: safeQueued,
    availableCp,
    displayedCp,
    cpPercent,
    stancePercent,
    usableMaxCp,
    usableMaxPercent,
    queuedPercent,
    reservedPercent: queuedPercent,
    stanceShown,
    queuedShown,
    reservedShown: queuedShown,
  };
}

/** Convenience for affordability checks. Includes both queued + stance reservations. */
export function getAvailableCp(rawCp: number, queuedReservedCp: number, stanceReservedCp = 0): number {
  return Math.max(0, (rawCp ?? 0) - (queuedReservedCp ?? 0) - (stanceReservedCp ?? 0));
}
