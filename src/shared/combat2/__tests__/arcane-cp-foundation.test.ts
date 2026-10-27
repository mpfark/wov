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

function arcaneRecords() {
  const rows = structuredClone(authored.abilities);
  rows.find(r => r.classKey === 'wizard' && r.abilityKey === 'conflagrate')!.cpCost = 30;
  for (const [key, cost, reserve] of [['force_shield', 10, 10], ['arcane_surge', 15, 15], ['ignite', 20, 20]] as const) {
    const row = rows.find(r => r.classKey === 'wizard' && r.abilityKey === key)!;
    row.cpCost = cost; row.cpReservePct = null; row.effectConfig = { ...row.effectConfig, cp_reserve_fixed: reserve };
  }
  const focus = structuredClone(rows.find(r => r.abilityKey === 'arcane_surge')!);
  focus.abilityKey = focus.classAbilityKey = 'arcane_focus'; focus.label = 'Arcane Focus';
  focus.effectConfig = { offense_mode: 'base_cp_discount', cp_discount_min: 5, cp_reserve_fixed: 15 };
  focus.amountCalc = { base: 5, terms: [], unit: 'count' }; rows.push(focus);
  const armor = structuredClone(rows.find(r => r.abilityKey === 'force_shield')!);
  armor.abilityKey = armor.classAbilityKey = 'frost_armor'; armor.mechanic = 'control_debuff';
  armor.amountCalc = { base: .1, terms: [], unit: 'multiplier' };
  armor.durationCalc = { base: 10000, terms: [], unit: 'ms' };
  armor.effectConfig = { cp_reserve_fixed: 10, contact_debuff: 'weakened', control_mode: 'damage_reduction' }; rows.push(armor);
  const overload = structuredClone(rows.find(r => r.abilityKey === 'fireball')!);
  overload.abilityKey = overload.classAbilityKey = 'arcane_overload'; overload.label = 'Arcane Overload';
  overload.damageType = 'arcane'; overload.cpCost = 30; overload.appliedStatus = null; overload.statusTrigger = null;
  overload.statusChancePct = null; overload.mechanicCalcs = {};
  overload.effectConfig = { stat: 'int', accuracy_stat: 'int', extra_cp_max: 30 };
  overload.amountCalc = { base: 12, floor: 1, unit: 'hp', terms: [
    { source: 'stat', stat: 'int', mult: 3, clampAtZero: true, rounding: 'round', transform: { kind: 'soft', profile: 'burst' } },
    { source: 'level', mult: 1 / 3, rounding: 'floor' },
    { source: 'context', contextKey: 'extra_cp', mult: 1.5 },
  ] }; rows.push(overload);
  const cheap = structuredClone(overload); cheap.abilityKey = cheap.classAbilityKey = 'cheap_spell';
  cheap.cpCost = 3; cheap.effectConfig = { stat: 'int', accuracy_stat: 'int' };
  cheap.amountCalc = { base: 10, terms: [], unit: 'hp' }; rows.push(cheap);
  return rows;
}
const records = arcaneRecords(), arcaneCatalog = buildAbilityCatalog(records, authored.statuses);
const deps = { abilities: arcaneCatalog.specs };
const C1 = '20000000-0000-4000-8000-000000000001';

function stance(_snap: NodeSnapshot, key: string, amount: number, state = {}) {
  return { character_id: C1, ability_key: key, reserve_pct: 0,
    reservation: { mode: 'fixed' as const, amount }, state, version: 1, activated_at: new Date(NOW).toISOString() };
}
function focused(snap: NodeSnapshot) {
  snap.character_stances = [stance(snap, 'arcane_focus', 15)]; return snap;
}
const attack = (out: ProposedTick, key = 'arcane_overload') => out.events.find(e => e.kind === 'attack' && e.abilityKey === key)!;
const cp = (out: ProposedTick) => out.characters.find(c => c.id === C1)?.cp;
function effectFor(snap: NodeSnapshot, key: string) {
  const spec = deps.abilities.get(`wizard:${key}`)!;
  const out = MECHANIC_HANDLERS[spec.mechanic]({ actor: snap.fighters[0], nowMs: NOW,
    tick: 1, rng: new TickRandom({ encounterId: snap.encounter.id, candidateTick: 1 }) }, spec);
  return persisted({ ...resolveNodeTick({ ...snap, intents: [], creatures: [] }, legacyDeps), effects_insert: out.effects });
}

