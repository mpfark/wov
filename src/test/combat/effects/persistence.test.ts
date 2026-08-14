/**
 * Per-ability multi-tick persistence goldens.
 *
 * Every ability whose mechanic creates, feeds on, or consumes a persistent
 * effect is walked through the full production chain, once per tick:
 *
 *   cast tick -> committed active_effects row -> next snapshot -> semantic
 *   effect reconstructed -> a LATER tick's numbers change because of it ->
 *   remaining/charges/stacks updated -> expiry or consumption committed once.
 *
 * Two rules keep these tests honest:
 *   1. The "later tick changed" assertion always compares against a bare run of
 *      the identical snapshot with the effects removed. Same tick number, same
 *      RNG, so any difference can only come from the persisted effect.
 *   2. The coverage test below fails if an ability with a persistent mechanic
 *      has no case here, so a new ability cannot land unproven.
 */

import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { resolveTickPure } from '@/shared/combat/pure';
import { EFFECT_MECHANIC_REGISTRY } from '@/shared/combat/pure/effect-contract';
import type { EncounterSnapshot, ProposedTick } from '@/shared/combat/pure/types';
import { abilityEncounter, abilityId, type AbilityRow } from '../c3a/ability-fixtures';
import {
  assertOnlyMutableFieldsChanged,
  commitEffects,
  decodeRows,
  nextSnapshot,
  rowFor,
  rowsFromSnapshot,
  type CommitResult,
  type EffectRow,
} from './roundtrip';

const ABILITIES = inventory.abilities as unknown as AbilityRow[];

/** Mechanics that own persistent state, or read state a previous tick wrote. */
const PERSISTENT_MECHANICS = new Set<string>([
  ...Object.keys(EFFECT_MECHANIC_REGISTRY),
  'stack_consume',
]);

const PERSISTENT_ABILITIES = ABILITIES.filter((a) => PERSISTENT_MECHANICS.has(a.mechanic));

const byId = (id: string): AbilityRow => {
  const row = PERSISTENT_ABILITIES.find((a) => abilityId(a) === id);
  if (!row) throw new Error(`no persistent ability fixture for ${id}`);
  return row;
};

interface StatusDef {
  key: string;
  isPeriodic: boolean;
  ampPct: number;
  maxStacks: number;
}

interface Chain {
  /** Cast tick and its commit. */
  cast: { out: ProposedTick; commit: CommitResult };
  /** The snapshot the next tick sees, with buffs rebuilt from effects only. */
  next: EncounterSnapshot;
  /** Second tick, resolved with the persisted effects. */
  live: ProposedTick;
  /** Second tick, resolved with the effects stripped — the control run. */
  bare: ProposedTick;
  /** Commit of the second tick. */
  liveCommit: CommitResult;
  /** Rows after the cast tick, and after the second tick. */
  rowsAfterCast: EffectRow[];
  rowsAfterLive: EffectRow[];
  snap: EncounterSnapshot;
}

/** Cast the ability, commit, rehydrate, resolve again with and without state. */
function chain(id: string, opts: { statusDefs?: StatusDef[] } = {}): Chain {
  const row = byId(id);
  const base = abilityEncounter(row);
  const snap: EncounterSnapshot = opts.statusDefs
    ? ({
        ...base,
        config: { ...base.config, statusDefs: [...base.config.statusDefs, ...opts.statusDefs] },
      } as EncounterSnapshot)
    : base;
  const creatureIds = new Set(snap.creatures.map((c) => c.id));

  const seeded = rowsFromSnapshot(snap);
  const out = resolveTickPure(snap);
  const commit = commitEffects(seeded, out, { nodeId: snap.nodeId, creatureIds, nowMs: snap.nowMs });
  const effects = decodeRows(commit.rows, { creatureIds, statusDefs: snap.config.statusDefs });

  const next = nextSnapshot(snap, effects);
  const live = resolveTickPure(next);
  const bare = resolveTickPure(nextSnapshot(snap, []));
  const liveCommit = commitEffects(commit.rows, live, {
    nodeId: snap.nodeId,
    creatureIds,
    nowMs: next.nowMs,
  });

  return {
    cast: { out, commit },
    next,
    live,
    bare,
    liveCommit,
    rowsAfterCast: commit.rows,
    rowsAfterLive: liveCommit.rows,
    snap,
  };
}

/**
 * A single-charge row that already exists when the tick starts — the state a
 * charge granted by an earlier tick leaves behind. Proves the rehydrate ->
 * consume -> remove-once path without a same-tick cast.
 */
