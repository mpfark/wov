/**
 * Ability Library workflow tests — the page is a THREE-COLUMN hierarchy.
 *
 * Column 1 lists reusable `base_abilities`. Column 2 lists the authored
 * `abilities` built on the selected base (filtered by `base_ability_id`).
 * Column 3 configures either the base or the selected authored ability.
 *
 * Guards the ownership model: the page never writes `class_ability_assignments`,
 * never groups by class, and only offers the on-hit editor when the base
 * declares that capability.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/** Every table operation the component performs, in order. */
const ops = vi.hoisted(() => [] as { table: string; op: string; payload?: unknown }[]);

const BASE_ROWS = vi.hoisted(() => [
  {
    id: 'base-spell', base_key: 'spell_attack', label: 'Spell Attack',
    description: 'Cast a damaging spell.', mechanic_key: 'spell_attack',
    activation_mode: 'queued', default_target_type: 'enemy',
    allowed_target_types: ['enemy'], trigger_type: 'none',
    capabilities: ['identity', 'activation', 'damage', 'damage_type', 'combat_text', 'on_hit_effect'],
    on_hit_allowed: ['ignite'], status: 'active', admin_notes: null,
  },
  {
    id: 'base-heal', base_key: 'heal', label: 'Heal',
    description: 'Restore health.', mechanic_key: 'heal',
    activation_mode: 'queued', default_target_type: 'ally',
    allowed_target_types: ['ally', 'self'], trigger_type: 'none',
    capabilities: ['identity', 'activation', 'amount'],
    on_hit_allowed: [], status: 'active', admin_notes: null,
  },
  {
    id: 'base-orb', base_key: 'orb_stance', label: 'Orb Stance',
    description: 'Orbs attack on their own.', mechanic_key: 'stack_apply',
    activation_mode: 'stance', default_target_type: 'self',
    allowed_target_types: ['self'], trigger_type: 'pulse',
    capabilities: ['identity', 'stance', 'applied_status'],
    on_hit_allowed: ['ignite'], status: 'active', admin_notes: null,
  },
]);

const ABILITY_ROWS = vi.hoisted(() => [
  {
    id: 'ab-fireball', base_ability_id: 'base-spell', ability_key: 'fireball',
    label: 'Fireball', description: 'Hurl fire.', tooltip: 'Fire damage.', cp_cost: 10,
    mechanic_key: 'spell_attack', status: 'active', interval_ms: null,
    damage_type: 'fire', ability_type: 'damage', activation_mode: 'queued',
    target_type: 'enemy', admin_notes: null, amount_calc: null,
    duration_calc: null, mechanic_calcs: {}, combat_text: {},
    effect_config: { on_hit_allowed: ['ignite'] },
  },
  {
    id: 'ab-smite', base_ability_id: 'base-spell', ability_key: 'smite',
    label: 'Smite', description: 'Holy bolt.', tooltip: 'Holy damage.', cp_cost: 10,
    mechanic_key: 'spell_attack', status: 'active', interval_ms: null,
    damage_type: 'holy', ability_type: 'damage', activation_mode: 'queued',
    target_type: 'enemy', admin_notes: null, amount_calc: null,
    duration_calc: null, mechanic_calcs: {}, combat_text: {},
    effect_config: { on_hit_allowed: ['ignite'] },
  },
  {
    id: 'ab-orbs', base_ability_id: 'base-orb', ability_key: 'ignite',
    label: 'Orbs of Fire', description: 'Orbs circle the caster.', tooltip: 'Applies Ignite.',
    cp_cost: 12, mechanic_key: 'stack_apply', status: 'active', interval_ms: 3000,
    damage_type: 'fire', ability_type: 'buff', activation_mode: 'stance',
    target_type: 'self', admin_notes: null, amount_calc: null,
    duration_calc: null, mechanic_calcs: {}, combat_text: {},
    effect_config: { on_hit_allowed: ['ignite'] },
  },
]);

