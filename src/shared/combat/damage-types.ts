/**
 * damage-types.ts — Phase 5 shared combat foundation.
 *
 * The single canonical damage-type vocabulary for the whole game: authored
 * boss casts, boss crit flavors, ability rows (`abilities.damage_type`) and
 * structured log events (`GameLogEvent.damageType`).
 *
 * Owns identity + presentation-neutral prose helpers only. It does NOT own
 * resistances or mitigation math — those stay in the damage pipeline.
 *
 * Mirrored byte-for-byte to `supabase/functions/_shared/combat/damage-types.ts`
 * so edge functions and the client can never drift apart.
 */

export interface DamageTypeMeta {
  /** Canonical storage key. Never displayed raw. */
  key: string;
  /** Display noun, e.g. "Fire". */
  label: string;
  /** Decorative only — carries no routing meaning. */
  /** Adjective used inside generated prose, e.g. "searing". */
  adjective: string;
}

export const DAMAGE_TYPE_REGISTRY: readonly DamageTypeMeta[] = [
  { key: 'physical', label: 'Physical', adjective: 'brutal' },
  { key: 'fire', label: 'Fire', adjective: 'searing' },
  { key: 'frost', label: 'Frost', adjective: 'freezing' },
  { key: 'lightning', label: 'Lightning', adjective: 'crackling' },
  { key: 'poison', label: 'Poison', adjective: 'venomous' },
  { key: 'nature', label: 'Nature', adjective: 'thorned' },
  { key: 'necrotic', label: 'Necrotic', adjective: 'withering' },
  { key: 'holy', label: 'Holy', adjective: 'radiant' },
  { key: 'shadow', label: 'Shadow', adjective: 'creeping' },
  { key: 'arcane', label: 'Arcane', adjective: 'unraveling' },
  { key: 'psychic', label: 'Psychic', adjective: 'maddening' },
] as const;

export type DamageTypeKey = (typeof DAMAGE_TYPE_REGISTRY)[number]['key'];

export const DAMAGE_TYPE_KEYS: readonly string[] = DAMAGE_TYPE_REGISTRY.map(d => d.key);

const BY_KEY = new Map<string, DamageTypeMeta>(
  DAMAGE_TYPE_REGISTRY.map(d => [d.key, d]),
);

/**
 * Coerce any stored/authored value to a canonical key.
 * Unknown values (typos, retired types, empty) resolve to `null` — untyped
 * damage is legal and simply renders without a type adjective.
 */
export function normalizeDamageType(value: unknown): DamageTypeKey | null {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key || key === 'none') return null;
  return BY_KEY.has(key) ? (key as DamageTypeKey) : null;
}

export function getDamageType(value: unknown): DamageTypeMeta | null {
  const key = normalizeDamageType(value);
  return key ? BY_KEY.get(key)! : null;
}

/** "Fire" for a known type, `''` for untyped damage. */
export function damageTypeLabel(value: unknown): string {
  return getDamageType(value)?.label ?? '';
}

/** "searing" for a known type, `''` for untyped damage — safe to inline in prose. */
export function damageTypeAdjective(value: unknown): string {
  return getDamageType(value)?.adjective ?? '';
}

/** Options for admin `<Select>` controls: `{ value, label }`. */
export const DAMAGE_TYPE_OPTIONS: readonly { value: string; label: string }[] =
  DAMAGE_TYPE_REGISTRY.map(d => ({ value: d.key, label: d.label }));
