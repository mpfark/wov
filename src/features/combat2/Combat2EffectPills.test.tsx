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

  it('presents the authoritative Holy Shield mechanic and reservation as one semantic stance', () => {
    const reservation = effect({
      id: 'holy-reservation', kind: 'reservation', effectType: 'cp_reservation', abilityKey: 'holy_shield',
      sourceCharacterId: 'character-target', sourceCreatureId: null, magnitude: 12,
      isReservation: true, category: 'stance',
    });
    const retaliation = effect({
      id: 'holy-reactive', kind: 'reactive', effectType: 'reactive_damage', abilityKey: 'holy_shield',
      sourceCharacterId: 'character-target', sourceCreatureId: null, magnitude: 7, category: 'stance',
    });
    const view = render(<Combat2EffectPills effects={[reservation, retaliation]} />);

    expect(screen.getAllByText('Holy Shield')).toHaveLength(1);
    expect(screen.getByLabelText('Holy Shield: 12 CP reserved, Reactive magnitude 7')).toBeInTheDocument();
    expect(view.container.querySelector('[data-combat2-effect-id]')).toHaveAttribute(
      'data-combat2-effect-id', 'holy-reservation holy-reactive',
    );
  });

  it('does not collapse same-labelled effects from different authoritative sources', () => {
    render(<Combat2EffectPills effects={[
      effect({ id: 'first', abilityKey: 'shared_guard', sourceCharacterId: 'caster-a', sourceCreatureId: null,
        category: 'beneficial' }),
      effect({ id: 'second', abilityKey: 'shared_guard', sourceCharacterId: 'caster-b', sourceCreatureId: null,
        category: 'beneficial' }),
    ]} />);
    expect(screen.getAllByText('Shared Guard')).toHaveLength(2);
  });

  it('pairs stances by source, target and ability without merging a foreign source', () => {
    render(<Combat2EffectPills effects={[
      effect({ id: 'reserve-a', kind: 'reservation', abilityKey: 'holy_shield',
        sourceCharacterId: 'caster-a', sourceCreatureId: null, magnitude: 12,
        isReservation: true, category: 'stance' }),
      effect({ id: 'reactive-a', kind: 'reactive', abilityKey: 'holy_shield',
        sourceCharacterId: 'caster-a', sourceCreatureId: null, magnitude: 7, category: 'stance' }),
      effect({ id: 'reserve-b', kind: 'reservation', abilityKey: 'holy_shield',
        sourceCharacterId: 'caster-b', sourceCreatureId: null, magnitude: 9,
        isReservation: true, category: 'stance' }),
      effect({ id: 'reactive-b', kind: 'reactive', abilityKey: 'holy_shield',
        sourceCharacterId: 'caster-b', sourceCreatureId: null, magnitude: 4, category: 'stance' }),
    ]} />);
    expect(screen.getAllByText('Holy Shield')).toHaveLength(2);
    expect(screen.getByLabelText('Holy Shield: 12 CP reserved, Reactive magnitude 7')).toBeInTheDocument();
    expect(screen.getByLabelText('Holy Shield: 9 CP reserved, Reactive magnitude 4')).toBeInTheDocument();
  });
});
