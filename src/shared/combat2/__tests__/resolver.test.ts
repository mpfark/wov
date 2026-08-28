import { describe, expect, it } from 'vitest';
import { resolveNodeTick, selectTank } from '../resolver';
import type { AbilitySpec } from '../mechanics';
import type { NodeSnapshot, SnapshotCreature, SnapshotFighter } from '../types';

const NOW = '2026-01-01T00:00:00.000Z';
const nowPlus = (msOffset: number): string => new Date(Date.parse(NOW) + msOffset).toISOString();

function fighter(overrides: Partial<SnapshotFighter> & { character_id: string }): SnapshotFighter {
  return {
    id: `f-${overrides.character_id}`,
    entry_seq: 1,
    present: true,
    party_id_at_entry: null,
    party_id: null,
    name: 'Tester',
    class: 'warrior',
    race: 'human',
    level: 10,
    hp: 100,
    max_hp: 100,
    cp: 50,
    max_cp: 50,
    mp: 10,
    max_mp: 10,
    ac: 12,
    str: 14,
    dex: 12,
    con: 12,
    int: 10,
    wis: 10,
    cha: 10,
    equipment: [],
    ...overrides,
  };
}

function creature(overrides: Partial<SnapshotCreature> = {}): SnapshotCreature {
  return {
    id: 'nc-1',
    creature_id: 'cr-1',
    spawn_seq: 3,
    hp: 60,
    is_alive: true,
    pending_action: null,
    tank_fighter_id: null,
    name: 'Granite Sentinel',
    level: 10,
    max_hp: 60,
    ac: 12,
    stats: { str: 12 },
    rarity: 'common',
    is_humanoid: false,
    is_aggressive: true,
    boss_crit_flavors: null,
    boss_death_cry: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    encounter: {
      id: 'enc-1',
      node_id: 'node-1',
      tick: 10,
      candidate_tick: 11,
      state_version: 4,
      now: NOW,
    },
    creatures: [creature()],
    fighters: [fighter({ character_id: 'ch-1' })],
    effects: [],
    intents: [],
    boss_abilities: [],
    ...overrides,
  };
}

const weaponAttack: AbilitySpec = {
  abilityKey: 'power_strike',
  label: 'Power Strike',
  mechanic: 'weapon_attack',
  damageType: 'physical',
  accuracyStat: 'dex',
  scalingStat: 'str',
  cpCost: 5,
  baseAmount: 6,
  perModifier: 2,
  durationMs: null,
  intervalMs: null,
  weaponBased: false,
  attackCount: 1,
  effectType: null,
  config: {},
};

const abilities = new Map<string, AbilitySpec>([[weaponAttack.abilityKey, weaponAttack]]);

