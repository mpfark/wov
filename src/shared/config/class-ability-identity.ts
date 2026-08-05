/**
 * class-ability-identity.ts — canonical per-class ability identity.
 *
 * Phase 1 of the ability-consolidation model. Base `abilities` rows are a
 * reusable library: two classes may share one base (Power Strike / Aimed Shot /
 * Backstab all become one "focused attack" base). Identity therefore cannot
 * live on the base row any more — it lives on the assignment as
 * `class_ability_assignments.class_ability_key`.
 *
 * Rules (mirrored by the SQL constraint + unique index):
 *  - lowercase letters, digits and underscores, starting with a letter
 *  - unique per class among ACTIVE assignments
 *  - the base `ability_key` remains a valid ALIAS for resolution, so clients
 *    that still send the base key keep working.
 *
 * Mirrored (modulo Deno `.ts` specifiers) to
 * `supabase/functions/_shared/config/class-ability-identity.ts`.
 */

export const CLASS_ABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Normalize arbitrary text into a legal class ability key. */
export function normalizeClassAbilityKey(raw: string): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return CLASS_ABILITY_KEY_PATTERN.test(slug) ? slug : `ability_${slug || 'unnamed'}`;
}

export function isValidClassAbilityKey(key: string): boolean {
  return CLASS_ABILITY_KEY_PATTERN.test(key ?? '');
}

/**
 * Pick a free class ability key: prefer the base key, then a class-qualified
 * variant, then a numeric suffix. Deterministic so admin UI and server agree.
 */
export function deriveClassAbilityKey(
  baseKey: string,
  classKey: string,
  taken: readonly string[] = [],
): string {
  const used = new Set(taken);
  const base = normalizeClassAbilityKey(baseKey);
  if (!used.has(base)) return base;
  const qualified = normalizeClassAbilityKey(`${classKey}_${base}`);
  if (!used.has(qualified)) return qualified;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}
