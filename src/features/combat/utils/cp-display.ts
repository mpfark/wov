/**
 * Centralized CP math for the UI and ability affordability.
 *
 * The "raw" CP is the locally-known authoritative value (from `character.cp`).
 * The "reserved" CP is an in-flight queued ability cost the player has
 * committed to spend, but which the server may not yet have processed.
 *
 * Display rule:
 *   - The filled portion of the bar shows: max(0, raw - reserved)
 *   - A separate shaded segment shows the reserved amount, clamped to raw
 *
 * Affordability rule:
 *   - A new ability is only affordable if its cost <= (raw - reserved)
 */

export interface CpDisplay {
  /** Authoritative current CP from the character row */
  rawCp: number;
  /** Effective max CP (gear-adjusted) */
  maxCp: number;
  /** Currently reserved (display-only) cost from any in-flight queued ability */
  reservedCp: number;
  /** What the player can still spend on a new ability */
  availableCp: number;
  /** What the filled portion of the bar shows (max(0, raw - reserved)) */
  displayedCp: number;
  /** Filled CP percentage (0-100) */
  cpPercent: number;
  /** Reserved overlay percentage (0-100), clamped so it can't exceed raw */
  reservedPercent: number;
  /** Reserved amount actually shown next to the number, clamped to raw */
  reservedShown: number;
}

export function getCpDisplay(rawCp: number, maxCp: number, reservedCp: number): CpDisplay {
  const safeMax = Math.max(1, maxCp);
  const safeRaw = Math.max(0, rawCp);
  const safeReserved = Math.max(0, reservedCp);
  const reservedShown = Math.min(safeReserved, safeRaw);
  const displayedCp = Math.max(0, safeRaw - safeReserved);
  const availableCp = displayedCp;
  const cpPercent = Math.round((displayedCp / safeMax) * 100);
  const reservedPercent = Math.max(0, Math.min(100, Math.round((reservedShown / safeMax) * 100)));
  return {
    rawCp: safeRaw,
    maxCp: safeMax,
    reservedCp: safeReserved,
    availableCp,
    displayedCp,
    cpPercent,
    reservedPercent,
    reservedShown,
  };
}

/** Convenience for affordability checks. */
export function getAvailableCp(rawCp: number, reservedCp: number): number {
  return Math.max(0, (rawCp ?? 0) - (reservedCp ?? 0));
}