function seededCharge(
  mechanic: 'stealth_buff' | 'evasion_buff',
  row: { effectType: string; magnitude: number; params: Record<string, number | boolean | string> },
) {
  // A no-op cast (Heal on self) keeps the fixture shape without adding state.
  const base = abilityEncounter(byId('warrior:rend'));
  const snap = { ...base, actions: [] } as EncounterSnapshot;
  const creatureIds = new Set(snap.creatures.map((c) => c.id));
  const rowId = 'eff-charge';
  const rows: EffectRow[] = [
    {
      id: rowId,
      node_id: snap.nodeId,
      target_id: 'char-caster',
      source_id: 'char-caster',
      effect_type: row.effectType,
      stacks: 1,
      damage_per_tick: 0,
      next_tick_at: snap.nowMs + 60_000,
      expires_at: snap.nowMs + 60_000,
      tick_rate_ms: 0,
      source_ability_key: row.effectType,
      damage_type: null,
      mechanic,
      magnitude: row.magnitude,
      remaining: 1,
      params: row.params,
      params_version: 1,
      created_at_ms: snap.nowMs - 1,
    },
  ];
  const effects = decodeRows(rows, { creatureIds, statusDefs: snap.config.statusDefs });
  const next = nextSnapshot(snap, effects);
  const live = resolveTickPure(next);
  const bare = resolveTickPure(nextSnapshot(snap, []));
  const committed = commitEffects(rows, live, {
    nodeId: snap.nodeId,
    creatureIds,
    nowMs: next.nowMs,
  });
  const third = resolveTickPure(
    nextSnapshot(next, decodeRows(committed.rows, { creatureIds, statusDefs: snap.config.statusDefs })),
  );
  return { rowId, live, bare, third, rowsAfterLive: committed.rows };
}

const hpOf = (t: ProposedTick, id: string) => t.characters.find((c) => c.characterId === id)!.hpAfter;
const cpOf = (t: ProposedTick, id: string) => t.characters.find((c) => c.characterId === id)!.cpAfter;
const creatureHp = (t: ProposedTick, id = 'crt-1') =>
  t.creatures.find((c) => c.creatureId === id)!.hpAfter;
const types = (t: ProposedTick) => t.events.map((e) => e.type);

/** The row survived the round trip with only its declared mutable fields moved. */
function assertSurvived(c: Chain, mechanic: string): { before: EffectRow; after: EffectRow } {
  const before = rowFor(c.rowsAfterCast, mechanic);
  const after = c.rowsAfterLive.find((r) => r.id === before.id);
  expect(after, `${mechanic} row must still exist after the second tick`).toBeDefined();
  assertOnlyMutableFieldsChanged(before, after!);
  return { before, after: after! };
}

/**
 * Roll the chain forward until the row's window closes, and prove the removal
 * is committed exactly once (a later tick must not delete it again).
 */
function assertExpiresExactlyOnce(c: Chain, rowId: string): void {
  const creatureIds = new Set(c.snap.creatures.map((cr) => cr.id));
  const row = c.rowsAfterLive.find((r) => r.id === rowId) ?? c.rowsAfterCast.find((r) => r.id === rowId);
  expect(row, `row ${rowId} must exist before the expiry check`).toBeDefined();
  const expiresAtMs = row!.expires_at;
  const past = nextSnapshot(c.snap, decodeRows(c.rowsAfterLive, { creatureIds, statusDefs: c.snap.config.statusDefs }), {
    advanceMs: expiresAtMs - c.snap.nowMs + c.snap.tickRateMs,
  });
  const out = resolveTickPure(past);
  expect(out.effectDeleteIds.filter((id) => id === rowId)).toHaveLength(1);
  const after = commitEffects(c.rowsAfterLive, out, {
    nodeId: c.snap.nodeId,
    creatureIds,
    nowMs: past.nowMs,
  });
  expect(after.rows.some((r) => r.id === rowId)).toBe(false);

  // A tick after the removal may not delete or resurrect it.
  const again = resolveTickPure(
    nextSnapshot(past, decodeRows(after.rows, { creatureIds, statusDefs: c.snap.config.statusDefs })),
  );
  expect(again.effectDeleteIds).not.toContain(rowId);
  expect(again.effectUpserts.some((u) => u.effectType === row!.effect_type && u.mechanic === row!.mechanic)).toBe(
    false,
  );
}

