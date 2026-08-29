import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import {
  buildAbilityCatalog,
  buildAbilitySpec,
  lookupSpec,
  type AuthoredAbilityRecord,
} from '../catalog';
import { adaptBossCast, buildBossCatalog, type AuthoredBossCast } from '../boss-catalog';
import { resolveMainHandDie } from '../mechanics';
import type { SnapshotEquipment } from '../types';

const records = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;

describe('authored ability catalogue', () => {
  it('reads the real active inventory, not a hand-written fixture', () => {
    expect(records.length).toBeGreaterThanOrEqual(30);
  });

  it('accounts for every authored record exactly once: adapted or explicitly refused', () => {
    const { specs, rejected } = buildAbilityCatalog(records);
    const refused = new Set(rejected.map((r) => `${r.classKey}:${r.abilityKey}`));
    let adapted = 0;
    for (const record of records) {
      const key = `${record.classKey}:${record.abilityKey}`;
      if (refused.has(key)) continue;
      adapted += 1;
      expect(specs.has(key)).toBe(true);
    }
    expect(adapted + refused.size).toBe(records.length);
    for (const rejection of rejected) expect(rejection.reason).toBeTruthy();
  });

  it('refuses a mechanic outside the closed registry instead of guessing one', () => {
    const attack = records.find((r) => r.mechanic === 'weapon_attack');
    expect(attack).toBeDefined();
    const out = buildAbilitySpec({ ...attack!, mechanic: 'not_a_mechanic' });
    expect('rejection' in out).toBe(true);
    if ('rejection' in out) expect(out.rejection.reason).toBe('unsupported_mechanic');
  });

  it('normalizes the authored reactive_holy mechanic onto reactive_damage, keeping its authoring', () => {
    const authored = records.find((r) => r.mechanic === 'reactive_holy');
    expect(authored).toBeDefined();
    const out = buildAbilitySpec(authored!);
    expect('spec' in out).toBe(true);
    if (!('spec' in out)) return;
    expect(out.spec.mechanic).toBe('reactive_damage');
    expect(out.spec.authoredMechanic).toBe('reactive_holy');
    expect(out.spec.damageType).toBe(authored!.damageType);
    expect(out.spec.activation).toBe('stance');
    expect(out.spec.cpReservePct).toBe(authored!.cpReservePct);
    expect(out.spec.mechanicCalcs.retaliation_damage).toBeDefined();
    expect(out.spec.config.once_per_attacker_per_tick).toBe(true);
  });

  it('refuses a reactive record with no authored retaliation magnitude', () => {
    const authored = records.find((r) => r.mechanic === 'reactive_holy');
    expect(authored).toBeDefined();
    const out = buildAbilitySpec({ ...authored!, mechanicCalcs: {} });
    expect('rejection' in out).toBe(true);
    if ('rejection' in out) expect(out.rejection.reason).toBe('missing_mechanic_calc');
  });

  it('refuses a record whose mechanic-specific calculation is missing', () => {
    const multi = records.find((r) => r.mechanic === 'multi_attack');
    expect(multi).toBeDefined();
    const out = buildAbilitySpec({ ...multi!, mechanicCalcs: {} });
    expect('rejection' in out).toBe(true);
    if ('rejection' in out) expect(out.rejection.reason).toBe('missing_mechanic_calc');
  });

  it('refuses a damaging record with no authored magnitude rather than dealing zero', () => {
    const attack = records.find((r) => r.mechanic === 'weapon_attack');
    expect(attack).toBeDefined();
    const out = buildAbilitySpec({ ...attack!, amountCalc: null });
    expect('rejection' in out).toBe(true);
    if ('rejection' in out) expect(out.rejection.reason).toBe('missing_amount_calc');
  });

  it('resolves a class-scoped key in preference to the bare ability key', () => {
    const catalog = buildAbilityCatalog(records);
    const { specs } = catalog;
    const scoped = [...specs.keys()].find((k) => k.includes(':'));
    expect(scoped).toBeDefined();
    const [classKey, abilityKey] = scoped!.split(':');
    expect(lookupSpec(catalog, classKey, abilityKey)).toBe(specs.get(scoped!));
    expect(lookupSpec(catalog, 'no_such_class', abilityKey)).toBe(specs.get(abilityKey));
  });
});

