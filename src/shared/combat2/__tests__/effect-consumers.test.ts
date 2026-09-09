import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, SnapshotEffect } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
const deps = { abilities: catalog.specs };

function effect(patch: Partial<SnapshotEffect>): SnapshotEffect {
  return { id: 'effect', kind: 'offense', effect_type: 'test', ability_key: null,
    target_character_id: 'character', target_creature_id: null, source_character_id: 'character',
    source_creature_id: null, stacks: 1, magnitude: 0, config: {}, expires_at: null,
    next_due_at: null, interval_ms: null, last_pulse_tick: null, is_reservation: false, ...patch };
}

function snapshot(extra: SnapshotEffect[]): NodeSnapshot {
  return {
    encounter: { id: 'consumer-seed', node_id: 'node', tick: 0, candidate_tick: 1,
      state_version: 1, now: '2026-09-07T12:00:00.000Z', test_arena_id: null },
    fighters: [{ id: 'fighter', character_id: 'character', entry_seq: 1, present: true,
      party_id: null, party_id_at_entry: null, name: 'Hero', class: 'ranger', race: 'human',
      level: 20, hp: 1000, max_hp: 1000, cp: 500, max_cp: 500, mp: 0, max_mp: 0,
      ac: 1, str: 18, dex: 18, con: 14, int: 18, wis: 14, cha: 18, equipment: [] }],
    creatures: [{ id: 'spawn', creature_id: 'creature', spawn_seq: 1, hp: 1000, max_hp: 1000,
      is_alive: true, engaged: true, pending_action: null, tank_fighter_id: 'fighter', name: 'Enemy',
      level: 20, ac: 1, stats: { str: 20 }, rarity: 'common', is_humanoid: false,
      is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null,
      loot_mode: 'salvage_only', loot_table_id: null, drop_chance: null, loot_table: [] }],
    effects: [effect({ id: 'auto', kind: 'autoattack', effect_type: 'basic_attack',
      target_creature_id: 'creature', config: { node_creature_id: 'spawn', spawn_seq: 1 } }), ...extra],
    intents: [], boss_abilities: [], boss_configurations: [], participation: [], pending_events: [],
    tank_candidates: [{ fighter_id: 'fighter', character_id: 'character', entry_seq: 1 }],
    reward_config: { xp_boost_multiplier: 1, drop_chance_regular: .35, drop_chance_rare: .6, drop_chance_boss: 1, equip_level_min_offset: -3, equip_level_max_offset: 0, common_pct: 80, uncommon_pct: 20, consumable_drop_chance: .15, consumable_level_min_offset: -5, consumable_level_max_offset: 0 }, loot_items: [], loot_table_entries: [],
  };
}

describe('authored Combat2 effect consumers', () => {
  it('creates the authored Divine Aegis absorb through the common effect contract', () => {
    const input = snapshot([]);
    input.intents = [{ id: 'intent', seq: 1, character_id: 'character', intent_kind: 'ability',
      ability_key: 'divine_aegis', stance_key: null, target_creature_id: null,
      target_character_id: 'character', target_fighter_id: 'fighter', target_entry_seq: 1 }];
    const out = resolveNodeTick(input, deps);
    expect(out.events.some(event => event.kind === 'action_rejected')).toBe(false);
    expect(out.characters.find(row => row.id === 'character')?.cp).toBe(440);
    expect(out.effects_insert).toContainEqual(expect.objectContaining({ kind: 'absorb', ability_key: 'divine_aegis' }));
  });

  it('resolves Inspire as an authored timed HP/CP party presence effect', () => {
    const input = snapshot([]);
    input.intents = [{ id: 'intent', seq: 1, character_id: 'character', intent_kind: 'ability',
      ability_key: 'inspire', stance_key: null, target_creature_id: null }];
    const out = resolveNodeTick(input, deps);
    expect(out.events.some(event => event.kind === 'party_restore')).toBe(false);
    expect(out.characters.find(row => row.id === 'character')?.cp).toBe(485);
    expect(out.effects_insert).toContainEqual(expect.objectContaining({ kind: 'party_regen',
      ability_key: 'inspire', config: expect.objectContaining({ cp_per_tick: expect.any(Number) }) }));
  });

  it('consumes a guaranteed Disengage dodge only for an otherwise-landed attack', () => {
    const out = resolveNodeTick(snapshot([effect({ id: 'dodge', kind: 'evasion', ability_key: 'disengage',
      magnitude: 1, config: { dodge_chance: 1, evasion_source: 'disengage' } })]), deps);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'attack_evaded', abilityKey: 'disengage' }));
    expect(out.effects_delete).toContain('dodge');
  });

  it('applies creature outgoing-damage reduction separately from target mitigation', () => {
    const out = resolveNodeTick(snapshot([effect({ id: 'snare', kind: 'control', ability_key: 'natures_snare',
      target_character_id: null, target_creature_id: 'creature', magnitude: 0.4,
      config: { control_mode: 'damage_reduction' } })]), deps);
    const hit = out.events.find(event => event.kind === 'creature_attack' && event.amount! > 0);
    expect(hit?.meta?.outgoingReduced).toBeGreaterThan(0);
    expect(hit?.meta?.percentMitigated ?? 0).toBe(0);
  });

  it('consumes Shadowstep once and reports authored offense benefits on a basic attack', () => {
    const out = resolveNodeTick(snapshot([
      effect({ id: 'ambush', kind: 'stealth', ability_key: 'shadowstep', magnitude: 2.25 }),
      effect({ id: 'crit', kind: 'offense', ability_key: 'eagle_eye', magnitude: 3,
        config: { offense_mode: 'crit_edge' } }),
      effect({ id: 'surge', kind: 'offense', ability_key: 'arcane_surge', magnitude: 1.2,
        config: { offense_mode: 'damage_mult' } }),
    ]), deps);
    const attack = out.events.find(event => event.kind === 'attack' && event.meta?.basicAttack === true);
    expect(attack?.meta).toMatchObject({ ambushMultiplier: 2.25, criticalEdge: 3, offenseMultiplier: 1.2 });
    expect(out.effects_delete.filter(id => id === 'ambush')).toHaveLength(1);
  });
});
