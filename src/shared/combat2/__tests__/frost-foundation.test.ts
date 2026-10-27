import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { decodeSnapshot } from '../decode';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, ProposedTick, SnapshotEffect, SnapshotIntent } from '../types';
import { MECHANIC_HANDLERS } from '../mechanics';
import { TickRandom } from '../rng';

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

const frostRecords = structuredClone(authored.abilities);
const statuses = structuredClone(authored.statuses);
const chillRow = statuses.find(row => row.key === 'chilled')!;
chillRow.modifier = { ...chillRow.modifier, value: 2 };
chillRow.duration = { base_ms: 10000 };
chillRow.stacks = { max_stacks_calc: { base: 5, terms: [], unit: 'count' } };
const frost = frostRecords.find(row => row.abilityKey === 'frostbolt')!;
frost.effectConfig = { ...frost.effectConfig, stack_grouping: 'creature_status' };
const grasp = structuredClone(frost);
grasp.abilityKey = grasp.classAbilityKey = 'winters_grasp'; grasp.label = "Winter's Grasp";
grasp.cpCost = 20; grasp.appliedStatus = null; grasp.statusTrigger = null; grasp.statusChancePct = null;
grasp.effectConfig = { stat: 'int', accuracy_stat: 'int', shared_stack_type: 'chilled' };
grasp.amountCalc = { ...(grasp.amountCalc as object), base: 8 };
grasp.mechanicCalcs = { per_stack_multiplier: { base: .12, unit: 'percent', terms: [] } };
frostRecords.push(grasp);
const armor = structuredClone(frostRecords.find(row => row.abilityKey === 'force_shield')!);
armor.abilityKey = armor.classAbilityKey = 'frost_armor'; armor.label = 'Frost Armor';
armor.mechanic = 'control_debuff'; armor.appliedStatus = null;
armor.effectConfig = { contact_debuff: 'weakened', control_mode: 'damage_reduction' };
armor.amountCalc = { base: .1, unit: 'multiplier', terms: [] };
armor.durationCalc = { base: 10000, unit: 'ms', terms: [] };
armor.mechanicCalcs = {}; frostRecords.push(armor);
const frostCatalog = buildAbilityCatalog(frostRecords, statuses);
const deps = { abilities: frostCatalog.specs };
const F1 = '10000000-0000-4000-8000-000000000001', C1 = '20000000-0000-4000-8000-000000000001';
const F2 = '10000000-0000-4000-8000-000000000002', C2 = '20000000-0000-4000-8000-000000000002';

function chilled(stacks: number, type = 'chilled'): SnapshotEffect {
  return { id: 'shared-chill', kind: 'amplification', effect_type: type, ability_key: 'frostbolt',
    source_character_id: C1, target_creature_id: 'creature', target_character_id: null, source_creature_id: null,
    stacks, magnitude: 0, config: { stack_grouping: 'creature_status', node_creature_id: 'spawn',
      creature_id: 'creature', spawn_seq: 4, max_stacks: 5, damage_taken_pct: 2,
      eligible_sources: ['ability', 'weapon', 'dot', 'stance', 'proc'], modifier_kind: 'damage_taken_pct',
      activated_at_tick: 0, expires_after_tick: 5, interval_ticks: 1, next_pulse_tick: 1 },
    expires_at: new Date(NOW + 10000).toISOString(), interval_ms: null, next_due_at: null,
    last_pulse_tick: null, is_reservation: false };
}

function withArmor(snap: NodeSnapshot): SnapshotEffect {
  const effects = MECHANIC_HANDLERS.control_debuff({ actor: snap.fighters[0], nowMs: NOW,
    tick: snap.encounter.candidate_tick, rng: new TickRandom({ encounterId: snap.encounter.id,
      candidateTick: snap.encounter.candidate_tick }) }, deps.abilities.get('wizard:frost_armor')!).effects;
  return persisted({ ...resolveNodeTick({ ...snap, intents: [], creatures: [] }, legacyDeps), effects_insert: effects })[0];
}

function contactSnapshot(): NodeSnapshot {
  const snap = input('wizard', 'frostbolt', 'ability'); snap.intents = [];
  snap.fighters[0].ac = 1; snap.creatures[0].level = 20; snap.creatures[0].stats = { str: 50 };
  snap.effects = [withArmor(snap)];
  return snap;
}
const attacks = (out: ProposedTick) => out.events.filter(e => e.kind === 'creature_attack');
const weak = (out: ProposedTick) => out.effects_insert.filter(e => e.effect_type === 'weakened');
function expectValid(snap: NodeSnapshot) {
  const decoded = decodeSnapshot(snap); expect(decoded.ok, JSON.stringify(decoded)).toBe(true);
}

