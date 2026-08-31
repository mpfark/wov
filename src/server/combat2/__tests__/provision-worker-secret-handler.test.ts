import { describe, expect, it, vi } from 'vitest';
import {
  createCombat2ProvisionHandler,
  PROVISION_RPC,
  type Combat2ProvisionHandlerDependencies,
  type ProvisionRpcClient,
} from '../../../../supabase/functions/combat2-provision-worker-secret/handler.ts';

const SERVICE_KEY = 'server-only-service-role-key';
const WORKER_SECRET = 'invocation-only-worker-secret';
const PLAYER_JWT = 'header.player-claims.signature';

function request(body?: unknown, init: RequestInit = {}): Request {
  return new Request('http://local/combat2-provision-worker-secret', {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_SECRET}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    ...init,
  });
}

function setup(result: unknown = { ok: true, classification: 'created' }) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: result, error: null }));
  const log = vi.fn();
  const createClient = vi.fn(() => ({ rpc }) as ProvisionRpcClient);
  const deps: Combat2ProvisionHandlerDependencies = {
    env: (name) => {
      if (name === 'SUPABASE_URL') return 'https://project.supabase.co';
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return SERVICE_KEY;
      return WORKER_SECRET;
    },
    createClient,
    log,
  };
  return { handler: createCombat2ProvisionHandler(deps), deps, rpc, log, createClient };
}

describe('combat2-provision-worker-secret Edge handler', () => {
  it('accepts POST only', async () => {
    const { handler, rpc } = setup();
    const response = await handler(new Request('http://local', { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ classification: 'method_not_allowed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['missing bearer', undefined],
    ['malformed scheme', 'Basic ' + WORKER_SECRET],
    ['bearer without token', 'Bearer '],
    ['incorrect bearer', 'Bearer wrong-worker-secret'],
    ['ordinary player JWT', `Bearer ${PLAYER_JWT}`],
    ['service-role key', `Bearer ${SERVICE_KEY}`],
  ])('refuses %s', async (_label, authorization) => {
    const { handler, rpc } = setup();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await handler(request({}, { headers }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ classification: 'unauthorized' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['exact empty object', {}],
  ])('accepts %s', async (_label, body) => {
    const { handler, rpc } = setup();
    const response = await handler(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, classification: 'created' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', '{'],
    ['array body', []],
    ['null-literal body', 'null'],
    ['scalar body', '42'],
    ['caller-supplied secret', { secret: 'attacker-chosen-value' }],
    ['caller-supplied vault name', { name: 'SOME_OTHER_SECRET' }],
    ['caller-supplied secret and name', { _secret: 'x', vault_name: 'OTHER' }],
  ])('rejects %s and never forwards it', async (_label, body) => {
    const { handler, rpc } = setup();
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ classification: 'invalid_request' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls exactly one fixed RPC with only the environment-sourced secret', async () => {
    const { handler, rpc, createClient } = setup();
    await handler(request({}));
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([PROVISION_RPC]);
    expect(rpc.mock.calls[0][1]).toEqual({ _secret: WORKER_SECRET });
    expect(Object.keys(rpc.mock.calls[0][1])).toEqual(['_secret']);
    expect(createClient).toHaveBeenCalledWith('https://project.supabase.co', SERVICE_KEY);
  });

  it('performs no scheduling, combat or world-state call', async () => {
    const { handler, rpc } = setup();
    await handler(request({}));
    const names = rpc.mock.calls.map(([name]) => name);
    expect(names).toHaveLength(1);
    expect(names.some((name) => /schedul|cron|combat_mode|world|tick|dispatch/i.test(name))).toBe(false);
  });

  it.each([
    ['created', 200, true],
    ['updated', 200, true],
    ['ambiguous_secret_state', 409, false],
    ['invalid_secret', 409, false],
    ['vault_write_failed', 409, false],
  ])('maps RPC outcome %s', async (classification, status, ok) => {
    const { handler } = setup({ ok, classification });
    const response = await handler(request({}));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok, classification });
  });

  it.each([
    ['unknown classification', { ok: true, classification: 'something_else' }],
    ['missing classification', { ok: true }],
    ['non-object payload', 'created'],
  ])('refuses %s from the RPC', async (_label, data) => {
    const { handler } = setup(data);
    const response = await handler(request({}));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ classification: 'provision_failed' });
  });

  it('fails safely when the RPC returns an error or throws', async () => {
    const fixture = setup();
    const failing: ProvisionRpcClient = { rpc: async () => ({ data: null, error: { code: '42501' } }) };
    fixture.deps.createClient = () => failing;
    const errored = await createCombat2ProvisionHandler(fixture.deps)(request({}));
    expect(errored.status).toBe(502);

    const throwing: ProvisionRpcClient = { rpc: () => { throw new Error(SERVICE_KEY); } };
    fixture.deps.createClient = () => throwing;
    const thrown = await createCombat2ProvisionHandler(fixture.deps)(request({}));
    expect(thrown.status).toBe(502);
    const text = await thrown.text();
    expect(text).not.toContain(SERVICE_KEY);
    expect(text).not.toContain(WORKER_SECRET);
  });

  it.each([
    ['all missing', () => undefined],
    ['missing url', (name: string) => name === 'SUPABASE_URL' ? undefined : name === 'SUPABASE_SERVICE_ROLE_KEY' ? SERVICE_KEY : WORKER_SECRET],
    ['missing service role key', (name: string) => name === 'SUPABASE_SERVICE_ROLE_KEY' ? undefined : name === 'SUPABASE_URL' ? 'https://project.supabase.co' : WORKER_SECRET],
    ['missing worker secret', (name: string) => name === 'COMBAT2_WORKER_SECRET' ? undefined : name === 'SUPABASE_URL' ? 'https://project.supabase.co' : SERVICE_KEY],
    ['worker secret equals service role key', (name: string) => name === 'SUPABASE_URL' ? 'https://project.supabase.co' : SERVICE_KEY],
  ])('fails closed when environment is %s', async (_label, env) => {
    const fixture = setup();
    fixture.deps.env = env as Combat2ProvisionHandlerDependencies['env'];
    const response = await createCombat2ProvisionHandler(fixture.deps)(request({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ classification: 'environment_failure' });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it('never exposes either secret in responses or logs', async () => {
    const { handler, log } = setup({ ok: true, classification: 'updated', echo: `${SERVICE_KEY} ${WORKER_SECRET}` });
    const response = await handler(request({}));
    const text = await response.text();
    expect(text).toBe('{"ok":true,"classification":"updated"}');
    const logs = JSON.stringify(log.mock.calls);
    expect(text).not.toContain(SERVICE_KEY);
    expect(text).not.toContain(WORKER_SECRET);
    expect(logs).not.toContain(SERVICE_KEY);
    expect(logs).not.toContain(WORKER_SECRET);
  });

  it('carries no secret literal in its own source', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('supabase/functions/combat2-provision-worker-secret/handler.ts', 'utf8'));
    expect(source).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(source).toContain("'COMBAT2_WORKER_SECRET'");
    expect(source).not.toMatch(/console\.(log|warn|error)\(/);
  });
});
