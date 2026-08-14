/**
 * Stance persistence invariants.
 *
 * A stance is reservation-backed persistent state, not a timed buff:
 *  - the resolver materialises its `active_effects` row when it is missing,
 *    charging no CP and consuming no client action;
 *  - the row carries `lifetime: 'stance'`;
 *  - later ticks never expire it, and an emptied absorb pool never deletes it;
 *  - effects-only (catch-up) resolution never materialises one.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import type { EffectSnapshot, StanceSnapshot } from '@/shared/combat/pure/types';
import { snapshot, participant, creature } from './fixtures';

const forceShield: StanceSnapshot = {
  stanceKey: 'force_shield',
  abilityKey: 'force_shield',
  mechanic: 'absorb_buff',
  damageType: null,
  amount: 40,
  durationMs: 0,
  intervalMs: 0,
  statusKey: null,
  statusChancePct: 0,
  maxStacks: 1,
  weaponBased: false,
};

function withStance(mode: 'live' | 'catchup' = 'live') {
  const p = participant({ id: 'c1', cp: 50 });
  return snapshot({
    mode,
    participants: [{ ...p, stances: [forceShield] }],
    creatures: [creature({ id: 'm1' })],
  });
}

describe('stance persistence', () => {
  it('materialises the missing stance row without charging CP or an action', () => {
    const snap = withStance();
    const tick = resolveTickPure(snap);
    const row = tick.effectUpserts.find((e) => e.abilityKey === 'force_shield');
    expect(row).toBeDefined();
    expect(row!.lifetime).toBe('stance');
    expect(row!.targetId).toBe('c1');
    expect(tick.consumedActionIds).toEqual([]);
    expect(tick.rejectedActions).toEqual([]);
    const me = tick.characters.find((c) => c.characterId === 'c1')!;
    expect(me.cpAfter).toBe(me.cpBefore);
  });

  it('does not materialise a stance in effects-only resolution', () => {
    const tick = resolveTickPure(withStance('catchup'));
    expect(tick.effectUpserts.filter((e) => e.lifetime === 'stance')).toEqual([]);
  });

  it('never expires a persisted stance row and keeps an emptied pool', () => {
    const persisted: EffectSnapshot = {
      id: 'e1',
      lifetime: 'stance',
      targetKind: 'character',
      targetId: 'c1',
      effectType: 'force_shield',
      stacks: 1,
      amountPerTick: 0,
      // Long past — a timed row would be deleted on sight.
      expiresAtMs: 1,
      intervalMs: 0,
      nextTickAtMs: 1,
      damageType: null,
      sourceCharacterId: 'c1',
      isPeriodic: false,
      ampPct: 0,
      mechanic: 'absorb_buff',
      abilityKey: 'force_shield',
      magnitude: 40,
      remaining: 0,
    };
    const snap = { ...withStance(), effects: [persisted] };
    const tick = resolveTickPure(snap);
    expect(tick.effectDeleteIds).not.toContain('e1');
  });

});
