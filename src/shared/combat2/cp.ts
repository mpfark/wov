import type { AbilitySpec } from './mechanics';
import type { SnapshotEffect } from './types';

/** Arithmetic only: callers supply the authoritative active effects and working resources. */
export function effectiveBaseCp(spec: AbilitySpec, effects: readonly SnapshotEffect[]): number {
  if (spec.activation === 'stance') return spec.cpCost;
  const discount = effects.filter(effect => effect.kind === 'offense'
    && effect.config.offense_mode === 'base_cp_discount')
    .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0) || a.id.localeCompare(b.id))[0];
  return discount ? Math.max(Number(discount.config.cp_discount_min), spec.cpCost - (discount.magnitude ?? 0)) : spec.cpCost;
}

export function stanceReservationCp(spec: AbilitySpec, maxCp: number): number {
  return spec.cpReserveFixed ?? Math.floor(Math.max(0, maxCp) * (spec.cpReservePct ?? 0));
}