describe('effect persistence — absorb_buff (pool in `remaining`)', () => {
  it('wizard:force_shield absorbs a later tick and banks the unspent pool', () => {
    const c = chain('wizard:force_shield');
    const cast = rowFor(c.rowsAfterCast, 'absorb_buff');
    expect(cast.magnitude).toBe(20);
    expect(cast.remaining).toBe(20);

    // Rebuilt from the row alone.
    expect(c.next.participants.find((p) => p.id === 'char-caster')!.buffs.absorbShield).toBe(20);

    // Later tick changed: the creature's hit lands on the shield, not on HP.
    expect(hpOf(c.bare, 'char-caster')).toBeLessThan(hpOf(c.live, 'char-caster'));
    expect(hpOf(c.live, 'char-caster')).toBe(70);

    const { after } = assertSurvived(c, 'absorb_buff');
    expect(after.remaining).toBeLessThan(20);
    expect(after.remaining).toBe(20 - (70 - hpOf(c.bare, 'char-caster')));
  });

  it('wizard:force_shield is removed exactly once when the pool empties', () => {
    const c = chain('wizard:force_shield');
    const creatureIds = new Set(c.snap.creatures.map((cr) => cr.id));
    let rows = c.rowsAfterCast;
    const rowId = rowFor(rows, 'absorb_buff').id;
    let snap = c.snap;
    let deletions = 0;
    // Drain the pool over successive ticks; the row must vanish once, no more.
    for (let i = 0; i < 12; i++) {
      snap = nextSnapshot(snap, decodeRows(rows, { creatureIds, statusDefs: c.snap.config.statusDefs }));
      const out = resolveTickPure(snap);
      deletions += out.effectDeleteIds.filter((id) => id === rowId).length;
      rows = commitEffects(rows, out, { nodeId: snap.nodeId, creatureIds, nowMs: snap.nowMs }).rows;
    }
    expect(deletions).toBe(1);
    expect(rows.some((r) => r.id === rowId)).toBe(false);
  });

  it('healer:divine_aegis persists on the ally and keeps an untouched pool intact', () => {
    const c = chain('healer:divine_aegis');
    const cast = rowFor(c.rowsAfterCast, 'absorb_buff');
    expect(cast.target_id).toBe('char-ally');
    expect(cast.source_id).toBe('char-caster');
    expect(c.next.participants.find((p) => p.id === 'char-ally')!.buffs.absorbShield).toBe(20);
    const { after } = assertSurvived(c, 'absorb_buff');
    // The ally was not hit this tick: the pool is preserved, not silently reset.
    expect(after.remaining).toBe(20);
  });
});

describe('effect persistence — mitigation_buff', () => {
  for (const id of ['templar:divine_challenge', 'warrior:battle_cry']) {
    it(`${id} reduces incoming damage on the following tick`, () => {
      const c = chain(id);
      const cast = rowFor(c.rowsAfterCast, 'mitigation_buff');
      expect(cast.params.mode).toBe('percent');
      expect(c.next.participants.find((p) => p.id === 'char-caster')!.buffs.mitigationPct).toBe(
        cast.magnitude,
      );
      expect(hpOf(c.live, 'char-caster')).toBeGreaterThan(hpOf(c.bare, 'char-caster'));
      assertSurvived(c, 'mitigation_buff');
      assertExpiresExactlyOnce(c, cast.id);
    });
  }
});

describe('effect persistence — offense_buff', () => {
  for (const id of ['ranger:eagle_eye', 'wizard:arcane_surge']) {
    it(`${id} raises the caster's damage on the following tick`, () => {
      const c = chain(id);
      const cast = rowFor(c.rowsAfterCast, 'offense_buff');
      expect(cast.params.offenseMode).toBe('damage_mult');
      expect(c.next.participants.find((p) => p.id === 'char-caster')!.buffs.damageBuff).toBe(true);
      expect(creatureHp(c.live)).toBeLessThan(creatureHp(c.bare));
      assertSurvived(c, 'offense_buff');
      assertExpiresExactlyOnce(c, cast.id);
    });
  }
});

