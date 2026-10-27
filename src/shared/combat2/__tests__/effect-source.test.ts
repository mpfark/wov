import { describe, expect, it } from 'vitest';
import { bindCreatureEffectSource, readCreatureEffectSource, resolveCreatureEffectSource } from '../effect-source';
import { decodeSnapshot } from '../decode';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, SnapshotCreature, SnapshotEffect } from '../types';

const creature: SnapshotCreature = {
  id: 'instance-a', creature_id: 'definition', spawn_seq: 7, hp: 10, max_hp: 10, is_alive: true,
  engaged: false, pending_action: null, tank_fighter_id: null, name: 'Source', level: 1, ac: 10,
  stats: null, rarity: 'common', is_humanoid: false, is_aggressive: false, boss_crit_flavors: null,
  boss_death_cry: null, loot_mode: 'salvage_only', loot_table_id: null, drop_chance: null, loot_table: [],
  gold_enabled: false, gold_min: 0, gold_max: 0, gold_chance: 0, salvage_enabled: false,
  item_source: 'none', unique_item_id: null, unique_drop_chance: null,
};
const effect: SnapshotEffect = {
  id: 'effect', kind: 'dot', effect_type: 'test', ability_key: null, target_character_id: 'target',
  target_creature_id: null, source_character_id: null, source_creature_id: null, stacks: 1,
  magnitude: 3, config: {}, expires_at: null, next_due_at: null, interval_ms: null,
  last_pulse_tick: null, is_reservation: false,
};
function bound(): SnapshotEffect {
  return { ...effect, ...bindCreatureEffectSource(effect, creature) };
}
function snapshot(effects: SnapshotEffect[]): NodeSnapshot {
  return {
    encounter: { id: 'encounter', node_id: 'node', tick: 0, candidate_tick: 1, state_version: 1,
      now: '2026-10-27T12:00:00Z', test_arena_id: null },
    creatures: [], fighters: [], effects, intents: [], boss_abilities: [], boss_cooldowns: [],
    participation: [], pending_events: [], tank_candidates: [], loot_items: [], loot_table_entries: [],
    reward_config: { xp_boost_multiplier: 1, drop_chance_regular: 0, drop_chance_rare: 0,
      drop_chance_boss: 0, equip_level_min_offset: 0, equip_level_max_offset: 0, common_pct: 100,
      uncommon_pct: 0, consumable_drop_chance: 0, consumable_level_min_offset: 0, consumable_level_max_offset: 0 },
  };
}

describe('001G3A local creature effect source contract', () => {
  it('captures the known producer instance, definition and generation without mutating inputs', () => {
    const before = structuredClone({ effect, creature });
    expect(bound().config.creature_source).toEqual({ node_creature_id: 'instance-a', creature_id: 'definition', spawn_seq: 7 });
    expect(bound().source_creature_id).toBe('definition');
    expect({ effect, creature }).toEqual(before);
  });
  it('does not change the captured generation when the input source later respawns', () => {
    const source = structuredClone(creature);
    const captured = bindCreatureEffectSource(effect, source);
    source.spawn_seq++;
    expect(captured.config?.creature_source?.spawn_seq).toBe(7);
  });
  it('refuses rebinding an existing identity even to the same source', () => {
    expect(() => bindCreatureEffectSource(bound(), creature)).toThrow('invalid_creature_effect_source_capture');
  });
  it.each([
    { source_character_id: 'player' }, { source_creature_id: 'other' },
    { target_character_id: null }, { target_creature_id: 'other' },
  ])('refuses conflicting capture fields %j', patch => {
    expect(() => bindCreatureEffectSource({ ...effect, ...patch }, creature)).toThrow();
  });
  it.each([{ hp: 0 }, { is_alive: false }, { spawn_seq: -1 }, { spawn_seq: 1.5 }, { id: '' }])(
    'refuses invalid/dead producer source %j', patch => {
      expect(() => bindCreatureEffectSource(effect, { ...creature, ...patch })).toThrow();
    });
  it('selects the exact instance among several sources with the same definition', () => {
    const other = { ...creature, id: 'instance-b', spawn_seq: 12 };
    const result = resolveCreatureEffectSource(bound(), [other, creature]);
    expect(result.kind).toBe('current');
    if (result.kind === 'current') expect(result.creature.id).toBe('instance-a');
  });
  it.each([
    [[], 'missing_instance'],
    [[{ ...creature, id: 'instance-b' }], 'missing_instance'],
    [[{ ...creature, spawn_seq: 8 }], 'generation_mismatch'],
    [[{ ...creature, creature_id: 'other' }], 'definition_mismatch'],
    [[creature, { ...creature }], 'ambiguous_instance'],
    [[{ ...creature, hp: 0, is_alive: false }], 'dead'],
  ] as const)('classifies unavailable/stale/dead sources without rebinding %#', (sources, kind) => {
    const original = bound();
    expect(resolveCreatureEffectSource(original, sources).kind).toBe(kind);
    expect(original).toEqual(bound());
  });
  it('leaves missing legacy identity explicitly unbound even with a unique current source', () => {
    const legacy = { ...effect, source_creature_id: creature.creature_id };
    expect(resolveCreatureEffectSource(legacy, [creature])).toEqual({ kind: 'unbound' });
    expect(decodeSnapshot(snapshot([legacy])).ok).toBe(true);
  });
  it.each([null, {}, [], { node_creature_id: 'instance-a', creature_id: 'definition', spawn_seq: '7' },
    { node_creature_id: 'instance-a', creature_id: 'definition', spawn_seq: -1 }])(
    'rejects malformed opted-in identity %j through claim decoding', value => {
      const raw = structuredClone(snapshot([bound()]));
      (raw.effects[0].config as Record<string, unknown>).creature_source = value;
      expect(readCreatureEffectSource(raw.effects[0]).kind).toBe('invalid');
      const decoded = decodeSnapshot(raw);
      expect(decoded.ok).toBe(false);
      if (decoded.ok === false) expect(decoded.errors.some(error => error.includes('config.creature_source'))).toBe(true);
    });
  it.each([{ source_character_id: 'player' }, { source_creature_id: 'other' }, { target_creature_id: 'other' }])(
    'rejects inconsistent metadata in the claim %j', patch => {
      expect(decodeSnapshot(snapshot([{ ...bound(), ...patch }])).ok).toBe(false);
    });
  it('retains well-formed historical identity when its source is absent from the claim', () => {
    const raw = snapshot([bound()]);
    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(raw)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.snapshot.effects[0].config.creature_source).toEqual(bound().config.creature_source);
  });
  it('replays capture, decode and identity classification deterministically', () => {
    const once = () => ({ decoded: decodeSnapshot(snapshot([bound()])),
      resolution: resolveCreatureEffectSource(bound(), [creature]) });
    expect(JSON.stringify(once())).toBe(JSON.stringify(once()));
  });
  it('does not introduce damage or effect-lifecycle changes for existing effects', () => {
    const before = snapshot([{ ...effect, source_creature_id: 'definition' }]);
    const raw = structuredClone(before);
    const result = resolveNodeTick(raw, { abilities: new Map() });
    const decoded = decodeSnapshot(before);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(resolveNodeTick(decoded.snapshot, { abilities: new Map() })).toEqual(result);
    expect(result.effects_delete).toEqual([]);
    expect(raw).toEqual(before);
  });
});
