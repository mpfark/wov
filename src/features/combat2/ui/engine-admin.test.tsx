import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EngineAdminWorkspace from './EngineAdminWorkspace';

vi.mock('@/components/admin/Combat2TestArenaPanel', () => ({ default: () => <div data-testid="arena" /> }));
vi.mock('@/components/admin/AbilityConfigManager', () => ({ default: () => <div data-testid="abilities" /> }));
vi.mock('@/components/admin/StatusManager', () => ({ default: () => <div data-testid="statuses" /> }));
vi.mock('@/components/admin/ClassConfigManager', () => ({ default: () => <div data-testid="classes" /> }));

describe('engine admin workspace navigation', () => {
  it('opens each existing authoring entry point without mounting arena controls', () => {
    for (const initialTab of ['abilities', 'statuses', 'classes'] as const) {
      render(<EngineAdminWorkspace initialTab={initialTab} />);
      expect(screen.queryByTestId(initialTab)).not.toBeNull();
      expect(screen.queryByTestId('arena')).toBeNull();
      cleanup();
    }
  });
  it('mounts only the selected existing tool rather than competing background controllers', () => {
    render(<EngineAdminWorkspace />);
    expect(screen.queryByTestId('arena')).not.toBeNull();
    expect(screen.queryByTestId('abilities')).toBeNull();
    for (const [name, id] of [['Abilities', 'abilities'], ['Statuses', 'statuses'], ['Classes', 'classes'], ['Test Arena', 'arena']]) {
      fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
      expect(screen.queryByTestId(id)).not.toBeNull();
      for (const other of ['arena', 'abilities', 'statuses', 'classes'].filter(x => x !== id)) {
        expect(screen.queryByTestId(other)).toBeNull();
      }
    }
  });
});