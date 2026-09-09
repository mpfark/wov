import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { decodeSnapshot } from '../decode';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, ProposedTick, SnapshotEffect, SnapshotIntent } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
const deps = { abilities: catalog.specs };
const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function input(classKey: 'assassin' | 'wizard', key: string, kind: SnapshotIntent['intent_kind']): NodeSnapshot {
  return {
    encounter: { id: 'stack-seed', node_id: 'node', tick: 0, candidate_tick: 1,
      state_version: 1, now: new Date(NOW).toISOString(), test_arena_id: null },
    fighters: [{ id: 'fighter', character_id: 'character', entry_seq: 7, present: true,
      party_id: null, party_id_at_entry: null, name: 'Hero', class: classKey, race: 'human',
      level: 20, hp: 1000, max_hp: 1000, cp: 500, max_cp: 500, mp: 0, max_mp: 0,
      ac: 20, str: 18, dex: 18, con: 14, int: 20, wis: 16, cha: 16, equipment: [] }],
    creatures: [{ id: 'spawn', creature_id: 'creature', spawn_seq: 4, hp: 2000, max_hp: 2000,
      is_alive: true, engaged: true, pending_action: null, tank_fighter_id: 'fighter', name: 'Enemy',
      level: 1, ac: 1, stats: { str: 1 }, rarity: 'common', is_humanoid: false,
      is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null }],
    effects: [], intents: [{ id: 'intent', seq: 1, character_id: 'character', intent_kind: kind,
      ability_key: kind === 'ability' ? key : null, stance_key: kind === 'ability' ? null : key,
      target_creature_id: kind === 'ability' ? 'creature' : null }],
    boss_abilities: [], boss_configurations: [], participation: [], pending_events: [],
    tank_candidates: [{ fighter_id: 'fighter', character_id: 'character', entry_seq: 7 }],
  };
}

function persisted(out: ProposedTick): SnapshotEffect[] {
  return out.effects_insert.map((effect, index) => ({ id: `effect-${index}`,
    kind: '', effect_type: '', ability_key: null, target_character_id: null, target_creature_id: null,
    source_character_id: null, source_creature_id: null, stacks: 1, magnitude: null, config: {},
    expires_at: null, next_due_at: null, interval_ms: null, last_pulse_tick: null,
    is_reservation: false, ...effect }));
}

function next(snapshot: NodeSnapshot, out: ProposedTick): NodeSnapshot {
  return { ...snapshot,
    encounter: { ...snapshot.encounter, tick: 1, candidate_tick: 2,
      state_version: 2, now: new Date(NOW + 2000).toISOString() },
    fighters: snapshot.fighters.map(row => ({ ...row,
      cp: out.characters.find(change => change.id === row.character_id)?.cp ?? row.cp })),
    effects: persisted(out), intents: [] };
}

function stack(effectType: 'poison' | 'ignite', stacks: number, abilityKey = effectType === 'poison' ? 'envenom' : 'ignite'): SnapshotEffect {
  return { id: `${effectType}-stack`, kind: 'stack', effect_type: effectType, ability_key: abilityKey,
    target_character_id: null, target_creature_id: 'creature', source_character_id: 'character',
    source_creature_id: null, stacks, magnitude: 3,
    config: { node_creature_id: 'spawn', creature_id: 'creature', spawn_seq: 4,
      source_fighter_id: 'fighter', source_entry_seq: 7, max_stacks: 5, damage_type: effectType === 'ignite' ? 'fire' : 'poison' },
    expires_at: new Date(NOW + 25000).toISOString(), next_due_at: new Date(NOW + 10000).toISOString(),
    interval_ms: 2000, last_pulse_tick: null, is_reservation: false };
}

