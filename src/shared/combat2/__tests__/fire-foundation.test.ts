import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { decodeSnapshot } from '../decode';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, ProposedTick, SnapshotEffect, SnapshotIntent } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
const legacyDeps = { abilities: catalog.specs };
const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function input(classKey: 'assassin' | 'wizard', key: string, kind: SnapshotIntent['intent_kind']): NodeSnapshot {
  return {
    encounter: { id: 'stack-seed', node_id: 'node', tick: 0, candidate_tick: 1,
      state_version: 1, now: new Date(NOW).toISOString(), test_arena_id: null },
    fighters: [{ id: '10000000-0000-4000-8000-000000000001', character_id: '20000000-0000-4000-8000-000000000001', entry_seq: 7, present: true,
      party_id: null, party_id_at_entry: null, name: 'Hero', class: classKey, race: 'human',
      level: 20, hp: 1000, max_hp: 1000, cp: 500, max_cp: 500, mp: 0, max_mp: 0,
      ac: 20, str: 18, dex: 18, con: 14, int: 20, wis: 16, cha: 16, equipment: [] }],
    creatures: [{ id: 'spawn', creature_id: 'creature', spawn_seq: 4, hp: 2000, max_hp: 2000,
      is_alive: true, engaged: true, pending_action: null, tank_fighter_id: '10000000-0000-4000-8000-000000000001', name: 'Enemy',
      level: 1, ac: 1, stats: { str: 1 }, rarity: 'common', is_humanoid: false,
      is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null,
      loot_mode: 'salvage_only', loot_table_id: null, drop_chance: null, loot_table: [],
      gold_enabled: false, gold_min: 0, gold_max: 0, gold_chance: 0,
      salvage_enabled: false, item_source: 'none', unique_item_id: null, unique_drop_chance: null }],
    effects: [], intents: [{ id: 'intent', seq: 1, character_id: '20000000-0000-4000-8000-000000000001', intent_kind: kind,
      ability_key: kind === 'ability' ? key : null, stance_key: kind === 'ability' ? null : key,
      target_creature_id: kind === 'ability' ? 'creature' : null }],
    boss_abilities: [], boss_configurations: [{ encounter_id: 'stack-seed', node_creature_id: 'spawn', creature_id: 'creature', spawn_seq: 4, boss_cast: null }], participation: [], pending_events: [],
    tank_candidates: [{ fighter_id: '10000000-0000-4000-8000-000000000001', character_id: '20000000-0000-4000-8000-000000000001', entry_seq: 7 }],
    reward_config: { xp_boost_multiplier: 1, drop_chance_regular: .35, drop_chance_rare: .6, drop_chance_boss: 1, equip_level_min_offset: -3, equip_level_max_offset: 0, common_pct: 80, uncommon_pct: 20, consumable_drop_chance: .15, consumable_level_min_offset: -5, consumable_level_max_offset: 0 }, loot_items: [], loot_table_entries: [],
  };
}

function persisted(out: ProposedTick): SnapshotEffect[] {
  return out.effects_insert.map((effect, index) => ({ id: `effect-${index}`,
    kind: '', effect_type: '', ability_key: null, target_character_id: null, target_creature_id: null,
    source_character_id: null, source_creature_id: null, stacks: 1, magnitude: null, config: {},
    expires_at: null, next_due_at: null, interval_ms: null, last_pulse_tick: null,
    is_reservation: false, ...effect }));
}

