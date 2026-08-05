/**
 * ability-registry.test.ts — Phase 2b gate for configurable abilities.
 *
 * 1. The hardcoded `CLASS_ABILITIES` fallback lists must stay balance-identical
 *    to `ABILITY_SEED` (the data seeded into `abilities` /
 *    `class_ability_assignments`), so switching the config path on is a no-op.
 * 2. Every seeded `mechanic_key` must map to an implemented runtime handler.
 * 3. `setAbilityRegistry` must override `CLASS_ABILITIES` in place, honour
 *    status/default filters, and drop rows with unknown mechanics.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  CLASS_ABILITIES, setAbilityRegistry, resetAbilityRegistry,
  isAbilityRegistryLoaded, isKnownAbilityMechanic, getUnlockedAbilities,
  type AbilityConfigRow,
} from '@/features/combat/utils/class-abilities';
import { ABILITY_SEED, ABILITY_ROLE_SEED } from '@/shared/config/ability-seed';

const roleUnlock = new Map(ABILITY_ROLE_SEED.map(r => [r.slot, r.unlock_level]));

afterEach(() => resetAbilityRegistry());

describe('fallback ability lists match the seeded ability rows', () => {
  it('covers exactly the same class/slot grid', () => {
    const seedKeys = ABILITY_SEED.map(a => `${a.class_key}:${a.slot}`).sort();
    const fallbackKeys = Object.entries(CLASS_ABILITIES)
      .flatMap(([cls, list]) => list.map(a => `${cls}:${a.tier}`)).sort();
    expect(fallbackKeys).toEqual(seedKeys);
  });

  for (const seed of ABILITY_SEED) {
    it(`${seed.class_key}/${seed.ability_key} is identical`, () => {
      const fallback = (CLASS_ABILITIES[seed.class_key] ?? []).find(a => a.tier === seed.slot);
      expect(fallback).toBeTruthy();
      expect(fallback!.label).toBe(seed.label);
      expect(fallback!.description).toBe(seed.description);
      expect(fallback!.tooltip).toBe(seed.tooltip);
      expect(fallback!.cpCost).toBe(seed.cp_cost);
      expect(fallback!.type).toBe(seed.mechanic_key);
      expect(fallback!.levelRequired).toBe(roleUnlock.get(seed.slot));
    });
  }

  it('every seeded mechanic has a runtime handler', () => {
    for (const seed of ABILITY_SEED) {
      expect(isKnownAbilityMechanic(seed.mechanic_key)).toBe(true);
    }
  });
});

function row(over: Partial<AbilityConfigRow> & { slot?: number; label?: string; mechanic?: string } = {}): AbilityConfigRow {
  const { slot = 0, label = 'Configured', mechanic = 'weapon_attack', ...rest } = over;
  return {
    class_key: 'warrior',
    unlock_level: 3,
    is_default: true,
    status: 'active',
    role: { slot },
    ability: {
      label,
      description: 'Configured description',
      tooltip: 'Configured tooltip',
      cp_cost: 7,
      mechanic_key: mechanic,
      status: 'active',
    },
    ...rest,
  } as AbilityConfigRow;
}

describe('setAbilityRegistry overrides ability lists in place', () => {
  it('replaces the configured class and leaves others on fallback', () => {
    const healerBefore = CLASS_ABILITIES.healer.map(a => a.label);

    setAbilityRegistry([row({ slot: 2, label: 'Configured Two' }), row({ slot: 1 })]);

    expect(isAbilityRegistryLoaded()).toBe(true);
    expect(CLASS_ABILITIES.warrior.map(a => a.label)).toEqual(['Configured', 'Configured Two']);
    expect(CLASS_ABILITIES.warrior[0]).toMatchObject({
      cpCost: 7, type: 'weapon_attack', tier: 0, levelRequired: 3,
      description: 'Configured description', tooltip: 'Configured tooltip',
    });
    expect(CLASS_ABILITIES.healer.map(a => a.label)).toEqual(healerBefore);
  });

  it('filters retired, non-default and unknown-mechanic rows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setAbilityRegistry([
      row(),
      row({ slot: 2, label: 'Draft', status: 'draft' }),
      row({ slot: 3, label: 'Retired Ability', ability: { ...row().ability!, status: 'retired' } }),
      row({ slot: 4, label: 'Not Default', is_default: false }),
      row({ slot: 5, label: 'Broken', mechanic: 'teleport_to_moon' }),
    ]);

    expect(CLASS_ABILITIES.warrior.map(a => a.label)).toEqual(['Configured']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('teleport_to_moon'));
    warn.mockRestore();
  });

  it('ignores an empty payload and keeps fallbacks', () => {
    setAbilityRegistry([]);
    expect(isAbilityRegistryLoaded()).toBe(false);
    expect(CLASS_ABILITIES.warrior[0].label).toBe('Power Strike');
  });

  it('resetAbilityRegistry restores the fallback lists', () => {
    setAbilityRegistry([row()]);
    resetAbilityRegistry();
    expect(CLASS_ABILITIES.warrior.map(a => a.label)).toEqual(
      ABILITY_SEED.filter(a => a.class_key === 'warrior').sort((a, b) => a.slot - b.slot).map(a => a.label),
    );
  });
});

describe('getUnlockedAbilities', () => {
  it('gates by the configured unlock level', () => {
    expect(getUnlockedAbilities('warrior', 1).map(a => a.tier)).toEqual([0]);
    expect(getUnlockedAbilities('warrior', 20).length).toBe(5);
    expect(getUnlockedAbilities('classless', 42)).toEqual([]);

    setAbilityRegistry([row({ slot: 5, label: 'Early Capstone', unlock_level: 2 })]);
    expect(getUnlockedAbilities('warrior', 2).map(a => a.label)).toEqual(['Early Capstone']);
    // Config slots are 1-based; the runtime tier is normalized to a 0-based index.
    expect(CLASS_ABILITIES.warrior[0].tier).toBe(0);
  });
});