describe('Combat2 authored stack closure', () => {
  it.each([['assassin', 'envenom', 50], ['wizard', 'ignite', 50]] as const)(
    '%s:%s activates without a creature and creates one source-fenced stance plus reservation',
    (classKey, key, cost) => {
      const out = resolveNodeTick(input(classKey, key, 'stance_activate'), deps);
      expect(out.events.some(event => event.kind === 'action_rejected')).toBe(false);
      expect(out.characters.find(row => row.id === 'character')?.cp).toBe(500 - cost);
      expect(out.effects_insert.find(row => row.kind === 'reservation')).toMatchObject({ magnitude: 100 });
      expect(out.effects_insert.find(row => row.kind === 'stack_source')).toMatchObject({
        ability_key: key, target_character_id: 'character', source_character_id: 'character',
        config: { source_fighter_id: 'fighter', source_entry_seq: 7 },
      });
    },
  );

  it('Envenom applies only after a landed weapon attack and produces deterministic absolute state', () => {
    const activatedInput = input('assassin', 'envenom', 'stance_activate');
    const activated = resolveNodeTick(activatedInput, deps);
    const base = next(activatedInput, activated);
    let landed: ProposedTick | null = null;
    for (let seed = 0; seed < 100 && !landed; seed++) {
      base.encounter.id = `envenom-${seed}`;
      const out = resolveNodeTick(base, deps);
      if (out.events.some(event => event.kind === 'stack_applied')) landed = out;
    }
    expect(landed).not.toBeNull();
    expect(landed!.effects_insert.find(row => row.kind === 'stack')).toMatchObject({
      effect_type: 'poison', ability_key: 'envenom', target_creature_id: 'creature',
      source_character_id: 'character', stacks: 1,
      config: { node_creature_id: 'spawn', spawn_seq: 4, source_fighter_id: 'fighter', source_entry_seq: 7 },
    });
    expect(resolveNodeTick(base, deps)).toEqual(resolveNodeTick(base, deps));
  });

  it('a missed weapon attack adds no Envenom stack', () => {
    const source = persisted(resolveNodeTick(input('assassin', 'envenom', 'stance_activate'), deps));
    const snap = input('assassin', 'power_strike', 'ability');
    snap.creatures[0].ac = 1000; snap.effects = source;
    const out = resolveNodeTick(snap, deps);
    expect(out.events.some(event => event.kind === 'stack_applied')).toBe(false);
    expect(out.effects_insert.some(effect => effect.kind === 'stack')).toBe(false);
  });

  it('refreshes a capped stack without crossing source/spawn identity', () => {
    const snap = input('assassin', 'power_strike', 'ability');
    const source = persisted(resolveNodeTick(input('assassin', 'envenom', 'stance_activate'), deps))
      .find(effect => effect.kind === 'stack_source')!;
    source.magnitude = 1;
    const existing = stack('poison', Number(source.config.max_stacks));
    existing.config.max_stacks = source.config.max_stacks;
    snap.effects = [source, existing];
    const out = resolveNodeTick(snap, deps);
    expect(out.effects_update.find(update => update.id === existing.id)).toMatchObject({
      stacks: source.config.max_stacks,
      expires_at: new Date(NOW + Number(source.config.stack_duration_ms)).toISOString(),
    });
  });

  it.each([['assassin', 'eviscerate', 'poison'], ['wizard', 'conflagrate', 'ignite']] as const)(
    '%s:%s consumes only its source-owned compatible stacks, including on a miss',
    (classKey, key, effectType) => {
      const snap = input(classKey, key, 'ability');
      snap.effects = [stack(effectType, 2), { ...stack(effectType, 3), id: 'other-source',
        source_character_id: 'other', config: { ...stack(effectType, 3).config,
          source_fighter_id: 'other-fighter', source_entry_seq: 1 } }];
      snap.creatures[0].ac = 1000;
      const out = resolveNodeTick(snap, deps);
      expect(out.effects_delete).toContain(`${effectType}-stack`);
      expect(out.effects_delete).not.toContain('other-source');
      expect(out.events.find(event => event.kind === 'attack')?.meta?.stacksConsumed).toBe(2);
      expect(out.characters.find(row => row.id === 'character')?.cp).toBe(500 - (key === 'eviscerate' ? 40 : 60));
    },
  );

  it('zero-stack finishers retain their explicitly authored base-damage path', () => {
    const out = resolveNodeTick(input('wizard', 'conflagrate', 'ability'), deps);
    expect(out.events.find(event => event.kind === 'attack')?.meta?.stacksConsumed).toBe(0);
    expect(out.events.some(event => event.kind === 'action_rejected')).toBe(false);
  });

  it.each([['assassin', 'eviscerate', 'poison'], ['wizard', 'conflagrate', 'ignite']] as const)(
    '%s:%s damage uses the actual consumed stack count', (classKey, key, effectType) => {
      const zero = input(classKey, key, 'ability');
      zero.encounter.id = `${key}-damage`;
      const stacked = structuredClone(zero);
      stacked.effects = [stack(effectType, 2)];
      const baseDamage = resolveNodeTick(zero, deps).events.find(event => event.kind === 'attack')?.amount ?? 0;
      const stackedDamage = resolveNodeTick(stacked, deps).events.find(event => event.kind === 'attack')?.amount ?? 0;
      expect(stackedDamage).toBeGreaterThan(baseDamage);
    },
  );

  it('Ignite pulses independently, targets the fenced autoattack spawn, and never stacks after killing', () => {
    const activationInput = input('wizard', 'ignite', 'stance_activate');
    const activated = resolveNodeTick(activationInput, deps);
    const snap = next(activationInput, activated);
    const source = snap.effects.find(effect => effect.kind === 'stack_source')!;
    source.magnitude = 1;
    const out = resolveNodeTick(snap, deps);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'orb_attack', abilityKey: 'ignite' }));
    expect(out.effects_insert.find(effect => effect.kind === 'stack')).toMatchObject({
      effect_type: 'ignite', target_creature_id: 'creature', config: { node_creature_id: 'spawn', spawn_seq: 4 },
    });
  });

  it('stance drop removes source/reservation but preserves already-applied stacks and prevents a pulse', () => {
    const activationInput = input('wizard', 'ignite', 'stance_activate');
    const snap = next(activationInput, resolveNodeTick(activationInput, deps));
    const existing = stack('ignite', 2);
    snap.effects.push(existing);
    snap.intents = [{ id: 'drop', seq: 2, character_id: 'character', intent_kind: 'stance_drop',
      ability_key: null, stance_key: 'ignite', target_creature_id: null }];
    const out = resolveNodeTick(snap, deps);
    expect(out.effects_delete).not.toContain(existing.id);
    expect(out.effects_delete).toEqual(expect.arrayContaining(
      snap.effects.filter(effect => effect.ability_key === 'ignite' && effect.kind !== 'stack').map(effect => effect.id),
    ));
    expect(out.events.some(event => event.kind === 'orb_attack')).toBe(false);
  });

  it('strict decoding rejects duplicate and stale stack identities', () => {
    const snap = input('assassin', 'eviscerate', 'ability');
    const valid = stack('poison', 2);
    snap.effects = [valid, { ...valid, id: 'duplicate' }];
    expect(decodeSnapshot(snap)).toMatchObject({ ok: false, errors: expect.arrayContaining([
      expect.stringContaining('duplicate stack identity'),
    ]) });
    snap.effects = [{ ...valid, config: { ...valid.config, spawn_seq: 3 } }];
    expect(decodeSnapshot(snap)).toMatchObject({ ok: false, errors: expect.arrayContaining([
      expect.stringContaining('stack identity is stale or malformed'),
    ]) });
  });
});
