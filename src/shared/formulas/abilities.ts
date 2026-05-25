/**
 * abilities.ts — Per-ability magnitude & rate formulas.
 *
 * CANONICAL OWNER for: every "what % does this ability do" number that used
 * to be hardcoded in `useCombatActions.ts` or `combat-tick`. Each helper
 * returns a soft-capped value driven by one class primary stat so that the
 * other primary can keep owning the rate/duration/stack side.
 *
 * Policy: NO hardcoded magnitudes in ability handlers. Every active ability
 * must scale on both of its owning class's primary attributes — magnitude on
 * one, rate/duration on the other.
 *
 * Pure TS, zero deps. Mirrored byte-for-byte to
 * `supabase/functions/_shared/formulas/abilities.ts`.
 */

import { diminishing, diminishingFloat } from './stats';

// ── Warrior ──────────────────────────────────────────────────────

/** Battle Cry (warrior, STR magnitude / DEX duration).
 *  DR floor 10%, scales with STR up to +12%, +5% with a shield.
 *  Crit reduction uses the same curve as DR. */
export function getBattleCryDR(strMod: number, hasShield: boolean): { dr: number; critReduction: number } {
  const base = 0.10 + diminishingFloat(Math.max(0, strMod), 0.02, 0.12);
  return {
    dr: base + (hasShield ? 0.05 : 0),
    critReduction: base,
  };
}

// ── Ranger / Bard root debuff ────────────────────────────────────

/** Nature's Snare (ranger DEX) / Dissonance (bard CHA) magnitude.
 *  25% floor, scales with the second primary up to +15% (cap 40%). */
export function getRootReduction(secondaryMod: number): number {
  return 0.25 + diminishingFloat(Math.max(0, secondaryMod), 0.02, 0.15);
}

// ── Ranger Disengage ─────────────────────────────────────────────

/** Disengage next-hit damage multiplier (ranger, DEX duration / WIS magnitude).
 *  Floor 1.30×, scales with WIS up to 1.70×. */
export function getDisengageMult(wisMod: number): number {
  return 1.30 + diminishingFloat(Math.max(0, wisMod), 0.05, 0.40);
}

// ── Rogue Cloak of Shadows ───────────────────────────────────────

/** Cloak of Shadows dodge chance (rogue, DEX duration / CHA magnitude).
 *  Floor 40%, scales with CHA up to 60%. */
export function getCloakDodge(chaMod: number): number {
  return 0.40 + diminishingFloat(Math.max(0, chaMod), 0.03, 0.20);
}

// ── Rogue Envenom (server-side proc) ─────────────────────────────

/** Envenom hit-proc chance (rogue, DEX magnitude).
 *  Floor 25%, scales with DEX up to 45%. */
export function getEnvenomProc(dexMod: number): number {
  return 0.25 + diminishingFloat(Math.max(0, dexMod), 0.04, 0.20);
}

/** Envenom max stack ceiling (rogue, CHA rate).
 *  Floor 3 stacks, scales with CHA up to 7. */
export function getEnvenomMaxStacks(chaMod: number): number {
  return 3 + diminishing(Math.max(0, chaMod), 4);
}

// ── Wizard Arcane Surge (stance damage multiplier) ───────────────

/** Arcane Surge global damage multiplier (wizard, INT magnitude).
 *  Floor 1.10×, scales with INT up to 1.22×. */
export function getArcaneSurgeMult(intMod: number): number {
  return 1.10 + diminishingFloat(Math.max(0, intMod), 0.02, 0.12);
}

// ── Wizard Conflagrate (consume burn stacks) ─────────────────────

/** Conflagrate per-stack bonus damage ratio (wizard, INT magnitude).
 *  Floor +30%/stack, scales with INT up to +70%/stack. */
export function getConflagratePerStack(intMod: number): number {
  return 0.30 + diminishingFloat(Math.max(0, intMod), 0.05, 0.40);
}

// ── Wizard Ignite (orb proc chance) ──────────────────────────────

/** Ignite orb pulse chance per heartbeat (wizard, INT magnitude).
 *  Floor 25%, scales with INT up to 50%. */
export function getIgniteOrbChance(intMod: number): number {
  return 0.25 + diminishingFloat(Math.max(0, intMod), 0.04, 0.25);
}

// ── Ranger Barrage (per-arrow damage ratio vs autoattack) ────────

/** Barrage per-arrow damage ratio (ranger, DEX magnitude).
 *  Floor 55% of base arrow damage, scales with DEX up to 80%.
 *  (Applied as a multiplier on the computed per-arrow base.) */
export function getBarragePerArrowRatio(dexMod: number): number {
  return 0.55 + diminishingFloat(Math.max(0, dexMod), 0.04, 0.25);
}

// ── Templar Divine Challenge ─────────────────────────────────────

/** Divine Challenge damage reduction (templar, WIS magnitude / CON duration).
 *  Floor 20%, scales with WIS up to 40%. */
export function getDivineChallengeReduction(wisMod: number): number {
  return 0.20 + diminishingFloat(Math.max(0, wisMod), 0.03, 0.20);
}
