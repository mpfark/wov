/**
 * Reactive retaliation, proven with the REAL authored Holy Shield record
 * (authored mechanic `reactive_holy`, normalized onto `reactive_damage`).
 * Nothing here hand-writes a spec or branches on the ability name.
 */
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilitySpec, type AuthoredAbilityRecord } from '../catalog';
import { resolveNodeTick } from '../resolver';
import type { AbilitySpec } from '../mechanics';
import type { NodeSnapshot, SnapshotCreature, SnapshotEffect, SnapshotFighter } from '../types';

const records = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;
const authored = records.find((r) => r.mechanic === 'reactive_holy')!;
const built = buildAbilitySpec(authored);
if (!('spec' in built)) throw new Error('authored reactive record rejected');
const holyShield: AbilitySpec = built.spec;

const abilities = new Map<string, AbilitySpec>([
  [holyShield.abilityKey, holyShield],
  [`${holyShield.classKey}:${holyShield.abilityKey}`, holyShield],
]);

const NOW = '2026-01-01T00:00:00.000Z';

function fighter(over: Partial<SnapshotFighter> = {}): SnapshotFighter {
  return {
    id: 'f-1',
    character_id: 'ch-1',
    entry_seq: 1,
    present: true,
    party_id_at_entry: null,
    party_id: null,
    name: 'Templar',
    class: authored.classKey,
    race: 'human',
    level: 20,
    hp: 200,
    max_hp: 200,
    cp: 100,
    max_cp: 100,
    mp: 10,
    max_mp: 10,
    ac: 1, // low AC: the creature's attack lands, so the trigger fires
    str: 12,
    dex: 12,
    con: 16,
    int: 10,
    wis: 18,
    cha: 10,
    equipment: [],
    ...over,
  };
}

function creature(over: Partial<SnapshotCreature> = {}): SnapshotCreature {
  return {
    id: 'nc-1',
    creature_id: 'cr-1',
    spawn_seq: 2,
    hp: 400,
    is_alive: true,
    pending_action: null,
    tank_fighter_id: null,
    name: 'Granite Sentinel',
    level: 20,
    max_hp: 400,
    ac: 12,
    stats: { str: 12 },
    rarity: 'common',
    is_humanoid: false,
    is_aggressive: true,
    boss_crit_flavors: null,
    boss_death_cry: null,
    ...over,
  };
}

function reactiveEffect(over: Partial<SnapshotEffect> = {}): SnapshotEffect {
  return {
    id: 'e-react',
    kind: 'reactive',
    effect_type: 'reactive',
    ability_key: holyShield.abilityKey,
    target_character_id: 'ch-1',
    target_creature_id: null,
    source_character_id: 'ch-1',
    source_creature_id: null,
    stacks: 1,
    magnitude: 12,
    config: { once_per_attacker_per_tick: true, damage_type: 'holy' },
    expires_at: null,
    next_due_at: null,
    interval_ms: null,
    last_pulse_tick: null,
    is_reservation: false,
    ...over,
  };
}

function snapshot(over: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    encounter: {
      id: 'enc-react',
      node_id: 'node-1',
      tick: 4,
      candidate_tick: 5,
      state_version: 1,
      now: NOW,
    },
    creatures: [creature()],
    fighters: [fighter()],
    effects: [],
    intents: [],
    boss_abilities: [],
    ...over,
  };
}

describe('authored reactive retaliation (Holy Shield)', () => {
  it('activates from the authored stance with the authored damage type and magnitude', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          {
            id: 'i-1',
            seq: 1,
            character_id: 'ch-1',
            intent_kind: 'stance_activate',
            ability_key: null,
            stance_key: holyShield.abilityKey,
            target_creature_id: null,
          },
        ],
      }),
      { abilities },
    );
    const inserted = out.effects_insert.find((e) => e.kind === 'reactive');
    expect(inserted).toBeDefined();
    expect(inserted!.source_character_id).toBe('ch-1');
    expect(inserted!.target_character_id).toBe('ch-1');
    expect(Number(inserted!.magnitude)).toBeGreaterThan(0);
    expect(inserted!.config?.damage_type).toBe(authored.damageType);
    expect(inserted!.config?.once_per_attacker_per_tick).toBe(true);
  });

  it('retaliates only on its authored trigger, attributed to the effect source', () => {
    const out = resolveNodeTick(snapshot({ effects: [reactiveEffect()] }), { abilities });
    const landed = out.events.find((e) => e.kind === 'creature_attack' && (e.amount ?? 0) >= 0);
    expect(landed).toBeDefined();
    const pulses = out.events.filter((e) => e.kind === 'effect_pulse' && e.meta?.reactive === true);
    expect(pulses).toHaveLength(1);
    expect(pulses[0].actor).toMatchObject({ type: 'character', id: 'ch-1' });
    expect(pulses[0].target).toMatchObject({ type: 'creature', id: 'cr-1' });
    expect(pulses[0].amount).toBe(12);
    expect(pulses[0].meta?.damageType).toBe('holy');
    const creatureOut = out.creatures.find((c) => c.creature_id === 'cr-1');
    expect(creatureOut?.hp).toBe(400 - 12);
  });

  it('qualifies its source for exactly this creature spawn', () => {
    const out = resolveNodeTick(snapshot({ effects: [reactiveEffect()] }), { abilities });
    expect(out.participation).toEqual([
      {
        creature_id: 'cr-1',
        spawn_seq: 2,
        character_id: 'ch-1',
        qualification: 'qualified',
        qualified_by: 'damage',
        party_id_at_qualification: null,
      },
    ]);
  });

  it('never reacts twice to the same attacker in one tick', () => {
    const out = resolveNodeTick(snapshot({ effects: [reactiveEffect()] }), { abilities });
    const pulses = out.events.filter((e) => e.kind === 'effect_pulse' && e.meta?.reactive === true);
    expect(pulses).toHaveLength(1);
  });

  it('takes the kill exactly once when the retaliation lands the killing blow', () => {
    const out = resolveNodeTick(
      snapshot({ creatures: [creature({ hp: 5 })], effects: [reactiveEffect()] }),
      { abilities },
    );
    const deaths = out.events.filter((e) => e.kind === 'creature_died');
    expect(deaths).toHaveLength(1);
    expect(deaths[0].meta?.killedBy).toBe('ch-1');
    expect(out.rewards).toHaveLength(1);
    expect(out.rewards[0]).toMatchObject({ creature_id: 'cr-1', spawn_seq: 2, character_id: 'ch-1', is_killer: true });
    expect(out.creatures.find((c) => c.creature_id === 'cr-1')?.is_alive).toBe(false);
  });

  it('produces no second death, reward or damage when the creature is already dead', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ hp: 0, is_alive: false })],
        effects: [reactiveEffect()],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'effect_pulse' && e.meta?.reactive === true)).toBe(false);
    expect(out.events.some((e) => e.kind === 'creature_died')).toBe(false);
    expect(out.rewards).toEqual([]);
  });

  it('cannot retaliate for an effect belonging to another encounter roster', () => {
    // The effect names a character who is not a fighter of this encounter: it
    // has no owner in the snapshot, so nothing triggers.
    const out = resolveNodeTick(
      snapshot({ effects: [reactiveEffect({ target_character_id: 'ch-elsewhere' })] }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'effect_pulse' && e.meta?.reactive === true)).toBe(false);
  });
});
