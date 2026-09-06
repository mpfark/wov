import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import type { Combat2PresentationModel } from './presentation';
import { useCombat2VisibleLog } from './useCombat2VisibleLog';

const CHARACTER = '22222222-2222-4222-8222-222222222222';
const ENCOUNTER = '33333333-3333-4333-8333-333333333333';
const line = (id: string, message: string, ts: number): GameLogEvent => ({ v: 1, id, ts, type: 'ability', message });
const model = (status: string, events: readonly GameLogEvent[]): Combat2PresentationModel => ({
  encounterId: ENCOUNTER, encounterTick: 1, stateVersion: 1, encounterStatus: status, fighterExitState: null,
  autoattack: null, character: { id: CHARACTER, level: 1, xp: 0, gold: 0, hp: 10, maxHp: 10, cp: 10, maxCp: 10, mp: 10, maxMp: 10 },
  creatures: [], effects: [], characterEffects: [], creatureEffects: {}, telegraphs: [], telegraphsByCreatureLife: {},
  rewardClaims: [], events, lastAppliedTick: 1,
});

describe('useCombat2VisibleLog', () => {
  it('keeps accepted local evidence before a quickly arriving resolution', () => {
    const ack = line('ack', 'You prepare Power Strike.', 10);
    const resolved = line('resolved', 'You strike with Power Strike.', 11);
    const { result, rerender } = renderHook(({ current, local }) => useCombat2VisibleLog(CHARACTER, true, current, local), {
      initialProps: { current: model('active', []), local: [ack] },
    });
    expect(result.current.events.map(event => event.message)).toEqual(['You prepare Power Strike.']);
    rerender({ current: model('active', [resolved]), local: [ack] });
    expect(result.current.events.map(event => event.message)).toEqual(['You prepare Power Strike.', 'You strike with Power Strike.']);
  });

  it.each(['Stop test run and preserve evidence', 'Close test environment safely'])(
    '%s retains the last ordered log as historical and accepts no detached updates', (_operation) => {
      const received = [line('one', 'First.', 1), line('two', 'Second.', 2)];
      const { result, rerender } = renderHook(({ current, local }) => useCombat2VisibleLog(CHARACTER, true, current, local), {
        initialProps: { current: model('active', received) as Combat2PresentationModel | null, local: [] as GameLogEvent[] },
      });
      rerender({ current: model('stopped', received), local: [] });
      expect(result.current).toMatchObject({ historical: true, events: received });
      rerender({ current: null, local: [line('late', 'Late.', 3)] });
      expect(result.current.events.map(event => event.message)).toEqual(['First.', 'Second.']);
    },
  );

  it('clears retained history outside the arena and never crosses characters', () => {
    const received = [line('one', 'First.', 1)];
    const { result, rerender } = renderHook(({ character, reserved, current }) => useCombat2VisibleLog(character, reserved, current, []), {
      initialProps: { character: CHARACTER, reserved: true, current: model('active', received) as Combat2PresentationModel | null },
    });
    rerender({ character: CHARACTER, reserved: false, current: null });
    expect(result.current).toEqual({ events: [], historical: false });
    rerender({ character: '99999999-9999-4999-8999-999999999999', reserved: true, current: null });
    expect(result.current).toEqual({ events: [], historical: false });
  });
});
