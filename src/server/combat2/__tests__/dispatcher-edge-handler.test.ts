import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCombat2DispatchHandler, type Combat2DispatchHandlerDependencies } from '../../../../supabase/functions/combat2-dispatch-once/handler.ts';
import type { NodeTickRunResult, ProcessNodeTickDependencies } from '../process-node-tick-once';

const NODE = '10000000-0000-4000-8000-000000000001';
const ENCOUNTER = '10000000-0000-4000-8000-000000000101';
const SERVICE_KEY = 'server-only-secret';
const WORKER_SECRET = 'invocation-only-secret';

function request(body: string | null = '{}', authorization = `Bearer ${WORKER_SECRET}`): Request {
  return new Request('http://local/combat2-dispatch-once', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization, 'Content-Type': 'application/json' } : undefined,
    body,
  });
}

function setup(candidates: unknown[] = []) {
  const rpc = vi.fn(async (name: string) => name === 'combat2_due_nodes'
    ? { data: { ok: true, kind: 'candidates', candidates }, error: null }
    : { data: null, error: null });
  const process = vi.fn(async (_nodeId: string, _deps: ProcessNodeTickDependencies): Promise<NodeTickRunResult> =>
    ({ ok: true, kind: 'not_due', nextDueAt: null }));
  const log = vi.fn();
  const deps: Combat2DispatchHandlerDependencies = {
    env: (name) => name === 'SUPABASE_URL' ? 'https://project.supabase.co'
      : name === 'SUPABASE_SERVICE_ROLE_KEY' ? SERVICE_KEY : WORKER_SECRET,
    createClient: () => ({ rpc }),
    processNodeTickOnce: process,
    abilityRecords: [],
    log,
  };
  return { deps, handler: createCombat2DispatchHandler(deps), rpc, process, log };
}

describe('combat2-dispatch-once Edge handler', () => {
  it.each([null, 'Bearer wrong', 'Bearer player-jwt', `Bearer ${SERVICE_KEY}`, 'Basic token'])(
    'refuses non-worker authorization: %s', async (authorization) => {
      const fixture = setup();
      const response = await fixture.handler(request('{}', authorization ?? ''));
      expect(response.status).toBe(401);
      expect(fixture.rpc).not.toHaveBeenCalled();
      expect(fixture.process).not.toHaveBeenCalled();
    },
  );

  it('fails closed on missing or identical secrets', async () => {
    const missing = setup();
    missing.deps.env = () => undefined;
    expect((await createCombat2DispatchHandler(missing.deps)(request())).status).toBe(500);
    const identical = setup();
    identical.deps.env = (name) => name === 'SUPABASE_URL' ? 'https://project.supabase.co' : SERVICE_KEY;
    expect((await createCombat2DispatchHandler(identical.deps)(request('{}', `Bearer ${SERVICE_KEY}`))).status).toBe(500);
  });

  it.each(['{"node_id":"' + NODE + '"}', '[]', 'null', '{'])('rejects non-empty or malformed body %s', async (body) => {
    const fixture = setup();
    expect((await fixture.handler(request(body))).status).toBe(400);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it.each([null, '', '{}', '  { }  '])('accepts the exact empty invocation shape', async (body) => {
    const fixture = setup();
    const response = await fixture.handler(request(body));
    expect(response.status).toBe(200);
    expect(fixture.rpc).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith('combat2_due_nodes', { _limit: 10 });
    expect(fixture.process).not.toHaveBeenCalled();
  });

  it('passes each discovered node to the existing worker exactly once', async () => {
    const row = { node_id: NODE, encounter_id: ENCOUNTER, next_due_at: '2026-08-31T00:00:00Z' };
    const fixture = setup([row]);
    const response = await fixture.handler(request());
    expect(response.status).toBe(200);
    expect(fixture.process).toHaveBeenCalledOnce();
    expect(fixture.process.mock.calls[0][0]).toBe(NODE);
    expect(await response.json()).toMatchObject({ classification: 'dispatched', candidateCount: 1, processedCount: 1 });
  });

  it('redacts both secrets from response and logs', async () => {
    const row = { node_id: NODE, encounter_id: ENCOUNTER, next_due_at: '2026-08-31T00:00:00Z' };
    const fixture = setup([row]);
    fixture.process.mockRejectedValue(new Error(`${SERVICE_KEY} ${WORKER_SECRET}`));
    const responseText = await (await fixture.handler(request())).text();
    expect(responseText).not.toContain(SERVICE_KEY);
    expect(responseText).not.toContain(WORKER_SECRET);
    expect(JSON.stringify(fixture.log.mock.calls)).not.toContain(SERVICE_KEY);
    expect(JSON.stringify(fixture.log.mock.calls)).not.toContain(WORKER_SECRET);
  });

  it('has no direct table access, HTTP self-invocation, or resolver implementation', () => {
    const source = readFileSync('supabase/functions/combat2-dispatch-once/handler.ts', 'utf8');
    expect(source).not.toContain('.from(');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('resolveNodeTick');
    expect(source.match(/combat2_due_nodes/g)).toHaveLength(2);
  });
});
