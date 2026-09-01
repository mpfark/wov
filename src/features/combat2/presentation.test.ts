import { describe, expect, it } from 'vitest';
import type { Character } from '@/features/character';
import type { Creature } from '@/features/creatures';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import type { Combat2DeliverySessionState } from './useCombat2DeliverySession';
import { buildCombat2Presentation, Combat2PresentationError } from './presentation';
import { selectCombat2Character, selectCombat2Creatures, selectCombat2Events } from './presentation-selectors';
import { decodeCombat2Intent } from './intent';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const CREATURE = 'cccccccc-0000-4000-8000-000000000001';

function effect(overrides: Record<string, unknown> = {}) {
  return {
    id: 'effect-1', kind: 'mitigation', effectType: 'damage_reduction', abilityKey: 'divine_challenge',
    sourceCharacterId: CHARACTER, sourceCreatureId: null, targetCharacterId: CHARACTER, targetCreatureId: null,
    stacks: 1, magnitude: 6, expiresAt: '2026-09-01T00:00:30Z', nextDueAt: null,
    intervalMs: null, lastPulseTick: null, isReservation: false, ...overrides,
  };
}

function delivery(tick = 1): Combat2DeliverySessionState {
  const batches = Array.from({ length: tick }, (_, index) => ({
    id: `batch-${index + 1}`,
    tick: index + 1,
    createdAt: `2026-09-01T00:00:0${index + 1}Z`,
    events: [{ seq: 1, kind: index === 0 ? 'attack' : 'unknown_future_kind', amount: 4 }],
  }));
  return {
    status: 'live', lastAppliedTick: tick, error: null, batches,
    snapshot: {
      ok: true, kind: 'sync', latest_tick: tick, returned_through_tick: tick, has_more: false,
      encounter: { id: ENCOUNTER, status: 'active', tick, stateVersion: tick + 3 },
      character: { id: CHARACTER, hp: 17 - tick, maxHp: 20, cp: 8 - tick, maxCp: 10, mp: 6, maxMp: 10 },
      fighter: { present: true }, effects: [], rewardClaims: [],
      creatures: [{
        id: 'node-creature-1', creatureId: CREATURE, name: 'Wolf', hp: 9 - tick,
        maxHp: 10, isAlive: tick < 2, pendingAction: { abilityKey: 'bite', resolveAtTick: tick + 1 },
      }],
      batches,
    },
  };
}

