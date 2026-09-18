import type { Combat2DepartureResult } from './useCombat2DepartureSession';

export interface MovementPresentation {
  kind: 'movement' | 'system' | 'error';
  message: string;
}

const FINALIZING = new Set(['exit_pending', 'live_claim']);
const PENDING = new Set(['request_pending']);
const TRANSITION_CONFLICT = new Set(['transition_conflict']);
const AUTHORIZATION = new Set(['not_authorized']);
const STALE_SESSION = new Set([
  'no_session', 'stale_origin', 'stale_departure',
]);

/** Maps existing movement outcomes to concise guidance without changing their meaning. */
export function movementIssueMessage(
  status: 'refused' | 'local_refusal' | 'stale' | 'uncertain' | 'error',
  classification?: string | null,
): string {
  if (status === 'stale') return 'The movement response is no longer current. Check your present location.';
  if (status === 'uncertain') return 'A previous movement request is still processing.';
  if (status === 'error') return 'Movement could not reach the server. Try again shortly.';
  if (classification && FINALIZING.has(classification)) return 'Movement is being finalized — try again shortly.';
  if (classification && PENDING.has(classification)) return 'A previous movement request is still processing.';
  if (classification && TRANSITION_CONFLICT.has(classification)) return 'Another transition is being finalized — try again shortly.';
  if (classification && AUTHORIZATION.has(classification)) return 'This character is not authorized to move.';
  if (classification && STALE_SESSION.has(classification)) return 'The combat state is reconnecting.';
  if (classification === 'mode_refused' || classification === 'not_accepting_input') {
    return 'Movement is temporarily unavailable.';
  }
  if (classification === 'no_retry') return 'There is no movement request waiting to be retried.';
  return classification
    ? `Movement was refused (${classification.replaceAll('_', ' ')}).`
    : 'Movement was refused.';
}

export function presentCombat2Departure(
  result: Combat2DepartureResult,
  destinationName: string,
): MovementPresentation | null {
  if (result.status === 'queued') {
    return {
      kind: 'system',
      message: result.members?.length && result.members.length > 1
        ? `Party movement toward ${destinationName} is queued; followers resolve before the leader.`
        : `You attempt to flee toward ${destinationName}.`,
    };
  }
  if (result.status === 'moved') {
    const summary = result.members?.map(member => `${member.displayName}: ${member.status}`).join(', ');
    return { kind: 'movement', message: summary ? `Party movement completed (${summary}).` : `You travel to ${destinationName}.` };
  }
  if (result.status === 'dead') {
    return { kind: 'error', message: 'You fall before the movement can be completed.' };
  }
  return { kind: 'error', message: movementIssueMessage(result.status, result.classification) };
}