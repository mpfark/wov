/**
 * resources.ts — HP/CP/MP cap & regen formulas.
 *
 * CANONICAL OWNER for: getMaxHp, getMaxCp, getMaxMp, getEffectiveMax*, regen helpers.
 *
 * ⚠️ SQL MIRROR: `public.sync_character_resources()` mirrors getMaxHp/Cp/Mp
 * in PL/pgSQL. If you change the numbers here, also update that RPC.
 */

import { getStatModifier } from './stats.ts';
import { CLASS_BASE_HP } from './classes.ts';

/** Max HP = base class HP + CON modifier + (level-1)*5
 *  Returns the BASE max — gear bonuses are layered on by `getEffectiveMaxHp`. */
export function getMaxHp(charClass: string, con: number, level: number): number {
  const baseHP = CLASS_BASE_HP[charClass] || 18;
  return baseHP + getStatModifier(con) + (level - 1) * 5;
}

/** Max Concentration Points — scales with INT + WIS */
export function getMaxCp(level: number, int: number = 10, wis: number = 10, _cha: number = 10): number {
  const intMod = Math.max(getStatModifier(int), 0);
  const wisMod = Math.max(getStatModifier(wis), 0);
  return 30 + (level - 1) * 3 + (intMod + wisMod) * 3;
}

/** Max Movement Points (stamina) */
export function getMaxMp(level: number, dex: number = 10): number {
  const dexMod = Math.max(getStatModifier(dex), 0);
  return 100 + dexMod * 10 + Math.floor((level - 1) * 2);
}

/** Gear-effective max HP: base HP using (CON + gear CON) plus flat hp gear bonus. */
export function getEffectiveMaxHp(
  charClass: string,
  baseCon: number,
  level: number,
  equipmentBonuses: Record<string, number>,
): number {
  return getMaxHp(charClass, baseCon + (equipmentBonuses.con || 0), level) + (equipmentBonuses.hp || 0);
}

export function getEffectiveMaxCp(
  level: number,
  int: number,
  wis: number,
  cha: number,
  equipmentBonuses: Record<string, number>,
): number {
  return getMaxCp(
    level,
    int + (equipmentBonuses.int || 0),
    wis + (equipmentBonuses.wis || 0),
    cha + (equipmentBonuses.cha || 0),
  );
}

export function getEffectiveMaxMp(level: number, dex: number, equipmentBonuses: Record<string, number>): number {
  return getMaxMp(level, dex + (equipmentBonuses.dex || 0));
}

/** Unified regen base: same formula for HP (CON) and CP (INT). */
export function getStatRegen(stat: number): number {
  return 2 + Math.floor(Math.sqrt(Math.max(0, stat - 10)));
}

export function getMpRegenRate(dex: number = 10): number {
  const dexMod = Math.max(getStatModifier(dex), 0);
  return Math.round((5 + dexMod) * 0.67);
}

// ── Milestone Regen Track (Level 20+) ───────────────────────────

export function getMilestoneHpRegen(level: number): number {
  if (level >= 40) return 10;
  if (level >= 35) return 8;
  if (level >= 30) return 6;
  if (level >= 25) return 4;
  if (level >= 20) return 2;
  return 0;
}

export function getMilestoneCpRegen(level: number): number {
  if (level >= 40) return 5;
  if (level >= 35) return 4;
  if (level >= 30) return 3;
  if (level >= 25) return 2;
  if (level >= 20) return 1;
  return 0;
}