describe('Combat2 authoritative presentation model', () => {
  it('populates resources, encounter identity, creature state, and pending action from sync only', () => {
    const model = buildCombat2Presentation(delivery());
    expect(model).toMatchObject({
      encounterId: ENCOUNTER, encounterTick: 1, stateVersion: 4, encounterStatus: 'active', lastAppliedTick: 1,
      character: { id: CHARACTER, hp: 16, maxHp: 20, cp: 7, maxCp: 10, mp: 6, maxMp: 10 },
    });
    expect(model.creatures[0]).toMatchObject({ creatureId: CREATURE, hp: 8, maxHp: 10, isAlive: true, pendingAction: { abilityKey: 'bite', resolveAtTick: 2 } });
  });

  it('changes visible resources only when a committed sync snapshot changes', () => {
    const before = buildCombat2Presentation(delivery(1));
    expect(decodeCombat2Intent({ ok: true, kind: 'queued', intent_id: ENCOUNTER, seq: 2 })).toMatchObject({ status: 'accepted' });
    expect(before.character.hp).toBe(16);
    expect(before.character.cp).toBe(7);
    expect(before.creatures[0].hp).toBe(8);
    const after = buildCombat2Presentation(delivery(2));
    expect(after.character).toMatchObject({ hp: 15, cp: 6 });
    expect(after.creatures[0]).toMatchObject({ hp: 7, isAlive: false });
  });

  it('projects authoritative effects by explicit target and classifies known, stance, and unknown rows', () => {
    const state = delivery();
    state.snapshot!.effects = [
      effect(),
      effect({ id: 'reservation', kind: 'reservation', effectType: 'cp_reservation', abilityKey: 'battle_cry', magnitude: 3, isReservation: true }),
      effect({ id: 'stance-effect', kind: 'mitigation', abilityKey: 'battle_cry' }),
      effect({ id: 'dot', kind: 'dot', effectType: 'bleed', abilityKey: 'rend', targetCharacterId: null, targetCreatureId: CREATURE, sourceCharacterId: CHARACTER }),
      effect({ id: 'future', kind: 'future_kind', effectType: null, abilityKey: null, targetCharacterId: null, targetCreatureId: CREATURE }),
    ];
    const model = buildCombat2Presentation(state);
    expect(model.characterEffects.map(({ id, category }) => ({ id, category }))).toEqual([
      { id: 'effect-1', category: 'beneficial' },
      { id: 'reservation', category: 'stance' },
      { id: 'stance-effect', category: 'stance' },
    ]);
    expect(model.creatureEffects[CREATURE].map(({ id, category }) => ({ id, category }))).toEqual([
      { id: 'dot', category: 'harmful' },
      { id: 'future', category: 'unknown' },
    ]);
  });

  it('treats each sync effects array as the authoritative replacement without duplicates or local retention', () => {
    const first = delivery();
    first.snapshot!.effects = [effect()];
    expect(buildCombat2Presentation(first).effects).toHaveLength(1);
    expect(buildCombat2Presentation(first).effects).toHaveLength(1);

    const updated = delivery();
    updated.snapshot!.effects = [effect({ stacks: 2, magnitude: 9 })];
    expect(buildCombat2Presentation(updated).effects[0]).toMatchObject({ id: 'effect-1', stacks: 2, magnitude: 9 });

    const removed = delivery();
    expect(buildCombat2Presentation(removed).effects).toEqual([]);
  });

  it('orders events by tick, gives stable identities, deduplicates at the UI seam, and handles unknown kinds', () => {
    const model = buildCombat2Presentation(delivery(2));
    expect(model.events.map((event) => event.id)).toEqual(['batch-1:1', 'batch-2:1']);
    expect(model.events[1]).toMatchObject({ type: 'unknown', severity: 'notable' });
    expect(selectCombat2Events(true, model, [model.events[0] as GameLogEvent]).map((event) => event.id))
      .toEqual(['batch-1:1', 'batch-2:1']);
  });

  it('rejects duplicate/out-of-order ticks instead of skipping or reapplying them', () => {
    const state = delivery(2);
    state.batches = [state.batches[1], state.batches[0]];
    expect(() => buildCombat2Presentation(state)).not.toThrow();
    state.batches = [state.batches[0], { ...state.batches[0] }];
    expect(() => buildCombat2Presentation(state)).toThrow(Combat2PresentationError);
    const gap = delivery(2);
    gap.batches = [{ ...gap.batches[1], tick: 3 }];
    gap.lastAppliedTick = 3;
    expect(() => buildCombat2Presentation(gap)).toThrow(Combat2PresentationError);
  });

  it('preserves exact legacy references while disabled and overlays only projected fields while enabled', () => {
    const model = buildCombat2Presentation(delivery());
    const character = { id: CHARACTER, hp: 99, cp: 99, mp: 99 } as Character;
    const creature = { id: CREATURE, hp: 99, max_hp: 99, is_alive: true } as Creature;
    const events: GameLogEvent[] = [];
    expect(selectCombat2Character(false, model, character)).toBe(character);
    expect(selectCombat2Creatures(false, model, [creature])[0]).toBe(creature);
    expect(selectCombat2Events(false, model, events)).toBe(events);
    expect(selectCombat2Character(true, model, character)).toMatchObject({ hp: 16, cp: 7, mp: 6 });
    expect(selectCombat2Creatures(true, model, [creature])[0]).toMatchObject({ hp: 8, max_hp: 10, is_alive: true });
  });

  it('fails malformed sync without accepting partial state', () => {
    const state = delivery();
    state.snapshot = { ...state.snapshot!, character: { id: CHARACTER, hp: 'bad' } };
    expect(() => buildCombat2Presentation(state)).toThrow(Combat2PresentationError);
  });

  it('connects only the gated visible presentation seams, not gameplay hooks', () => {
    const page = readFileSync('src/pages/GamePage.tsx', 'utf8');
    expect(page).toMatch(/COMBAT2_CLIENT_ENABLED && combat2\.sessionStatus === 'active'/);
    expect(page).toContain('character={presentedCharacter}');
    expect(page).toContain('creatures={presentedCreatures}');
    expect(page).toContain('creatureHpOverrides={presentedCreatureHp ?? mergedCreatureHpOverrides}');
    expect(page).toContain('authoritativeCreatureEffects={activeCombat2Presentation?.creatureEffects}');
    expect(page).toContain('authoritativeEffects: activeCombat2Presentation?.characterEffects');
    expect(page).toContain('filteredEventLog={presentedEventLog}');
    expect(page).toMatch(/useCombatActions\(\{\s*character,/);
    expect(page).toMatch(/useMovementActions\(\{\s*character,/);
  });
});
import { readFileSync } from 'node:fs';
