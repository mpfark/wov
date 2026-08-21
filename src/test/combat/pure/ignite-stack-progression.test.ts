/**
 * Effect writeback regression — do stacking periodic effects actually climb,
 * and does cadence writeback leave semantic fields alone?
 *
 * The observed log showed `[2/5]` repeating tick after tick. This drives the
 * real resolver across consecutive ticks and feeds each tick's committed
 * `effectUpserts` back into the next snapshot exactly as
 * `commit_encounter_tick_v*` persists them (ON CONFLICT (source_id, target_id,
 * effect_type) DO UPDATE SET the proposed values), so a stall here is a
 * resolver defect, not a SQL one.
 *
 * EVIDENCE CLASS: executable resolver/reference test. The `commit` helper is a
 * faithful reference mirror of the deployed conflict identity and update list —
 * it is NOT proof that the deployed SQL executes correctly. Live database
 * evidence is reported separately.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import type {
  EffectSnapshot,
  EffectUpsert,
  ProposedTick,
  StackApplierSnapshot,
} from '@/shared/combat/pure/types';
import { snapshot, participant, creature } from './fixtures';

const orbs: StackApplierSnapshot = {
  abilityKey: 'ignite',
  effectType: 'ignite',
  trigger: 'successful_pulse_hit',
  chance: 1,
  dotPerTick: 9,
  durationMs: 33000,
  intervalMs: 2000,
  maxStacks: 5,
  damageType: 'fire',
  pulseDamage: 7,
};

const envenom: StackApplierSnapshot = {
  abilityKey: 'envenom',
  effectType: 'poison',
  trigger: 'weapon_hit',
  chance: 1,
  dotPerTick: 6,
  durationMs: 25000,
  intervalMs: 2000,
  maxStacks: 4,
  damageType: 'poison',
  pulseDamage: 0,
};

const identity = (row: { sourceCharacterId?: string | null; targetId: string; effectType: string }) =>
  `${row.sourceCharacterId ?? 'null'}|${row.targetId}|${row.effectType}`;

/**
 * Persist one tick's upserts the way the deployed committer does: conflict
 * identity (source_id, target_id, effect_type), every proposed column written.
 */
function commit(effects: EffectSnapshot[], tick: ProposedTick): EffectSnapshot[] {
  const out = effects.filter((e) => !tick.effectDeleteIds.includes(e.id));
  for (const up of tick.effectUpserts) {
    const idx = out.findIndex((e) => identity(e) === identity(up));
    const row = {
      id: idx >= 0 ? out[idx].id : `eff-${out.length + 1}`,
      isPeriodic: true,
      ampPct: 0,
      lifetime: up.lifetime ?? 'timed',
      ...up,
    } as unknown as EffectSnapshot;
    if (idx >= 0) out[idx] = row;
    else out.push(row);
  }
  return out;
}

const rowOf = (effects: EffectSnapshot[], effectType: string, targetId: string) =>
  effects.find((e) => e.effectType === effectType && e.targetId === targetId) ?? null;

const upsertOf = (tick: ProposedTick, effectType: string, targetId?: string) =>
  tick.effectUpserts.find(
    (e) => e.effectType === effectType && (targetId === undefined || e.targetId === targetId),
  );

function baseSnapshot(opts: {
  creatureIds?: string[];
  appliers?: StackApplierSnapshot[];
  participants?: { id: string; creatureId: string; appliers?: StackApplierSnapshot[] }[];
} = {}) {
  const pairs =
    opts.participants ??
    (opts.creatureIds ?? ['m1']).map((creatureId) => ({
      id: 'c1',
      creatureId,
      appliers: opts.appliers ?? [orbs],
    }));
  const uniqueChars = [...new Map(pairs.map((p) => [p.id, p])).values()];
  const creatureIds = [...new Set(pairs.map((p) => p.creatureId))];
  return snapshot({
    participants: uniqueChars.map((pair) => {
      const p = participant({ id: pair.id, name: `Hero-${pair.id}` });
      return {
        ...p,
        buffs: { ...p.buffs, stackAppliers: pair.appliers ?? opts.appliers ?? [orbs] },
      };
    }),
    creatures: creatureIds.map((id) => creature({ id, hp: 4000, maxHp: 4000, ac: 1 })),
    engagements: pairs.map((pair) => ({
      creatureId: pair.creatureId,
      characterId: pair.id,
      lastActionAtMs: 1_699_999_000_000,
    })),
  });
}

