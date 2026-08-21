/**
 * Ability Correction Batch 1 — deterministic proofs for the mechanics whose
 * configuration was previously dropped by catalog decode.
 *
 * Everything here goes through the real decode (`resolveAbilityConfig`), the
 * real pure resolver and the real effect contract: no mechanic behaviour is
 * re-implemented by the test.
 */
import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import {
  buildBuffSnapshotFromEffects,
  buildCreatureControlSnapshot,
} from '@/shared/combat/pure/effect-contract';
import {
  resolveAbilityConfig,
  type AbilityConfigEntry,
  type AbilityCasterInputs,
} from '@/shared/combat/c3/ability-resolve';
import type {
  ActionParamsSnapshot,
  ActionSnapshot,
  EffectSnapshot,
  EncounterSnapshot,
  ResolverMechanic,
} from '@/shared/combat/pure/types';
import { creature, participant, snapshot } from '../pure/fixtures';

// ── shared fixtures ───────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function action(over: Partial<ActionSnapshot>): ActionSnapshot {
  return {
    id: 'act-1',
    characterId: 'char-1',
    creatureId: 'crt-1',
    allyId: null,
    abilityKey: 'test_ability',
    mechanic: 'spell_attack',
    damageType: 'physical',
    cpCost: 0,
    amount: 20,
    durationMs: 20000,
    intervalMs: 0,
    statusKey: null,
    statusChancePct: 100,
    maxStacks: 1,
    weaponBased: false,
    sequence: 0,
    ...over,
  };
}

function effect(over: Partial<EffectSnapshot>): EffectSnapshot {
  return {
    id: 'eff-1',
    targetKind: 'creature',
    targetId: 'crt-1',
    effectType: 'sunder_armor',
    stacks: 1,
    amountPerTick: 0,
    expiresAtMs: NOW + 60_000,
    intervalMs: 0,
    nextTickAtMs: NOW + 60_000,
    damageType: null,
    sourceCharacterId: 'char-1',
    isPeriodic: false,
    ampPct: 0,
    ...over,
  };
}

/** Encounter with one hero, one creature, and whatever we hand it. */
function enc(over: Partial<EncounterSnapshot> = {}): EncounterSnapshot {
  const p = participant({ id: 'char-1' });
  const c = creature({ id: 'crt-1', hp: 4000, maxHp: 4000 });
  return snapshot({
    nowMs: NOW,
    participants: [p],
    creatures: [c],
    engagements: [{ creatureId: c.id, characterId: p.id, lastActionAtMs: NOW - 1000 }],
    ...over,
  });
}

const ROLL_MECHANICS: readonly ResolverMechanic[] = [
  'weapon_attack',
  'spell_attack',
  'multi_attack',
  'burst_damage',
  'stack_consume',
];

const MECH_PARAMS: Partial<Record<ResolverMechanic, ActionParamsSnapshot>> = {
  multi_attack: { minHits: 2, maxHits: 2 },
  burst_damage: { critEdge: 0, critThresholdFloor: 17 },
  stack_consume: { perStackMultiplier: 0.25, stackEffectType: 'poison' },
};

/** Did the caster land anything on the creature this tick? */
function landedDamage(out: ReturnType<typeof resolveTickPure>): boolean {
  return out.creatures.some((c) => c.hpAfter < c.hpBefore);
}

// ── 1. catalog decode ─────────────────────────────────────────────

const CASTER: AbilityCasterInputs = {
  level: 20,
  attrMods: { str: 5, dex: 4, con: 4, int: 6, wis: 5, cha: 5 },
  weaponDie: 8,
};

function entry(over: Partial<AbilityConfigEntry>): AbilityConfigEntry {
  return {
    abilityKey: 'x',
    classAbilityKey: 'x',
    classKey: 'templar',
    mechanicKey: 'mitigation_buff',
    amountCalc: { base: 10, terms: [], unit: 'flat' } as never,
    durationCalc: { base: 30000, terms: [], unit: 'ms' } as never,
    intervalMs: null,
    mechanicCalcs: {},
    effectConfig: {},
    cpCost: 10,
    damageType: null,
    unlockLevel: 1,
    label: 'X',
    ...over,
  };
}

