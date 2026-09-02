import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combat2TelegraphIndicator } from './Combat2TelegraphIndicator';
import type { Combat2PresentationTelegraph } from './presentation';

function telegraph(overrides: Partial<Combat2PresentationTelegraph> = {}): Combat2PresentationTelegraph {
  return {
    id: 'telegraph-1', encounterId: 'encounter-1', nodeCreatureId: 'node-creature-1',
    creatureId: 'creature-1', spawnSeq: 3, creatureName: 'Granite Sentinel',
    abilityKey: 'granite_slam', abilityLabel: 'Granite Slam', startedAtTick: 10, resolveAtTick: 12,
    targetFighterId: 'fighter-1', targetCharacterId: 'character-1', targetEntrySeq: 4,
    targetIsCurrentCharacter: true, ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Combat2TelegraphIndicator', () => {
  it('uses the captured label, shows only an authorized current-character target, and falls back to ability key', () => {
    const view = render(<Combat2TelegraphIndicator telegraph={telegraph()} encounterTick={10} />);
    expect(screen.getByLabelText(/Granite Slam: Gathering/)).toHaveTextContent('Target: You');
    view.rerender(<Combat2TelegraphIndicator telegraph={telegraph({
      id: 'telegraph-2', abilityLabel: null, abilityKey: 'falling_star', targetIsCurrentCharacter: false,
    })} encounterTick={10} />);
    expect(screen.getByLabelText(/Falling Star: Gathering/)).not.toHaveTextContent('Target:');
    expect(view.container.querySelectorAll('[data-combat2-telegraph-id]')).toHaveLength(1);
  });

  it('reaches awaiting resolution without removing the cast or performing combat work', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'));
    const view = render(<Combat2TelegraphIndicator telegraph={telegraph()} encounterTick={10} />);
    expect(screen.getByText(/Gathering · 4s/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4500));
    expect(screen.getByText(/Awaiting resolution/)).toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-combat2-telegraph-id="telegraph-1"]')).toHaveLength(1);
  });

  it('keeps only one live visual timer under Strict Mode and cleans it on unmount', () => {
    vi.useFakeTimers();
    const view = render(
      <StrictMode><Combat2TelegraphIndicator telegraph={telegraph()} encounterTick={10} /></StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.rerender(
      <StrictMode><Combat2TelegraphIndicator telegraph={telegraph()} encounterTick={10} /></StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts in awaiting-resolution state when authoritative tick is already due', () => {
    vi.useFakeTimers();
    render(<Combat2TelegraphIndicator telegraph={telegraph()} encounterTick={12} />);
    expect(screen.getByText(/Awaiting resolution/)).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