// Test-only authored release inputs. Production JSON, CP prices and reservations stay untouched.
function fireRecords() {
  const records = structuredClone(authored.abilities);
  for (const key of ['fireball', 'ignite']) {
    const row = records.find(row => row.classKey === 'wizard' && row.abilityKey === key)!;
    row.appliedStatus = 'ignite'; row.statusApplicationEnabled = true;
    row.statusTrigger = key === 'fireball' ? 'ability_hit' : 'successful_pulse_hit';
    row.statusChancePct = key === 'fireball' ? 35 : null;
    row.effectConfig = { ...(key === 'ignite' ? row.effectConfig : { stat: 'int', accuracy_stat: 'int' }),
      stack_grouping: 'caster_status' };
    row.mechanicCalcs = {
      ...row.mechanicCalcs,
      stack_damage: { base: 2, unit: 'hp', rounding: 'floor', terms: [
        { source: 'stat', stat: 'wis', mult: .25, clampAtZero: true, rounding: 'floor' },
      ] },
      stack_duration: { base: 30000, cap: 45000, unit: 'ms', terms: [
        { source: 'stat', stat: 'wis', mult: 1000, clampAtZero: true },
      ] },
      max_stacks: { base: 5, unit: 'count', terms: [] },
      ...(key === 'ignite' ? { pulse_damage: { base: 2, floor: 1, unit: 'hp', rounding: 'floor', terms: [
        { source: 'stat', stat: 'int', mult: 1, transform: { kind: 'soft', profile: 'damage' } },
      ] } } : {}),
    };
  }
  const finisher = records.find(row => row.classKey === 'wizard' && row.abilityKey === 'conflagrate')!;
  finisher.effectConfig = { ...finisher.effectConfig, stack_grouping: 'caster_status', stack_consume_on: 'landed_hit' };
  finisher.mechanicCalcs = { per_stack_multiplier: { base: .30, unit: 'percent', terms: [] } };
  return records;
}
const releaseRecords = fireRecords();
const fireCatalog = buildAbilityCatalog(releaseRecords, authored.statuses);
const deps = { abilities: fireCatalog.specs };

function owned(stacks = 2, abilityKey = 'fireball'): SnapshotEffect {
  const effect = stack('ignite', stacks, abilityKey);
  effect.config = { ...effect.config, stack_grouping: 'caster_status', activated_at_tick: 0, expires_after_tick: 13, interval_ticks: 1, next_pulse_tick: 1 };
  return effect;
}

function source(snap: NodeSnapshot, guaranteed = true): SnapshotEffect {
  const activation = input('wizard', 'ignite', 'stance_activate');
  activation.fighters = structuredClone(snap.fighters);
  const effect = persisted(resolveNodeTick(activation, deps)).find(e => e.kind === 'stack_source')!;
  if (guaranteed) effect.magnitude = 1;
  return effect;
}

/** Apply the proposal as absolute state and advance one committed tick. */
function advance(snap: NodeSnapshot, out: ProposedTick): NodeSnapshot {
  const next = structuredClone(snap);
  next.effects = next.effects.filter(e => !out.effects_delete.includes(e.id)).map(e => ({
    ...e, ...out.effects_update.find(update => update.id === e.id),
  }));
  next.effects.push(...persisted(out).map((e, i) => ({ ...e, id: `tick-${snap.encounter.candidate_tick}-${i}` })));
  next.fighters = next.fighters.map(f => ({ ...f, cp: out.characters.find(c => c.id === f.character_id)?.cp ?? f.cp }));
  next.creatures = next.creatures.map(c => ({ ...c, hp: out.creatures.find(r => r.id === c.id)?.hp ?? c.hp }));
  next.encounter.tick = snap.encounter.candidate_tick;
  next.encounter.candidate_tick++;
  next.encounter.state_version++;
  next.encounter.now = new Date(Date.parse(snap.encounter.now) + 2000).toISOString();
  next.intents = [];
  return next;
}

function findOutcome(snap: NodeSnapshot, predicate: (out: ProposedTick) => boolean) {
  for (let seed = 0; seed < 500; seed++) {
    const candidate = structuredClone(snap); candidate.encounter.id = `fire-foundation-${seed}`;
    candidate.boss_configurations![0].encounter_id = candidate.encounter.id;
    const out = resolveNodeTick(candidate, deps);
    if (predicate(out)) return { snap: candidate, out };
  }
  throw new Error('No deterministic fixture seed matched');
}

