/**
 * Live (`combat-tick`) vs replay (`combat-catchup`) parity for the shared
 * status runtime.
 *
 * The two runtimes may only differ in where the chance sample comes from:
 * `Math.random()` live, `statusSample(...)` on replay. Everything else —
 * chance decision, magnitude, stacking, refresh, timing and attribution — is
 * one implementation, so these tests supply the SAME sample to both and require
 * byte-identical rows. They also pin the replay sample's stability and prove a
 * replayed application cannot be processed twice into extra stacks.
 */
import { describe, it, expect } from 'vitest';
import { createStatusRuntime, type StatusEffectRow } from '../status-runtime';
import { readStatusApplication, statusSample } from '../status-application';

const TICK = 2000;

const bleedCfg = {
  status_enabled: true,
  status_key: 'bleed',
  effect_type: 'bleed',
  status_label: 'Bleed',
  status_classification: 'dot',
  status_trigger: 'ability_hit',
  status_chance_pct: 100,
  dot_stat: 'str',
  dot_stat_mult: 1,
  dot_global_mult: 1,
  dot_duration_ms: 6000,
  dot_tick_rate_ms: TICK,
};

const chilledCfg = {
  status_enabled: true,
  status_key: 'chilled',
  effect_type: 'chilled',
  status_label: 'Chilled',
  status_classification: 'damage_amp',
  status_trigger: 'ability_hit',
  status_chance_pct: 100,
  status_duration_ticks: 3,
};

const character = { str: 18, dex: 12, con: 10, int: 10, wis: 10, cha: 10 };

function runtime(effects: StatusEffectRow[]) {
  return createStatusRuntime({
    nodeId: 'node-1',
    tickRateMs: TICK,
    effects,
    statModifier: (score: number) => Math.floor((score - 10) / 2),
    newId: () => 'fixed-id',
  });
}

function apply(cfg: Record<string, unknown>, sample: number, at = 10_000, maxStacks = 3) {
  const effects: StatusEffectRow[] = [];
  const spec = readStatusApplication(cfg)!;
  const res = runtime(effects).applyStatusFromSource({
    sourceId: 'char-1', character, eb: {}, spec,
    abilityKey: 'rend', targetId: 'creature-1', at, sample, maxStacks,
  });
  return { effects, res };
}

describe('status runtime live/replay parity', () => {
  it('produces identical periodic rows for the same sample', () => {
    const sample = 0.42;
    const live = apply(bleedCfg, sample);
    const replay = apply(bleedCfg, sample);
    expect(replay.res).toEqual(live.res);
    expect(replay.effects).toEqual(live.effects);
  });

  it('produces identical non-periodic (amp) rows for the same sample', () => {
    const live = apply(chilledCfg, 0.1);
    const replay = apply(chilledCfg, 0.1);
    expect(replay.effects).toEqual(live.effects);
    // 3 combat ticks from the application time.
    expect(replay.effects[0].expires_at).toBe(10_000 + 3 * TICK);
    expect(replay.effects[0].next_tick_at).toBeNull();
  });

  it('rejects on the same sample in both paths when chance fails', () => {
    const cfg = { ...bleedCfg, status_chance_pct: 25 };
    expect(apply(cfg, 0.9).res).toBeNull();
    expect(apply(cfg, 0.9).effects).toHaveLength(0);
    expect(apply(cfg, 0.1).res).not.toBeNull();
  });
});

describe('replay sampling', () => {
  it('is stable for a historical event identity', () => {
    const id = ['rend', 'char-1', 'creature-1', 10_000];
    expect(statusSample(id)).toBe(statusSample([...id]));
  });

  it('differs across distinct historical events', () => {
    const a = statusSample(['rend', 'char-1', 'creature-1', 10_000]);
    const b = statusSample(['rend', 'char-1', 'creature-1', 12_000]);
    expect(a).not.toBe(b);
  });

  it('stays within the unit interval', () => {
    for (let t = 0; t < 50; t++) {
      const s = statusSample(['rend', 'char-1', 'creature-1', t * 137]);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });
});

describe('replayed application is not processed twice', () => {
  it('re-applying the same historical event does not add a stack', () => {
    const effects: StatusEffectRow[] = [];
    const spec = readStatusApplication(bleedCfg)!;
    const at = 10_000;
    const sample = statusSample(['rend', 'char-1', 'creature-1', at]);
    const input = {
      sourceId: 'char-1', character, eb: {}, spec,
      abilityKey: 'rend', targetId: 'creature-1', at, sample, maxStacks: 1,
    };
    const rt = runtime(effects);
    const first = rt.applyStatusFromSource(input);
    const second = rt.applyStatusFromSource(input);
    expect(effects).toHaveLength(1);
    expect(second!.stacks).toBe(first!.stacks);
    expect(effects[0].expires_at).toBe(at + 6000);
  });
});