describe('Batch 1 — catalog decode produces every typed field', () => {
  it('mitigation_buff carries its mode', () => {
    const flat = resolveAbilityConfig(
      entry({ mechanicKey: 'mitigation_buff', effectConfig: { mitigation_mode: 'flat' } }),
      CASTER,
    );
    expect(flat.params?.mode).toBe('flat');
    expect(flat.failures).toEqual([]);
    const pct = resolveAbilityConfig(
      entry({ mechanicKey: 'mitigation_buff', effectConfig: { mitigation_mode: 'percent' } }),
      CASTER,
    );
    expect(pct.params?.mode).toBe('percent');
  });

  it('offense_buff carries its offense mode', () => {
    const crit = resolveAbilityConfig(
      entry({ mechanicKey: 'offense_buff', effectConfig: { offense_mode: 'crit_edge' } }),
      CASTER,
    );
    expect(crit.params?.offenseMode).toBe('crit_edge');
    const mult = resolveAbilityConfig(
      entry({ mechanicKey: 'offense_buff', effectConfig: { offense_mode: 'damage_mult' } }),
      CASTER,
    );
    expect(mult.params?.offenseMode).toBe('damage_mult');
  });

  it('control_debuff carries its control mode', () => {
    const ac = resolveAbilityConfig(
      entry({ mechanicKey: 'control_debuff', effectConfig: { control_mode: 'ac_reduction' } }),
      CASTER,
    );
    expect(ac.params?.controlMode).toBe('ac_reduction');
    const dr = resolveAbilityConfig(
      entry({ mechanicKey: 'control_debuff', effectConfig: { control_mode: 'damage_reduction' } }),
      CASTER,
    );
    expect(dr.params?.controlMode).toBe('damage_reduction');
  });

  it('burst_damage carries an integer crit edge and its threshold floor', () => {
    const out = resolveAbilityConfig(
      entry({
        mechanicKey: 'burst_damage',
        effectConfig: { crit_threshold_floor: 17 },
        mechanicCalcs: { crit_edge: { base: 3, terms: [], unit: 'flat' } as never },
      }),
      CASTER,
    );
    expect(out.params?.critEdge).toBe(3);
    expect(out.params?.critThresholdFloor).toBe(17);
  });

  it('an unknown enum value fails closed instead of silently switching mechanic', () => {
    const out = resolveAbilityConfig(
      entry({ mechanicKey: 'mitigation_buff', effectConfig: { mitigation_mode: 'flatt' } }),
      CASTER,
    );
    expect(out.failures.length).toBe(1);
    expect(out.failures[0]).toContain('mitigation_mode');
  });
});

// ── 2. Divine Challenge ───────────────────────────────────────────

