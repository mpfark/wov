import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CreatureManager from '../CreatureManager';
import { CREATURE_ADMIN_ENABLED, configuration, configurationChange, decodeCreatureResult, mutateCreature } from '../creature-admin';
import { buildBossCastSave } from '../boss-cast-form';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
vi.mock('sonner', () => ({ toast: { error: mock.error, success: mock.success } }));

// Execute actual updated handler initializers with explicit React/transport
// fixtures. The DOM gate below separately renders the real component.
function handler(file: string, name: string, env: Record<string, unknown>) {
  const text = readFileSync(file, 'utf8'), tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(tree) === name) expression = n.initializer!.getText(tree);
    ts.forEachChild(n, visit);
  }
  visit(tree); expect(expression).not.toBe('');
  const code = ts.transpileModule('const run=' + expression + ';run;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), code.replace(/run;\s*$/, 'return run;'))(...Object.values(env));
}
const manager = 'src/components/admin/CreatureManager.tsx';
function saveFixture(creating = false) {
  const form = handler(manager, 'defaultForm', {})();
  Object.assign(form, { name: 'wounded', description: 'new', node_id: null });
  const pendingRef = { current: null }, dispatchingRef = { current: false };
  const baseline = { ...configuration({ ...form, description: '' }), max_hp: 100, node_id: null };
  const mutate = vi.fn(), rpc = vi.fn().mockResolvedValue({ data: { ok: true, kind: 'updated' }, error: null });
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { ...form, id: 'fixture', hp: 40, max_hp: 100 } }),
    order: async () => ({ data: [] }) };
  const env = { bossFormRef: { current: null }, needsRefreshRef: { current: false }, CREATURE_ADMIN_ENABLED: true, CREATURE_ADMIN_GATE: 'off', loading: false, form,
    selectedId: creating ? null : 'fixture', newCreatureId: 'stable-create', baselineRef: { current: baseline },
    pendingRef, dispatchingRef, configurationChange, configuration, mutateCreature: mutate,
    buildBossCastSave, TICK_RATE_MS: 2000, toast: mock, setLoading: vi.fn(), setSelectedId: vi.fn(), setIsNew: vi.fn(),
    supabase: { rpc, from: () => query }, rewardExpected: {}, rewardRequestRef: { current: null },
    decodeRewardMutationResult: (v: unknown) => v, setRewardExpected: vi.fn(), setCreatures: vi.fn(), openEdit: vi.fn(),
  };
  return { env, mutate, rpc, pendingRef, form, run: handler(manager, 'handleSave', env) };
}

