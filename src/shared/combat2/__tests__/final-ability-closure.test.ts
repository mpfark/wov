import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { resolveNodeTick } from '../resolver';
import { decodeSnapshot } from '../decode';
import { combat2PulseDue, combat2TickTiming, combat2TicksForMs } from '../time';
import type { NodeSnapshot, ProposedTick, SnapshotEffect } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
const deps = { abilities: catalog.specs };
const NOW = Date.parse('2026-09-07T12:00:00Z');

function snap(classKey: string, abilityKey: string, target = false): NodeSnapshot {
  return {
    encounter: { id: `final-${abilityKey}`, node_id: 'node', tick: 0, candidate_tick: 1,
      state_version: 1, now: new Date(NOW).toISOString(), test_arena_id: null },
    fighters: [
      { id: 'caster-f', character_id: 'caster', entry_seq: 4, present: true, party_id: 'party',
        party_id_at_entry: 'party', name: 'Caster', class: classKey, race: 'human', level: 20,
        hp: 80, max_hp: 100, cp: 200, max_cp: 250, mp: 10, max_mp: 50, ac: 50,
        str: 12, dex: 12, con: 16, int: 18, wis: 20, cha: 20, equipment: [] },
      { id: 'ally-f', character_id: 'ally', entry_seq: 8, present: true, party_id: 'party',
        party_id_at_entry: 'party', name: 'Ally', class: 'warrior', race: 'human', level: 20,
        hp: 50, max_hp: 100, cp: 20, max_cp: 100, mp: 0, max_mp: 0, ac: 1,
        str: 18, dex: 12, con: 16, int: 10, wis: 10, cha: 10, equipment: [] },
      { id: 'foreign-f', character_id: 'foreign', entry_seq: 2, present: true, party_id: 'other',
        party_id_at_entry: 'other', name: 'Foreign', class: 'warrior', race: 'human', level: 20,
        hp: 40, max_hp: 100, cp: 20, max_cp: 100, mp: 0, max_mp: 0, ac: 50,
        str: 18, dex: 12, con: 16, int: 10, wis: 10, cha: 10, equipment: [] },
    ],
    creatures: [
      { id: 'spawn-b', creature_id: 'creature-b', spawn_seq: 2, hp: 100, max_hp: 100,
        is_alive: true, engaged: true, pending_action: null, tank_fighter_id: 'ally-f', name: 'B',
        level: 1, ac: 1, stats: { str: 1 }, rarity: 'common', is_humanoid: false,
        is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null },
      { id: 'spawn-a', creature_id: 'creature-a', spawn_seq: 3, hp: 100, max_hp: 100,
        is_alive: true, engaged: true, pending_action: null, tank_fighter_id: 'ally-f', name: 'A',
        level: 1, ac: 1, stats: { str: 1 }, rarity: 'common', is_humanoid: false,
        is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null },
    ], effects: [], intents: [{ id: 'intent', seq: 1, character_id: 'caster', intent_kind: 'ability',
      ability_key: abilityKey, stance_key: null, target_creature_id: null,
      target_character_id: target ? 'ally' : null, target_fighter_id: target ? 'ally-f' : null,
      target_entry_seq: target ? 8 : null }], boss_abilities: [], boss_configurations: [],
    participation: [], pending_events: [],
    tank_candidates: [{ fighter_id: 'ally-f', character_id: 'ally', entry_seq: 8 }],
  };
}

function persisted(out: ProposedTick): SnapshotEffect[] {
  return out.effects_insert.map((effect, i) => ({ id: `effect-${i}`, kind: '', effect_type: '',
    ability_key: null, target_character_id: null, target_creature_id: null, source_character_id: null,
    source_creature_id: null, stacks: 1, magnitude: null, config: {}, expires_at: null,
    next_due_at: null, interval_ms: null, last_pulse_tick: null, is_reservation: false, ...effect }));
}

function next(input: NodeSnapshot, out: ProposedTick): NodeSnapshot {
  return { ...input, encounter: { ...input.encounter, tick: 1, candidate_tick: 2,
    state_version: 2, now: new Date(NOW + 60_000).toISOString() }, intents: [], effects: persisted(out),
    fighters: input.fighters.map(f => { const change = out.characters.find(c => c.id === f.character_id);
      return { ...f, hp: change?.hp ?? f.hp, cp: change?.cp ?? f.cp, mp: change?.mp ?? f.mp,
        present: out.fighters.find(row => row.id === f.id)?.present ?? f.present }; }) };
}