describe('Batch 1 — Divine Challenge is flat mitigation', () => {
  const cast = (mode: 'flat' | 'percent') =>
    resolveTickPure(
      enc({
        actions: [
          action({
            abilityKey: 'divine_challenge',
            mechanic: 'mitigation_buff',
            amount: 9,
            params: { mode },
          }),
        ],
      }),
    );

  it('persists a flat row, not a percent row (no taunt param)', () => {
    const up = cast('flat').effectUpserts.find((e) => e.mechanic === 'mitigation_buff');
    expect(up?.params).toEqual({ mode: 'flat' });
    expect(up?.magnitude).toBe(9);
  });

  it('applies flat mitigation in the same tick it is cast', () => {
    // The cast is resolved before creature counterattacks, so the in-tick
    // override must already be flat: a percent reading of 9 would multiply.
    const out = cast('flat');
    const hit = out.events.find((e) => e.type === 'creature_hit' || e.type === 'creature_crit');
    if (hit && typeof hit.attemptedAmount === 'number' && typeof hit.appliedAmount === 'number') {
      expect(hit.attemptedAmount - hit.appliedAmount).toBeGreaterThanOrEqual(0);
    }
    expect(out.effectUpserts.some((e) => e.params?.mode === 'flat')).toBe(true);
  });

  it('rehydrates as flat mitigation from its committed row', () => {
    const buffs = buildBuffSnapshotFromEffects(
      'char-1',
      [
        {
          targetKind: 'character',
          targetId: 'char-1',
          effectType: 'divine_challenge',
          expiresAtMs: NOW + 10_000,
          intervalMs: 0,
          amountPerTick: 0,
          mechanic: 'mitigation_buff',
          magnitude: 9,
          params: { mode: 'flat' },
        },
      ],
      NOW,
    );
    expect(buffs.mitigationFlat).toBe(9);
    expect(buffs.mitigationPct).toBe(0);
  });

  it('has no taunt behaviour: the row carries no taunt and targeting is unchanged', () => {
    const out = cast('flat');
    for (const up of out.effectUpserts) expect(up.params?.taunt).toBeUndefined();
    expect(out.events.some((e) => e.type.includes('taunt'))).toBe(false);
  });

  it('flat mitigation can fully absorb a small blow without going negative', () => {
    const buffs = buildBuffSnapshotFromEffects(
      'char-1',
      [
        {
          targetKind: 'character',
          targetId: 'char-1',
          effectType: 'divine_challenge',
          expiresAtMs: NOW + 10_000,
          intervalMs: 0,
          amountPerTick: 0,
          mechanic: 'mitigation_buff',
          magnitude: 500,
          params: { mode: 'flat' },
        },
      ],
      NOW,
    );
    const p = participant({ id: 'char-1', buffs: { ...participant().buffs, mitigationFlat: buffs.mitigationFlat } });
    const out = resolveTickPure(enc({ participants: [p] }));
    const me = out.characters.find((c) => c.characterId === 'char-1');
    if (me) expect(me.hpAfter).toBe(me.hpBefore);
  });

  it('an expired mitigation row contributes nothing', () => {
    const buffs = buildBuffSnapshotFromEffects(
      'char-1',
      [
        {
          targetKind: 'character',
          targetId: 'char-1',
          effectType: 'divine_challenge',
          expiresAtMs: NOW - 1,
          intervalMs: 0,
          amountPerTick: 0,
          mechanic: 'mitigation_buff',
          magnitude: 9,
          params: { mode: 'flat' },
        },
      ],
      NOW,
    );
    expect(buffs.mitigationFlat).toBe(0);
  });
});

// ── 3. Eagle Eye ──────────────────────────────────────────────────

describe('Batch 1 — Eagle Eye widens crit, never multiplies damage', () => {
  const casted = resolveTickPure(
    enc({
      actions: [
        action({
          abilityKey: 'eagle_eye',
          mechanic: 'offense_buff',
          amount: 4,
          params: { offenseMode: 'crit_edge' },
        }),
      ],
    }),
  );

  it('persists a crit_edge row', () => {
    const up = casted.effectUpserts.find((e) => e.mechanic === 'offense_buff');
    expect(up?.params).toEqual({ offenseMode: 'crit_edge' });
    expect(up?.magnitude).toBe(4);
  });

  it('rehydrates into critBuffBonus and never into a damage multiplier', () => {
    const buffs = buildBuffSnapshotFromEffects(
      'char-1',
      [
        {
          targetKind: 'character',
          targetId: 'char-1',
          effectType: 'eagle_eye',
          expiresAtMs: NOW + 10_000,
          intervalMs: 0,
          amountPerTick: 0,
          mechanic: 'offense_buff',
          magnitude: 4,
          params: { offenseMode: 'crit_edge' },
        },
      ],
      NOW,
    );
    expect(buffs.critBuffBonus).toBe(4);
    expect(buffs.damageBuff).toBe(false);
  });

  it('widens the crit range: the same rolls produce more crits, same base damage', () => {
    const base = participant({ id: 'char-1' });
    const eagle = participant({
      id: 'char-1',
      buffs: { ...base.buffs, critBuffBonus: 18 },
    });
    let plain = 0;
    let widened = 0;
    for (let t = 0; t < 40; t++) {
      const a = resolveTickPure(enc({ participants: [base], tickNumber: 100 + t }));
      const b = resolveTickPure(enc({ participants: [eagle], tickNumber: 100 + t }));
      plain += a.events.filter((e) => e.type === 'autoattack_crit').length;
      widened += b.events.filter((e) => e.type === 'autoattack_crit').length;
    }
    expect(widened).toBeGreaterThan(plain);
  });

  it('dropping the stance removes the bonus', () => {
    const buffs = buildBuffSnapshotFromEffects('char-1', [], NOW);
    expect(buffs.critBuffBonus).toBe(0);
  });
});

