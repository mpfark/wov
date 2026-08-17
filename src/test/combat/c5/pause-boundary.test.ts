/**
 * Policy C — expire without damage across a genuine simulation pause.
 *
 * When background simulation was actually suspended (world asleep, worker
 * unscheduled) and later resumed, pulses that came due inside that window must
 * NOT pay out a backlog of damage or healing. They are skipped and the cadence
 * is fast-forwarded past the resume point. Expiry stays authoritative: an effect
 * whose lifetime ended inside the pause is still proposed for removal by the
 * resolver (and committed by C2) — the resolver never mutates the database.
 *
 * Without a pause boundary the very same snapshot must still pay out the
 * backlog, so an ordinary late tick can never be mistaken for a pause.
 */
import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import type { EffectSnapshot, EncounterSnapshot } from '@/shared/combat/pure/types';
import { snapshot, participant, creature } from '../pure/fixtures';

const NOW = 1_700_000_000_000;
const SUSPENDED = NOW - 600_000; // simulation stopped 10 minutes ago
const RESUMED = NOW - 1_000; // and came back one second ago

function dot(over: Partial<EffectSnapshot> = {}): EffectSnapshot {
  return {
    id: 'eff-dot',
    lifetime: 'timed',
    targetKind: 'creature',
    targetId: 'crt-1',
    effectType: 'bleed',
    stacks: 1,
    amountPerTick: 7,
    expiresAtMs: NOW + 60_000,
    intervalMs: 2_000,
    nextTickAtMs: SUSPENDED + 30_000, // came due mid-pause
    damageType: 'physical',
    sourceCharacterId: 'char-1',
    isPeriodic: true,
    ampPct: 0,
    ...over,
  } as EffectSnapshot;
}

function sweep(effects: EffectSnapshot[], pause: EncounterSnapshot['pauseBoundary']) {
  const p = participant();
  const c = creature({ hp: 90, maxHp: 90 });
  return resolveTickPure(
    snapshot({
      mode: 'catchup',
      ticksToSimulate: 3,
      nowMs: NOW,
      participants: [p],
      creatures: [c],
      effects,
      pauseBoundary: pause,
    }),
  );
}

describe('policy C simulation pause boundary', () => {
  it('pays out the pulse when there was no pause (ordinary late tick)', () => {
    const tick = sweep([dot()], null);
    expect(tick.events.filter((e) => e.type === 'dot_tick').length).toBeGreaterThan(0);
  });

  it('skips pulses that came due inside the pause window', () => {
    const tick = sweep([dot()], { suspendedAtMs: SUSPENDED, resumedAtMs: RESUMED });
    expect(tick.events.filter((e) => e.type === 'dot_tick')).toHaveLength(0);
    expect(tick.effectDeleteIds).not.toContain('eff-dot');
  });

  it('never pays out a backlog: creature HP is untouched across the pause', () => {
    const tick = sweep([dot({ amountPerTick: 25 })], {
      suspendedAtMs: SUSPENDED,
      resumedAtMs: RESUMED,
    });
    const hp = tick.creatures.find((u) => u.id === 'crt-1')?.hp;
    expect(hp === undefined || hp === 90).toBe(true);
    expect(tick.events.some((e) => e.type === 'death')).toBe(false);
  });

  it('still expires an effect whose lifetime ended inside the pause', () => {
    const expired = dot({ id: 'eff-gone', expiresAtMs: SUSPENDED + 60_000 });
    const tick = sweep([expired], { suspendedAtMs: SUSPENDED, resumedAtMs: RESUMED });
    expect(tick.effectDeleteIds).toContain('eff-gone');
    expect(tick.events.filter((e) => e.type === 'dot_tick')).toHaveLength(0);
  });

  it('resumes normal cadence for pulses due after the resume point', () => {
    const tick = sweep([dot({ nextTickAtMs: NOW })], {
      suspendedAtMs: SUSPENDED,
      resumedAtMs: RESUMED,
    });
    expect(tick.events.filter((e) => e.type === 'dot_tick').length).toBeGreaterThan(0);
  });
});