describe('effect persistence — block_buff', () => {
  it('templar:shield_wall blocks on a later tick with the configured flat bonus', () => {
    const c = chain('templar:shield_wall');
    const cast = rowFor(c.rowsAfterCast, 'block_buff');
    expect(cast.magnitude).toBe(0.2);
    expect(cast.params.blockAmount).toBe(6);
    expect(cast.params.blockChanceCap).toBe(0.75);
    const buffs = c.next.participants.find((p) => p.id === 'char-caster')!.buffs;
    expect(buffs.blockBuff).toBe(true);
    expect(buffs.blockAmountBonus).toBe(6);
    expect(types(c.live)).toContain('block');
    expect(types(c.bare)).not.toContain('block');
    expect(hpOf(c.live, 'char-caster')).toBeGreaterThan(hpOf(c.bare, 'char-caster'));
    assertSurvived(c, 'block_buff');
  });
});

describe('effect persistence — evasion_buff', () => {
  it('assassin:cloak_of_shadows dodges an incoming hit on the following tick', () => {
    const c = chain('assassin:cloak_of_shadows');
    const cast = rowFor(c.rowsAfterCast, 'evasion_buff');
    expect(cast.params.kind).toBe('dodge');
    expect(c.next.participants.find((p) => p.id === 'char-caster')!.buffs.dodgeChance).toBe(0.25);
    expect(types(c.live)).toContain('dodge');
    expect(hpOf(c.live, 'char-caster')).toBeGreaterThan(hpOf(c.bare, 'char-caster'));
    assertSurvived(c, 'evasion_buff');
  });

  it('ranger:disengage persists the dodge window; a charge spent in the cast tick is not written', () => {
    const c = chain('ranger:disengage');
    const rows = c.rowsAfterCast.filter((r) => r.mechanic === 'evasion_buff');
    // The caster's own autoattack in the cast tick spends the one-shot charge,
    // so only the dodge window survives — a spent charge is never persisted.
    expect(c.cast.out.consumedBuffs.map((b) => b.buff)).toContain('disengage');
    expect(rows.map((r) => r.params.kind)).toEqual(['dodge']);
    const dodge = rows[0];
    expect(dodge.magnitude).toBe(0.3);
    expect(hpOf(c.live, 'char-caster')).toBeGreaterThan(hpOf(c.bare, 'char-caster'));
    assertOnlyMutableFieldsChanged(dodge, c.rowsAfterLive.find((r) => r.id === dodge.id)!);
  });

  it("a persisted Disengage charge boosts exactly one later hit and is then removed once", () => {
    const seeded = seededCharge('evasion_buff', {
      effectType: 'disengage_next_hit',
      magnitude: 1.5,
      params: { kind: 'next_hit', evasionSource: 'disengage' },
    });
    expect(creatureHp(seeded.live)).toBeLessThan(creatureHp(seeded.bare));
    expect(seeded.live.effectDeleteIds).toEqual([seeded.rowId]);
    expect(seeded.rowsAfterLive.some((r) => r.id === seeded.rowId)).toBe(false);
    expect(seeded.third.effectDeleteIds).not.toContain(seeded.rowId);
  });
});

describe('effect persistence — stealth_buff', () => {
  it('assassin:shadowstep spends its ambush inside the cast tick and writes no charge', () => {
    const c = chain('assassin:shadowstep');
    expect(c.cast.out.consumedBuffs.map((b) => b.buff)).toContain('stealth');
    expect(types(c.cast.out)).toContain('buff_consumed');
    // Nothing to rehydrate: the charge is gone, so the next tick is ordinary.
    expect(c.rowsAfterCast.some((r) => r.mechanic === 'stealth_buff')).toBe(false);
    expect(types(c.live)).not.toContain('buff_consumed');
  });

  it('a persisted ambush charge multiplies exactly one later hit and is then removed once', () => {
    const seeded = seededCharge('stealth_buff', {
      effectType: 'shadowstep',
      magnitude: 2.5,
      params: {},
    });
    expect(creatureHp(seeded.live)).toBeLessThan(creatureHp(seeded.bare));
    expect(types(seeded.live)).toContain('buff_consumed');
    expect(seeded.live.effectDeleteIds).toEqual([seeded.rowId]);
    expect(seeded.rowsAfterLive.some((r) => r.id === seeded.rowId)).toBe(false);
    // The charge cannot come back: a third tick has no ambush and no delete.
    expect(types(seeded.third)).not.toContain('buff_consumed');
    expect(seeded.third.effectDeleteIds).not.toContain(seeded.rowId);
  });
});

