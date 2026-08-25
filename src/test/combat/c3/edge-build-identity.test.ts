/**
 * Server build identity contract.
 *
 * A stale deployment has twice produced a misleading production diagnosis:
 * stored configuration was correct while the running function decoded it with
 * retired code, and no captured response could distinguish the two. Every
 * response envelope from both combat functions must therefore carry the same
 * build identity — successes AND refusals.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EDGE_COMBAT_BUILD_ID,
  stampCombatBuild,
} from '../../../../supabase/functions/_shared/combat/build-identity';

const TICK = 'supabase/functions/combat-tick/index.ts';
const CATCHUP = 'supabase/functions/combat-catchup/index.ts';

/** The envelope kinds a client can observe, one per response path. */
const ENVELOPES: Array<[string, Record<string, unknown>]> = [
  ['success', { ok: true, encounterId: 'e', tick: 4, batchId: 'b', ticksProcessed: 1 }],
  ['not_due', { ok: false, kind: 'claim_refused', reason: 'not_due', detail: { nextDueAtMs: 1 } }],
  ['in_flight', { ok: false, kind: 'claim_refused', reason: 'in_flight' }],
  ['maintenance', { ok: false, kind: 'maintenance', reason: 'closed' }],
  ['terminal', { ok: false, kind: 'no_encounter', reason: 'encounter_ended' }],
  ['unauthorized', { ok: false, kind: 'unauthorized', reason: 'invalid or missing token' }],
  ['invalid_request', { ok: false, kind: 'invalid_request', reason: 'body is not valid JSON' }],
];

describe('edge combat build identity', () => {
  it('is a non-empty label', () => {
    expect(EDGE_COMBAT_BUILD_ID.length).toBeGreaterThan(0);
  });

  for (const [name, body] of ENVELOPES) {
    it(`${name} responses expose the identity`, () => {
      const stamped = stampCombatBuild(body);
      expect(stamped.serverBuild).toBe(EDGE_COMBAT_BUILD_ID);
      // Stamping never rewrites the envelope itself.
      for (const [k, v] of Object.entries(body)) expect(stamped[k as keyof typeof stamped]).toEqual(v);
    });
  }

  it('every envelope kind reports the SAME identity', () => {
    const ids = new Set(ENVELOPES.map(([, b]) => stampCombatBuild(b).serverBuild));
    expect(ids.size).toBe(1);
  });

  it('does not overwrite an identity a caller already set', () => {
    expect(stampCombatBuild({ ok: true, serverBuild: 'pinned' }).serverBuild).toBe('pinned');
  });

  /**
   * Both functions must import the identity from the one shared module, so they
   * can never disagree, and every response constructor must route through the
   * stamping helpers.
   */
  for (const file of [TICK, CATCHUP]) {
    it(`${file} stamps every response`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('_shared/combat/build-identity.ts');
      expect(src).toContain('EDGE_COMBAT_BUILD_ID');
      // No raw `new Response(JSON.stringify(` that skips the stamp.
      const raw = src.match(/JSON\.stringify\((?!stampCombatBuild)/g) ?? [];
      expect(raw).toHaveLength(0);
      // The success/refusal JSON helper is the stamped wrapper, not the raw one.
      expect(src).toContain('return rawJson(stampCombatBuild(data));');
    });
  }
});