describe('combat2 resolver', () => {
  it('is deterministic for an identical snapshot and candidate tick', () => {
    const a = resolveNodeTick(snapshot(), { abilities });
    const b = resolveNodeTick(snapshot(), { abilities });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('proposes the candidate tick, never the last committed tick', () => {
    const out = resolveNodeTick(snapshot(), { abilities });
    expect(out.tick).toBe(11);
  });

  it('consumes only the intents present in the snapshot', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          { id: 'i-1', seq: 7, character_id: 'ch-1', ability_key: 'power_strike', target_creature_id: 'cr-1' },
        ],
      }),
      { abilities },
    );
    expect(out.intent_ids).toEqual(['i-1']);
  });

  it('rejects an ability outside the closed catalogue without writing state', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          { id: 'i-9', seq: 8, character_id: 'ch-1', ability_key: 'not_a_real_ability', target_creature_id: 'cr-1' },
        ],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'action_rejected' && e.outcomeReason === 'unknown_ability')).toBe(true);
    expect(out.rewards).toEqual([]);
  });

  it('spends CP and damages the creature on a landed player action', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          { id: 'i-2', seq: 9, character_id: 'ch-1', ability_key: 'power_strike', target_creature_id: 'cr-1' },
        ],
      }),
      { abilities },
    );
    const actor = out.characters.find((c) => c.id === 'ch-1');
    expect(actor?.cp).toBe(45);
  });

  it('selects the newest present fighter as tank', () => {
    const fighters = [
      fighter({ character_id: 'a', entry_seq: 1 }),
      fighter({ character_id: 'b', entry_seq: 2 }),
      fighter({ character_id: 'c', entry_seq: 3 }),
    ];
    expect(selectTank(fighters, new Set(['a', 'b', 'c']))?.character_id).toBe('c');
    fighters[2].present = false;
    expect(selectTank(fighters, new Set(['a', 'b', 'c']))?.character_id).toBe('b');
    fighters[2].present = true;
    expect(selectTank(fighters, new Set(['a', 'b', 'c']))?.character_id).toBe('c');
  });

  it('removes an effect whose wall-clock lifetime lapsed without pulsing it', () => {
    const out = resolveNodeTick(
      snapshot({
        effects: [
          {
            id: 'e-1',
            kind: 'dot',
            effect_type: 'rend',
            ability_key: 'rend',
            target_character_id: null,
            target_creature_id: 'cr-1',
            source_character_id: 'ch-1',
            source_creature_id: null,
            stacks: 1,
            magnitude: 5,
            config: {},
            expires_at: nowPlus(-1000),
            next_due_at: nowPlus(-500),
            interval_ms: 2000,
            last_pulse_tick: 5,
            is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    expect(out.effects_delete).toContain('e-1');
    expect(out.events.some((e) => e.kind === 'effect_pulse')).toBe(false);
  });

  it('pulses a periodic effect at most once per tick and skips missed pulses', () => {
    const base = snapshot({
      effects: [
        {
          id: 'e-2',
          kind: 'dot',
          effect_type: 'rend',
          ability_key: 'rend',
          target_character_id: null,
          target_creature_id: 'cr-1',
          source_character_id: 'ch-1',
          source_creature_id: null,
          stacks: 1,
          magnitude: 5,
          config: {},
          expires_at: nowPlus(60_000),
          next_due_at: nowPlus(-30_000),
          interval_ms: 2000,
          last_pulse_tick: 5,
          is_reservation: false,
        },
      ],
    });
    const out = resolveNodeTick(base, { abilities });
    const pulses = out.events.filter((e) => e.kind === 'effect_pulse');
    expect(pulses).toHaveLength(1);
    expect(pulses[0].amount).toBe(5);
    const update = out.effects_update.find((u) => u.id === 'e-2');
    expect(update?.last_pulse_tick).toBe(11);
    expect(Date.parse(update!.next_due_at!)).toBe(Date.parse(NOW) + 2000);
  });

  it('never pulses the same effect twice for the same tick', () => {
    const out = resolveNodeTick(
      snapshot({
        effects: [
          {
            id: 'e-3', kind: 'dot', effect_type: 'rend', ability_key: 'rend',
            target_character_id: null, target_creature_id: 'cr-1',
            source_character_id: 'ch-1', source_creature_id: null,
            stacks: 1, magnitude: 5, config: {},
            expires_at: nowPlus(60_000), next_due_at: nowPlus(-1),
            interval_ms: 2000, last_pulse_tick: 11, is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'effect_pulse')).toBe(false);
  });

  it('attributes an offscreen damage-over-time kill to the effect source', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ hp: 4 })],
        fighters: [fighter({ character_id: 'ch-1', present: false })],
        effects: [
          {
            id: 'e-4', kind: 'dot', effect_type: 'rend', ability_key: 'rend',
            target_character_id: null, target_creature_id: 'cr-1',
            source_character_id: 'ch-1', source_creature_id: null,
            stacks: 1, magnitude: 9, config: {},
            expires_at: nowPlus(60_000), next_due_at: nowPlus(-1),
            interval_ms: 2000, last_pulse_tick: 5, is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    const death = out.events.find((e) => e.kind === 'creature_died');
    expect(death?.meta?.killedBy).toBe('ch-1');
    expect(out.rewards).toHaveLength(1);
    expect(out.rewards[0]).toMatchObject({ creature_id: 'cr-1', spawn_seq: 3, character_id: 'ch-1', is_killer: true });
  });

  it('writes a pending action for a telegraphed boss ability and skips the autoattack', () => {
    const out = resolveNodeTick(
      snapshot({
        boss_abilities: [
          {
            id: 'ba-1', creature_id: 'cr-1', ability_key: 'granite_slam', label: 'Granite Slam',
            weight: 1, windup_ticks: 2, targeting: 'aoe', magnitude: 20, amount_calc: null,
            damage_type: 'physical', effect: null,
            telegraph_text: 'gathers force', resolution_text: 'slams down',
          },
        ],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'boss_telegraph')).toBe(true);
    expect(out.events.some((e) => e.kind === 'creature_attack')).toBe(false);
    expect(out.creatures[0].pending_action).toEqual({ ability_key: 'granite_slam', resolve_at_tick: 13 });
  });

  it('resolves a due telegraph against the roster current at resolution', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ pending_action: { ability_key: 'granite_slam', resolve_at_tick: 11 } })],
        boss_abilities: [
          {
            id: 'ba-1', creature_id: 'cr-1', ability_key: 'granite_slam', label: 'Granite Slam',
            weight: 1, windup_ticks: 2, targeting: 'aoe', magnitude: 20, amount_calc: null,
            damage_type: 'physical', effect: null,
            telegraph_text: 'gathers force', resolution_text: 'slams down',
          },
        ],
      }),
      { abilities },
    );
    expect(out.creatures[0].pending_action).toBeNull();
    expect(out.events.some((e) => e.kind === 'creature_attack' && e.abilityKey === 'granite_slam')).toBe(true);
  });

  it('gives the empty-ground result when nobody is present at resolution', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ pending_action: { ability_key: 'granite_slam', resolve_at_tick: 11 } })],
        fighters: [fighter({ character_id: 'ch-1', present: false })],
        boss_abilities: [
          {
            id: 'ba-1', creature_id: 'cr-1', ability_key: 'granite_slam', label: 'Granite Slam',
            weight: 1, windup_ticks: 2, targeting: 'aoe', magnitude: 20, amount_calc: null,
            damage_type: 'physical', effect: null,
            telegraph_text: 'gathers force', resolution_text: 'slams down',
          },
        ],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'boss_cast_evaded')).toBe(true);
    expect(out.characters.find((c) => c.id === 'ch-1')?.hp ?? 100).toBe(100);
  });

  it('shares the reward with the killer party only, exactly once per character', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ hp: 1 })],
        fighters: [
          fighter({ character_id: 'ch-1', party_id: 'p-1', entry_seq: 1 }),
          fighter({ character_id: 'ch-2', party_id: 'p-1', entry_seq: 2 }),
          fighter({ character_id: 'ch-3', party_id: 'p-2', entry_seq: 3 }),
        ],
        effects: [
          {
            id: 'e-5', kind: 'dot', effect_type: 'rend', ability_key: 'rend',
            target_character_id: null, target_creature_id: 'cr-1',
            source_character_id: 'ch-1', source_creature_id: null,
            stacks: 1, magnitude: 9, config: {},
            expires_at: nowPlus(60_000), next_due_at: nowPlus(-1),
            interval_ms: 2000, last_pulse_tick: 5, is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    const ids = out.rewards.map((r) => r.character_id).sort();
    expect(ids).toEqual(['ch-1', 'ch-2']);
  });
});
