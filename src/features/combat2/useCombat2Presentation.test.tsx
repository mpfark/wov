import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Combat2DeliverySessionState } from './useCombat2DeliverySession';
import { useCombat2Presentation } from './useCombat2Presentation';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const KEY = `${CHARACTER}:node:${ENCOUNTER}`;

function state(hp: number, encounterId = ENCOUNTER, withTelegraph = false): Combat2DeliverySessionState {
  return {
    status: 'live', error: null, lastAppliedTick: 0, batches: [],
    snapshot: {
      ok: true, kind: 'sync', latest_tick: 0, returned_through_tick: 0, has_more: false,
      encounter: { id: encounterId, status: 'active', tick: 0, stateVersion: 0 },
      character: { id: CHARACTER, hp, maxHp: 10, cp: 5, maxCp: 10, mp: 7, maxMp: 10, level: 2, xp: 20, gold: 4 },
      fighter: withTelegraph ? { id: 'fighter-1', characterId: CHARACTER, entrySeq: 3, present: true } : null,
      creatures: withTelegraph ? [{
        id: 'node-creature-1', creatureId: 'creature-1', spawnSeq: 2, name: 'Sentinel',
        hp: 10, maxHp: 10, isAlive: true, engaged: true, tankFighterId: 'fighter-1',
        pendingAction: {
          abilityKey: 'granite_slam', abilityLabel: 'Granite Slam', startedAtTick: 0, resolveAtTick: 2,
          targetFighterId: 'fighter-1', targetCharacterId: CHARACTER, targetEntrySeq: 3,
        },
      }] : [], effects: [], rewardClaims: [], batches: [],
    },
  };
}

describe('useCombat2Presentation session retention', () => {
  it('retains the last valid model on malformed input and rejects old-session identity', () => {
    const { result, rerender } = renderHook(({ key, delivery }) => useCombat2Presentation(key, delivery), {
      initialProps: { key: KEY as string | null, delivery: state(8) },
    });
    expect(result.current.model?.character.hp).toBe(8);
    rerender({ key: KEY, delivery: { ...state(3), snapshot: { ...state(3).snapshot!, character: {} } } });
    expect(result.current).toMatchObject({ status: 'error', model: { character: { hp: 8 } } });
    rerender({ key: KEY, delivery: state(2, 'dddddddd-0000-4000-8000-000000000001') });
    expect(result.current.model?.character.hp).toBe(8);
  });

  it('starts a fresh model for a new session and does not inherit old creatures or cursor', () => {
    const { result, rerender } = renderHook(({ key, delivery }) => useCombat2Presentation(key, delivery), {
      initialProps: { key: KEY as string | null, delivery: state(8, ENCOUNTER, true) },
    });
    expect(result.current.model?.telegraphs).toHaveLength(1);
    rerender({ key: `${CHARACTER}:new-node:dddddddd-0000-4000-8000-000000000001`, delivery: { status: 'syncing', error: null, snapshot: null, batches: [], lastAppliedTick: 0 } });
    expect(result.current.model).toBeNull();
    expect(result.current.status).toBe('syncing');
  });
});
