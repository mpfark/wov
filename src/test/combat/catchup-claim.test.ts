/**
 * Phase 7 — catch-up runs on the shared encounter claim in `effects_only` mode.
 *
 * These cases pin the decision table `combat-catchup` uses when interpreting
 * `claim_encounter_tick`: it may only resolve effects while it actually holds a
 * claim, must never mutate state after a refusal that captured no lease, and
 * must still reconcile (unclaimed, idempotent) for encounters that are not on
 * the shared cursor.
 */
import { describe, it, expect } from 'vitest';
import {
  interpretEffectsOnlyClaim,
  EFFECTS_ONLY_MODES,
  type ClaimResult,
} from '@/shared/combat/tick-claim';

const granted: ClaimResult = {
  claimed: true,
  tick: 42,
  mode: 'effects_only',
  claim_token: 'token-1',
  attempt: 1,
  reclaimed: false,
};

describe('catch-up effects_only claim', () => {
  it('declares only effects_only capability', () => {
    expect([...EFFECTS_ONLY_MODES]).toEqual(['effects_only']);
  });

  it('resolves while holding the claim', () => {
    const d = interpretEffectsOnlyClaim(granted);
    expect(d).toMatchObject({ action: 'resolve' });
    if (d.action === 'resolve') {
      expect(d.claim.tick).toBe(42);
      expect(d.claim.claim_token).toBe('token-1');
      expect(d.claim.mode).toBe('effects_only');
    }
  });

  it('resolves a reclaimed effects_only tick after lease expiry', () => {
    const d = interpretEffectsOnlyClaim({ ...granted, reclaimed: true, attempt: 2 });
    expect(d.action).toBe('resolve');
  });

  it('skips without mutating when live combat owns the encounter', () => {
    expect(interpretEffectsOnlyClaim({ claimed: false, reason: 'mode_refused', mode: 'live' }))
      .toEqual({ action: 'skip', reason: 'mode_refused' });
  });

  it('skips while another resolver holds the lease', () => {
    expect(interpretEffectsOnlyClaim({ claimed: false, reason: 'in_flight', mode: 'effects_only' }))
      .toEqual({ action: 'skip', reason: 'in_flight' });
  });

  it('skips when the tick is not due', () => {
    expect(interpretEffectsOnlyClaim({ claimed: false, reason: 'not_due', mode: 'effects_only' }))
      .toEqual({ action: 'skip', reason: 'not_due' });
  });

  it('falls back to unclaimed reconciliation for legacy-owned encounters', () => {
    expect(interpretEffectsOnlyClaim({ claimed: false, reason: 'legacy_owner', tick_owner: 'legacy' }))
      .toEqual({ action: 'legacy', reason: 'legacy_owner' });
  });

  it('falls back when the node has no encounter row', () => {
    expect(interpretEffectsOnlyClaim({ claimed: false, reason: 'no_encounter' }))
      .toEqual({ action: 'legacy', reason: 'no_encounter' });
  });

  it('falls back when the claim RPC failed', () => {
    expect(interpretEffectsOnlyClaim(null)).toEqual({ action: 'legacy', reason: 'claim_error' });
    expect(interpretEffectsOnlyClaim(undefined)).toEqual({ action: 'legacy', reason: 'claim_error' });
  });
});
