import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combat2EffectPills } from './Combat2EffectPills';
import type { Combat2PresentationEffect } from './presentation';

function effect(overrides: Partial<Combat2PresentationEffect> = {}): Combat2PresentationEffect {
  return {
    id: 'effect-1', kind: 'unknown_future_kind', effectType: null, abilityKey: null,
    sourceCharacterId: null, sourceCreatureId: 'creature-source', targetCharacterId: 'character-target', targetCreatureId: null,
    magnitude: null, stacks: null, expiresAt: null, nextDueAt: null, intervalMs: null,
    lastPulseTick: null, isReservation: false, category: 'unknown', ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Combat2EffectPills', () => {
  it('renders unknown authoritative effects generically and accessibly', () => {
    render(<Combat2EffectPills effects={[effect()]} />);
    expect(screen.getByLabelText('Unknown Future Kind')).toHaveTextContent('Unknown Future Kind');
  });

  it('updates remaining-time text without removing or mutating an expired effect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    const view = render(<Combat2EffectPills effects={[effect({
      abilityKey: 'rend', category: 'harmful', stacks: 2, magnitude: 4,
      expiresAt: '2026-09-01T00:00:01Z',
    })]} />);
    expect(screen.getByText(/Rend ×2 · 1s/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText(/Rend ×2 · 0s/)).toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-combat2-effect-id="effect-1"]')).toHaveLength(1);
  });
});
