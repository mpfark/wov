import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { combat2AbilityControlDisabled, combat2DeliveryPreservesPending, deriveCombat2ActionReadiness } from './action-readiness';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const model = { encounterStatus: 'active', fighterExitState: null } as const;
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

function AbilityButton({ ready, onAction }: { ready: boolean; onAction(): void }) {
  return <Button disabled={!ready} className={ready ? 'ability-ready' : 'ability-blocked'} onClick={onAction}>Ability</Button>;
}

describe('Combat2 action readiness', () => {
  it('keeps the rendered button HTML state and styling stable through healthy syncing', () => {
    const action = vi.fn();
    const view = render(<AbilityButton ready={deriveCombat2ActionReadiness(readyInput)} onAction={action} />);
    const button = screen.getByRole('button', { name: 'Ability' });
    expect(button).toBeEnabled();
    expect(button).toHaveClass('ability-ready');
    const liveClass = button.className;
    view.rerender(<AbilityButton ready={deriveCombat2ActionReadiness({ ...readyInput, presentationStatus: 'syncing' })} onAction={action} />);
    expect(button).toBeEnabled();
    expect(button.className).toBe(liveClass);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    view.rerender(<AbilityButton ready={deriveCombat2ActionReadiness({ ...readyInput, presentationStatus: 'live', model: { ...model, encounterStatus: 'completed' } })} onAction={action} />);
    expect(button).toBeDisabled();
    expect(button).toHaveClass('ability-blocked');
  });

  it('requires an accepted, identity-matched active snapshot and authoritative capacity', () => {
    expect(deriveCombat2ActionReadiness({ ...readyInput, presentationStatus: 'syncing', model: null })).toBe(false);
    expect(deriveCombat2ActionReadiness({ ...readyInput, encounterId: null })).toBe(false);
    expect(deriveCombat2ActionReadiness({ ...readyInput, fighter: { ...fighter, characterId: 'other' } })).toBe(false);
    expect(deriveCombat2ActionReadiness({ ...readyInput, fighter: { ...fighter, present: false } })).toBe(false);
    expect(deriveCombat2ActionReadiness({ ...readyInput, dead: true })).toBe(false);
    expect(deriveCombat2ActionReadiness({ ...readyInput, pendingFlee: true })).toBe(false);
    expect(deriveCombat2ActionReadiness({ ...readyInput, inputLocked: true })).toBe(false);
  });

  it.each(['gap', 'error', 'refused', 'reconnecting', 'idle'])(
    'fails closed for unsafe delivery status %s', presentationStatus => {
      expect(deriveCombat2ActionReadiness({ ...readyInput, presentationStatus })).toBe(false);
      expect(combat2DeliveryPreservesPending(presentationStatus)).toBe(false);
    },
  );

  it('preserves pending request fencing only for live and healthy syncing', () => {
    expect(combat2DeliveryPreservesPending('live')).toBe(true);
    expect(combat2DeliveryPreservesPending('syncing')).toBe(true);
  });

  it('keeps CP, incapacity and target validity as independent button gates', () => {
    const base = { actionsReady: true, levelLocked: false, insufficientCp: false, dead: false, invalidTarget: false };
    expect(combat2AbilityControlDisabled(base)).toBe(false);
    expect(combat2AbilityControlDisabled({ ...base, insufficientCp: true })).toBe(true);
    expect(combat2AbilityControlDisabled({ ...base, dead: true })).toBe(true);
    expect(combat2AbilityControlDisabled({ ...base, invalidTarget: true })).toBe(true);
    expect(combat2AbilityControlDisabled({ ...base, levelLocked: true })).toBe(true);
  });
});