describe('final Combat2 authored ability closure', () => {
  it('uses one canonical two-second tick conversion with an inclusive 11-pulse 22s boundary', () => {
    const timing = combat2TickTiming(5, 22_000, 2_000);
    expect(combat2TicksForMs(22_000)).toBe(11);
    expect(Array.from({ length: 13 }, (_, i) => i + 5).filter(t => combat2PulseDue(timing, t, null)))
      .toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('Inspire creates authored timed HP/CP regeneration for eligible party members only', () => {
    const input = snap('bard', 'inspire');
    const cast = resolveNodeTick(input, deps);
    expect(cast.events.some(e => e.kind === 'party_restore')).toBe(false);
    expect(cast.effects_insert).toContainEqual(expect.objectContaining({ kind: 'party_regen',
      ability_key: 'inspire', interval_ms: 2000,
      config: expect.objectContaining({ presence_effect: true, cp_per_tick: expect.any(Number) }) }));
    const pulse = resolveNodeTick(next(input, cast), deps);
    const rows = pulse.events.filter(e => e.kind === 'party_restore');
    expect(rows.map(e => e.target?.id)).toEqual(['ally', 'caster']);
    expect(rows.every(e => Number(e.meta?.cpApplied) > 0)).toBe(true);
    expect(rows.some(e => e.target?.id === 'foreign')).toBe(false);
  });

  it.each([['bard', 'crescendo'], ['healer', 'purifying_light']] as const)(
    '%s:%s creates one every-heartbeat presence effect and stops when its source is absent',
    (classKey, key) => {
      const input = snap(classKey, key);
      const cast = resolveNodeTick(input, deps);
      expect(cast.effects_insert).toContainEqual(expect.objectContaining({ ability_key: key,
        interval_ms: 2000, config: expect.objectContaining({ interval_ticks: 1, presence_effect: true }) }));
      const active = resolveNodeTick(next(input, cast), deps);
      expect(resolveNodeTick(next(input, cast), deps)).toEqual(active);
      expect(active.events.filter(e => e.kind === 'party_restore').map(e => e.target?.id))
        .toEqual(['ally', 'caster']);
      const absent = next(input, cast); absent.fighters[0].present = false;
      const stopped = resolveNodeTick(absent, deps);
      expect(stopped.effects_delete).toContain('effect-0');
      expect(stopped.events.some(e => e.kind === 'party_restore')).toBe(false);
      const dead = next(input, cast); dead.fighters[0].hp = 0;
      const deadStopped = resolveNodeTick(dead, deps);
      expect(deadStopped.effects_delete).toContain('effect-0');
      expect(deadStopped.events.some(e => e.kind === 'party_restore')).toBe(false);
    },
  );

  it('Consecrate pulses friends and spawn-fenced creatures once in stable order', () => {
    const input = snap('templar', 'consecrate');
    const cast = resolveNodeTick(input, deps);
    const pulse = resolveNodeTick(next(input, cast), deps);
    expect(pulse.events.filter(e => e.kind === 'consecrate_heal').map(e => e.target?.id))
      .toEqual(['ally', 'caster']);
    expect(pulse.events.filter(e => e.kind === 'consecrate_pulse').map(e => e.target?.id))
      .toEqual(['creature-a', 'creature-b']);
    expect(pulse.events.some(e => e.kind === 'consecrate_pulse' && e.target?.type === 'character')).toBe(false);
  });

  it('Divine Aegis uses the common fenced absorb pool and preserves the stronger pool on refresh', () => {
    const input = snap('healer', 'divine_aegis', true);
    const out = resolveNodeTick(input, deps);
    expect(out.effects_insert).toContainEqual(expect.objectContaining({ kind: 'absorb',
      target_character_id: 'ally', config: expect.objectContaining({ target_fighter_id: 'ally-f', target_entry_seq: 8 }) }));
    expect(out.characters.find(c => c.id === 'caster')?.cp).toBe(140);
  });

  it('Divine Aegis consumes only landed damage, persists an absolute pool, depletes and expires', () => {
    const input = snap('healer', 'divine_aegis', true);
    const cast = resolveNodeTick(input, deps);
    const base = next(input, cast);
    const shield = base.effects.find(e => e.ability_key === 'divine_aegis')!;
    let missed: ProposedTick | null = null;
    let landed: ProposedTick | null = null;
    const missBase = next(input, cast); missBase.fighters[1].ac = 100;
    for (let i = 0; i < 100 && !missed; i++) {
      missBase.encounter.id = `aegis-miss-${i}`;
      const out = resolveNodeTick(missBase, deps);
      const attacks = out.events.filter(e => e.kind === 'creature_attack');
      if (attacks.length > 0 && attacks.every(attack => attack.hitQuality === 'miss')) missed = out;
    }
    for (let i = 0; i < 100 && !landed; i++) {
      base.encounter.id = `aegis-${i}`;
      const out = resolveNodeTick(base, deps);
      const attacks = out.events.filter(e => e.kind === 'creature_attack');
      if (attacks.some(attack => Number(attack.meta?.absorbed) > 0)) landed = out;
    }
    expect(missed?.effects_update.some(e => e.id === shield.id)).toBe(false);
    expect(missed?.effects_delete).not.toContain(shield.id);
    expect(landed?.effects_update.find(e => e.id === shield.id)?.magnitude
      ?? (landed?.effects_delete.includes(shield.id) ? 0 : shield.magnitude)).toBeLessThan(shield.magnitude!);
    const expired = { ...base, encounter: { ...base.encounter,
      candidate_tick: Number(shield.config.expires_after_tick) + 1 } };
    expect(resolveNodeTick(expired, deps).effects_delete).toContain(shield.id);
  });

  it('Transfer Health atomically charges the authored caster amount and caps recipient healing', () => {
    const input = snap('healer', 'transfer_health', true);
    input.fighters[1].hp = 95;
    const out = resolveNodeTick(input, deps);
    const caster = out.characters.find(c => c.id === 'caster');
    const ally = out.characters.find(c => c.id === 'ally');
    const event = out.events.find(e => e.kind === 'hp_transfer');
    expect(caster?.hp).toBe(75);
    expect(ally?.hp).toBeGreaterThan(95); // the later creature phase may damage the healed ally
    expect(event?.amount).toBe(5);
    expect(event?.meta).toMatchObject({ applied: 5, removedFromCaster: 5 });
  });

  it('refuses a stale, foreign, absent or dead explicit ally before spending CP', () => {
    for (const mutate of [
      (s: NodeSnapshot) => { s.intents[0].target_entry_seq = 7; },
      (s: NodeSnapshot) => { s.intents[0].target_character_id = 'foreign'; s.intents[0].target_fighter_id = 'foreign-f'; s.intents[0].target_entry_seq = 2; },
      (s: NodeSnapshot) => { s.fighters[1].present = false; },
      (s: NodeSnapshot) => { s.fighters[1].hp = 0; },
    ]) {
      const input = snap('healer', 'divine_aegis', true); mutate(input);
      const out = resolveNodeTick(input, deps);
      expect(out.events).toContainEqual(expect.objectContaining({ kind: 'action_rejected', outcomeReason: 'invalid_ally_target' }));
      expect(out.characters.find(c => c.id === 'caster')?.cp ?? 200).toBe(200);
    }
  });

  it('preserves authored self targeting only for Divine Aegis', () => {
    const aegis = snap('healer', 'divine_aegis', true);
    Object.assign(aegis.intents[0], { target_character_id: 'caster', target_fighter_id: 'caster-f', target_entry_seq: 4 });
    expect(resolveNodeTick(aegis, deps).effects_insert).toContainEqual(expect.objectContaining({
      ability_key: 'divine_aegis', target_character_id: 'caster',
    }));
    const transfer = snap('healer', 'transfer_health', true);
    Object.assign(transfer.intents[0], { target_character_id: 'caster', target_fighter_id: 'caster-f', target_entry_seq: 4 });
    expect(resolveNodeTick(transfer, deps).events).toContainEqual(expect.objectContaining({
      kind: 'action_rejected', outcomeReason: 'invalid_ally_target',
    }));
  });

  it('strict decoding rejects duplicated presence sources and stale ally shield generations', () => {
    const party = snap('bard', 'crescendo');
    const effects = persisted(resolveNodeTick(party, deps));
    party.effects = [effects[0], { ...effects[0], id: 'duplicate' }];
    const duplicate = decodeSnapshot(party);
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok === false) expect(duplicate.errors.join('\n')).toContain('duplicate presence effect');

    const aegis = snap('healer', 'divine_aegis', true);
    aegis.effects = persisted(resolveNodeTick(aegis, deps));
    aegis.effects[0].config.target_entry_seq = 999;
    const stale = decodeSnapshot(aegis);
    expect(stale.ok).toBe(false);
    if (stale.ok === false) expect(stale.errors.join('\n')).toContain('ally absorb binding is stale');
  });
});
