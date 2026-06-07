/**
 * Bond multiplier — class mastery scalar.
 *
 * Bond is stored 0..100 per (character, class) in `character_class_bonds`.
 * The multiplier is intentionally gentle: max bond grants +15% magnitude,
 * never duration. Negative or out-of-range inputs clamp to 1.00×.
 *
 * Applied AFTER `getEffectiveCombatMod`, at the final magnitude step of:
 *   - direct damage (autoattacks, ability direct hits)
 *   - DoT / HoT per-tick magnitudes (Rend, Ignite, Envenom, etc.)
 *   - utility magnitudes (Sunder armor reduction, root strength, …)
 *
 * NOT applied to: durations, cooldowns, hit chance, AC, costs, item procs.
 *
 * NOTE: Mirrored to `supabase/functions/_shared/formulas/bond.ts` — keep
 * the two files byte-for-byte equivalent.
 */

/** Returns a multiplier in [1.00, 1.15]. */
export function bondMultiplier(bond: number | null | undefined): number {
  const b = Math.max(0, Math.min(100, Number(bond) || 0));
  return 1 + b * 0.0015;
}

/**
 * Bond gain awarded for a single kill. Mirrors the SQL helper
 * `public.award_class_bond_for_kill` so client previews/log copy match.
 */
export function bondGainForKill(creatureLevel: number, isBoss: boolean): number {
  const raw = Math.round((creatureLevel || 1) * 0.5 + (isBoss ? 5 : 0));
  return Math.max(1, Math.min(25, raw));
}