describe('001E opt-in Frost foundation', () => {
  it('accepts only explicit local policies; published defaults remain inactive', () => {
    expect(frostCatalog.rejected).toEqual([]);
    for (const spec of catalog.specs.values()) {
      expect(spec.stackGrouping).toBeUndefined(); expect(spec.sharedStackType).toBeUndefined(); expect(spec.contactDebuff).toBeUndefined();
    }
    expect(deps.abilities.get('wizard:winters_grasp')!.cpCost).toBe(20);
  });

  it.each(['contact_debuff', 'shared_stack_type', 'stack_grouping'])('rejects malformed authored %s', field => {
    const rows = structuredClone(frostRecords);
    const row = rows.find(r => r.abilityKey === (field === 'contact_debuff' ? 'frost_armor' : field === 'shared_stack_type' ? 'winters_grasp' : 'frostbolt'))!;
    row.effectConfig![field] = 42;
    expect(buildAbilityCatalog(rows, statuses).rejected).not.toEqual([]);
  });

  it('two Wizards build exactly one shared group without modifying the triggering hit', () => {
    const snap = input('wizard', 'frostbolt', 'ability');
    snap.fighters.push({ ...snap.fighters[0], id: F2, character_id: C2, entry_seq: 8 });
    snap.intents.push({ ...snap.intents[0], id: 'second-cast', seq: 2, character_id: C2 });
    const found = findOutcome(snap, o => o.events.filter(e => e.kind === 'status_applied' && e.meta?.status === 'chilled').length === 2);
    const groups = found.out.effects_insert.filter(e => e.effect_type === 'chilled');
    expect(groups).toHaveLength(1); expect(groups[0].stacks).toBe(2);
    const first = found.out.events.find(e => e.kind === 'attack' && e.actor?.id === C1)!;
    const base = resolveNodeTick(found.snap, legacyDeps).events.find(e => e.kind === 'attack' && e.actor?.id === C1)!;
    expect(first.amount).toBe(base.amount);
    expectValid(advance(found.snap, found.out));
    expect(resolveNodeTick(found.snap, deps)).toEqual(found.out);
  });

  it('caps at five, refreshes the entire group at cap and preserves first-source attribution', () => {
    const snap = input('wizard', 'frostbolt', 'ability'); snap.effects = [chilled(5)];
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'status_applied'));
    const group = found.out.effects_insert.find(e => e.effect_type === 'chilled')!;
    expect(group).toMatchObject({ stacks: 5, source_character_id: C1,
      expires_at: new Date(NOW + 10000).toISOString(), config: { expires_after_tick: 6 } });
    expect(found.out.effects_delete).toContain('shared-chill');
    expectValid(advance(found.snap, found.out));
  });

  it('miss and natural one add no Chilled; grazing does', () => {
    const snap = input('wizard', 'frostbolt', 'ability'); snap.creatures[0].ac = 25;
    const missed = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'frostbolt' && e.hitQuality === 'miss'));
    expect(missed.out.effects_insert.some(e => e.effect_type === 'chilled')).toBe(false);
    const nat1 = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'frostbolt' && e.outcomeReason === 'critical_miss'));
    expect(nat1.out.effects_insert.some(e => e.effect_type === 'chilled')).toBe(false);
    const grazing = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'frostbolt' && e.hitQuality === 'glancing'));
    expect(grazing.out.effects_insert.find(e => e.effect_type === 'chilled')!.stacks).toBe(1);
  });

  it.each([0, 1, 5])('Grasp reads %s shared stacks with separate12%% and2%% bonuses and never consumes', stacks => {
    const snap = input('wizard', 'winters_grasp', 'ability'); if (stacks) snap.effects = [chilled(stacks)];
    const found = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'winters_grasp' && e.hitQuality === 'strong' && !e.meta?.isCrit));
    // INT20/L20 base =8+10+6=24. Strong quality is1.25 before shared amplification.
    const expected = Math.floor(Math.floor(24 * (1 + .12 * stacks) * 1.25) * (1 + .02 * stacks));
    expect(found.out.events.find(e => e.abilityKey === 'winters_grasp')!.amount).toBe(expected);
    expect(found.out.effects_delete).not.toContain('shared-chill');
    expect(found.out.effects_insert.some(e => e.effect_type === 'chilled')).toBe(false);
    expect(found.out.characters.find(c => c.id === C1)!.cp).toBe(480);
  });

  it.each(['miss', 'glancing', 'critical'])('Grasp uses normal %s resolution without consuming Chilled', quality => {
    const snap = input('wizard', 'winters_grasp', 'ability'); snap.creatures[0].ac = 25; snap.effects = [chilled(5)];
    const found = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'winters_grasp'
      && (quality === 'critical' ? e.meta?.isCrit === true : e.hitQuality === quality)));
    expect(found.out.effects_delete).not.toContain('shared-chill');
    expect(found.out.characters.find(c => c.id === C1)!.cp).toBe(480);
    if (quality === 'glancing') expect(found.out.events.find(e => e.abilityKey === 'winters_grasp')!.amount).toBeLessThanOrEqual(3);
  });

  it('shared stacks affect another party member and DoT exactly once, without legacy10% overlay', () => {
    const snap = input('wizard', 'winters_grasp', 'ability');
    snap.fighters.push({ ...snap.fighters[0], id: F2, character_id: C2, entry_seq: 8, party_id: 'party', party_id_at_entry: 'party' });
    snap.fighters[0].party_id = snap.fighters[0].party_id_at_entry = 'party';
    snap.intents[0].character_id = C2;
    const legacy = chilled(1); legacy.id = 'legacy'; delete legacy.config.stack_grouping; legacy.config.damage_taken_pct = 10;
    const dot: SnapshotEffect = { ...chilled(1), id: 'dot', kind: 'dot', effect_type: 'test_dot', ability_key: 'test_dot',
      magnitude: 100, interval_ms: 2000, next_due_at: new Date(NOW).toISOString(),
      config: { ...chilled(1).config, stack_grouping: undefined }, stacks: 1 };
    snap.effects = [chilled(1), legacy, dot];
    const out = resolveNodeTick(snap, deps);
    expect(out.events.find(e => e.kind === 'effect_pulse' && e.abilityKey === 'test_dot')!.amount).toBe(102);
    const noLegacy = structuredClone(snap); noLegacy.effects = noLegacy.effects.filter(e => e.id !== 'legacy');
    expect(out.events.find(e => e.abilityKey === 'winters_grasp')!.amount)
      .toBe(resolveNodeTick(noLegacy, deps).events.find(e => e.abilityKey === 'winters_grasp')!.amount);
  });

  it('expiry removes shared bonuses and stale spawns cannot amplify Grasp', () => {
    const snap = input('wizard', 'winters_grasp', 'ability'); snap.effects = [chilled(5)];
    snap.encounter.tick = 5; snap.encounter.candidate_tick = 6;
    const out = resolveNodeTick(snap, deps);
    const clean = structuredClone(snap); clean.effects = [];
    expect(out.events.find(e => e.abilityKey === 'winters_grasp')!.amount)
      .toBe(resolveNodeTick(clean, deps).events.find(e => e.abilityKey === 'winters_grasp')!.amount);
    expect(out.effects_delete).toContain('shared-chill');
    snap.encounter.tick = 0; snap.encounter.candidate_tick = 1; snap.effects[0].config.spawn_seq = 3;
    expect(decodeSnapshot(snap).ok).toBe(false);
    expect(resolveNodeTick(snap, deps).events.find(e => e.abilityKey === 'winters_grasp')!.amount)
      .toBe(resolveNodeTick({ ...snap, effects: [] }, deps).events.find(e => e.abilityKey === 'winters_grasp')!.amount);
  });

  it('decoder rejects two shared groups across casters or ability keys', () => {
    const snap = input('wizard', 'frostbolt', 'ability');
    snap.effects = [chilled(2), { ...chilled(3), id: 'duplicate', source_character_id: C2, ability_key: 'another' }];
    expect(decodeSnapshot(snap)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining('duplicate shared creature status')]) });
  });

  it.each(['normal', 'glancing', 'critical'])('Armor triggers on %s contact and only reduces later hits', quality => {
    const snap = contactSnapshot(); if (quality === 'glancing') snap.fighters[0].ac = 25;
    const found = findOutcome(snap, o => attacks(o).some(e => quality === 'critical' ? e.meta?.isCrit === true : e.hitQuality === quality));
    expect(weak(found.out)).toHaveLength(1);
    expect(attacks(found.out)[0].meta?.outgoingReduced).toBeUndefined();
    expect(weak(found.out)[0]).toMatchObject({ stacks: 1, magnitude: .1,
      expires_at: new Date(NOW + 10000).toISOString() });
    expectValid(advance(found.snap, found.out));
    expect(resolveNodeTick(found.snap, deps)).toEqual(found.out);
  });

  it('fully absorbed contact still applies Weakened', () => {
    const snap = contactSnapshot();
    snap.effects.push({ ...snap.effects[0], id: 'absorb', kind: 'absorb', effect_type: 'ward', magnitude: 10000 });
    const found = findOutcome(snap, o => attacks(o).some(e => e.hitQuality !== 'miss'));
    expect(attacks(found.out)[0].amount).toBe(0); expect(weak(found.out)).toHaveLength(1);
  });

  it.each(['miss', 'evasion'])('Armor ignores %s', kind => {
    const snap = contactSnapshot(); if (kind === 'miss') snap.fighters[0].ac = 1000;
    else snap.effects.push({ ...snap.effects[0], id: 'evade', kind: 'evasion', magnitude: 1 });
    const found = findOutcome(snap, o => kind === 'evasion' ? o.events.some(e => e.kind === 'attack_evaded')
      : attacks(o).some(e => e.hitQuality === 'miss'));
    expect(weak(found.out)).toHaveLength(0);
  });

  it('DoT and unsupported environment events do not establish direct contact', () => {
    const snap = contactSnapshot(); snap.creatures[0].engaged = false; snap.tank_candidates = [];
    snap.effects.push({ ...snap.effects[0], id: 'dot', kind: 'dot', target_character_id: C1,
      source_character_id: null, source_creature_id: 'creature', magnitude: 5,
      next_due_at: new Date(NOW).toISOString(), interval_ms: 2000,
      config: { activated_at_tick: 0, expires_after_tick: 5, interval_ticks: 1, next_pulse_tick: 1 } });
    snap.pending_events = [{ id: 'env', event_type: 'environment_damage', actor_character_id: null,
      actor_creature_id: null, target_character_id: C1, target_creature_id: null, payload: { amount: 5 }, occurred_at: new Date(NOW).toISOString() }];
    const out = resolveNodeTick(snap, deps);
    expect(out.events.some(e => e.kind === 'effect_pulse')).toBe(true); expect(weak(out)).toHaveLength(0);
  });

  it('opportunity contact applies Weakened before a later ordinary hit in the same tick', () => {
    const snap = contactSnapshot();
    snap.pending_events = [{ id: 'opportunity', event_type: 'fighter_entered', actor_character_id: C1,
      actor_creature_id: null, target_character_id: C1, target_creature_id: null,
      payload: { fighter_id: F1, entry_seq: 7 }, occurred_at: new Date(NOW).toISOString() }];
    const found = findOutcome(snap, o => attacks(o).length === 2 && attacks(o).every(e => e.hitQuality !== 'miss'));
    expect(attacks(found.out)[0].meta?.opportunityKind).toBe('entry');
    expect(attacks(found.out)[0].meta?.outgoingReduced).toBeUndefined();
    expect(Number(attacks(found.out)[1].meta?.outgoingReduced)).toBeGreaterThan(0);
    expect(weak(found.out)).toHaveLength(1); expect(weak(found.out)[0].stacks).toBe(1);
  });

  it('supported exit opportunity contact also applies Armor without changing movement generation', () => {
    const snap = contactSnapshot();
    snap.pending_events = [{ id: 'exit', event_type: 'fighter_exit_requested', actor_character_id: C1,
      actor_creature_id: null, target_character_id: C1, target_creature_id: null,
      payload: { fighter_id: F1, entry_seq: 7 }, occurred_at: new Date(NOW).toISOString() }];
    const found = findOutcome(snap, o => attacks(o).some(e => e.meta?.opportunityKind === 'exit' && e.hitQuality !== 'miss'));
    expect(weak(found.out)).toHaveLength(1);
    expect(found.out.fighters).toContainEqual(expect.objectContaining({ id: F1, present: false }));
  });

  it('Weakened refreshes without stacking and expires after ten seconds', () => {
    const snap = contactSnapshot(); const first = findOutcome(snap, o => weak(o).length === 1);
    const next = advance(first.snap, first.out); next.fighters[0].ac = 1;
    const refreshed = findOutcome(next, o => weak(o).length === 1);
    expect(weak(refreshed.out)[0]).toMatchObject({ stacks: 1, magnitude: .1,
      config: { expires_after_tick: 7 } });
    const expired = advance(refreshed.snap, refreshed.out); expired.effects = expired.effects.filter(e => e.kind !== 'contact_status');
    expired.encounter.tick = 7; expired.encounter.candidate_tick = 8;
    expect(attacks(resolveNodeTick(expired, deps)).every(e => e.meta?.outgoingReduced === undefined)).toBe(true);
  });

  it.each(['instant', 'telegraphed'])('Armor covers %s boss primary and secondary damage through the common boundary', mode => {
    const snap = contactSnapshot();
    snap.fighters.push({ ...snap.fighters[0], id: F2, character_id: C2, entry_seq: 8 });
    snap.boss_abilities = [{ id: 'boss', creature_id: 'creature', spawn_seq: 4,
      ability_key: 'slam', label: 'Slam', weight: 1, windup_ticks: mode === 'instant' ? 0 : 2,
      targeting: 'tank_plus_others', magnitude: 100, secondary_magnitude: 50, amount_calc: null,
      damage_type: 'physical', effect: null, telegraph_text: null, resolution_text: null }];
    if (mode === 'telegraphed') snap.creatures[0].pending_action = {
      ability_key: 'slam', ability_label: 'Slam', started_at_tick: 0, resolve_at_tick: 1,
      target_mode: 'tank_plus_others', primary_magnitude: 100, secondary_magnitude: 50,
      damage_type: 'physical', target_fighter_id: null, target_character_id: null, target_entry_seq: null,
    };
    const found = findOutcome(snap, o => attacks(o).length === 2 && attacks(o).every(e => e.hitQuality !== 'miss'));
    expect(attacks(found.out)[0].meta?.outgoingReduced).toBeUndefined();
    expect(attacks(found.out)[1].meta?.outgoingReduced).toBe(5);
    expect(weak(found.out)).toHaveLength(1);
    const noArmor = structuredClone(found.snap); noArmor.effects = [];
    const clean = resolveNodeTick(noArmor, deps);
    expect(attacks(found.out)[0].amount).toBe(attacks(clean)[0].amount);
    expect(attacks(found.out)[1].amount).toBeLessThan(attacks(clean)[1].amount!);
  });

  it('a shared group survives its original caster departure and applies to another creature target only when fenced', () => {
    const snap = input('wizard', 'winters_grasp', 'ability'); snap.effects = [chilled(5)];
    snap.fighters.push({ ...snap.fighters[0], id: F2, character_id: C2, entry_seq: 8 });
    snap.fighters[0].present = false; snap.intents[0].character_id = C2;
    const found = findOutcome(snap, o => o.events.some(e => e.abilityKey === 'winters_grasp' && e.hitQuality === 'strong' && !e.meta?.isCrit));
    expect(found.out.events.find(e => e.abilityKey === 'winters_grasp')!.amount).toBe(52);
    const other = structuredClone(found.snap);
    other.creatures[0].id = 'other-spawn'; other.creatures[0].creature_id = 'other-creature';
    other.intents[0].target_creature_id = 'other-creature';
    expect(resolveNodeTick(other, deps).events.find(e => e.abilityKey === 'winters_grasp')!.amount).toBe(30);
  });

  it('same-tick Grasp sees a preceding caster stack; repeated reads never consume it', () => {
    const snap = input('wizard', 'frostbolt', 'ability');
    snap.fighters.push({ ...snap.fighters[0], id: F2, character_id: C2, entry_seq: 8 });
    snap.intents.push({ ...snap.intents[0], id: 'grasp', seq: 2, character_id: C2, ability_key: 'winters_grasp' });
    const found = findOutcome(snap, o => o.events.some(e => e.meta?.status === 'chilled')
      && o.events.some(e => e.abilityKey === 'winters_grasp' && e.hitQuality === 'strong' && !e.meta?.isCrit));
    expect(found.out.events.find(e => e.abilityKey === 'winters_grasp')!.amount)
      .toBe(Math.floor(Math.floor(24 * 1.12 * 1.25) * 1.02));
    expect(found.out.effects_insert.find(e => e.effect_type === 'chilled')!.stacks).toBe(1);
  });

  it('a shared refresh removes the previous standalone Chilled rather than stacking a legacy bonus', () => {
    const snap = input('wizard', 'frostbolt', 'ability'); const old = chilled(1);
    delete old.config.stack_grouping; old.config.damage_taken_pct = 10; snap.effects = [old];
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'status_applied'));
    expect(found.out.effects_delete).toContain('shared-chill');
    expect(found.out.effects_insert.filter(e => e.effect_type === 'chilled')).toHaveLength(1);
    expect(found.out.effects_insert.find(e => e.effect_type === 'chilled')!.stacks).toBe(1);
  });

  it('malformed shared and contact state fails strict decoding', () => {
    const snap = contactSnapshot(); snap.effects[0].config.contact_duration_ms = 0;
    expect(decodeSnapshot(snap).ok).toBe(false);
    snap.effects = [chilled(6)]; expect(decodeSnapshot(snap).ok).toBe(false);
    snap.effects = [chilled(2)]; snap.effects[0].config.creature_id = 'wrong'; expect(decodeSnapshot(snap).ok).toBe(false);
  });

  it('shared amplification applies to weapon and stance-proc damage through existing categories', () => {
    const snap = input('wizard', 'frostbolt', 'ability'); snap.intents = []; snap.fighters[0].str = 100;
    snap.effects = [chilled(5)];
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'attack' && e.hitQuality === 'strong'));
    const bare = structuredClone(found.snap); bare.effects = [];
    expect(found.out.events.find(e => e.kind === 'attack')!.amount)
      .toBe(Math.floor(resolveNodeTick(bare, deps).events.find(e => e.kind === 'attack')!.amount! * 1.10));
    // A stance source uses the independent proc category, just as Orbs and item damage do.
    const proc = structuredClone(found.snap);
    proc.effects.push({ ...chilled(1), id: 'orb', kind: 'stack_source', effect_type: 'ignite', ability_key: 'ignite',
      target_creature_id: null, target_character_id: C1, magnitude: 1,
      config: { source_fighter_id: F1, source_entry_seq: 7, stack_trigger: 'successful_pulse_hit',
        pulse_damage: 100, stack_effect_type: 'ignite', max_stacks: 5, stack_duration_ms: 30000, dot_per_tick: 2 } });
    expect(resolveNodeTick(proc, deps).events.find(e => e.kind === 'orb_attack')!.amount).toBe(110);
  });

  it('shared Chilled opts item damage into the proc category without changing legacy item behavior', () => {
    const snap = input('wizard', 'frostbolt', 'ability'); snap.intents = []; snap.effects = [chilled(5)];
    snap.fighters[0].equipment = [{ slot: 'ring', item_id: 'item', inventory_id: 'inventory', character_id: C1,
      durability: 10, max_durability: 10, applied_gems: {}, stat_override: null, crafted_level: null,
      item_present: true, item_type: 'equipment', weapon_tag: null, hands: null, item_level: 20,
      rarity: 'common', base_stats: {}, procs: [{ type: 'burst_damage', chance: 1, weight: 1,
        value: 100, damage_type: 'fire', text: null, trigger: 'on_hit' }] }];
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'item_proc_damage'));
    expect(found.out.events.find(e => e.kind === 'item_proc_damage')!.amount).toBe(110);
    const legacy = structuredClone(found.snap); delete legacy.effects[0].config.stack_grouping;
    expect(resolveNodeTick(legacy, deps).events.find(e => e.kind === 'item_proc_damage')!.amount).toBe(100);
    expect(resolveNodeTick(legacy, deps)).toEqual(resolveNodeTick(legacy, legacyDeps));
  });

  it('other class specs and unchanged Wizard Fire defaults preserve their prior proposals', () => {
    for (const [key, spec] of catalog.specs) if (spec.classKey !== 'wizard') expect(deps.abilities.get(key)).toEqual(spec);
    for (const [classKey, ability] of [['assassin', 'eviscerate'], ['wizard', 'fireball'], ['wizard', 'conflagrate']] as const) {
      const snap = input(classKey, ability, 'ability');
      expect(resolveNodeTick(snap, deps)).toEqual(resolveNodeTick(snap, legacyDeps));
    }
  });
});
