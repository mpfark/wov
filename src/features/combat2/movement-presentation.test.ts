import { describe, expect, it } from 'vitest';
import { movementIssueMessage, presentCombat2Departure } from './movement-presentation';

describe('Combat2 movement presentation', () => {
  it.each([
    ['local_refusal', 'exit_pending', 'Movement is being finalized'],
    ['refused', 'request_pending', 'previous movement request'],
    ['refused', 'special_transition_conflict', 'Another transition'],
    ['refused', 'not_authorized', 'not authorized'],
    ['refused', 'stale_origin', 'reconnecting'],
    ['error', 'transport_error', 'could not reach the server'],
  ] as const)('preserves %s/%s guidance', (status, classification, expected) => {
    expect(movementIssueMessage(status, classification)).toContain(expected);
  });

  it('does not mislabel a death during movement as a refusal', () => {
    expect(presentCombat2Departure({
      status: 'dead', classification: 'dead', originNodeId: 'origin',
      destinationNodeId: 'destination', cost: 0,
    }, 'North Road')).toEqual({
      kind: 'error', message: 'You fall before the movement can be completed.',
    });
  });
});