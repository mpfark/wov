import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Combat2TestStatus } from './Combat2TestStatus';
import { selectCombat2EntryStatusLabel, selectCombat2SessionLocked } from './presentation-selectors';

describe('Combat2 entry status label', () => {
  it.each([
    ['disabled', 'Idle — no active encounter'],
    ['idle', 'Idle — no active encounter'],
    ['entering', 'Entering'],
    ['entered', 'Synchronizing'],
  ] as const)('reports %s as %s', (status, label) => {
    expect(selectCombat2EntryStatusLabel(status)).toBe(label);
  });

  it('treats an idle or ready session as unlocked and everything else as locked', () => {
    expect(selectCombat2SessionLocked('Idle — no active encounter')).toBe(false);
    expect(selectCombat2SessionLocked('Ready')).toBe(false);
    expect(selectCombat2SessionLocked('Entering')).toBe(true);
    expect(selectCombat2SessionLocked('Refused')).toBe(true);
  });

  it('does not claim the session is locked while idle', () => {
    const status = selectCombat2EntryStatusLabel('idle');
    render(<Combat2TestStatus status={status} stale={false} locked={selectCombat2SessionLocked(status)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Combat2: Idle — no active encounter');
    expect(screen.getByRole('status')).not.toHaveTextContent('unavailable while the session is locked');
  });

  it('still warns while entry is genuinely in flight', () => {
    render(<Combat2TestStatus status="Entering" stale={false} locked />);
    expect(screen.getByRole('status')).toHaveTextContent('unavailable while the session is locked');
  });
});
