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

function setup(candidates: unknown[] = [], sessions: unknown[] = []) {
  const rpc = vi.fn(async (name: string) => name === 'combat2_due_nodes'
    ? { data: { ok: true, kind: 'candidates', candidates }, error: null }
    : name === 'combat2_diagnostic_sessions_for_candidates' ? {data:sessions,error:null}
    : { data: {ok:true,kind:'recorded'}, error: null });
  const process = vi.fn(async (_nodeId: string, _deps: ProcessNodeTickDependencies): Promise<NodeTickRunResult> =>
    ({ ok: true, kind: 'not_due', nextDueAt: null }));
  const log = vi.fn();
  const deferred: PromiseLike<unknown>[]=[];
  const deps: Combat2DispatchHandlerDependencies = {
    env: (name) => name === 'SUPABASE_URL' ? 'https://project.supabase.co'
      : name === 'SUPABASE_SERVICE_ROLE_KEY' ? SERVICE_KEY : WORKER_SECRET,
    createClient: () => ({ rpc }),
    processNodeTickOnce: process,
    abilityRecords: [],
    log,
    defer: work=>deferred.push(work),
  };
  return { deps, handler: createCombat2DispatchHandler(deps), rpc, process, log, deferred };
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

  it('persists ordered worker phases only for authoritative relevant sessions without duplicating gameplay', async()=>{
    const row={node_id:NODE,encounter_id:ENCOUNTER,next_due_at:'2026-08-31T00:00:00Z'};
    const fixture=setup([row],[{session_id:'20000000-0000-4000-8000-000000000001',node_id:NODE,encounter_id:ENCOUNTER}]);
    fixture.process.mockImplementation(async (_node,deps)=>{
      for(const event of ['claim_attempted','claim_acquired','decode_completed','resolve_completed','commit_attempted','commit_completed'] as const)
        deps.diagnostic?.({event,nodeId:NODE,encounterId:ENCOUNTER,tick:1,elapsedMs:2,outcome:'ok'});
      return {ok:true,kind:'committed',encounterId:ENCOUNTER,tick:1};
    });
    expect((await fixture.handler(request())).status).toBe(200);
    await Promise.all(fixture.deferred);
    expect(fixture.process).toHaveBeenCalledOnce();
    const persisted=fixture.rpc.mock.calls.find(([name])=>name==='combat2_diagnostic_record_server_events');
    expect(persisted?.[1]._events.map((event: {event_type:string})=>event.event_type)).toEqual([
      'dispatcher_requested','claim_attempted','claim_acquired','decode_completed','resolve_completed','commit_attempted','commit_completed']);
  });

  it('does not insert for no, unrelated, expired or stopped sessions and isolates sink failure',async()=>{
    const row={node_id:NODE,encounter_id:ENCOUNTER,next_due_at:'2026-08-31T00:00:00Z'};
    for(const sessions of [[],[{session_id:'x',node_id:'other',encounter_id:ENCOUNTER}]]){
      const fixture=setup([row],sessions); const response=await fixture.handler(request()); await Promise.all(fixture.deferred);
      expect(response.status).toBe(200); expect(fixture.process).toHaveBeenCalledOnce();
      expect(fixture.rpc.mock.calls.some(([name])=>name==='combat2_diagnostic_record_server_events')).toBe(false);
    }
    const failing=setup([row],[{session_id:'x',node_id:NODE,encounter_id:ENCOUNTER}]);
    failing.rpc.mockImplementation(async(name:string)=>{if(name==='combat2_due_nodes')return{data:{ok:true,kind:'candidates',candidates:[row]},error:null};
      if(name==='combat2_diagnostic_sessions_for_candidates')return{data:[{session_id:'x',node_id:NODE,encounter_id:ENCOUNTER}],error:null}; throw new Error('sink');});
    const response=await failing.handler(request()); await Promise.all(failing.deferred);
    expect(response.status).toBe(200); expect(failing.process).toHaveBeenCalledOnce();
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