describe('authored boss casts', () => {
  const cast: AuthoredBossCast = {
    ability_key: 'granite_slam',
    label: 'Granite Slam',
    cast_ms: 4000,
    chance: 0.25,
    base_amount: 30,
    damage_type: 'physical',
    cast_flavor: 'raises its fists',
    hit_flavor: 'slams the ground',
  };

  it('converts millisecond wind-up into whole authoritative ticks', () => {
    const out = adaptBossCast('cr-1', cast);
    expect('ability' in out).toBe(true);
    if ('ability' in out) {
      expect(out.ability.windup_ticks).toBe(2);
      expect(out.ability.magnitude).toBe(30);
      expect(out.ability.telegraph_text).toBe('raises its fists');
    }
  });

  it('refuses a cast with no identity, no amount, or no timing', () => {
    const cases: Array<[AuthoredBossCast, string]> = [
      [{ ...cast, ability_key: null }, 'missing_ability_key'],
      [{ ...cast, base_amount: null }, 'missing_amount'],
      [{ ...cast, cast_ms: null }, 'missing_cast_ms'],
    ];
    for (const [bad, reason] of cases) {
      const out = adaptBossCast('cr-1', bad);
      expect('rejection' in out).toBe(true);
      if ('rejection' in out) expect(out.rejection.reason).toBe(reason);
    }
  });

  it('refuses stored-power and split primary/area semantics rather than inventing them', () => {
    const stored = adaptBossCast('cr-1', { ...cast, accumulate: { enabled: true } });
    expect('rejection' in stored && stored.rejection.reason).toBe('stored_power_unsupported');
    const split = adaptBossCast('cr-1', { ...cast, base_aoe_amount: 10 });
    expect('rejection' in split && split.rejection.reason).toBe('split_target_shares_unsupported');
  });

  it('reports each creature separately so one bad cast cannot silence another boss', () => {
    const { abilities, rejected } = buildBossCatalog([
      { id: 'cr-1', boss_cast: cast },
      { id: 'cr-2', boss_cast: { ...cast, base_amount: null } },
      { id: 'cr-3', boss_cast: null },
    ]);
    expect(abilities.map((a) => a.creature_id)).toEqual(['cr-1']);
    expect(rejected.map((r) => r.creatureId)).toEqual(['cr-2', 'cr-3']);
  });
});

describe('equipment-derived weapon dice', () => {
  const main = (extra: Partial<SnapshotEquipment>): SnapshotEquipment[] => [
    { slot: 'main_hand', ...extra } as SnapshotEquipment,
  ];

  it('uses the unarmed die when no main hand is equipped', () => {
    expect(resolveMainHandDie([], 10).kind).toBe('unarmed');
  });

  it('fails closed when an equipped main hand lacks the fields the formula needs', () => {
    expect(resolveMainHandDie(main({ item_present: true, item_type: 'weapon' }), 10).kind).toBe(
      'incomplete',
    );
  });

  it('fails closed when the equipped inventory row points at an item that is gone', () => {
    const out = resolveMainHandDie(
      main({
        item_present: false,
        item_type: 'weapon',
        weapon_tag: 'sword',
        hands: 1,
        item_level: 10,
        rarity: 'common',
      }),
      10,
    );
    expect(out.kind).toBe('incomplete');
    if (out.kind === 'incomplete') expect(out.missing).toContain('item');
  });

  it('derives the die from the item when the projection is complete', () => {
    const out = resolveMainHandDie(
      main({
        item_present: true,
        item_type: 'weapon',
        weapon_tag: 'sword',
        hands: 1,
        item_level: 10,
        rarity: 'common',
      }),
      10,
    );
    expect(out.kind).toBe('weapon');
    if (out.kind === 'weapon') expect(out.die).toBeGreaterThan(0);
  });
});
