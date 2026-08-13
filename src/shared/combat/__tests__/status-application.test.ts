/**
 * Status Application — the consolidated model that replaced the competing
 * "Applied Status" and "Optional On-Hit Effect" paths.
 *
 * These tests pin the contracts the runtime depends on: ownership of the
 * chance decision, the difference between a disabled application and a 0%
 * chance, magnitude/duration ownership by the reusable status, and the
 * live/replay parity rules (identical results for the same sample, and a
 * stable seeded sample per historical event).
 */
import { describe, it, expect } from 'vitest';
import {
  readStatusApplication,
  statusChanceSucceeds,
  statusDamagePerTick,
  statusDurationMs,
  statusSample,
  normalizeStatusTrigger,
} from '../status-application';

/** Composed `effect_config` for a scaled DoT (shared Ignite shape). */
const igniteCfg = {
  status_enabled: true,
  status_key: 'ignite',
  status_label: 'Ignited',
  status_classification: 'dot',
  status_trigger: 'successful_pulse_hit',
  status_chance_pct: null,
  effect_type: 'ignite',
  dot_stat: 'wis',
  dot_stat_mult: 1,
  dot_global_mult: 1,
  dot_duration_ms: 30000,
  dot_duration_stat: 'wis',
  dot_duration_per_point_ms: 1000,
  dot_duration_cap_ms: 45000,
};

/** Composed `effect_config` for the flat burn preserved for Fireball. */
const scorchedCfg = {
  status_enabled: true,
  status_key: 'scorched',
  status_label: 'Scorched',
  status_classification: 'dot',
  status_trigger: 'ability_hit',
  status_chance_pct: 25,
  effect_type: 'scorched',
  dot_flat_damage: 3,
  dot_duration_ms: 6000,
};

/** Composed `effect_config` for a non-periodic amplifier (Chilled). */
const chilledCfg = {
  status_enabled: true,
  status_key: 'chilled',
  status_label: 'Chilled',
  status_classification: 'damage_amp',
  status_trigger: 'ability_hit',
  status_chance_pct: 100,
  amp_effect_type: 'chilled',
  amp_label: 'Chilled',
  amp_kind: 'damage_taken_pct',
  amp_pct: 10,
  amp_duration_ticks: 3,
  amp_eligible_sources: ['weapon', 'ability', 'stance', 'dot'],
};

describe('Status Application — reading the spec', () => {
  it('reads a periodic status application', () => {
    const spec = readStatusApplication(igniteCfg)!;
    expect(spec.statusKey).toBe('ignite');
    expect(spec.isPeriodic).toBe(true);
    expect(spec.trigger).toBe('successful_pulse_hit');
    // Empty chance means "use the ability's own stat-scaled chance".
    expect(spec.chancePct).toBeNull();
  });

  it('reads a non-periodic amplifier and its tick-count duration', () => {
    const spec = readStatusApplication(chilledCfg)!;
    expect(spec.isPeriodic).toBe(false);
    expect(spec.durationTicks).toBe(3);
    expect(spec.ampPct).toBe(10);
  });

  it('distinguishes a disabled application from a 0% chance', () => {
    // Disabled: the application DOES NOT EXIST.
    expect(readStatusApplication({ ...scorchedCfg, status_enabled: false })).toBeNull();
    // Wired but never succeeds.
    const spec = readStatusApplication({ ...scorchedCfg, status_chance_pct: 0 })!;
    expect(spec.chancePct).toBe(0);
    expect(statusChanceSucceeds(spec, 0)).toBe(false);
  });

  it('rejects a half-wired application (no status, or no trigger)', () => {
    expect(readStatusApplication({ ...scorchedCfg, status_key: null })).toBeNull();
    expect(readStatusApplication({ ...scorchedCfg, status_trigger: null, trigger: null })).toBeNull();
  });

  it('canonicalises legacy stance trigger words', () => {
    expect(normalizeStatusTrigger('on_hit')).toBe('weapon_hit');
    expect(normalizeStatusTrigger('pulse')).toBe('successful_pulse_hit');
    expect(normalizeStatusTrigger('nonsense')).toBeNull();
  });
});

describe('Status Application — chance ownership', () => {
  it('uses the configured chance when present', () => {
    const spec = readStatusApplication(scorchedCfg)!;
    expect(statusChanceSucceeds(spec, 0.24)).toBe(true);
    expect(statusChanceSucceeds(spec, 0.25)).toBe(false);
  });

  it('falls back to the ability-scaled chance only when chance is empty', () => {
    const spec = readStatusApplication(igniteCfg)!;
    expect(statusChanceSucceeds(spec, 0.3, 0.4)).toBe(true);
    expect(statusChanceSucceeds(spec, 0.5, 0.4)).toBe(false);
    // No scaled chance supplied → nothing can land.
    expect(statusChanceSucceeds(spec, 0, null)).toBe(false);
  });
});

describe('Status Application — magnitude and duration come from the status', () => {
  it('a flat status ignores attributes entirely', () => {
    const spec = readStatusApplication(scorchedCfg)!;
    expect(statusDamagePerTick(spec, { effectiveStatMod: 0 })).toBe(3);
    expect(statusDamagePerTick(spec, { effectiveStatMod: 99 })).toBe(3);
    expect(statusDurationMs(spec, 0)).toBe(6000);
  });

  it('a scaled status uses the bound attribute and respects its cap', () => {
    const spec = readStatusApplication(igniteCfg)!;
    expect(statusDamagePerTick(spec, { effectiveStatMod: 5 })).toBe(5);
    expect(statusDurationMs(spec, 5)).toBe(35000);
    // per_point extension is capped by the status definition.
    expect(statusDurationMs(spec, 50)).toBe(45000);
  });

  it('bond multipliers still apply on top of the status magnitude', () => {
    const spec = readStatusApplication(igniteCfg)!;
    expect(statusDamagePerTick(spec, { effectiveStatMod: 5, bondMult: 1.5 })).toBe(7);
  });
});

describe('Status Application — live/replay parity', () => {
  const spec = readStatusApplication(scorchedCfg)!;

  it('both paths agree whenever they are handed the same sample', () => {
    // Live combat supplies Math.random(); catch-up supplies statusSample().
    // Parity is defined on the SAMPLE, not on the generators.
    for (const sample of [0, 0.1, 0.2499, 0.25, 0.6, 0.999]) {
      const live = statusChanceSucceeds(spec, sample);
      const replay = statusChanceSucceeds(spec, sample);
      expect(replay).toBe(live);
    }
  });

  it('a historical event samples the same value every time it is examined', () => {
    const identity = ['fireball', 'char-1', 'creature-9', 1730000000000];
    const first = statusSample(identity);
    expect(statusSample(identity)).toBe(first);
    expect(statusSample([...identity.slice(0, 3), 1730000002000])).not.toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('re-deriving the same tick cannot flip the outcome', () => {
    const identity = ['ignite', 'char-2', 'creature-3', 1730000004000];
    const outcomes = [0, 1, 2].map(() => statusChanceSucceeds(spec, statusSample(identity)));
    expect(new Set(outcomes).size).toBe(1);
  });
});
