import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardMovement } from './useKeyboardMovement';
import type { GameNode } from '@/features/world';

const node = (id: string, destination: string): GameNode => ({
  id,
  name: id,
  connections: [{ node_id: destination, direction: 'E', hidden: false }],
} as GameNode);

describe('useKeyboardMovement authoritative routing', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('submits the initial valid press synchronously without a fixed timer', () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    renderHook(() => useKeyboardMovement({
      currentNode: node('a', 'b'), nodes: [], onMove, disabled: false,
    }));

    fireEvent.keyDown(document, { key: 'd', repeat: false });

    expect(onMove).toHaveBeenCalledExactlyOnceWith('b', 'E');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the latest acknowledged origin and ignores native held-key repeats', () => {
    const onMove = vi.fn();
    const { rerender } = renderHook(({ currentNode, disabled }) => useKeyboardMovement({
      currentNode, nodes: [], onMove, disabled,
    }), { initialProps: { currentNode: node('a', 'b'), disabled: false } });

    fireEvent.keyDown(document, { key: 'd', repeat: false });
    rerender({ currentNode: node('b', 'c'), disabled: false });
    fireEvent.keyDown(document, { key: 'd', repeat: true });
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(document, { key: 'd' });
    fireEvent.keyDown(document, { key: 'd', repeat: false });
    expect(onMove).toHaveBeenNthCalledWith(2, 'c', 'E');

    rerender({ currentNode: node('c', 'd'), disabled: true });
    fireEvent.keyDown(document, { key: 'd', repeat: false });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('does not move while typing or while a dialog owns keyboard focus', () => {
    const onMove = vi.fn();
    renderHook(() => useKeyboardMovement({
      currentNode: node('a', 'b'), nodes: [], onMove, disabled: false,
    }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'd', repeat: false });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(document, { key: 'd', repeat: false });

    expect(onMove).not.toHaveBeenCalled();
    input.remove();
    dialog.remove();
  });
});