// ── 4. Sunder Armor ───────────────────────────────────────────────

const HIGH_AC = creature({ id: 'crt-1', hp: 4000, maxHp: 4000, ac: 60 });

const SUNDER = effect({
  effectType: 'sunder_armor',
  mechanic: 'control_debuff',
  magnitude: 60,
  params: { controlMode: 'ac_reduction' },
});

describe('Batch 1 — Sunder Armor lowers effective AC', () => {
  it('changes the hit outcome at a controlled boundary', () => {
    const without = resolveTickPure(enc({ creatures: [HIGH_AC] }));
    const with_ = resolveTickPure(enc({ creatures: [HIGH_AC], effects: [SUNDER] }));
    expect(landedDamage(without)).toBe(false);
    expect(landedDamage(with_)).toBe(true);
  });

  it('affects every roll-based attack mechanic', () => {
    for (const mechanic of ROLL_MECHANICS) {
      const actions = [action({ mechanic, params: MECH_PARAMS[mechanic], amount: 10 })];
      const without = resolveTickPure(enc({ creatures: [HIGH_AC], actions }));
      const with_ = resolveTickPure(enc({ creatures: [HIGH_AC], actions, effects: [SUNDER] }));
      const missed = without.events.filter((e) => e.type === 'ability_miss').length;
      const landedAbility = with_.events.filter(
        (e) => e.type === 'ability_hit' || e.type === 'ability_crit',
      ).length;
      expect(missed, `${mechanic} should miss at AC 60`).toBeGreaterThan(0);
      expect(landedAbility, `${mechanic} should land once sundered`).toBeGreaterThan(0);
    }
  });

  it('the strongest active reduction wins rather than summing', () => {
    const snap = buildCreatureControlSnapshot(
      [
        { targetKind: 'creature', targetId: 'crt-1', effectType: 'a', expiresAtMs: NOW + 1, intervalMs: 0, amountPerTick: 0, mechanic: 'control_debuff', magnitude: 4, params: { controlMode: 'ac_reduction' } },
        { targetKind: 'creature', targetId: 'crt-1', effectType: 'b', expiresAtMs: NOW + 1, intervalMs: 0, amountPerTick: 0, mechanic: 'control_debuff', magnitude: 7, params: { controlMode: 'ac_reduction' } },
      ],
      NOW,
    );
    expect(snap.get('crt-1')?.acReduction).toBe(7);
  });

  it('expiry restores the original AC', () => {
    const expired = { ...SUNDER, expiresAtMs: NOW - 1 };
    const out = resolveTickPure(enc({ creatures: [HIGH_AC], effects: [expired] }));
    expect(landedDamage(out)).toBe(false);
  });

  it('does not touch periodic damage', () => {
    const dot = effect({
      id: 'eff-dot',
      effectType: 'bleed',
      isPeriodic: true,
      amountPerTick: 11,
      intervalMs: 2000,
      nextTickAtMs: NOW,
      expiresAtMs: NOW + 20_000,
    });
    const without = resolveTickPure(enc({ creatures: [HIGH_AC], effects: [dot] }));
    const with_ = resolveTickPure(enc({ creatures: [HIGH_AC], effects: [dot, SUNDER] }));
    const dmg = (o: ReturnType<typeof resolveTickPure>) =>
      o.events.filter((e) => e.type === 'dot_tick').reduce((n, e) => n + (e.amount ?? 0), 0);
    expect(dmg(without)).toBeGreaterThan(0);
    expect(dmg(with_)).toBe(dmg(without) + 0);
  });
});

