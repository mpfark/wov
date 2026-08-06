/**
 * Phase 1 workflow tests — the Abilities page is a BASE ABILITY LIBRARY.
 *
 * Guards the ownership model: the page reads `abilities` directly, shows every
 * base ability exactly once (assigned or not), never groups by class, never
 * renders the removed AssignmentMatrix, and never writes
 * `class_ability_assignments` — neither when editing nor when creating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/** Every table operation the component performs, in order. */
const ops = vi.hoisted(() => [] as { table: string; op: string; payload?: unknown }[]);

const ABILITY_ROWS = vi.hoisted(() => [
  {
    id: 'ab-fireball', ability_key: 'fireball', label: 'Fireball',
    description: 'Hurl fire.', tooltip: 'Fire damage.', cp_cost: 10,
    mechanic_key: 'fireball', status: 'active', interval_ms: null,
    damage_type: 'fire', ability_type: 'damage', activation_mode: 'queued',
    target_type: 'enemy', admin_notes: null, amount_calc: null,
    duration_calc: null, mechanic_calcs: {}, combat_text: {},
  },
  {
    id: 'ab-frost', ability_key: 'frost_bolt', label: 'Frost Bolt',
    description: 'Hurl frost.', tooltip: 'Frost damage.', cp_cost: 10,
    mechanic_key: 'fireball', status: 'active', interval_ms: null,
    damage_type: 'frost', ability_type: 'damage', activation_mode: 'queued',
    target_type: 'enemy', admin_notes: null, amount_calc: null,
    duration_calc: null, mechanic_calcs: {}, combat_text: {},
  },
  {
    id: 'ab-orphan', ability_key: 'unbound_ward', label: 'Unbound Ward',
    description: 'A ward no class uses yet.', tooltip: 'Ward.', cp_cost: 12,
    mechanic_key: 'self_heal', status: 'draft', interval_ms: null,
    damage_type: null, ability_type: 'buff', activation_mode: 'instant',
    target_type: 'self', admin_notes: null, amount_calc: null,
    duration_calc: null, mechanic_calcs: {}, combat_text: {},
  },
]);

/** Fireball is deliberately assigned to TWO classes — it must still list once. */
const ASSIGNMENT_ROWS = vi.hoisted(() => [
  { ability_id: 'ab-fireball', class_key: 'wizard', is_default: true, status: 'active', unlock_level: 1, class_ability_key: 'fireball', overrides: { label: 'Fireball' }, role: { slot: 0, name: 'Signature' } },
  { ability_id: 'ab-fireball', class_key: 'bard', is_default: false, status: 'active', unlock_level: 15, class_ability_key: 'cutting_words', overrides: { label: 'Cutting Words' }, role: { slot: 3, name: 'Pressure' } },
  { ability_id: 'ab-frost', class_key: 'wizard', is_default: false, status: 'active', unlock_level: 1, class_ability_key: 'frost_bolt', overrides: {}, role: { slot: 0, name: 'Signature' } },
]);


vi.mock('@/integrations/supabase/client', () => {
  const abilitiesResult = { data: ABILITY_ROWS, error: null };
  const assignmentResult = { data: ASSIGNMENT_ROWS, error: null };

  function builder(table: string) {
    const result = table === 'abilities' ? abilitiesResult : assignmentResult;
    const chain: any = {
      select: (_cols?: string) => {
        ops.push({ table, op: 'select' });
        return chain;
      },
      order: () => Promise.resolve(result),
      eq: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: { id: 'ab-new' }, error: null }),
      insert: (payload: unknown) => {
        ops.push({ table, op: 'insert', payload });
        return chain;
      },
      update: (payload: unknown) => {
        ops.push({ table, op: 'update', payload });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return chain;
  }

  return { supabase: { from: (table: string) => builder(table) } };
});

// Calculation publish validation is not what this suite exercises.
vi.mock('@/shared/config/mechanic-templates', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/config/mechanic-templates')>()),
  validateAbilityForPublish: () => [],
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AbilityConfigManager from '../AbilityConfigManager';

const SOURCE = readFileSync('src/components/admin/AbilityConfigManager.tsx', 'utf8');

describe('Abilities page — base ability library', () => {
  beforeEach(() => { ops.length = 0; });

  it('queries the abilities table as its primary list', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Fireball')).toBeInTheDocument());
    expect(ops.filter(o => o.table === 'abilities' && o.op === 'select').length).toBeGreaterThan(0);
  });

  it('shows a base ability exactly once even when several classes assign it', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getAllByText('Fireball')).toHaveLength(1));
    expect(screen.getAllByText('Frost Bolt')).toHaveLength(1);
  });

  it('lists unassigned base abilities', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Unbound Ward')).toBeInTheDocument());
    expect(screen.getByText('unassigned')).toBeInTheDocument();
  });

  it('does not group the library by class', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Fireball')).toBeInTheDocument());
    expect(screen.queryByText('Wizard')).not.toBeInTheDocument();
    expect(screen.queryByText('Bard')).not.toBeInTheDocument();
  });

  it('filters the library by search text', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Fireball')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search base abilities'), { target: { value: 'frost' } });
    expect(screen.queryByText('Fireball')).not.toBeInTheDocument();
    expect(screen.getByText('Frost Bolt')).toBeInTheDocument();
  });

  it('edits only the base ability row — never a class assignment', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Fireball')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Fireball'));
    await waitFor(() => expect(screen.getByText('Save ability')).toBeInTheDocument());
    ops.length = 0;
    fireEvent.click(screen.getByText('Save ability'));
    await waitFor(() => expect(ops.some(o => o.table === 'abilities' && o.op === 'update')).toBe(true));
    expect(ops.some(o => o.table === 'class_ability_assignments' && o.op !== 'select')).toBe(false);
  });

  it('no longer renders AssignmentMatrix or class-assignment controls', () => {
    expect(SOURCE).not.toMatch(/AssignmentMatrix/);
    expect(existsSync('src/components/admin/ability/AssignmentMatrix.tsx')).toBe(false);
    // Slot / default / unlock-level assignment state is never AUTHORED here —
    // it may only be read for the read-only class-variant column.
    expect(SOURCE).not.toMatch(/is_default:\s*(true|false)/);
    expect(SOURCE).not.toMatch(/setDraft\([^)]*unlock_level/);

    // The page never inserts or updates assignments.
    expect(SOURCE).not.toMatch(/from\('class_ability_assignments'\)\s*\n?\s*\.(insert|update|delete)/);
  });

  it('immutable identity: ability_key is never written by this page', () => {
    expect(SOURCE).not.toMatch(/ability_key: draft\.ability_key/);
  });
});

describe('Base ability creation', () => {
  beforeEach(() => { ops.length = 0; });

  it('creates only an abilities row — never an assignment', async () => {
    const { default: BaseAbilityCreateDialog } = await import('../ability/BaseAbilityCreateDialog');
    const onCreated = vi.fn();
    render(<BaseAbilityCreateDialog open onOpenChange={() => {}} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Ember Lash' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A lash of embers.' } });

    await waitFor(() => expect(screen.getByText('Create base ability')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Create base ability'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ab-new'));
    const inserts = ops.filter(o => o.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('abilities');
    expect((inserts[0].payload as any).status).toBe('draft');
    expect(ops.some(o => o.table === 'class_ability_assignments')).toBe(false);
  });
});