/** Fireball is deliberately assigned to TWO classes — it must still list once. */
const ASSIGNMENT_ROWS = vi.hoisted(() => [
  { ability_id: 'ab-fireball', class_key: 'wizard', is_default: true, status: 'active', unlock_level: 1, class_ability_key: 'fireball', overrides: { label: 'Fireball' }, role: { slot: 0, name: 'Signature' } },
  { ability_id: 'ab-fireball', class_key: 'bard', is_default: false, status: 'active', unlock_level: 15, class_ability_key: 'cutting_words', overrides: { label: 'Cutting Words' }, role: { slot: 3, name: 'Pressure' } },
  { ability_id: 'ab-smite', class_key: 'templar', is_default: true, status: 'active', unlock_level: 1, class_ability_key: 'smite', overrides: {}, role: { slot: 0, name: 'Signature' } },
]);

vi.mock('@/integrations/supabase/client', () => {
  function resultFor(table: string) {
    if (table === 'base_abilities') return { data: BASE_ROWS, error: null };
    if (table === 'abilities') return { data: ABILITY_ROWS, error: null };
    return { data: ASSIGNMENT_ROWS, error: null };
  }

  function builder(table: string) {
    const result = resultFor(table);
    const chain: any = {
      select: () => { ops.push({ table, op: 'select' }); return chain; },
      order: () => Promise.resolve(result),
      eq: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: { id: 'new-row' }, error: null }),
      insert: (payload: unknown) => { ops.push({ table, op: 'insert', payload }); return chain; },
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

describe('Ability Library — three-column hierarchy', () => {
  beforeEach(() => { ops.length = 0; });

  it('lists base abilities in the first column', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    const column = screen.getByTestId('base-ability-column');
    expect(column.textContent).toContain('Heal');
    expect(column.textContent).toContain('Orb Stance');
    expect(ops.some(o => o.table === 'base_abilities' && o.op === 'select')).toBe(true);
  });

  it('keeps the ability column empty until a base is selected', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    expect(screen.getByText('Pick a base ability to see its class versions.')).toBeInTheDocument();
    expect(screen.getByTestId('class-variant-column').textContent).not.toContain('Fireball');
  });

  it('filters authored abilities to the selected base ability', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spell Attack'));

    const column = await waitFor(() => screen.getByTestId('class-variant-column'));
    expect(column.textContent).toContain('Fireball');
    expect(column.textContent).toContain('Smite');
    // An ability on a DIFFERENT base must not leak in.
    expect(column.textContent).not.toContain('Orbs of Fire');
  });

  it('shows an authored ability exactly once even when several classes assign it', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spell Attack'));
    await waitFor(() => expect(screen.getAllByText('Fireball')).toHaveLength(1));
  });

  it('reports when the selected base has no authored abilities', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Heal')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Heal'));
    const column = await waitFor(() => screen.getByTestId('class-variant-column'));
    expect(column.textContent).toContain('No ability uses this base yet');
  });

  it('filters the ability column by search text', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spell Attack'));
    fireEvent.change(await screen.findByLabelText('Search abilities'), { target: { value: 'smi' } });
    const column = screen.getByTestId('class-variant-column');
    expect(column.textContent).not.toContain('Fireball');
    expect(column.textContent).toContain('Smite');
  });

  it('configures the base ability when only a base is selected', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spell Attack'));
    await waitFor(() => expect(screen.getByTestId('base-ability-editor')).toBeInTheDocument());

    ops.length = 0;
    fireEvent.click(screen.getByText('Save base ability'));
    await waitFor(() => expect(ops.some(o => o.table === 'base_abilities' && o.op === 'update')).toBe(true));
    expect(ops.some(o => o.table === 'abilities' && o.op === 'update')).toBe(false);
  });

  it('edits only the authored ability row — never a class assignment', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spell Attack'));
    fireEvent.click(await screen.findByText('Fireball'));
    await waitFor(() => expect(screen.getByText('Save ability')).toBeInTheDocument());

    ops.length = 0;
    fireEvent.click(screen.getByText('Save ability'));
    await waitFor(() => expect(ops.some(o => o.table === 'abilities' && o.op === 'update')).toBe(true));
    expect(ops.some(o => o.table === 'class_ability_assignments' && o.op !== 'select')).toBe(false);
  });

  it('saves the optional on-hit effect into the ability effect_config', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spell Attack'));
    fireEvent.click(await screen.findByText('Fireball'));
    await waitFor(() => expect(screen.getByTestId('on-hit-effect-card')).toBeInTheDocument());

    ops.length = 0;
    fireEvent.click(screen.getByText('Save ability'));
    await waitFor(() => expect(ops.some(o => o.table === 'abilities' && o.op === 'update')).toBe(true));
    const update = ops.find(o => o.table === 'abilities' && o.op === 'update')!;
    expect((update.payload as any).effect_config).toBeTruthy();
  });

  it('hides the on-hit editor when the base does not declare the capability', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Orb Stance')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Orb Stance'));
    fireEvent.click(await screen.findByText('Orbs of Fire'));
    await waitFor(() => expect(screen.getByText('Save ability')).toBeInTheDocument());
    expect(screen.queryByTestId('on-hit-effect-card')).not.toBeInTheDocument();
  });

  it('does not group the library by class', async () => {
    render(<AbilityConfigManager />);
    await waitFor(() => expect(screen.getByText('Spell Attack')).toBeInTheDocument());
    expect(screen.queryByText('Wizard')).not.toBeInTheDocument();
    expect(screen.queryByText('Bard')).not.toBeInTheDocument();
  });

  it('never authors assignment state or mutable identity here', () => {
    expect(SOURCE).not.toMatch(/AssignmentMatrix/);
    expect(existsSync('src/components/admin/ability/AssignmentMatrix.tsx')).toBe(false);
    expect(SOURCE).not.toMatch(/is_default:\s*(true|false)/);
    expect(SOURCE).not.toMatch(/setDraft\([^)]*unlock_level/);
    expect(SOURCE).not.toMatch(/from\('class_ability_assignments'\)\s*\n?\s*\.(insert|update|delete)/);
    // ability_key and mechanic_key are base/identity owned — never written here.
    expect(SOURCE).not.toMatch(/ability_key: draft\.ability_key/);
    // The update payload must not carry mechanic_key (base-owned).
    const updateBlock = SOURCE.slice(SOURCE.indexOf(".from('abilities').update("));
    expect(updateBlock.slice(0, updateBlock.indexOf('}).eq('))).not.toMatch(/mechanic_key/);
  });
});

