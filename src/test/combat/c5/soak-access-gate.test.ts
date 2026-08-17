/**
 * C5 — soak access gate + acknowledgement contract regression coverage.
 *
 * Two halves, both decidable without a live database:
 *
 *  A. the orchestration maintenance/soak gate: while `combat_mode` is
 *     `maintenance`, resolution is refused unless the DATABASE says this exact
 *     character has soak access. The gate is evaluated per request, from
 *     `public.combat_soak_access_check` only, and a refusal touches nothing.
 *
 *  B. `interpretTickAck`: the client's reader of the C3 response envelope. The
 *     Gate 3 failure was a contract mismatch here — the client read pre-C3
 *     snake_case fields, so it never adopted the encounter identity, never
 *     latched maintenance and never recognised a terminal encounter, and so
 *     ticked against a corpse forever.
 */

import { describe, it, expect } from 'vitest';
import { orchestrateCombatResolution } from '@/shared/combat/c3/orchestration';
import { interpretTickAck, isTerminalTransportStatus } from '@/features/combat/utils/tick-ack';
import { COMBAT_MAINTENANCE_MESSAGE } from '@/shared/combat/maintenance';

const NODE = '00000000-0000-4000-8000-000000000001';
const ENC = '00000000-0000-4000-8000-0000000000e1';
const ALLOWED = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';

interface Call { fn: string; args: Record<string, unknown> }

/**
 * A database that is in maintenance and grants soak access exactly the way the
 * deployed `combat_soak_access_check` does: soak switch on, an unexpired row for
 * THIS character, and authoritative database time (not client time).
 */
