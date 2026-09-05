import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClassAbility } from '@/features/combat/utils/class-abilities';
import { resolveCombat2ManualAttackTarget, resolveCombat2Target, targetIdentity, type Combat2TargetRoster } from './target-resolution';
import { useCombat2Targets } from './useCombat2Targets';
import { routeCombat2Action, routeCombat2BasicAttack } from './routeCombat2Action';
import { useCombat2IntentSession } from './useCombat2IntentSession';
import { Combat2IntentError, type Combat2IntentAdapter } from './intent';

const creature = (id: string, engaged = true) => ({
  id: `spawn-${id}`, creatureId: id, spawnSeq: 1, name: id, hp: 10, maxHp: 10,
  isAlive: true, engaged, tankFighterId: null, isCurrentCharacterTank: false, pendingAction: null,
});
// The target seam consumes only these projected fields; no legacy roster.
const model = (creatures = [creature('one')], encounterId = 'enc'): Combat2TargetRoster =>
  ({ creatures, encounterId });
const ability = { abilityKey: 'power_strike', label: 'Power Strike', targetType: 'enemy' } as ClassAbility;
const accepted = { status: 'accepted' as const, classification: 'queued' as const, intentId: 'intent', seq: 1, intentStatus: null };

describe('authoritative Combat2 target resolution', () => {
  it('explicit living selection wins, including an idle target', () => {
    const roster = model([creature('one'), creature('idle', false)]);
    expect(resolveCombat2Target(roster, targetIdentity('enc', roster.creatures[1])))
      .toEqual({ ok: true, target: targetIdentity('enc', roster.creatures[1]) });
  });

  it('automatically selects only the sole living engaged creature', () => {
    const roster = model([creature('idle', false), creature('one'), { ...creature('dead'), hp: 0, isAlive: false }]);
    expect(resolveCombat2Target(roster, null)).toEqual({ ok: true, target: targetIdentity('enc', roster.creatures[1]) });
    expect(resolveCombat2Target(model([creature('idle', false)]), null)).toMatchObject({ ok: false });
    expect(resolveCombat2Target(model([creature('one'), creature('two')]), null))
      .toMatchObject({ ok: false, reason: expect.stringContaining('multiple') });
    expect(resolveCombat2Target(model([]), null)).toMatchObject({ ok: false });
  });

  it('manual Attack selects only a living idle creature and refuses when all are engaged', () => {
    const idle = creature('idle', false);
    expect(resolveCombat2ManualAttackTarget(model([creature('engaged'), idle]), null))
      .toEqual({ ok: true, target: targetIdentity('enc', idle) });
    expect(resolveCombat2ManualAttackTarget(model([creature('engaged')]), null))
      .toMatchObject({ ok: false, reason: expect.stringContaining('automatically') });
    expect(resolveCombat2ManualAttackTarget(model([creature('one', false), creature('two', false)]), null))
      .toMatchObject({ ok: false, reason: expect.stringContaining('Choose') });
  });

  it('keyboard-style manual Attack refuses an already engaged encounter without submission', async () => {
    const submit = vi.fn();
    const diagnose = vi.fn();
    await routeCombat2BasicAttack({ enabled: true, sessionReady: true,
      resolveTarget: () => resolveCombat2ManualAttackTarget(model([creature('engaged')]), null),
      legacy: vi.fn(), submit, diagnose });
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['dead', 'encounter', 'spawn', 'definition', 'row'])('rejects a %s identity, without substituting another target', change => {
    const roster = model();
    const selected = targetIdentity('enc', roster.creatures[0]);
    if (change === 'dead') roster.creatures[0].hp = 0;
    if (change === 'encounter') selected.encounterId = 'foreign';
    if (change === 'spawn') selected.spawnSeq = 0;
    if (change === 'definition') selected.creatureId = 'foreign';
    if (change === 'row') selected.id = 'old-row';
    expect(resolveCombat2Target(roster, selected)).toMatchObject({ ok: false });
  });

  it('reflects fallback in the indicator and clears invalid selection permanently', () => {
    const { result, rerender } = renderHook(({ roster }) => useCombat2Targets(roster), { initialProps: { roster: model() as Combat2TargetRoster | null } });
    expect(result.current.selectedId).toBe('one');
    const staleHandler = result.current.resolve;
    rerender({ roster: model([creature('one'), creature('two')]) });
    expect(staleHandler()).toMatchObject({ ok: false }); // Reads current roster at submission.
    act(() => result.current.select('two'));
    expect(result.current.selectedId).toBe('two');
    rerender({ roster: null });
    expect(result.current.selectedId).toBeNull();
    rerender({ roster: model([creature('one'), creature('two')]) });
    expect(result.current.selectedId).toBeNull();
    act(() => result.current.select('two'));
    rerender({ roster: model([creature('one'), { ...creature('two'), spawnSeq: 2 }]) });
    expect(result.current.selectedId).toBeNull();
    act(() => result.current.select('two'));
    rerender({ roster: model([creature('one'), creature('two')], 'new-enc') });
    expect(result.current.selectedId).toBeNull();
  });

  it('button and hotkey use the same target and indicator without automatic submissions', async () => {
    const submit = vi.fn().mockResolvedValue(accepted);
    const legacy = vi.fn();
    function Controls() {
      const targets = useCombat2Targets(model());
      const useAbility = () => routeCombat2Action({ enabled: true, sessionReady: true, ability,
        resolveTarget: targets.resolve, reservedBuffs: {}, legacy, submit, diagnose: vi.fn() });
      return <div onKeyDown={e => { if (e.key === '1') void useAbility(); }} tabIndex={0} data-testid="hotkey">
        <output>{targets.selectedId}</output><button onClick={() => void useAbility()}>Power Strike</button>
      </div>;
    }
    render(<Controls />);
    expect(screen.getByText('one')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('hotkey'), { key: '1' }); });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls.map(([action]) => action.targetCreatureId)).toEqual(['one', 'one']);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('preserves resolved target and request id on retry despite a changed automatic target', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Combat2IntentError('uncertain', 'timeout')).mockResolvedValue(accepted);
    const adapter: Combat2IntentAdapter = { submit };
    const ids = vi.fn().mockReturnValueOnce('request-1').mockReturnValueOnce('request-2');
    const { result, rerender } = renderHook(({ roster }) => ({
      targets: useCombat2Targets(roster),
      intents: useCombat2IntentSession({ enabled: true, canSubmit: true, characterId: 'character', nodeId: 'node', encounterId: 'enc', adapter, generateRequestId: ids }),
    }), { initialProps: { roster: model() } });
    const actOnce = () => routeCombat2Action({ enabled: true, sessionReady: true, ability,
      resolveTarget: result.current.targets.resolve, reservedBuffs: {}, legacy: vi.fn(), submit: result.current.intents.submit, diagnose: vi.fn() });
    await act(async () => { await actOnce(); });
    rerender({ roster: model([creature('two')]) });
    expect(result.current.targets.selectedId).toBe('two');
    await act(async () => { await result.current.intents.retry(); });
    await act(async () => { await actOnce(); });
    expect(submit.mock.calls.map(call => [call[2].targetCreatureId, call[3]]))
      .toEqual([['one', 'request-1'], ['one', 'request-1'], ['two', 'request-2']]);
  });

  it('self healing does not consult target resolution', async () => {
    const resolveTarget = vi.fn(() => ({ ok: false as const, reason: 'No enemies' }));
    const submit = vi.fn().mockResolvedValue(accepted);
    await routeCombat2Action({ enabled: true, sessionReady: true,
      ability: { ...ability, abilityKey: 'second_wind', targetType: 'self' }, resolveTarget,
      reservedBuffs: {}, legacy: vi.fn(), submit, diagnose: vi.fn() });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      { kind: 'ability', abilityKey: 'second_wind', stanceKey: null, targetCreatureId: null },
      { message: 'You prepare Power Strike.' },
    );
  });
});
