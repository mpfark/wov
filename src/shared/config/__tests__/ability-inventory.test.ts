/**
 * ability-inventory.test.ts — Phase 1 inventory freeze.
 *
 * Pins the full ability inventory (key/class/slot/mechanic/cp_cost/damage_type)
 * so every later phase is checked against a known baseline, and encodes the
 * damage-type classification rules mirrored by the DB trigger
 * `validate_ability_row()`.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { DAMAGE_TYPE_KEYS } from '@/shared/combat/damage-types';

/** Mechanics that deal or apply damage even when `ability_type` is not `damage`. */
const DAMAGING_MECHANICS = new Set([
  'dot_debuff',
  'ignite_buff',
  'poison_buff',
  'consecrate',
  'reactive_holy',
  'ignite_consume',
]);

const isDamaging = (a: { ability_type: string; mechanic_key: string }) =>
  a.ability_type === 'damage' || DAMAGING_MECHANICS.has(a.mechanic_key);

const inventory = () =>
  [...ABILITY_SEED]
    .map(a => ({
      ability_key: a.ability_key,
      class_key: a.class_key,
      slot: a.slot,
      mechanic_key: a.mechanic_key,
      ability_type: a.ability_type,
      activation_mode: a.activation_mode,
      cp_cost: a.cp_cost,
      damage_type: a.damage_type ?? null,
      has_amount_calc: a.amount_calc !== null,
      has_duration_calc: a.duration_calc !== null,
    }))
    .sort((x, y) => x.ability_key.localeCompare(y.ability_key));

describe('ability inventory (frozen)', () => {
  it('has exactly 5 abilities per class for 7 classes', () => {
    const byClass = new Map<string, number>();
    for (const a of ABILITY_SEED) byClass.set(a.class_key, (byClass.get(a.class_key) ?? 0) + 1);
    expect([...byClass.values()]).toEqual(Array(byClass.size).fill(5));
    expect(byClass.size).toBe(7);
    expect(ABILITY_SEED.length).toBe(35);
  });

  it('every class fills slots 0-4 exactly once', () => {
    const seen = new Map<string, number[]>();
    for (const a of ABILITY_SEED) {
      const list = seen.get(a.class_key) ?? [];
      list.push(a.slot);
      seen.set(a.class_key, list);
    }
    for (const [cls, slots] of seen) {
      expect(slots.slice().sort(), `class ${cls}`).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('ability keys are unique', () => {
    const keys = ABILITY_SEED.map(a => a.ability_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches the pinned inventory snapshot', () => {
    expect(inventory()).toMatchSnapshot();
  });
});

describe('damage-type classification', () => {
  it('every damaging ability carries a canonical damage type', () => {
    const offenders = ABILITY_SEED.filter(a => isDamaging(a) && !a.damage_type).map(a => a.ability_key);
    expect(offenders).toEqual([]);
  });

  it('non-damaging heals and buffs carry no damage type', () => {
    const offenders = ABILITY_SEED
      .filter(a => !isDamaging(a) && (a.ability_type === 'heal' || a.ability_type === 'buff') && a.damage_type)
      .map(a => a.ability_key);
    expect(offenders).toEqual([]);
  });

  it('every damage type present is registered', () => {
    const unknown = ABILITY_SEED
      .filter(a => a.damage_type && !DAMAGE_TYPE_KEYS.includes(a.damage_type))
      .map(a => `${a.ability_key}:${a.damage_type}`);
    expect(unknown).toEqual([]);
  });

  it('the 17 intentionally untyped abilities stay untyped', () => {
    const untyped = ABILITY_SEED.filter(a => !a.damage_type).map(a => a.ability_key).sort();
    expect(untyped).toEqual([
      'arcane_surge',
      'battle_cry',
      'cloak_of_shadows',
      'crescendo',
      'disengage',
      'divine_aegis',
      'divine_challenge',
      'eagle_eye',
      'force_shield',
      'heal',
      'inspire',
      'purifying_light',
      'second_wind',
      'shadowstep',
      'shield_wall',
      'sunder_armor',
      'transfer_health',
    ]);
  });
});