describe('effect persistence — reactive_holy', () => {
  it('templar:holy_shield retaliates on a later tick from its persisted row', () => {
    const c = chain('templar:holy_shield');
    const cast = rowFor(c.rowsAfterCast, 'reactive_holy');
    expect(cast.magnitude).toBe(7);
    expect(cast.params.damageType).toBe('holy');
    expect(c.next.participants.find((p) => p.id === 'char-caster')!.buffs.reactiveHolyDamage).toBe(7);
    expect(types(c.live)).toContain('holy_shield_return');
    expect(creatureHp(c.live)).toBeLessThan(creatureHp(c.bare));
    assertSurvived(c, 'reactive_holy');
    assertExpiresExactlyOnce(c, cast.id);
  });
});

describe('effect persistence — periodic friendly states', () => {
  const cases: { id: string; mechanic: string; hp: boolean; cp: boolean; enemy: boolean }[] = [
    { id: 'bard:inspire', mechanic: 'regen_buff', hp: true, cp: true, enemy: false },
    { id: 'bard:crescendo', mechanic: 'party_regen', hp: true, cp: false, enemy: false },
    { id: 'healer:purifying_light', mechanic: 'party_regen', hp: true, cp: false, enemy: false },
    { id: 'templar:consecrate', mechanic: 'aura_pulse', hp: true, cp: false, enemy: true },
  ];
  for (const t of cases) {
    it(`${t.id} pulses again on the following tick and advances its own cadence`, () => {
      const c = chain(t.id);
      const cast = rowFor(c.rowsAfterCast, t.mechanic);
      expect(cast.tick_rate_ms).toBeGreaterThan(0);
      expect(cast.next_tick_at).toBe(c.snap.nowMs + cast.tick_rate_ms);

      if (t.hp) expect(hpOf(c.live, 'char-caster')).toBeGreaterThan(hpOf(c.bare, 'char-caster'));
      if (t.cp) expect(cpOf(c.live, 'char-caster')).toBeGreaterThan(cpOf(c.bare, 'char-caster'));
      if (t.enemy) expect(creatureHp(c.live)).toBeLessThan(creatureHp(c.bare));

      const { after } = assertSurvived(c, t.mechanic);
      // Cadence advanced by exactly one interval — never re-based on `now`.
      expect(after.next_tick_at).toBe(cast.next_tick_at + cast.tick_rate_ms);
      assertExpiresExactlyOnce(c, cast.id);
    });
  }
});

describe('effect persistence — dot_debuff', () => {
  it('warrior:rend keeps bleeding on later ticks and advances one interval per tick', () => {
    const c = chain('warrior:rend');
    const cast = rowFor(c.rowsAfterCast, 'dot_debuff');
    expect(cast.target_id).toBe('crt-1');
    expect(cast.effect_type).toBe('bleed');
    expect(cast.damage_per_tick).toBeGreaterThan(0);
    expect(types(c.live)).toContain('dot_tick');
    expect(creatureHp(c.live)).toBeLessThan(creatureHp(c.bare));
    const { after } = assertSurvived(c, 'dot_debuff');
    expect(after.next_tick_at).toBe(cast.next_tick_at + cast.tick_rate_ms);
  });
});

describe('effect persistence — control_debuff', () => {
  for (const id of ['bard:dissonance', 'ranger:natures_snare', 'warrior:sunder_armor']) {
    it(`${id} persists on the creature and amplifies later damage per its status`, () => {
      const row = byId(id);
      // Amplification is a property of the status classification; the persisted
      // row supplies the window it applies in.
      const c = chain(id, {
        statusDefs: [{ key: row.abilityKey, isPeriodic: false, ampPct: 50, maxStacks: 1 }],
      });
      const cast = rowFor(c.rowsAfterCast, 'control_debuff');
      expect(cast.target_id).toBe('crt-1');
      expect(cast.tick_rate_ms).toBeGreaterThan(0);
      expect(creatureHp(c.live)).toBeLessThan(creatureHp(c.bare));
      assertSurvived(c, 'control_debuff');
      assertExpiresExactlyOnce(c, cast.id);
    });
  }
});

