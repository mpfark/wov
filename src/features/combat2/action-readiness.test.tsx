import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  combat2DeliveryPreservesPending,
  deriveCombat2AbilityReadiness,
  deriveCombat2ActionReadiness,
  type ActionReadiness,
} from './action-readiness';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const model = { encounterStatus: 'active', fighterExitState: null, fighterPresent: true } as const;
const fighter = { id: 'fighter', characterId: CHARACTER, present: true, entrySeq: 1 };
const readyInput = {
  inputLocked: false,
  encounterId: ENCOUNTER,
  presentationStatus: 'live',
  model,
  dead: false,
  pendingFlee: false,
  fighter,
  characterId: CHARACTER,
};

function AbilityButton({ readiness, onAction }: { readiness: ActionReadiness; onAction(): void }) {
  return <Button disabled={!readiness.ready} className={readiness.ready ? 'ability-ready' : 'ability-blocked'}
    title={'message' in readiness ? readiness.message : undefined} onClick={onAction}>Ability</Button>;
}

const abilityReadyInput = {
  session: { ready: true } as const,
  levelLocked: false,
  levelRequired: 1,
  inFlight: false,
  targetValid: true,
  stanceActive: false,
  requiredCp: 10,
  availableCp: 10,
};

describe('Combat2 action readiness', () => {
  it('keeps the rendered button HTML state and styling stable through healthy syncing', () => {
    const action = vi.fn();
    const view = render(<AbilityButton readiness={deriveCombat2ActionReadiness(readyInput)} onAction={action} />);
    const button = screen.getByRole('button', { name: 'Ability' });
    expect(button).toBeEnabled();
    expect(button).toHaveClass('ability-ready');
    const liveClass = button.className;
    view.rerender(<AbilityButton readiness={deriveCombat2ActionReadiness({ ...readyInput, presentationStatus: 'syncing' })} onAction={action} />);
    expect(button).toBeEnabled();
    expect(button.className).toBe(liveClass);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    view.rerender(<AbilityButton readiness={deriveCombat2ActionReadiness({ ...readyInput, presentationStatus: 'live', model: { ...model, encounterStatus: 'completed' } })} onAction={action} />);
    expect(button).toBeDisabled();
    expect(button).toHaveClass('ability-blocked');
  });

  it('requires an accepted, identity-matched active snapshot and authoritative capacity', () => {
    expect(deriveCombat2ActionReadiness({ ...readyInput, presentationStatus: 'syncing', model: null })).toMatchObject({ ready: false, reason: 'no_authoritative_snapshot' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, encounterId: null })).toMatchObject({ ready: false, reason: 'requires_active_combat' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, fighter: { ...fighter, characterId: 'other' } })).toMatchObject({ ready: false, reason: 'requires_active_combat' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, fighter: { ...fighter, present: false } })).toMatchObject({ ready: false, reason: 'requires_active_combat' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, model: { ...model, fighterPresent: false } })).toMatchObject({ ready: false, reason: 'requires_active_combat' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, dead: true })).toMatchObject({ ready: false, reason: 'incapacitated' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, pendingFlee: true })).toMatchObject({ ready: false, reason: 'movement_pending', message: 'Movement is pending' });
    expect(deriveCombat2ActionReadiness({ ...readyInput, inputLocked: true })).toMatchObject({ ready: false, reason: 'requires_active_combat' });
  });

  it.each(['gap', 'error', 'refused', 'reconnecting', 'idle'])(
    'fails closed for unsafe delivery status %s', presentationStatus => {
      expect(deriveCombat2ActionReadiness({ ...readyInput, presentationStatus })).toMatchObject({
        ready: false, reason: 'delivery_unavailable', message: 'Waiting for authoritative state',
      });
      expect(combat2DeliveryPreservesPending(presentationStatus)).toBe(false);
    },
  );

  it('preserves pending request fencing only for live and healthy syncing', () => {
    expect(combat2DeliveryPreservesPending('live')).toBe(true);
    expect(combat2DeliveryPreservesPending('syncing')).toBe(true);
  });

  it('reports spendable CP with required and available values while an active stance remains droppable', () => {
    expect(deriveCombat2AbilityReadiness({ ...abilityReadyInput, requiredCp: 40, availableCp: 27 })).toEqual({
      ready: false, reason: 'insufficient_spendable_cp', message: 'Requires 40 CP — 27 available',
    });
    expect(deriveCombat2AbilityReadiness({ ...abilityReadyInput, stanceActive: true, availableCp: 0 })).toEqual({ ready: true });
  });

  it('reports target, in-flight and active-combat gates with deterministic precedence', () => {
    expect(deriveCombat2AbilityReadiness({ ...abilityReadyInput, targetValid: false })).toMatchObject({
      reason: 'invalid_target', message: 'Select a valid target',
    });
    expect(deriveCombat2AbilityReadiness({ ...abilityReadyInput, inFlight: true })).toMatchObject({
      reason: 'action_in_flight', message: 'Action already queued',
    });
    const outside = { ready: false, reason: 'requires_active_combat', message: 'Requires active combat' } as const;
    expect(deriveCombat2AbilityReadiness({ ...abilityReadyInput, session: outside, inFlight: true,
      targetValid: false, availableCp: 0 })).toEqual(outside);
  });

  it('puts movement and delivery safety ahead of ability-specific gates', () => {
    const movement = deriveCombat2ActionReadiness({ ...readyInput, pendingFlee: true, presentationStatus: 'error' });
    expect(movement).toMatchObject({ reason: 'movement_pending' });
    expect(deriveCombat2AbilityReadiness({ ...abilityReadyInput, session: movement,
      inFlight: true, targetValid: false, availableCp: 0 })).toBe(movement);
  });
});
