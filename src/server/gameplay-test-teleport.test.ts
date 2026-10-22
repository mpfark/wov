import { expect, it, vi } from 'vitest';
import { handleGameplayTestTeleport } from '../../supabase/functions/_shared/gameplay-test-teleport';
import { readFileSync } from 'node:fs';
const id = '00000000-0000-4000-8000-000000000001';
const payload = { character_id: id, destination_node_id: id, request_id: id };
const req = (p: any = payload, action = 'test-teleport') => new Request(`https://local.test/?action=${action}`, { method: 'POST', body: JSON.stringify(p) });
it('derives actor server-side, validates exact inputs, routes access separately', async () => {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  expect((await handleGameplayTestTeleport(req(), async () => null, rpc)).status).toBe(401);
  expect((await handleGameplayTestTeleport(req({ ...payload, actor: id }), async () => id, rpc)).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  await handleGameplayTestTeleport(req({ character_id: id }, 'test-teleport-access'), async () => id, rpc);
  expect(rpc).toHaveBeenLastCalledWith('gameplay_test_teleport_access_internal', { _actor: id, _character: id });
});
it('only explicit transactional SQL refusals establish non-commit; network errors remain uncertain', async () => {
  const response = await handleGameplayTestTeleport(req(), async () => id, async () => ({ data: null, error: { code: 'P0001', message: 'encounter_unresolved' } }));
  expect(await response.json()).toMatchObject({ ...payload, outcome: 'not_committed' });
  for (const code of ['PGRST000', '57014', undefined]) {
    const r = await handleGameplayTestTeleport(req(), async () => id, async () => ({ data: null, error: { code } }));
    expect(r.status).toBe(503); expect(await r.json()).not.toHaveProperty('outcome');
  }
});
it('keeps the old teleport retired and new actions isolated before the existing admin gate', () => {
  const edge = readFileSync('supabase/functions/admin-users/index.ts', 'utf8');
  expect(edge.indexOf("testAction === 'test-teleport'")).toBeLessThan(edge.indexOf('= await verifyAdmin(req)'));
  expect(edge).toContain("['revive','teleport','give-item'");
  const sql = readFileSync('docs/operations/idea-025-test-teleport.sql', 'utf8');
  expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/DISABLE TRIGGER|ALTER DEFAULT PRIVILEGES|admin_teleport\(/i);
  expect(sql).toContain("set_config('app.combat2_depart_authorized','true',true)");
  expect(sql.indexOf('coverage:=public.creature_hp_cover')).toBeLessThan(sql.indexOf('FOR NO KEY UPDATE'));
});
