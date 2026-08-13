/**
 * C3a machine-check: every ACTIVE ability and every ACTIVE mechanic in the live
 * configuration must be represented by the pure resolver.
 *
 * The inventory is NOT a hand-maintained list. It is generated from
 * `class_ability_assignments x abilities x base_abilities` (status = active) by
 * `scripts/dump-active-ability-inventory.ts` into
 * `src/shared/combat/inventory/active-abilities.json`. Regenerate it after any
 * admin ability change; this test then fails until the resolver supports what
 * the configuration actually publishes.
 */
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import {
  MECHANIC_FAMILY,
  RESOLVER_MECHANICS,
  isResolverMechanic,
} from '@/shared/combat/pure/mechanics';
import { RESOLVED_MECHANICS } from '@/shared/combat/pure/resolver';
import { getMechanicTemplate } from '@/shared/config/mechanic-templates';

interface Row {
  classKey: string;
  classAbilityKey: string;
  abilityKey: string;
  baseKey: string | null;
  mechanic: string | null;
  targetType: string | null;
  damageType: string | null;
}

const rows = inventory.abilities as unknown as Row[];
const activeMechanics = [...new Set(rows.map((r) => r.mechanic))].sort();

describe('C3a active-ability coverage', () => {
  it('the inventory is non-empty and derived from the live configuration', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(inventory.abilityCount).toBe(rows.length);
    expect(inventory.source).toContain('class_ability_assignments');
  });

  it('every active ability declares a mechanic supported by the resolver', () => {
    const unsupported = rows
      .filter((r) => !isResolverMechanic(r.mechanic))
      .map((r) => `${r.classKey}:${r.classAbilityKey} -> ${r.mechanic}`);
    expect(unsupported).toEqual([]);
  });

  it('every active mechanic has a resolver implementation branch', () => {
    const missing = activeMechanics.filter((m) => !RESOLVED_MECHANICS.has(m as never));
    expect(missing).toEqual([]);
  });

  it('every registered mechanic is actually resolved (no dead labels)', () => {
    const dead = RESOLVER_MECHANICS.filter((m) => !RESOLVED_MECHANICS.has(m));
    expect(dead).toEqual([]);
  });

  it('no active ability is silently mapped onto a foreign semantic family', () => {
    // A mechanic's family must match the configured mechanic template, so an
    // ability cannot be re-pointed at a look-alike branch (e.g. a stack
    // applier folded into a plain DoT) without this failing.
    const mismatches: string[] = [];
    for (const r of rows) {
      const template = getMechanicTemplate(r.mechanic ?? '');
      if (!template) {
        mismatches.push(`${r.classKey}:${r.classAbilityKey} has no mechanic template`);
        continue;
      }
      const family = MECHANIC_FAMILY[r.mechanic as never];
      if (!family) mismatches.push(`${r.mechanic} has no declared family`);
    }
    expect(mismatches).toEqual([]);
  });

  it('each ability has a golden test naming it', async () => {
    const golden = await import('./golden-abilities.test-manifest');
    const covered = new Set(golden.GOLDEN_ABILITY_IDS);
    const missing = rows
      .map((r) => `${r.classKey}:${r.classAbilityKey}`)
      .filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });
});
