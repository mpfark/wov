/**
 * Stance system — CP-reservation buffs that persist for the entire online
 * session and lock part of the player's CP pool until manually dropped.
 *
 * Pure data + tiny helpers so that combat hooks, ability tooltips, and the
 * CP bar overlay all derive from the same source.
 *
 * Reservation cost = ceil(maxCp * tier%), minimum 5 CP.
 *   T1 = 10%  (Eagle Eye, Force Shield, Holy Shield)
 *   T2 = 15%  (Arcane Surge, Battle Cry)
 *   T3 = 20%  (Orbs of Fire, Envenom)
 *
 * Server is authoritative — clients call `activate_stance` / `drop_stance`
 * RPCs and read `character.reserved_buffs` for canonical state. Dropping a
 * stance does NOT refund the reserved CP.
 */

export type StanceKey =
  | 'ignite' | 'envenom'
  | 'holy_shield' | 'force_shield' | 'eagle_eye'
  | 'arcane_surge' | 'battle_cry' | 'shield_wall';

export interface StanceDef {
  key: StanceKey;
  tier: 1 | 2 | 3;
  /** Ability `type` from CLASS_ABILITIES that maps to this stance. */
  abilityType: string;
  label: string;
}

export const STANCE_DEFS: StanceDef[] = [
  { key: 'eagle_eye',    tier: 1, abilityType: 'crit_buff',     label: 'Eagle Eye' },
  { key: 'force_shield', tier: 1, abilityType: 'absorb_buff',   label: 'Force Shield' },
  { key: 'holy_shield',  tier: 1, abilityType: 'reactive_holy', label: 'Holy Shield' },
  { key: 'arcane_surge', tier: 2, abilityType: 'damage_buff',   label: 'Arcane Surge' },
  { key: 'battle_cry',   tier: 2, abilityType: 'battle_cry',    label: 'Battle Cry' },
  { key: 'shield_wall',  tier: 2, abilityType: 'block_buff',    label: 'Shield Wall' },
  { key: 'ignite',       tier: 3, abilityType: 'ignite_buff',   label: 'Orbs of Fire' },
  { key: 'envenom',      tier: 3, abilityType: 'poison_buff',   label: 'Envenom' },
];

const BY_ABILITY_TYPE = new Map(STANCE_DEFS.map(d => [d.abilityType, d]));
const BY_KEY = new Map(STANCE_DEFS.map(d => [d.key, d]));

/** Returns the stance def for an ability type, or null if it's not a stance. */
export function getStanceForAbility(abilityType: string): StanceDef | null {
  return BY_ABILITY_TYPE.get(abilityType) ?? null;
}

export function getStanceByKey(key: string): StanceDef | null {
  return BY_KEY.get(key as StanceKey) ?? null;
}

const TIER_PCT: Record<1 | 2 | 3, number> = { 1: 0.10, 2: 0.15, 3: 0.20 };

/** Compute the CP that would be reserved for a stance given the character's max CP. */
export function getStanceReserveCost(tier: 1 | 2 | 3, maxCp: number): number {
  const safeMax = Math.max(0, maxCp);
  return Math.max(5, Math.ceil(safeMax * TIER_PCT[tier]));
}

export interface ReservedBuffEntry {
  tier: number;
  reserved: number;
  activated_at: number;
}

export type ReservedBuffsMap = Record<string, ReservedBuffEntry>;

// ── Authority ─────────────────────────────────────────────────
// Stances reserve CP and are persisted in characters.reserved_buffs.
// They replace timed buffs for long-term effects. Server RPCs activate_stance
// and drop_stance are authoritative; clients only mirror the returned map.

import { sumReservedCp } from '@/shared/cp/cp-math';

/** Sum the `reserved` values across all active stances.
 *  Thin alias of the canonical `sumReservedCp` (defensive against malformed maps). */
export function sumStanceReserved(reservedBuffs: ReservedBuffsMap | null | undefined): number {
  return sumReservedCp(reservedBuffs as any);
}

/** True if the given stance key is currently active. */
export function isStanceActive(reservedBuffs: ReservedBuffsMap | null | undefined, key: StanceKey): boolean {
  return !!(reservedBuffs && reservedBuffs[key]);
}

/** Mutual exclusion check: ignite/envenom cannot coexist. */
export function isMutuallyExcluded(reservedBuffs: ReservedBuffsMap | null | undefined, key: StanceKey): boolean {
  if (!reservedBuffs) return false;
  if (key === 'ignite' && reservedBuffs.envenom) return true;
  if (key === 'envenom' && reservedBuffs.ignite) return true;
  return false;
}

// ── Stance activate / drop flavor ─────────────────────────────
// Replaces the generic "X activated! Reserves N CP..." line with themed,
// per-stance text. Reserved-CP info is kept as a short trailing parenthetical.

interface StanceFlavor { activate: string; drop: string }

const STANCE_FLAVOR: Record<StanceKey, StanceFlavor> = {
  holy_shield: {
    activate: 'Radiant wards flare around you — Holy Shield burns ready.',
    drop:     'The radiant wards dim and fade.',
  },
  force_shield: {
    activate: 'Threads of arcane light braid into a shimmering barrier.',
    drop:     'The arcane barrier unravels into motes.',
  },
  eagle_eye: {
    activate: 'Your vision narrows — every flaw in your foe stands out.',
    drop:     'The world widens again as Eagle Eye fades.',
  },
  arcane_surge: {
    activate: 'Arcane current crackles down your arms.',
    drop:     'The arcane current ebbs and stills.',
  },
  battle_cry: {
    activate: 'You bellow a battle cry — your blood runs cold and steady.',
    drop:     'Your battle cry falls silent.',
  },
  shield_wall: {
    activate: 'You plant your shield and root your stance.',
    drop:     'You ease out of Shield Wall stance.',
  },
  ignite: {
    activate: 'Embers gather at your fingertips, waiting to leap.',
    drop:     'The embers gutter out.',
  },
  envenom: {
    activate: 'You coat your blade in slow, dark venom.',
    drop:     'You wipe the last of the venom from your blade.',
  },
};

export function getStanceActivateFlavor(key: StanceKey, _cost: number): string {
  const f = STANCE_FLAVOR[key];
  if (!f) return `${key} activated.`;
  return f.activate;
}

export function getStanceDropFlavor(key: StanceKey): string {
  const f = STANCE_FLAVOR[key];
  if (!f) return `${key} dropped.`;
  return f.drop;
}