/** Run `ticks` consecutive committed ticks, returning proposals + final rows. */
function runTicks(
  ticks: number,
  base = baseSnapshot(),
  seed: EffectSnapshot[] = [],
): { base: ReturnType<typeof baseSnapshot>; effects: EffectSnapshot[]; proposals: ProposedTick[] } {
  let effects = seed;
  const proposals: ProposedTick[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const tick = resolveTickPure({
      ...base,
      nowMs: base.nowMs + i * 2000,
      tickNumber: base.tickNumber + i,
      effects,
    });
    proposals.push(tick);
    effects = commit(effects, tick);
  }
  return { base, effects, proposals };
}

describe('stacking periodic effects across consecutive committed ticks', () => {
  it('creates stack 1 on first application', () => {
    const { proposals, effects } = runTicks(1);
    expect(upsertOf(proposals[0], 'ignite')?.stacks).toBe(1);
    expect(rowOf(effects, 'ignite', 'm1')?.stacks).toBe(1);
  });

  it('produces stack 2 on the next committed application', () => {
    const { proposals, effects } = runTicks(2);
    expect(upsertOf(proposals[1], 'ignite')?.stacks).toBe(2);
    expect(rowOf(effects, 'ignite', 'm1')?.stacks).toBe(2);
  });

  it('produces stack 3 on the following committed application', () => {
    const { proposals, effects } = runTicks(3);
    expect(upsertOf(proposals[2], 'ignite')?.stacks).toBe(3);
    expect(rowOf(effects, 'ignite', 'm1')?.stacks).toBe(3);
  });

  it('climbs one stack per pulse and stops at the configured cap', () => {
    const { proposals } = runTicks(7);
    expect(proposals.map((t) => upsertOf(t, 'ignite')?.stacks ?? 0)).toEqual([
      1, 2, 3, 4, 5, 5, 5,
    ]);
  });

  it('refreshes duration on every application and the refresh survives commit', () => {
    const { base, proposals, effects } = runTicks(3);
    expect(proposals.map((t) => upsertOf(t, 'ignite')?.expiresAtMs ?? 0)).toEqual([
      base.nowMs + orbs.durationMs,
      base.nowMs + 2000 + orbs.durationMs,
      base.nowMs + 4000 + orbs.durationMs,
    ]);
    expect(rowOf(effects, 'ignite', 'm1')?.expiresAtMs).toBe(base.nowMs + 4000 + orbs.durationMs);
  });

  it('feeds the newly committed stack into the next resolver snapshot', () => {
    const base = baseSnapshot();
    let effects: EffectSnapshot[] = [];
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push(rowOf(effects, 'ignite', 'm1')?.stacks ?? 0);
      effects = commit(
        effects,
        resolveTickPure({
          ...base,
          nowMs: base.nowMs + i * 2000,
          tickNumber: base.tickNumber + i,
          effects,
        }),
      );
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('keeps separate source/target identities independent', () => {
    const base = baseSnapshot({
      participants: [
        { id: 'c1', creatureId: 'm1' },
        { id: 'c2', creatureId: 'm2' },
      ],
    });
    const { effects, proposals } = runTicks(3, base);
    expect(rowOf(effects, 'ignite', 'm1')?.stacks).toBe(3);
    expect(rowOf(effects, 'ignite', 'm2')?.stacks).toBe(3);
    const rows = proposals[2].effectUpserts.filter((e) => e.effectType === 'ignite');
    expect(rows.map((r) => r.targetId).sort()).toEqual(['m1', 'm2']);
    expect(new Set(rows.map(identity)).size).toBe(2);
  });

  it('is idempotent when the same committed tick is replayed', () => {
    const { proposals, effects } = runTicks(2);
    const replayed = commit(effects, proposals[1]);
    expect(rowOf(replayed, 'ignite', 'm1')?.stacks).toBe(rowOf(effects, 'ignite', 'm1')?.stacks);
    expect(replayed.filter((e) => e.effectType === 'ignite')).toHaveLength(1);
  });

  it('is mechanic-generic: Envenom stacks climb the same way', () => {
    const base = baseSnapshot({ appliers: [envenom] });
    const { proposals, effects } = runTicks(6, base);
    const landed = proposals
      .map((t) => upsertOf(t, 'poison')?.stacks)
      .filter((s): s is number => s !== undefined);
    expect(landed.length).toBeGreaterThan(1);
    // Never regresses, climbs above one, and the committed row equals the last
    // proposal (no stale cadence row overwriting it).
    expect(landed).toEqual([...landed].sort((a, b) => a - b));
    expect(Math.max(...landed)).toBeGreaterThan(1);
    expect(rowOf(effects, 'poison', 'm1')?.stacks).toBe(landed[landed.length - 1]);
  });
});

describe('cadence-only writeback', () => {
  /** An existing periodic bleed with no applier able to reapply it. */
  const bleedRow = (nowMs: number): EffectSnapshot =>
    ({
      id: 'eff-bleed',
      lifetime: 'timed',
      targetKind: 'creature',
      targetId: 'm1',
      effectType: 'bleed',
      stacks: 3,
      amountPerTick: 7,
      expiresAtMs: nowMs + 20000,
      intervalMs: 2000,
      nextTickAtMs: nowMs,
      damageType: 'physical',
      sourceCharacterId: 'c1',
      isPeriodic: true,
      ampPct: 0,
      mechanic: 'dot_debuff',
      abilityKey: 'rend',
      magnitude: 7,
      remaining: null,
      params: { maxStacks: 5, damageType: 'physical' },
      paramsVersion: 1,
      maxStacks: 5,
    }) as unknown as EffectSnapshot;

  const noApplierBase = () => {
    const b = baseSnapshot();
    return {
      ...b,
      participants: b.participants.map((p) => ({
        ...p,
        buffs: { ...p.buffs, stackAppliers: [] },
      })),
    };
  };

  it('advances cadence and preserves every semantic field when nothing reapplies', () => {
    const base = noApplierBase();
    const seed = bleedRow(base.nowMs);
    const { proposals, effects } = runTicks(1, base, [seed]);
    const up = upsertOf(proposals[0], 'bleed') as EffectUpsert;
    expect(up.nextTickAtMs).toBe(seed.nextTickAtMs + seed.intervalMs!);
    expect(up.stacks).toBe(seed.stacks);
    expect(up.expiresAtMs).toBe(seed.expiresAtMs);
    expect(up.amountPerTick).toBe(seed.amountPerTick);
    expect(up.intervalMs).toBe(seed.intervalMs);
    expect(up.damageType).toBe(seed.damageType);
    expect(up.sourceCharacterId).toBe(seed.sourceCharacterId);
    expect(up.abilityKey).toBe(seed.abilityKey);
    expect(up.mechanic).toBe(seed.mechanic);
    expect(up.magnitude).toBe(seed.magnitude);
    expect(up.params).toEqual(seed.params);
    expect(up.paramsVersion).toBe(seed.paramsVersion);
    expect(up.lifetime).toBe(seed.lifetime);
    expect(up.targetKind).toBe(seed.targetKind);
    const row = rowOf(effects, 'bleed', 'm1')!;
    expect(row.stacks).toBe(3);
    expect(row.expiresAtMs).toBe(seed.expiresAtMs);
  });

  it('emits exactly one proposal per identity when an application and a cadence advance collide', () => {
    // Existing ignite row that is due to tick AND gets reapplied this tick.
    const base = baseSnapshot();
    const existing = {
      ...bleedRow(base.nowMs),
      id: 'eff-ignite',
      effectType: 'ignite',
      abilityKey: 'ignite',
      stacks: 2,
      damageType: 'fire',
    } as unknown as EffectSnapshot;
    const { proposals, effects } = runTicks(1, base, [existing]);
    const rows = proposals[0].effectUpserts.filter((e) => e.effectType === 'ignite');
    expect(rows).toHaveLength(1);
    // Refreshed values win; cadence still advances.
    expect(rows[0].stacks).toBe(3);
    expect(rows[0].expiresAtMs).toBe(base.nowMs + orbs.durationMs);
    expect(rows[0].nextTickAtMs).toBe(base.nowMs + orbs.intervalMs);
    expect(rowOf(effects, 'ignite', 'm1')?.stacks).toBe(3);
  });

  it('never recreates an effect scheduled for deletion', () => {
    const base = noApplierBase();
    const expired = {
      ...bleedRow(base.nowMs),
      expiresAtMs: base.nowMs - 1,
    } as unknown as EffectSnapshot;
    const { proposals, effects } = runTicks(1, base, [expired]);
    expect(proposals[0].effectDeleteIds).toContain('eff-bleed');
    expect(proposals[0].effectUpserts.filter((e) => e.effectType === 'bleed')).toHaveLength(0);
    expect(rowOf(effects, 'bleed', 'm1')).toBeNull();
  });
});