describe('001D opt-in Fire foundation', () => {
  it('accepts test-only authored policies without activating them in the published catalogue', () => {
    expect(fireCatalog.rejected).toEqual([]);
    for (const spec of catalog.specs.values()) {
      expect(spec.stackGrouping).toBeUndefined(); expect(spec.stackConsumeOn).toBeUndefined();
    }
    expect(deps.abilities.get('wizard:conflagrate')!.cpCost).toBe(60);
    expect(deps.abilities.get('wizard:ignite')!.cpReservePct).toBe(.2);
  });

  it.each(['unknown', null, 1])('rejects malformed grouping %s instead of silently activating partial behavior', value => {
    const rows = fireRecords(); rows.find(r => r.abilityKey === 'fireball')!.effectConfig!.stack_grouping = value;
    expect(buildAbilityCatalog(rows, authored.statuses).rejected).toContainEqual(expect.objectContaining({ reason: 'invalid_calc' }));
  });

  it.each(['stack_damage', 'stack_duration', 'max_stacks', 'pulse_damage'])('rejects missing authored %s', name => {
    const rows = fireRecords(); delete rows.find(r => r.abilityKey === 'ignite')!.mechanicCalcs![name];
    expect(buildAbilityCatalog(rows, authored.statuses).rejected).toContainEqual(expect.objectContaining({ reason: 'missing_mechanic_calc', detail: name }));
  });

  it('rejects unsupported consumption policies, non-DoT grouping and malformed calculations', () => {
    const rows = fireRecords();
    rows.find(r => r.abilityKey === 'conflagrate')!.effectConfig!.stack_consume_on = 'sometimes';
    rows.find(r => r.abilityKey === 'fireball')!.appliedStatus = 'chilled';
    rows.find(r => r.abilityKey === 'ignite')!.mechanicCalcs!.stack_damage = { base: NaN, terms: [] };
    expect(buildAbilityCatalog(rows, authored.statuses).rejected).toHaveLength(3);
  });

  it('Fireball and an independent Orb apply the same group in one tick; replay is identical', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.effects = [source(snap)];
    const found = findOutcome(snap, out => out.events.filter(e => e.kind === 'stack_applied').length === 2);
    const stacks = found.out.effects_insert.filter(e => e.kind === 'stack');
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ effect_type: 'ignite', ability_key: 'fireball', stacks: 2,
      config: { stack_grouping: 'caster_status', source_fighter_id: '10000000-0000-4000-8000-000000000001', spawn_seq: 4 } });
    expect(found.out.effects_insert.some(e => e.effect_type === 'scorched')).toBe(false);
    expectValid(advance(found.snap, found.out));
    expect(resolveNodeTick(found.snap, deps)).toEqual(found.out);
  });

  it.each([[8, 2, 30000], [26, 4, 38000], [100, 13, 45000]])('WIS%s sets full per-stack magnitude and retained duration', (wis, magnitude, duration) => {
    const snap = input('wizard', 'fireball', 'ability'); snap.fighters[0].wis = wis;
    const out = findOutcome(snap, o => o.effects_insert.some(e => e.kind === 'stack')).out;
    expect(out.effects_insert.find(e => e.kind === 'stack')).toMatchObject({ magnitude,
      expires_at: new Date(NOW + duration).toISOString(), config: { max_stacks: 5 } });
    const orb = source(snap);
    expect(orb.config).toMatchObject({ dot_per_tick: magnitude, stack_duration_ms: duration });
  });

  it.each([[10, 2], [50, 22], [100, 33], [150, 44]])('INT%s reuses existing damage-soft profile for Orb damage', (int, damage) => {
    const snap = input('wizard', 'fireball', 'ability'); snap.intents = []; snap.fighters[0].int = int;
    snap.effects = [source(snap)];
    const out = resolveNodeTick(snap, deps);
    expect(out.events.find(e => e.kind === 'orb_attack')).toMatchObject({ amount: damage, hitQuality: 'normal' });
  });

  it('caps and refreshes an existing group across applying keys without duplicate or immediate pulses', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.effects = [owned(5), source(snap)];
    const out = findOutcome(snap, o => o.events.filter(e => e.kind === 'stack_applied').length === 2).out;
    expect(out.effects_insert.filter(e => e.kind === 'stack')).toHaveLength(0);
    expect(out.effects_update.find(e => e.id === 'ignite-stack')).toMatchObject({ stacks: 5,
      expires_at: new Date(NOW + 33000).toISOString(), next_due_at: new Date(NOW + 2000).toISOString() });
    // The already-due old group pulses once before the two applications; refresh adds no pulse.
    expect(out.events.filter(e => e.kind === 'effect_pulse').map(e => e.amount)).toEqual([15]);
  });

  it('ticks full damage per stack once and expires after the final due tick', () => {
    let snap = input('wizard', 'fireball', 'ability'); snap.intents = [];
    const effect = owned(5); effect.magnitude = 4;
    effect.config = { ...effect.config, activated_at_tick: 0, expires_after_tick: 2, interval_ticks: 1, next_pulse_tick: 1 };
    effect.next_due_at = new Date(NOW).toISOString(); effect.expires_at = new Date(NOW + 2000).toISOString(); snap.effects = [effect];
    for (let tick = 1; tick <= 3; tick++) {
      const out = resolveNodeTick(snap, deps);
      expect(out.events.filter(e => e.kind === 'effect_pulse' && e.abilityKey === 'fireball').map(e => e.amount))
        .toEqual(tick <= 2 ? [20] : []);
      if (tick === 3) expect(out.effects_delete).toContain(effect.id);
      snap = advance(snap, out);
    }
  });

  it('two casters have independent groups on one creature', () => {
    const snap = input('wizard', 'fireball', 'ability');
    snap.fighters.push({ ...snap.fighters[0], id: '10000000-0000-4000-8000-000000000002', character_id: '20000000-0000-4000-8000-000000000002', entry_seq: 8 });
    const own = source(snap); const other = structuredClone(own);
    other.id = 'other-source'; other.source_character_id = other.target_character_id = '20000000-0000-4000-8000-000000000002';
    other.config.source_fighter_id = other.config.target_fighter_id = '10000000-0000-4000-8000-000000000002';
    other.config.source_entry_seq = other.config.target_entry_seq = 8;
    snap.effects = [own, other]; snap.intents = [];
    const out = resolveNodeTick(snap, deps);
    expect(out.effects_insert.filter(e => e.kind === 'stack').map(e => e.source_character_id).sort())
      .toEqual(['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002']);
    expectValid(advance(snap, out));
  });

  it('Conflagrate preserves stacks on miss, spends the unchanged CP price and reports zero consumed', () => {
    const snap = input('wizard', 'conflagrate', 'ability'); snap.effects = [owned(5)]; snap.creatures[0].ac = 1000;
    const out = findOutcome(snap, o => o.events.some(e => e.kind === 'attack' && e.hitQuality === 'miss')).out;
    expect(out.effects_delete).not.toContain('ignite-stack');
    expect(out.events.find(e => e.kind === 'attack')!.meta!.stacksConsumed).toBe(0);
    expect(out.characters.find(c => c.id === '20000000-0000-4000-8000-000000000001')!.cp).toBe(440);
  });

  it.each(['glancing', 'normal', 'strong'])('Conflagrate consumes only own stacks on %s contact', quality => {
    const snap = input('wizard', 'conflagrate', 'ability'); snap.creatures[0].ac = 25;
    const other = owned(5); other.id = 'other'; other.source_character_id = '20000000-0000-4000-8000-000000000002';
    other.config = { ...other.config, source_fighter_id: '10000000-0000-4000-8000-000000000002', source_entry_seq: 8 };
    snap.fighters.push({ ...snap.fighters[0], character_id: '20000000-0000-4000-8000-000000000002', id: '10000000-0000-4000-8000-000000000002', entry_seq: 8 });
    snap.effects = [owned(3), other];
    const out = findOutcome(snap, o => o.events.some(e => e.kind === 'attack' && e.abilityKey === 'conflagrate' && e.hitQuality === quality)).out;
    expect(out.effects_delete).toContain('ignite-stack'); expect(out.effects_delete).not.toContain('other');
    expect(out.events.find(e => e.abilityKey === 'conflagrate')!.meta!.stacksConsumed).toBe(3);
    if (quality === 'glancing') expect(out.events.find(e => e.abilityKey === 'conflagrate')!.amount).toBeLessThanOrEqual(3);
  });

  it('Conflagrate uses exactly +30% per own stack with the retained INT base and normal rounding', () => {
    const snap = input('wizard', 'conflagrate', 'ability'); snap.effects = [owned(3)];
    const found = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'conflagrate' && e.hitQuality === 'strong' && !e.meta?.isCrit));
    // INT20 -> i5, level20: base4+10+6=20; three stacks -> x1.9, strong x1.25.
    expect(found.out.events.find(e => e.abilityKey === 'conflagrate')!.amount).toBe(Math.floor(20 * 1.9 * 1.25));
  });

  it('zero-stack cast works and a later Orb creates a fresh single stack after consumption', () => {
    const zero = input('wizard', 'conflagrate', 'ability');
    expect(resolveNodeTick(zero, deps).events.find(e => e.abilityKey === 'conflagrate')!.meta!.stacksConsumed).toBe(0);
    zero.effects = [owned(5), source(zero)];
    const out = findOutcome(zero, o => o.effects_delete.includes('ignite-stack')).out;
    expect(out.effects_update.some(e => e.id === 'ignite-stack')).toBe(false);
    expect(out.effects_insert.find(e => e.kind === 'stack')).toMatchObject({ stacks: 1, ability_key: 'ignite' });
  });

  it('rejects duplicate shared identities across ability keys and stale spawn/entry fences', () => {
    const snap = input('wizard', 'conflagrate', 'ability'); const a = owned(); const b = owned(3, 'ignite'); b.id = 'orb-stack';
    snap.effects = [a, b]; expect(decodeSnapshot(snap).ok).toBe(false);
    snap.effects = [a]; expectValid(snap);
    a.config.spawn_seq = 3; expect(decodeSnapshot(snap).ok).toBe(false);
    a.config.spawn_seq = 4; a.config.source_entry_seq = 6; expect(decodeSnapshot(snap).ok).toBe(false);
    expect(resolveNodeTick(snap, deps).events.find(e => e.abilityKey === 'conflagrate')!.meta!.stacksConsumed).toBe(0);
  });

  it('keeps every other class spec and deterministic output unchanged', () => {
    for (const [key, spec] of catalog.specs) if (spec.classKey !== 'wizard') expect(deps.abilities.get(key)).toEqual(spec);
    const snap = input('assassin', 'eviscerate', 'ability'); snap.effects = [stack('poison', 3)]; snap.creatures[0].ac = 1000;
    expect(resolveNodeTick(snap, deps)).toEqual(resolveNodeTick(snap, legacyDeps));
    expect(resolveNodeTick(snap, deps).effects_delete).toContain('poison-stack');
  });

  it('Fireball does not apply Ignite on natural one, and crits can apply the same owned status', () => {
    const snap = input('wizard', 'fireball', 'ability');
    const missed = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'fireball' && e.outcomeReason === 'critical_miss'));
    expect(missed.out.effects_insert.some(e => e.kind === 'stack')).toBe(false);
    expect(missed.out.characters.find(c => c.id === snap.fighters[0].character_id)!.cp).toBe(490);
    const crit = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'fireball' && e.meta?.isCrit === true)
      && o.effects_insert.some(e => e.kind === 'stack'));
    expect(crit.out.effects_insert.find(e => e.kind === 'stack')!.stacks).toBe(1);
  });

  it('Fireball grazing is landed contact for Ignite and its proc remains probabilistic at35%', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.creatures[0].ac = 25;
    const graze = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'fireball' && e.hitQuality === 'glancing')
      && o.effects_insert.some(e => e.kind === 'stack'));
    expect(graze.out.effects_insert.find(e => e.kind === 'stack')!.stacks).toBe(1);
    let landed = 0, applied = 0;
    for (let seed = 0; seed < 1000; seed++) {
      snap.encounter.id = `proc-distribution-${seed}`;
      const out = resolveNodeTick(snap, deps);
      if (out.events.some(e => e.kind === 'attack' && e.abilityKey === 'fireball' && e.hitQuality !== 'miss')) landed++;
      if (out.effects_insert.some(e => e.kind === 'stack')) applied++;
    }
    expect(applied / landed).toBeGreaterThan(.30); expect(applied / landed).toBeLessThan(.40);
  });

  it('Conflagrate critical hit consumes once; stale retry keeps the identical absolute proposal', () => {
    const snap = input('wizard', 'conflagrate', 'ability'); snap.effects = [owned(4)];
    const found = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'conflagrate' && e.meta?.isCrit === true));
    expect(found.out.effects_delete.filter(id => id === 'ignite-stack')).toHaveLength(1);
    expect(found.out.events.find(e => e.abilityKey === 'conflagrate')!.meta!.stacksConsumed).toBe(4);
    expect(resolveNodeTick(found.snap, deps)).toEqual(found.out);
  });

  it('uses working state for a newly inserted stack and never consumes that stack twice', () => {
    const snap = input('wizard', 'fireball', 'ability');
    // Exercise ordered working-state behavior directly; accepted gameplay still has one action slot.
    snap.intents.push(...[2, 3].map(seq => ({ ...snap.intents[0], id: `finisher-${seq}`, seq, ability_key: 'conflagrate' })));
    const found = findOutcome(snap, o => o.events.filter(e => e.abilityKey === 'conflagrate' && e.kind === 'attack').length === 2
      && o.events.some(e => e.abilityKey === 'conflagrate' && e.meta?.stacksConsumed === 1));
    const consumed = found.out.events.filter(e => e.kind === 'attack' && e.abilityKey === 'conflagrate')
      .map(e => e.meta!.stacksConsumed);
    expect(consumed).toEqual([1, 0]);
    expect(found.out.effects_insert.some(e => e.kind === 'stack')).toBe(false);
    expect(found.out.effects_delete).not.toContain(undefined);
    expect(resolveNodeTick(found.snap, deps)).toEqual(found.out);
  });

  it('does not stack after a killing Fireball or Orb', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.creatures[0].hp = 1;
    const hit = findOutcome(snap, o => o.events.some(e => e.kind === 'attack' && (e.amount ?? 0) > 0));
    expect(hit.out.effects_insert.some(e => e.kind === 'stack')).toBe(false);
    snap.intents = []; snap.effects = [source(snap)];
    expect(resolveNodeTick(snap, deps).effects_insert.some(e => e.kind === 'stack')).toBe(false);
  });

  it('never reuses stacks from a previous creature spawn or fighter entry', () => {
    const snap = input('wizard', 'conflagrate', 'ability'); const old = owned(5);
    old.config.spawn_seq = 3; snap.effects = [old];
    const out = resolveNodeTick(snap, deps);
    expect(out.events.find(e => e.abilityKey === 'conflagrate')!.meta!.stacksConsumed).toBe(0);
    expect(out.effects_delete).toContain(old.id);
  });

  it('default Fireball and Conflagrate behavior is unchanged when the policies are absent', () => {
    const fire = input('wizard', 'fireball', 'ability');
    expect(resolveNodeTick(fire, legacyDeps).effects_insert.some(e => e.effect_type === 'ignite')).toBe(false);
    const con = input('wizard', 'conflagrate', 'ability'); con.creatures[0].ac = 1000; con.effects = [stack('ignite', 3)];
    expect(resolveNodeTick(con, legacyDeps).effects_delete).toContain('ignite-stack');
  });
});

function stack(effectType: 'poison' | 'ignite', stacks: number, abilityKey = effectType === 'poison' ? 'envenom' : 'ignite'): SnapshotEffect {
  return { id: `${effectType}-stack`, kind: 'stack', effect_type: effectType, ability_key: abilityKey,
    target_character_id: null, target_creature_id: 'creature', source_character_id: '20000000-0000-4000-8000-000000000001',
    source_creature_id: null, stacks, magnitude: 3,
    config: { node_creature_id: 'spawn', creature_id: 'creature', spawn_seq: 4,
      source_fighter_id: '10000000-0000-4000-8000-000000000001', source_entry_seq: 7, max_stacks: 5, damage_type: effectType === 'ignite' ? 'fire' : 'poison' },
    expires_at: new Date(NOW + 25000).toISOString(), next_due_at: new Date(NOW + 10000).toISOString(),
    interval_ms: 2000, last_pulse_tick: null, is_reservation: false };
}


function expectValid(snap: NodeSnapshot) {
  const decoded = decodeSnapshot(snap);
  expect(decoded.ok, JSON.stringify(decoded)).toBe(true);
}