function gateDb(opts: {
  mode?: string;
  soak?: 'on' | 'off';
  allowlist?: { characterId: string; expiresAtMs: number }[];
  dbNowMs?: number;
}) {
  const calls: Call[] = [];
  const dbNow = opts.dbNowMs ?? 1_000_000;
  const db = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          calls.push({ fn: `from:${table}`, args: {} });
          if (table === 'combat_config') return { data: { value: opts.mode ?? 'maintenance' }, error: null };
          if (table === 'characters') return { data: { current_node_id: NODE }, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === 'combat_soak_access_check') {
        if ((opts.soak ?? 'off') !== 'on') return { data: false, error: null };
        const row = (opts.allowlist ?? []).find(a => a.characterId === args._character_id);
        // Expiry is decided against the database clock only.
        return { data: !!row && row.expiresAtMs > dbNow, error: null };
      }
      if (fn === 'encounter_intake') return { data: { ok: true, encounter_id: ENC }, error: null };
      if (fn === 'claim_encounter_tick') {
        return { data: { claimed: false, reason: 'not_due' }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { db, calls };
}

const deps = (db: any) => ({
  db,
  nowMs: 1_000_000,
  catalog: { configVersion: 'v-test', lookup: () => null },
  newBatchId: () => 'batch-1',
  caller: 'test',
});

const live = (characterId: string) => ({ role: 'live' as const, characterId, creatureIds: [] });

/** Did the request get past the gate at all? */
function passedGate(calls: Call[]): boolean {
  return calls.some(c => c.fn === 'encounter_intake' || c.fn === 'encounter_for_node');
}

describe('C5 — maintenance/soak access gate', () => {
  it('1. maintenance with combat_soak = off refuses combat', async () => {
    const { db, calls } = gateDb({ mode: 'maintenance', soak: 'off' });
    const r = await orchestrateCombatResolution(live(ALLOWED), deps(db) as any);
    expect(r.ok).toBe(false);
    expect((r as any).kind).toBe('maintenance');
    expect((r as any).reason).toBe(COMBAT_MAINTENANCE_MESSAGE);
    expect(passedGate(calls)).toBe(false);
  });

  it('2. soak enabled without an allowlist entry refuses combat', async () => {
    const { db, calls } = gateDb({ mode: 'maintenance', soak: 'on', allowlist: [] });
    const r = await orchestrateCombatResolution(live(ALLOWED), deps(db) as any);
    expect((r as any).kind).toBe('maintenance');
    expect(passedGate(calls)).toBe(false);
  });

  it('3. expired access is refused against authoritative database time', async () => {
    // Client/edge clock is far behind the database clock: the row looks live
    // locally and must still be refused.
    const { db, calls } = gateDb({
      mode: 'maintenance', soak: 'on', dbNowMs: 2_000_000,
      allowlist: [{ characterId: ALLOWED, expiresAtMs: 1_500_000 }],
    });
    const r = await orchestrateCombatResolution(live(ALLOWED), deps(db) as any);
    expect((r as any).kind).toBe('maintenance');
    expect(passedGate(calls)).toBe(false);
  });

  it('4. a different character cannot use another character access', async () => {
    const { db, calls } = gateDb({
      mode: 'maintenance', soak: 'on',
      allowlist: [{ characterId: ALLOWED, expiresAtMs: 9_000_000 }],
    });
    const r = await orchestrateCombatResolution(live(OTHER), deps(db) as any);
    expect((r as any).kind).toBe('maintenance');
    expect(passedGate(calls)).toBe(false);
    // The gate is keyed on the character identity it was asked about.
    const check = calls.find(c => c.fn === 'combat_soak_access_check')!;
    expect(check.args._character_id).toBe(OTHER);
  });

  it('5. the allowlisted character proceeds to encounter resolution', async () => {
    const { db, calls } = gateDb({
      mode: 'maintenance', soak: 'on',
      allowlist: [{ characterId: ALLOWED, expiresAtMs: 9_000_000 }],
    });
    const r = await orchestrateCombatResolution(live(ALLOWED), deps(db) as any);
    // The claim refusal below is cadence, not authorization: the gate let it in.
    expect(passedGate(calls)).toBe(true);
    expect((r as any).kind).toBe('claim_refused');
  });

  it('6. a non-allowlisted character stays refused while another is allowed', async () => {
    const cfg = {
      mode: 'maintenance', soak: 'on' as const,
      allowlist: [{ characterId: ALLOWED, expiresAtMs: 9_000_000 }],
    };
    const a = gateDb(cfg);
    const b = gateDb(cfg);
    await orchestrateCombatResolution(live(ALLOWED), deps(a.db) as any);
    const refused = await orchestrateCombatResolution(live(OTHER), deps(b.db) as any);
    expect(passedGate(a.calls)).toBe(true);
    expect((refused as any).kind).toBe('maintenance');
    expect(passedGate(b.calls)).toBe(false);
  });

  it('7. every role evaluates the same gate with the same identity rules', async () => {
    for (const role of ['live', 'catchup'] as const) {
      const { db, calls } = gateDb({ mode: 'maintenance', soak: 'off' });
      const r = await orchestrateCombatResolution(
        role === 'live' ? live(ALLOWED) : { role, nodeId: NODE },
        deps(db) as any,
      );
      expect((r as any).kind).toBe('maintenance');
      expect(calls.some(c => c.fn === 'combat_soak_access_check')).toBe(true);
      expect(passedGate(calls)).toBe(false);
    }
  });

  it('10. removing access stops the next authoritative operation', async () => {
    const open = gateDb({
      mode: 'maintenance', soak: 'on',
      allowlist: [{ characterId: ALLOWED, expiresAtMs: 9_000_000 }],
    });
    await orchestrateCombatResolution(live(ALLOWED), deps(open.db) as any);
    expect(passedGate(open.calls)).toBe(true);

    // Allowlist emptied between ticks: the very next tick is refused before any
    // encounter work, with no relaxation for an in-flight encounter.
    const closed = gateDb({ mode: 'maintenance', soak: 'on', allowlist: [] });
    const r = await orchestrateCombatResolution(live(ALLOWED), deps(closed.db) as any);
    expect((r as any).kind).toBe('maintenance');
    expect(passedGate(closed.calls)).toBe(false);
  });

  it('12. combat is unavailable when the gate itself errors (fails closed)', async () => {
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
      rpc: async () => ({ data: null, error: { message: 'boom' } }),
    };
    const r = await orchestrateCombatResolution(live(ALLOWED), deps(db) as any);
    expect((r as any).kind).toBe('maintenance');
  });

  it('never trusts a caller-supplied soak flag', async () => {
    const { db } = gateDb({ mode: 'maintenance', soak: 'off' });
    const r = await orchestrateCombatResolution(
      { ...live(ALLOWED), soak: true, combat_mode: 'open' } as any,
      deps(db) as any,
    );
    expect((r as any).kind).toBe('maintenance');
  });
});

describe('C5 — combat-tick acknowledgement contract', () => {
  it('latches maintenance from the C3 refusal envelope', () => {
    const ack = interpretTickAck({ ok: false, kind: 'maintenance', reason: COMBAT_MAINTENANCE_MESSAGE });
    expect(ack.kind).toBe('maintenance');
    expect((ack as any).message).toBe(COMBAT_MAINTENANCE_MESSAGE);
  });

  it('still recognises the legacy gated payload', () => {
    expect(interpretTickAck({ maintenance: true, message: 'closed' }).kind).toBe('maintenance');
  });

  it('adopts encounter identity from a committed acknowledgement', () => {
    const ack = interpretTickAck({
      ok: true, encounterId: ENC, tick: 4, mode: 'live',
      batchId: 'b-1', ticksProcessed: 1, events: [],
    });
    expect(ack).toMatchObject({ kind: 'committed', encounterId: ENC, tick: 4, batchId: 'b-1' });
  });

  it('treats an effects_only claim refusal as terminal (nothing live remains)', () => {
    const ack = interpretTickAck({
      ok: false, kind: 'claim_refused', reason: 'mode_refused',
      retryable: true, detail: { mode: 'effects_only' },
    });
    expect(ack).toMatchObject({ kind: 'refused', terminal: true });
  });

  it('treats cadence refusals as non-terminal', () => {
    const ack = interpretTickAck({
      ok: false, kind: 'claim_refused', reason: 'not_due',
      retryable: true, detail: { mode: 'live' },
    });
    expect(ack).toMatchObject({ kind: 'refused', terminal: false });
  });

  it('treats missing encounter and authorization refusals as terminal', () => {
    for (const kind of ['no_encounter', 'unauthorized', 'invalid_request']) {
      expect(interpretTickAck({ ok: false, kind, reason: 'x' })).toMatchObject({ terminal: true });
    }
  });

  it('leaves a renderable committed batch to the legacy path', () => {
    expect(interpretTickAck({ events: [], creature_states: [], encounter_tick: 3 }).kind).toBe('legacy');
  });

  it('classifies 400/401/403 transport failures as terminal', () => {
    for (const s of [400, 401, 403]) expect(isTerminalTransportStatus(s)).toBe(true);
    for (const s of [500, 503, 429, null, undefined]) expect(isTerminalTransportStatus(s)).toBe(false);
  });
});

describe('C5 — players cannot reach service-role-only maintenance functions', () => {
  it('11. the client bundle never calls the service-role-only RPCs', async () => {
    const fg = await import('@/features/inventory/hooks/useGroundLoot?raw' as any).catch(() => null);
    // Source-level assertion: read the files that previously did.
    const fs = await import('node:fs');
    const forbidden = ['cleanup_ground_loot', 'combat_soak_access_check', 'commit_encounter_tick_v2'];
    const files = [
      'src/features/inventory/hooks/useGroundLoot.ts',
      'src/features/combat/hooks/useCombatDriver.ts',
      'src/features/creatures/hooks/useCreatures.ts',
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const fn of forbidden) {
        expect(src.includes(`rpc('${fn}'`), `${f} must not call ${fn}`).toBe(false);
        expect(src.includes(`rpc("${fn}"`), `${f} must not call ${fn}`).toBe(false);
      }
    }
    expect(fg === null || true).toBe(true);
  });
});