describe('001F opt-in Arcane and CP preparation', () => {
  it('only fixtures select new policies; published catalogue and other-class specs remain unchanged', () => {
    expect(arcaneCatalog.rejected).toEqual([]);
    for (const spec of catalog.specs.values()) { expect(spec.cpReserveFixed).toBeUndefined(); expect(spec.extraCpMax).toBeUndefined(); }
    for (const [key, spec] of catalog.specs) if (spec.classKey !== 'wizard') expect(deps.abilities.get(key)).toEqual(spec);
  });

  it.each([['force_shield', 10, 10], ['frost_armor', 10, 10], ['arcane_surge', 15, 15],
    ['arcane_focus', 15, 15], ['ignite', 20, 20]] as const)('%s uses fixed activation%s/reservation%s locally', (key, cost, reserve) => {
    const snap = input('wizard', key, 'stance_activate');
    snap.effects = effectFor(snap, 'arcane_focus'); // Focus never discounts stance activation/reservation.
    const out = resolveNodeTick(snap, deps);
    expect(cp(out)).toBe(500 - cost);
    expect(out.effects_insert.find(e => e.kind === 'reservation')!.magnitude).toBe(reserve);
  });

  it.each([[30, 0], [42, 12], [60, 30], [100, 30]])('Overload at%s spendable CP burns%s extra', (raw, extra) => {
    const snap = input('wizard', 'arcane_overload', 'ability'); snap.fighters[0].cp = raw;
    const out = resolveNodeTick(snap, deps);
    expect(attack(out).meta).toMatchObject({ baseCp: 30, extraCp: extra });
    expect(cp(out)).toBe(raw - 30 - extra);
    expect(resolveNodeTick(snap, deps)).toEqual(out);
  });

  it.each([[40, 0], [52, 12], [70, 30], [100, 30]])('Focus + Overload at raw%s burns%s extra after15 reserved CP', (raw, extra) => {
    const snap = focused(input('wizard', 'arcane_overload', 'ability')); snap.fighters[0].cp = raw;
    const out = resolveNodeTick(snap, deps);
    expect(attack(out).meta).toMatchObject({ baseCp: 25, extraCp: extra }); expect(cp(out)).toBe(raw - 25 - extra);
    expect(decodeSnapshot(snap).ok).toBe(true);
  });

  it.each([['fireball', 5], ['frostbolt', 5], ['conflagrate', 25], ['cheap_spell', 5]])('Focus applies the effective base price to %s', (key, cost) => {
    const snap = focused(input('wizard', key, 'ability')); const out = resolveNodeTick(snap, deps);
    expect(cp(out)).toBe(500 - cost);
  });

  it('Focus makes a base cast affordable before both validation and settlement', () => {
    const snap = focused(input('wizard', 'fireball', 'ability')); snap.fighters[0].cp = 20;
    const out = resolveNodeTick(snap, deps); expect(cp(out)).toBe(15);
    expect(out.events.some(e => e.kind === 'action_rejected')).toBe(false);
    snap.fighters[0].cp = 19;
    expect(resolveNodeTick(snap, deps).events).toContainEqual(expect.objectContaining({ outcomeReason: 'insufficient_cp' }));
  });

  it('Overload refuses an unaffordable effective base without spending extra CP', () => {
    const snap = input('wizard', 'arcane_overload', 'ability'); snap.fighters[0].cp = 29;
    const out = resolveNodeTick(snap, deps); expect(attack(out)).toBeUndefined(); expect(cp(out)).toBeUndefined();
    expect(out.events).toContainEqual(expect.objectContaining({ outcomeReason: 'insufficient_cp' }));
  });

  it.each(['miss', 'glancing', 'critical'])('Overload %s spends the full computed base plus extra', quality => {
    const snap = focused(input('wizard', 'arcane_overload', 'ability')); snap.fighters[0].cp = 70; snap.creatures[0].ac = 25;
    const found = findOutcome(snap, o => quality === 'critical' ? attack(o)?.meta?.isCrit === true : attack(o)?.hitQuality === quality);
    expect(cp(found.out)).toBe(15); expect(attack(found.out).meta).toMatchObject({ baseCp: 25, extraCp: 30 });
    if (quality === 'glancing') expect(attack(found.out).amount).toBeLessThanOrEqual(3);
  });

  it('Overload evaluates the approved burst formula with authoritative extra_cp context', () => {
    const snap = input('wizard', 'arcane_overload', 'ability'); snap.fighters[0].cp = 42;
    const found = findOutcome(snap, o => attack(o)?.hitQuality === 'strong' && !attack(o)?.meta?.isCrit);
    // INT20 -> i5, L20 -> base12+15+6=33;12extra ->18; strong quality1.25.
    expect(attack(found.out).amount).toBe(Math.floor(51 * 1.25));
  });

  it.each([false, true])('uses working CP after an earlier same-tick spell (Focus%s)', focus => {
    const snap = input('wizard', 'fireball', 'ability'); snap.fighters[0].cp = focus ? 60 : 55;
    if (focus) focused(snap);
    snap.intents.push({ ...snap.intents[0], id: 'overload-second', seq: 2, ability_key: 'arcane_overload' });
    const out = resolveNodeTick(snap, deps);
    expect(attack(out).meta).toMatchObject({ baseCp: focus ? 25 : 30, extraCp: 15 }); expect(cp(out)).toBe(focus ? 15 : 0);
  });

  it('persistent fixed reservation is independent of MaxCP and depleted Force Shield retains it', () => {
    const snap = input('wizard', 'arcane_overload', 'ability'); snap.fighters[0].cp = 40;
    snap.character_stances = [stance(snap, 'force_shield', 10, { ward_remaining: 0 })];
    for (const max of [100, 500]) {
      snap.fighters[0].max_cp = max; const out = resolveNodeTick(snap, deps);
      expect(attack(out).meta).toMatchObject({ baseCp: 30, extraCp: 0 }); expect(cp(out)).toBe(10);
      expect(out.stance_fence).toContainEqual(expect.objectContaining({ ability_key: 'force_shield', version: 1 }));
      expect(out.stance_clear_character_ids).toEqual([]);
    }
  });

  it('existing percentage reservations retain their math for other classes', () => {
    const snap = input('assassin', 'envenom', 'stance_activate'); snap.fighters[0].max_cp = 200;
    const out = resolveNodeTick(snap, deps); expect(cp(out)).toBe(450);
    expect(out.effects_insert.find(e => e.kind === 'reservation')!.magnitude).toBe(40);
    expect(out).toEqual(resolveNodeTick(snap, legacyDeps));
  });

  it('several fixed reservations are summed before Focus and automatic extra burn', () => {
    const snap = focused(input('wizard', 'arcane_overload', 'ability')); snap.fighters[0].cp = 100;
    snap.character_stances!.push(stance(snap, 'force_shield', 10, { ward_remaining: 0 }), stance(snap, 'ignite', 20));
    const out = resolveNodeTick(snap, deps);
    expect(attack(out).meta).toMatchObject({ baseCp: 25, extraCp: 30 }); expect(cp(out)).toBe(45);
    expect(out.stance_fence).toHaveLength(3);
  });

  it.each([8, 100])('authoritative Force Shield ward state is not replaced by an INT%s catalogue pool', int => {
    const snap = input('wizard', 'fireball', 'ability'); snap.intents = []; snap.fighters[0].int = int;
    snap.fighters[0].ac = 1; snap.creatures[0].stats = { str: 100 };
    snap.character_stances = [stance(snap, 'force_shield', 10, { ward_remaining: 13 })];
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'absorb' && e.amount === 13));
    expect(found.out.stance_updates).toContainEqual(expect.objectContaining({ ability_key: 'force_shield', state: { ward_remaining: 0 } }));
    expect(found.out.stance_clear_character_ids).toEqual([]);
  });

  it('fixed reservation drop is possible at zero spendable CP and never refunds activation', () => {
    const snap = focused(input('wizard', 'arcane_focus', 'stance_drop')); snap.fighters[0].cp = 15;
    const out = resolveNodeTick(snap, deps);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'stance_dropped', meta: { refunded: false } }));
    expect(cp(out)).toBeUndefined();
    expect(out.events.some(e => e.kind === 'action_rejected')).toBe(false);
  });

  it('rejects fixed/percentage claim drift rather than inventing missing SQL metadata', () => {
    const snap = focused(input('wizard', 'fireball', 'ability'));
    delete snap.character_stances![0].reservation;
    expect(() => resolveNodeTick(snap, deps)).toThrow('stance_reservation_contract_mismatch');
    focused(snap); snap.character_stances![0].reservation!.amount = 99;
    expect(() => resolveNodeTick(snap, deps)).toThrow('stance_reservation_contract_mismatch');
    snap.character_stances![0].reserve_pct = .15; expect(decodeSnapshot(snap).ok).toBe(false);
  });

  it.each(['cp_reserve_fixed', 'extra_cp_max', 'cp_discount_min'])('invalid authored%s fails closed', field => {
    const rows = arcaneRecords(); const key = field === 'extra_cp_max' ? 'arcane_overload' : 'arcane_focus';
    rows.find(r => r.abilityKey === key)!.effectConfig![field] = -1;
    expect(buildAbilityCatalog(rows, authored.statuses).rejected).not.toEqual([]);
  });

  it('fixed and percentage authoring cannot coexist on one stance', () => {
    const rows = arcaneRecords(); rows.find(r => r.abilityKey === 'arcane_focus')!.cpReservePct = .15;
    expect(buildAbilityCatalog(rows, authored.statuses).rejected).toContainEqual(expect.objectContaining({ reason: 'invalid_calc' }));
  });

  it.each(['fireball', 'conflagrate'])('Surge amplifies direct%s with its existing INT magnitude', key => {
    const snap = input('wizard', key, 'ability'); snap.effects = effectFor(snap, 'arcane_surge');
    const found = findOutcome(snap, o => attack(o, key)?.hitQuality === 'strong' && !attack(o, key)?.meta?.isCrit);
    const bare = structuredClone(found.snap); bare.effects = [];
    const mult = 1.10 + .02 * Math.sqrt(5);
    const base = key === 'fireball' ? 21 : 20;
    expect(attack(found.out, key).amount).toBe(Math.floor(base * mult * 1.25));
    expect(attack(found.out, key).amount).toBeGreaterThan(attack(resolveNodeTick(bare, deps), key).amount!);
  });

  it('Surge amplifies basic attacks but not Scorched/Ignite ticks or Orbs', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.intents = []; snap.fighters[0].str = 100;
    snap.effects = effectFor(snap, 'arcane_surge');
    const burn: SnapshotEffect = { ...snap.effects[0], id: 'burn', kind: 'dot', effect_type: 'scorched', ability_key: 'fireball',
      target_character_id: null, target_creature_id: 'creature', magnitude: 20, stacks: 2, interval_ms: 2000,
      next_due_at: new Date(NOW).toISOString(), config: { node_creature_id: 'spawn', spawn_seq: 4,
        activated_at_tick: 0, expires_after_tick: 5, interval_ticks: 1, next_pulse_tick: 1 } };
    snap.effects.push(burn, { ...burn, id: 'ignite', effect_type: 'ignite', ability_key: 'ignite', magnitude: 10 });
    const source = effectFor(snap, 'ignite').find(e => e.kind === 'stack_source')!; source.magnitude = 1; snap.effects.push(source);
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'attack' && e.hitQuality === 'strong'));
    const withSurge = found.out;
    const bare = structuredClone(found.snap); bare.effects = bare.effects.filter(e => e.ability_key !== 'arcane_surge');
    const without = resolveNodeTick(bare, deps);
    expect(withSurge.events.filter(e => e.kind === 'effect_pulse' || e.kind === 'orb_attack'))
      .toEqual(without.events.filter(e => e.kind === 'effect_pulse' || e.kind === 'orb_attack'));
    expect(withSurge.events.find(e => e.kind === 'attack')!.amount)
      .toBeGreaterThan(without.events.find(e => e.kind === 'attack')!.amount!);
  });

  it.each([[10, 1.10], [20, 1.10 + .02 * Math.sqrt(5)], [100, 1.22]])('Surge at INT%s retains its original multiplier', (int, multiplier) => {
    const snap = input('wizard', 'fireball', 'ability'); snap.fighters[0].int = int;
    expect(effectFor(snap, 'arcane_surge')[0].magnitude).toBeCloseTo(multiplier, 12);
  });

  it('Surge does not amplify item damage procs', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.intents = []; snap.effects = effectFor(snap, 'arcane_surge');
    snap.fighters[0].equipment = [{ slot: 'ring', item_id: 'item', inventory_id: 'inventory', character_id: C1,
      durability: 10, max_durability: 10, applied_gems: {}, stat_override: null, crafted_level: null,
      item_present: true, item_type: 'equipment', weapon_tag: null, hands: null, item_level: 20,
      rarity: 'common', base_stats: {}, procs: [{ type: 'burst_damage', chance: 1, weight: 1,
        value: 100, damage_type: 'arcane', text: null, trigger: 'on_hit' }] }];
    const found = findOutcome(snap, o => o.events.some(e => e.kind === 'item_proc_damage'));
    expect(found.out.events.find(e => e.kind === 'item_proc_damage')!.amount).toBe(100);
    const bare = structuredClone(found.snap); bare.effects = [];
    expect(resolveNodeTick(bare, deps).events.find(e => e.kind === 'item_proc_damage')!.amount).toBe(100);
  });

  it('fixed ward projection survives a new entry in supplied authoritative state, and death proposes cleanup', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.intents = [];
    snap.character_stances = [stance(snap, 'force_shield', 10, { ward_remaining: 0 })];
    snap.fighters[0].entry_seq = 8; snap.fighters[0].max_cp = 900;
    const projection = resolveNodeTick(snap, deps);
    expect(projection.stance_fence).toHaveLength(1); expect(projection.stance_clear_character_ids).toEqual([]);
    expect(snap.character_stances[0].state).toEqual({ ward_remaining: 0 });
    snap.fighters[0].hp = 1; snap.fighters[0].ac = 1; snap.creatures[0].stats = { str: 100 };
    snap.tank_candidates[0].entry_seq = 8;
    const found = findOutcome(snap, o => o.stance_clear_character_ids.includes(C1));
    expect(found.out.stance_clear_character_ids).toEqual([C1]);
    expect(resolveNodeTick(found.snap, deps)).toEqual(found.out);
  });

  it('strict decoder refuses malformed Focus state and fixed reservation descriptors', () => {
    const snap = input('wizard', 'fireball', 'ability'); snap.effects = effectFor(snap, 'arcane_focus');
    snap.effects[0].config.cp_discount_min = NaN; expect(decodeSnapshot(snap).ok).toBe(false);
    focused(snap); snap.effects = []; snap.character_stances![0].reservation!.amount = -1;
    expect(decodeSnapshot(snap).ok).toBe(false);
  });

  it('advancing a committed proposal never replays a previous Overload intent', () => {
    const snap = focused(input('wizard', 'arcane_overload', 'ability')); snap.fighters[0].cp = 70;
    const out = resolveNodeTick(snap, deps); const next = advance(snap, out);
    expect(next.intents).toEqual([]); expect(attack(resolveNodeTick(next, deps))).toBeUndefined();
  });

  it('ignores client extra-burn suggestions and allows the next tick without a cooldown', () => {
    const snap = input('wizard', 'arcane_overload', 'ability'); snap.fighters[0].cp = 100;
    Object.assign(snap.intents[0], { extra_cp: 0, cooldown: 100 });
    const first = resolveNodeTick(snap, deps); expect(attack(first).meta!.extraCp).toBe(30);
    const next = advance(snap, first);
    next.intents = [{ ...snap.intents[0], id: 'new-request-next-tick' }];
    const second = resolveNodeTick(next, deps);
    expect(attack(second)).toBeDefined(); expect(attack(second).meta!.extraCp).toBeGreaterThan(0);
  });
});
