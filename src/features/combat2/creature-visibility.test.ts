import { describe, expect, it } from 'vitest';
import { selectCombat2Creatures } from './presentation-selectors';
import type { Combat2PresentationModel } from './presentation';
import type { Creature } from '@/features/creatures';

function creature(id: string, aggressive: boolean): Creature {
  return {
    id, name: `creature-${id}`, node_id: 'node-1', hp: 10, max_hp: 10,
    is_alive: true, is_aggressive: aggressive, spawn_seq: 1,
  } as unknown as Creature;
}

function model(entries: Array<{ creatureId: string; hp: number; engaged: boolean }>): Combat2PresentationModel {
  return {
    encounterId: 'encounter-1',
    creatures: entries.map((entry, index) => ({
      nodeCreatureId: `nc-${index}`, creatureId: entry.creatureId, spawnSeq: index + 1,
      hp: entry.hp, maxHp: 10, isAlive: entry.hp > 0, engaged: entry.engaged,
    })),
  } as unknown as Combat2PresentationModel;
}

describe('node creature visibility is independent from combat ownership', () => {
  const peaceful = creature('peaceful-1', false);
  const aggressive = creature('aggressive-1', true);
  const roster = [peaceful, aggressive];

  it('does not hide a respawned creature under a dead previous-generation snapshot', () => {
    const respawned = { ...aggressive, spawn_seq: 2, hp: 10, is_alive: true };
    const presented = selectCombat2Creatures(true, model([{ creatureId: aggressive.id, hp: 0, engaged: false }]), [respawned]);
    expect(presented[0]).toBe(respawned);
    expect(presented[0]).toMatchObject({ spawn_seq: 2, hp: 10, is_alive: true });
  });

  it('does not mix different or unknown roster generations with encounter resource values', () => {
    const projection = model([{ creatureId: aggressive.id, hp: 3, engaged: true }]);
    for (const spawn_seq of [0, null, undefined]) {
      const row = { ...aggressive, spawn_seq };
      expect(selectCombat2Creatures(true, projection, [row])[0]).toBe(row);
    }
  });

  it('keeps living peaceful creatures visible while an encounter is owned', () => {
    const presented = selectCombat2Creatures(true, model([{ creatureId: 'aggressive-1', hp: 4, engaged: true }]), roster);
    expect(presented.map(c => c.id)).toEqual(['peaceful-1', 'aggressive-1']);
  });

  it('keeps living aggressive creatures visible when no creature is engaged', () => {
    const presented = selectCombat2Creatures(true, model([{ creatureId: 'aggressive-1', hp: 10, engaged: false }]), roster);
    expect(presented.map(c => c.id)).toEqual(['peaceful-1', 'aggressive-1']);
  });

  it('refines runtime values only for creatures the encounter contains', () => {
    const presented = selectCombat2Creatures(true, model([{ creatureId: 'aggressive-1', hp: 3, engaged: true }]), roster);
    expect(presented.find(c => c.id === 'aggressive-1')?.hp).toBe(3);
    expect(presented.find(c => c.id === 'peaceful-1')?.hp).toBe(10);
  });

  it('shows the whole roster when no encounter presentation exists', () => {
    expect(selectCombat2Creatures(true, null, roster)).toEqual(roster);
    expect(selectCombat2Creatures(false, model([]), roster)).toEqual(roster);
  });

  it('never invents creatures the node roster excludes', () => {
    const presented = selectCombat2Creatures(true, model([
      { creatureId: 'aggressive-1', hp: 2, engaged: true },
      { creatureId: 'despawned-1', hp: 7, engaged: true },
    ]), roster);
    expect(presented.map(c => c.id)).toEqual(['peaceful-1', 'aggressive-1']);
  });
});
