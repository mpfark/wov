import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('supabase/functions/admin-users/index.ts', 'utf8');
function fixture(role = 'steward', authenticated = true, target: any = { id: 'char', deleted_at: null }) {
  const writes: unknown[] = [], tables: string[] = [];
  let handler: (request: Request) => Promise<Response>;
  const admin = { rpc: async (name: string, args: unknown) => { writes.push({ rpc: name, args }); return { data: { kind: 'committed' }, error: null }; }, from(table: string) {
    tables.push(table);
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain,
      maybeSingle: async () => ({ data: table === 'user_roles' ? { role } : target, error: null }),
      update: (value: unknown) => { writes.push({ table, value }); return chain; },
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
    }; return chain;
  } };
  const user = { auth: { getClaims: async () => ({ data: authenticated ? { claims: { sub: 'actor' } } : null, error: null }) } };
  let client = 0;
  const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function('Deno', 'createClient', code)({
    env: { get: () => 'local-test-only' }, serve: (value: typeof handler) => { handler = value; },
  }, () => client++ % 2 === 0 ? admin : user);
  return { writes, tables, async request(action: string, body: unknown, method = 'POST') {
    const response = await handler!(new Request(`https://local.invalid/?action=${action}`, {
      method, headers: { Authorization: 'Bearer local-test' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, body: await response.json() };
  } };
}
describe('actual admin-users D1 boundary', () => {
  for (const role of ['steward', 'overlord']) {
    for (const action of ['set-level', 'reset-stats', 'grant-respec']) {
      it(`${role}: ${action} refuses before gameplay table access`, async () => {
        const f = fixture(role);
        expect(await f.request(action, { character_id: 'char', new_level: 42, amount: 5 }))
          .toMatchObject({ status: 410, body: { code: 'legacy_progression_operation_retired' } });
        expect(f.tables).toEqual(['user_roles']); expect(f.writes).toEqual([]);
      });
    }
  }
  for (const field of ['str','dex','con','int','wis','cha','level','xp','class','is_classless',
    'unspent_stat_points','respec_points','bhp','bhp_trained','rp_total_earned']) {
    it(`mixed ${field} payload is refused atomically`, async () => {
      const f = fixture();
      expect(await f.request('update-character', { character_id: 'char', updates: { name: 'Allowed', [field]: 1 } }))
        .toMatchObject({ status: 403, body: { code: 'protected_progression_edit_denied' } });
      expect(f.tables).toEqual(['user_roles']); expect(f.writes).toEqual([]);
    });
  }
  for (const action of ['revive','teleport','give-item','remove-item','grant-gold','grant-salvage','grant-gem']) {
    for (const role of ['steward','overlord']) it(role + ': ' + action + ' retired before gameplay access', async () => {
      const f = fixture(role);
      expect(await f.request(action, {})).toMatchObject({ status: 410, body: { code: 'legacy_character_operation_retired' } });
      expect(f.tables).toEqual(['user_roles']); expect(f.writes).toEqual([]);
    });
    it(action + ' retains authentication and role denial', async () => {
      expect((await fixture('player').request(action, {})).status).toBe(403);
      expect((await fixture('steward', false).request(action, {})).status).toBe(401);
    });
  }
  for (const field of ['hp','max_hp','ac','gold','current_node_id','unknown']) it('denies mixed ' + field, async () => {
    const f = fixture();
    expect((await f.request('update-character', { character_id: 'char', updates: { name: 'Allowed', [field]: 1 } })).status).toBe(403);
    expect(f.tables).toEqual(['user_roles']); expect(f.writes).toEqual([]);
  });
  it('permits name and gender only for an existing active target', async () => {
    const f = fixture(), updates = { name: 'Allowed', gender: 'female' };
    expect((await f.request('update-character', { character_id: 'char', updates })).status).toBe(200);
    expect(f.writes).toEqual([{ table: 'characters', value: updates }]);
    for (const [target, status] of [[null,404], [{ id: 'char', deleted_at: '2026-10-10' },409]] as const) {
      const invalid = fixture('steward', true, target);
      expect((await invalid.request('update-character', { character_id: 'char', updates })).status).toBe(status);
      expect(invalid.writes).toEqual([]);
    }
    const invalid = fixture();
    expect((await invalid.request('update-character', { character_id: 'char', updates: { gender: 'invalid' } })).status).toBe(400);
    expect(invalid.writes).toEqual([]);
  });
  it('retains auth/role denial and XP pause', async () => {
    for (const f of [fixture('player'), fixture('steward', false)]) {
      expect([401, 403]).toContain((await f.request('reset-stats', {})).status);
      expect(f.writes).toEqual([]);
    }
    const f = fixture();
    expect(await f.request('grant-xp', {})).toMatchObject({ status: 503, body: { code: 'progression_awards_paused' } });
    expect(f.writes).toEqual([]);
  });
});

it('new token entry validates amount/reason and derives actor; old raw route stays410', async () => {
  const character_id = '00000000-0000-4000-8000-000000000001', request_id = '00000000-0000-4000-8000-000000000002';
  for (const body of [{ character_id, request_id, amount: 2, reason: 'Support' },{ character_id, request_id, amount: 1, reason: '' },{ character_id, request_id, amount: 1, reason: 'Support', actor: 'spoofed' }]) {
    const f=fixture(); expect((await f.request('award-respec-token',body)).status).toBe(400);expect(f.writes).toEqual([]);
  }
  const f=fixture();expect((await f.request('award-respec-token',{ character_id, request_id, amount: 1, reason: 'Support' })).status).toBe(200);
  expect(f.writes).toEqual([{ rpc: 'admin_respec_award', args: { _actor:'actor',_character:character_id,_request:request_id,_amount:1,_reason:'Support' } }]);
});

it('new token entry retains auth refusals',async()=>{
  const body={character_id:'00000000-0000-4000-8000-000000000001',request_id:'00000000-0000-4000-8000-000000000002',amount:1,reason:'Support'};
  for(const f of [fixture('player'),fixture('steward',false)]){expect([401,403]).toContain((await f.request('award-respec-token',body)).status);expect(f.writes).toEqual([]);}
});