describe('effect persistence — stack_apply appliers and the stacks they land', () => {
  it('assassin:envenom survives as a stance and lands a hostile periodic stack later', () => {
    const c = chain('assassin:envenom');
    const cast = rowFor(c.rowsAfterCast, 'stack_apply');
    expect(cast.target_id).toBe('char-caster');
    expect(cast.params.trigger).toBe('weapon_hit');
    expect(cast.params.stackEffectType).toBe('poison');

    const appliers = c.next.participants.find((p) => p.id === 'char-caster')!.buffs.stackAppliers;
    expect(appliers).toHaveLength(1);
    expect(appliers![0]).toMatchObject({ effectType: 'poison', trigger: 'weapon_hit', maxStacks: 5 });

    // Later tick changed: the landed stack is a creature-side periodic row, not
    // another copy of the applier stance.
    const landed = c.live.effectUpserts.find((u) => u.effectType === 'poison')!;
    expect(landed.mechanic).toBe('dot_debuff');
    expect(landed.targetKind).toBe('creature');
    expect(landed.stacks).toBe(1);
    expect(landed.expiresAtMs).toBeGreaterThan(c.next.nowMs);
    expect(types(c.live)).toContain('stack_applied');
    expect(types(c.bare)).not.toContain('stack_applied');

    // Both rows now coexist and both round-trip.
    const poison = c.rowsAfterLive.find((r) => r.effect_type === 'poison')!;
    expect(poison.mechanic).toBe('dot_debuff');
    expect(poison.params.maxStacks).toBe(5);
    assertSurvived(c, 'stack_apply');
  });

  it('wizard:orbs_of_fire rebuilds its pulse-triggered applier from the effect row', () => {
    const c = chain('wizard:orbs_of_fire');
    const cast = rowFor(c.rowsAfterCast, 'stack_apply');
    expect(cast.params.trigger).toBe('successful_pulse_hit');
    expect(cast.params.stackEffectType).toBe('ignite');
    const appliers = c.next.participants.find((p) => p.id === 'char-caster')!.buffs.stackAppliers;
    expect(appliers).toEqual([
      {
        abilityKey: cast.source_ability_key,
        effectType: 'ignite',
        trigger: 'successful_pulse_hit',
        chance: cast.magnitude,
        dotPerTick: cast.params.dotPerTick,
        durationMs: cast.params.durationMs,
        intervalMs: cast.params.intervalMs,
        maxStacks: cast.params.maxStacks,
        damageType: 'fire',
        pulseDamage: cast.params.pulseDamage,
      },
    ]);
    assertSurvived(c, 'stack_apply');
    assertExpiresExactlyOnce(c, cast.id);
  });
});

describe('effect persistence — stack_consume finishers', () => {
  for (const id of ['assassin:eviscerate', 'wizard:conflagrate']) {
    it(`${id} consumes the persisted stacks exactly once`, () => {
      const row = byId(id);
      const c = chain(id);
      const stackType = row.classKey === 'wizard' ? 'ignite' : 'poison';
      // The seeded stack row is gone after the finisher commits.
      expect(c.cast.commit.deleted).toContain('eff-stack');
      expect(c.rowsAfterCast.some((r) => r.effect_type === stackType)).toBe(false);
      // A second tick has nothing left to consume, so it cannot double-dip.
      expect(c.live.events.some((e) => e.type === 'dot_tick')).toBe(false);
      expect(c.live.effectDeleteIds).not.toContain('eff-stack');
    });
  }
});

describe('effect persistence — coverage', () => {
  it('every ability with a persistent mechanic has a golden above', () => {
    const covered = new Set<string>([
      'wizard:force_shield',
      'healer:divine_aegis',
      'templar:divine_challenge',
      'warrior:battle_cry',
      'ranger:eagle_eye',
      'wizard:arcane_surge',
      'templar:shield_wall',
      'assassin:cloak_of_shadows',
      'ranger:disengage',
      'assassin:shadowstep',
      'templar:holy_shield',
      'bard:inspire',
      'bard:crescendo',
      'healer:purifying_light',
      'templar:consecrate',
      'warrior:rend',
      'bard:dissonance',
      'ranger:natures_snare',
      'warrior:sunder_armor',
      'assassin:envenom',
      'wizard:orbs_of_fire',
      'assassin:eviscerate',
      'wizard:conflagrate',
    ]);
    const missing = PERSISTENT_ABILITIES.map(abilityId).filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  it('every registered effect mechanic is produced by at least one golden', () => {
    const produced = new Set<string>();
    for (const a of PERSISTENT_ABILITIES) {
      if (a.mechanic === 'stack_consume') continue;
      const c = chain(abilityId(a));
      for (const r of c.rowsAfterCast) if (r.mechanic) produced.add(r.mechanic);
      for (const u of c.live.effectUpserts) if (u.mechanic) produced.add(u.mechanic);
    }
    const unproven = Object.keys(EFFECT_MECHANIC_REGISTRY).filter((m) => !produced.has(m));
    expect(unproven).toEqual([]);
  });
});