describe('Base ability creation', () => {
  beforeEach(() => { ops.length = 0; });

  it('creates a base_abilities row only', async () => {
    const { default: BaseAbilityCreateDialog } = await import('../ability/BaseAbilityCreateDialog');
    const onCreated = vi.fn();
    render(<BaseAbilityCreateDialog open onOpenChange={() => {}} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Ember Lash' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A lash of embers.' } });

    await waitFor(() => expect(screen.getByText('Create base ability')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Create base ability'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-row'));
    const inserts = ops.filter(o => o.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('base_abilities');
    expect((inserts[0].payload as any).status).toBe('draft');
    expect(ops.some(o => o.table === 'class_ability_assignments')).toBe(false);
  });
});

describe('Class ability creation', () => {
  beforeEach(() => { ops.length = 0; });

  it('always stamps base_ability_id and inherits the base mechanic', async () => {
    const { default: ClassAbilityCreateDialog } = await import('../ability/ClassAbilityCreateDialog');
    const onCreated = vi.fn();
    render(
      <ClassAbilityCreateDialog
        open
        onOpenChange={() => {}}
        base={BASE_ROWS[0] as never}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Frost Bolt' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Hurl frost.' } });

    await waitFor(() => expect(screen.getByText('Create ability')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Create ability'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-row'));
    const insert = ops.find(o => o.op === 'insert')!;
    expect(insert.table).toBe('abilities');
    expect((insert.payload as any).base_ability_id).toBe('base-spell');
    expect((insert.payload as any).mechanic_key).toBe('spell_attack');
    expect((insert.payload as any).status).toBe('draft');
    expect(ops.some(o => o.table === 'class_ability_assignments')).toBe(false);
  });
});
