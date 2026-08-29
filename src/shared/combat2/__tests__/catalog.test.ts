import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, buildAbilitySpec, lookupSpec, type AuthoredAbilityRecord } from '../catalog';
import { adaptBossCast, buildBossCatalog } from '../boss-catalog';
import { resolveMainHandDie } from '../mechanics';

const records = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;

describe('authored ability catalogue', () => {
  it('reads the real active inventory, not a hand-written fixture', () => {
    expect(records.length).toBeGreaterThanOrEqual(30);
  });

  it('adapts every authored record it accepts and names every one it refuses', () => {
    const { catalog, rejections } = buildAbilityCatalog(records);
    // Every record is accounted for exactly once: adapted or explicitly refused.
    const accepted = new Set(
      records
        .filter((r) => !rejections.some((x) => x.classKey === r.classKey && x.abilityKey === r.abilityKey))
        .map((r) => `${r.classKey}:${r.abilityKey}`),
    );
    for (const key of accepted) expect(catalog.has(key)).toBe(true);
    expect(accepted.size + rejections.length).toBe(records.length);
    for (const rejection of rejections) expect(rejection.reason).toBeTruthy();
  });

  it('refuses a mechanic outside the closed registry instead of guessing one', () => {
    const authored = records.find((r) => r.mechanic === 'reactive_holy');
    if (!authored) return; // configuration already reconciled upstream
    const out = buildAbilitySpec(authored);
    expect('reason' in out).toBe(true);
  });

  it('refuses a record whose mechanic-specific calculation is missing', () => {
    const barrage = records.find((r) => r.mechanic === 'multi_attack');
    if (!barrage) return;
    const out = buildAbilitySpec({ ...barrage, mechanicCalcs: {} });
    expect('reason' in out).toBe(true);
  });

  it('resolves a class-scoped key before the bare ability key', () => {
    const { catalog } = buildAbilityCatalog(records);
    const first = [...catalog.keys()].find((k) => k.includes(':'));
    expect(first).toBeDefined();
    const [classKey, abilityKey] = first!.split(':');
    expect(lookupSpec(catalog, classKey, abilityKey)).toBe(catalog.get(first!));
  });
});

describe('authored boss casts', () => {
  const cast = {
    ability_key: 'granite_slam',
    label: 'Granite Slam',
    cast_ms: 4000,
    chance: 0.25,
    base_amount: 30,
    damage_type: 'physical',
    telegraph_text: 'raises its fists',
    resolution_text: 'slams the ground',
  };

  it('converts millisecond wind-up into whole authoritative ticks', () => {
    const out = adaptBossCast('cr-1', cast);
    expect('ability' in out).toBe(true);
    if ('ability' in out) expect(out.ability.windup_ticks).toBe(2);
  });

  it('refuses a cast with no identity, no amount, or no timing', () => {
    for (const bad of [
      { ...cast, ability_key: null, label: null },
      { ...cast, base_amount: null },
      { ...cast, cast_ms: null },
    ]) {
      expect('reason' in adaptBossCast('cr-1', bad as never)).toBe(true);
    }
  });

  it('refuses stored-power and split primary/area semantics rather than inventing them', () => {
    expect('reason' in adaptBossCast('cr-1', { ...cast, stored_power_per_tick: 5 } as never)).toBe(true);
    expect('reason' in adaptBossCast('cr-1', { ...cast, aoe_amount: 10 } as never)).toBe(true);
  });

  it('keeps refusals per creature so one bad cast cannot silence a boss', () => {
    const { abilities, rejections } = buildBossCatalog([
      { creature_id: 'cr-1', boss_cast: [cast, { ...cast, base_amount: null }] },
    ]);
    expect(abilities).toHaveLength(1);
    expect(rejections).toHaveLength(1);
  });
});

describe('equipment-derived weapon dice', () => {
  it('uses the unarmed die when no main hand is equipped', () => {
    expect(resolveMainHandDie([], 10)).toMatchObject({ kind: 'unarmed' });
  });

  it('fails closed when an equipped main hand lacks the fields the formula needs', () => {
    const out = resolveMainHandDie([{ slot: 'main_hand', item_type: 'weapon' } as never], 10);
    expect(out.kind).toBe('incomplete');
  });

  it('derives the die from the item when the projection is complete', () => {
    const out = resolveMainHandDie(
      [{ slot: 'main_hand', item_type: 'weapon', weapon_tag: 'sword', hands: 1, item_level: 10, rarity: 'common' } as never],
      10,
    );
    expect(out.kind).toBe('weapon');
    expect(out.die).toBeGreaterThan(0);
  });
});