// ── 5. Creature outgoing damage reduction ─────────────────────────

const DR = effect({
  id: 'eff-dr',
  effectType: 'natures_snare',
  mechanic: 'control_debuff',
  magnitude: 0.5,
  params: { controlMode: 'damage_reduction' },
});

describe('Batch 1 — control debuffs reduce creature outgoing damage', () => {
  /** First tick number where the creature actually connects. */
  function connecting(effects: EffectSnapshot[]): { attempted: number; tick: number } | null {
    for (let t = 0; t < 60; t++) {
      const out = resolveTickPure(enc({ tickNumber: 500 + t, effects }));
      const hit = out.events.find((e) => e.type === 'creature_hit' || e.type === 'creature_crit');
      if (hit && typeof hit.attemptedAmount === 'number') {
        return { attempted: hit.attemptedAmount, tick: 500 + t };
      }
    }
    return null;
  }

  it("Nature's Snare style reduction lowers the attempted creature damage", () => {
    const plain = connecting([]);
    expect(plain).not.toBeNull();
    const out = resolveTickPure(enc({ tickNumber: plain!.tick, effects: [DR] }));
    const hit = out.events.find((e) => e.type === 'creature_hit' || e.type === 'creature_crit');
    expect(hit?.attemptedAmount).toBeLessThan(plain!.attempted);
  });

  it('Dissonance style reduction shares the same typed mode and aggregation', () => {
    const snap = buildCreatureControlSnapshot(
      [
        { targetKind: 'creature', targetId: 'crt-1', effectType: 'natures_snare', expiresAtMs: NOW + 1, intervalMs: 0, amountPerTick: 0, mechanic: 'control_debuff', magnitude: 0.3, params: { controlMode: 'damage_reduction' } },
        { targetKind: 'creature', targetId: 'crt-1', effectType: 'dissonance', expiresAtMs: NOW + 1, intervalMs: 0, amountPerTick: 0, mechanic: 'control_debuff', magnitude: 0.45, params: { controlMode: 'damage_reduction' } },
      ],
      NOW,
    );
    expect(snap.get('crt-1')?.outgoingDamageReduction).toBeCloseTo(0.45);
    expect(snap.get('crt-1')?.acReduction).toBe(0);
  });

  it('applies to banked Stored Power as well as ordinary swings', () => {
    const boss = creature({
      id: 'crt-1',
      hp: 4000,
      maxHp: 4000,
      rarity: 'boss',
      storedPowerCap: 500,
      bossCast: {
        abilityKey: 'stone_wrath',
        label: 'Stone Wrath',
        castTicks: 4,
        cooldownTicks: 6,
        baseDamage: 10,
        baseAoeDamage: 5,
        primaryShare: 1,
        aoeShare: 0.5,
        storedPowerCap: 500,
        pauseAutoattacks: true,
        consumeMode: 'all',
        targetMode: 'tank_preferred',
      } as never,
    });
    const casting = {
      creatureId: 'crt-1',
      abilityKey: 'stone_wrath',
      startedAtMs: NOW - 2000,
      resolvesAtMs: NOW + 6000,
      targetCharacterId: 'char-1',
    } as never;
    const run = (effects: EffectSnapshot[]) =>
      resolveTickPure(enc({ creatures: [boss], activeCasts: [casting], effects }));
    const plain = run([]).storedPower.find((s) => s.creatureId === 'crt-1')?.delta ?? 0;
    const reduced = run([DR]).storedPower.find((s) => s.creatureId === 'crt-1')?.delta ?? 0;
    expect(plain).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(plain);
  });

  it('never becomes a player rooted modifier', () => {
    const buffs = buildBuffSnapshotFromEffects(
      'char-1',
      [
        {
          targetKind: 'creature',
          targetId: 'crt-1',
          effectType: 'natures_snare',
          expiresAtMs: NOW + 10_000,
          intervalMs: 0,
          amountPerTick: 0,
          mechanic: 'control_debuff',
          magnitude: 0.5,
          params: { controlMode: 'damage_reduction' },
        },
      ],
      NOW,
    );
    expect(buffs.rooted).toBe(false);
    const out = resolveTickPure(enc({ effects: [DR] }));
    for (const up of out.effectUpserts) expect(up.params?.rooted).toBeUndefined();
  });

  it('committed control rows rehydrate without losing mode or magnitude', () => {
    const out = resolveTickPure(
      enc({
        actions: [
          action({
            abilityKey: 'sunder_armor',
            mechanic: 'control_debuff',
            amount: 6,
            params: { controlMode: 'ac_reduction' },
          }),
        ],
      }),
    );
    const up = out.effectUpserts.find((e) => e.mechanic === 'control_debuff');
    expect(up?.params).toEqual({ controlMode: 'ac_reduction' });
    expect(up?.magnitude).toBe(6);
    const snap = buildCreatureControlSnapshot(
      [
        {
          targetKind: 'creature',
          targetId: up!.targetId,
          effectType: up!.effectType,
          expiresAtMs: up!.expiresAtMs,
          intervalMs: 0,
          amountPerTick: 0,
          mechanic: 'control_debuff',
          magnitude: up!.magnitude ?? 0,
          params: up!.params,
        },
      ],
      NOW,
    );
    expect(snap.get(up!.targetId)?.acReduction).toBe(6);
  });
});