describe('Creature Admin boundary', () => {
  it('stays off and never contacts an incompatible backend', async () => {
    expect(CREATURE_ADMIN_ENABLED).toBe(false);
    await expect(mutateCreature({ action: 'save', id: 'x', expected: {}, patch: {} })).rejects.toThrow('cutover');
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('selects dirty configuration only and keeps derived-max dependencies', () => {
    const before = { ...configuration({ name: 'old', level: 1, rarity: 'regular' }), max_hp: 23 };
    const desired = { ...before, name: 'new', hp: 999, stats: { str: 99 } };
    expect(configurationChange(before, desired)).toEqual({ expected: { name: 'old' }, patch: { name: 'new' } });
    expect(configurationChange(before, { ...before, level: 2 }).expected).toEqual({ level: 1, rarity: 'regular', max_hp: 23 });
  });
  it('normalizes equivalent rates and rejects unrelated or malformed responses', () => {
    expect(configurationChange({ regen_percent_4s: '2' }, { regen_percent_4s: '2.00' }).patch).toEqual({});
    expect(decodeCreatureResult({ ok: true, kind: 'updated', creatureId: 'other' }, 'x')).toBeNull();
    expect(decodeCreatureResult({ ok: true, kind: 'bogus', creatureId: 'x' }, 'x')).toBeNull();
  });
  it('actual metadata handler sends no HP/stats and reports reward partial failure', async () => {
    const x = saveFixture(); x.mutate.mockResolvedValue({ ok: true, kind: 'updated' });
    x.rpc.mockResolvedValue({ data: { ok: false, kind: 'stale', current: {} }, error: null });
    await x.run();
    expect(x.mutate.mock.calls[0][0]).toEqual({ action: 'save', id: 'fixture', expected: { description: '' }, patch: { description: 'new' } });
    expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('Configuration saved; reward update refused'));
  });
  it('actual create handler retains exact identity/payload on uncertain failure and blocks replacement', async () => {
    const x = saveFixture(true); x.mutate.mockRejectedValue(new Error('uncertain'));
    await x.run(); const original = structuredClone(x.mutate.mock.calls[0][0]); await x.run();
    expect(x.mutate.mock.calls[1][0]).toEqual(original); expect(original.id).toBe('stable-create');
    expect(original.patch).not.toHaveProperty('hp'); expect(original.patch).not.toHaveProperty('stats');
    expect(original.patch).not.toHaveProperty('base_aggressive');
    expect(Object.keys(original.patch).every(k => ['node_id', ...Object.keys(configuration(original.patch))].includes(k))).toBe(true);
    x.form.name = 'changed'; await x.run(); expect(x.mutate).toHaveBeenCalledTimes(2);
    expect(x.pendingRef.current).toEqual(original);
  });
  it('actual handler synchronous in-flight fence prevents duplicate dispatch', async () => {
    const x = saveFixture(); let finish!: (v: unknown) => void;
    x.mutate.mockReturnValue(new Promise(r => { finish = r; }));
    const first = x.run(); await x.run(); expect(x.mutate).toHaveBeenCalledTimes(1);
    finish({ ok: false, kind: 'stale' }); await first;
  });
  it('actual population handler reports per-row outcomes and retains failed create identity', async () => {
    const creatures = ['first', 'unknown', 'unsupported'].map((name, i) => ({ name, description: '', node_temp_id: 'node',
      level: 1, rarity: 'regular', is_aggressive: false, is_humanoid: i === 2 }));
    const mutate = vi.fn().mockResolvedValueOnce({ ok: true, kind: 'created' }).mockRejectedValue(new Error('uncertain'));
    const info = vi.fn();
    const run = handler('src/components/admin/PopulatePanel.tsx', 'applyAll', { CREATURE_ADMIN_ENABLED: true,
      CREATURE_ADMIN_GATE: 'off', generated: { creatures }, applyingRef: { current: false },
      populationRef: { current: new WeakMap() }, mutateCreature: mutate, toast: { ...mock, info },
      setApplying: vi.fn(), onDataChanged: vi.fn() });
    await run(); const failed = structuredClone(mutate.mock.calls[1][0]); await run();
    expect(mutate).toHaveBeenCalledTimes(3); expect(mutate.mock.calls[2][0]).toEqual(failed);
    expect(failed.patch).not.toHaveProperty('hp'); expect(failed.patch).not.toHaveProperty('stats');
    expect(info).toHaveBeenCalledWith('1 created/already reconciled; 2 failed or unresolved.');
  });
  it('actual node assignment handler uses expected-node RPC and never direct mutation', async () => {
    const mutate = vi.fn().mockResolvedValue({ ok: false, kind: 'retained_references' });
    const from = vi.fn();
    const run = handler('src/components/admin/NodeEditorPanel.tsx', 'assignCreature', {
      CREATURE_ADMIN_ENABLED: true, CREATURE_ADMIN_GATE: 'off', activeNodeId: 'destination', assignCreatureId: 'creature',
      allCreatures: [{ id: 'creature', node_id: 'origin' }], setAssigning: vi.fn(), mutateCreature: mutate,
      supabase: { from }, toast: mock, setAssignCreatureId: vi.fn(), loadCreatures: vi.fn(), setAllCreatures: vi.fn(),
    });
    await run(); expect(mutate).toHaveBeenCalledWith({ action: 'move', id: 'creature',
      expected: { node_id: 'origin' }, patch: { node_id: 'destination' } }); expect(from).not.toHaveBeenCalled();
  });
  it('renders the real 4-second configuration input and disabled activation gate', async () => {
    const q = { select: () => q, order: () => q, eq: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve) };
    mock.from.mockReturnValue(q);
    await act(async () => { render(<CreatureManager />); });
    fireEvent.click(screen.getByRole('button', { name: /New Creature/ }));
    expect(screen.getByLabelText(/Regeneration \(% max HP per 4 seconds\)/)).toHaveValue('2');
    expect(screen.getByLabelText(/Regeneration \(% max HP per 4 seconds\)/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('cutover');
  });
});
