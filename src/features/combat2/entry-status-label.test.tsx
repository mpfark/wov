import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Combat2TestStatus } from './Combat2TestStatus';
import { selectCombat2EntryStatusLabel, selectCombat2SessionLocked, selectCombat2StatusPresentation } from './presentation-selectors';

const statusInput = {
  rolloutEnabled: true, access: 'allowed', preflight: 'allowed', ownershipLocked: false,
  dead: false, testArenaDeath: false, sessionStatus: 'idle', pendingFlee: false,
  entryStatus: 'idle', entryClassification: null, presentationStatus: 'idle',
  actionsReady: false, ownsActiveCombat: false, hasModel: false, historical: false,
} as const;

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
    const presentation = selectCombat2StatusPresentation(statusInput);
    render(<Combat2TestStatus presentation={presentation} />);
    expect(screen.getByRole('status')).toHaveTextContent('Combat2: Peaceful — no active encounter');
    expect(screen.getByRole('status')).toHaveTextContent('Movement is available');
    expect(screen.getByRole('status')).not.toHaveTextContent('unavailable while the session is locked');
  });

  it('still warns while entry is genuinely in flight', () => {
    const presentation = selectCombat2StatusPresentation({ ...statusInput, entryStatus: 'entering' });
    render(<Combat2TestStatus presentation={presentation} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the authoritative combat state');
  });

  it.each([
    [{ presentationStatus: 'reconnecting', hasModel: true }, 'Reconnecting', 'fresh authoritative snapshot'],
    [{ presentationStatus: 'gap', hasModel: true }, 'Combat state out of sync', 'fresh authoritative snapshot'],
    [{ presentationStatus: 'error' }, 'Combat state unavailable', 'temporarily out of sync'],
    [{ access: 'refused' }, 'Combat access refused', 'not authorized'],
    [{ actionsReady: true, ownsActiveCombat: true, sessionStatus: 'active', entryStatus: 'entered', presentationStatus: 'live', hasModel: true }, 'Active combat', 'Combat actions are ready'],
  ] as const)('presents authoritative state %o distinctly', (overrides, label, guidance) => {
    const presentation = selectCombat2StatusPresentation({ ...statusInput, ...overrides });
    expect(presentation.label).toBe(label);
    expect(presentation.guidance).toContain(guidance);
  });
});