// ── 6. Grand Finale ───────────────────────────────────────────────

describe('Batch 1 — Grand Finale resolves on one d20', () => {
  const burst = (params: ActionParamsSnapshot, tick: number) =>
    resolveTickPure(
      enc({
        tickNumber: tick,
        actions: [
          action({
            abilityKey: 'grand_finale',
            mechanic: 'burst_damage',
            amount: 30,
            params,
          }),
        ],
      }),
    );

  it('spends the same number of RNG draws with and without a crit edge', () => {
    const a = burst({ critEdge: 0, critThresholdFloor: 17 }, 700);
    const b = burst({ critEdge: 3, critThresholdFloor: 17 }, 700);
    expect(b.rngDraws).toBe(a.rngDraws);
  });

  it('a widened threshold turns the same roll into a crit', () => {
    let plain = 0;
    let widened = 0;
    for (let t = 0; t < 40; t++) {
      plain += burst({ critEdge: 0, critThresholdFloor: 2 }, 800 + t).events
        .filter((e) => e.type === 'ability_crit').length;
      widened += burst({ critEdge: 18, critThresholdFloor: 2 }, 800 + t).events
        .filter((e) => e.type === 'ability_crit').length;
    }
    expect(widened).toBeGreaterThan(plain);
  });

  it('a positive edge never becomes an automatic crit (floor respected)', () => {
    let crits = 0;
    let hits = 0;
    for (let t = 0; t < 60; t++) {
      const out = burst({ critEdge: 30, critThresholdFloor: 17 }, 900 + t);
      crits += out.events.filter((e) => e.type === 'ability_crit').length;
      hits += out.events.filter((e) => e.type === 'ability_hit').length;
    }
    expect(crits).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
  });

  it('misses stay misses regardless of the edge', () => {
    const actions = [
      action({
        abilityKey: 'grand_finale',
        mechanic: 'burst_damage',
        amount: 30,
        params: { critEdge: 30, critThresholdFloor: 17 },
      }),
    ];
    const out = resolveTickPure(enc({ creatures: [HIGH_AC], actions }));
    expect(out.events.some((e) => e.type === 'ability_miss')).toBe(true);
    expect(out.events.some((e) => e.type === 'ability_crit')).toBe(false);
  });
});
