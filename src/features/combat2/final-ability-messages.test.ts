import { describe, expect, it } from 'vitest';
import { formatCombat2Event } from './event-message';

const context = { characterId: 'caster', classKey: 'healer' };
const event = (kind: string, abilityKey: string, amount: number, meta: Record<string, unknown> = {}) => ({
  seq: 0, kind, abilityKey, amount, actor: { type: 'character' as const, id: 'caster', name: 'Caster' },
  target: { type: 'character' as const, id: 'ally', name: 'Ally' }, meta,
});

describe('final Combat2 ability presentation', () => {
  it('reports actual party restoration and capped amounts without raw state', () => {
    expect(formatCombat2Event(event('party_restore', 'inspire', 4,
      { hpApplied: 4, cpApplied: 2, hpWasted: 3, cpWasted: 1 }), context))
      .toBe('Your Inspire restores 4 HP and 2 CP to Ally (4 capped).');
  });

  it('reports Consecrate heal and damage using authored naming', () => {
    expect(formatCombat2Event(event('consecrate_heal', 'consecrate', 5), context)).toContain('Consecrate');
    const damage = { ...event('consecrate_pulse', 'consecrate', 6),
      target: { type: 'creature' as const, id: 'creature', name: 'Wraith' } };
    expect(formatCombat2Event(damage, context)).toBe('Your Consecrate deals 6 holy damage to Wraith.');
  });

  it('reports Aegis absorption/depletion and actual Transfer Health reconciliation', () => {
    expect(formatCombat2Event(event('absorb', 'divine_aegis', 8, { remaining: 0, depleted: true }), context))
      .toContain('Divine Aegis absorbs 8 damage');
    expect(formatCombat2Event(event('hp_transfer', 'transfer_health', 5,
      { removedFromCaster: 5, wasted: 0 }), context))
      .toBe('You transfer 5 HP with Transfer Health, restoring 5 HP to Ally.');
  });

  it('reports authored status application and failed proc rolls', () => {
    const target = { type: 'creature' as const, id: 'creature', name: 'Wraith' };
    expect(formatCombat2Event({ ...event('status_applied', 'fireball', 1, { status: 'scorched' }), target },
      { characterId: 'caster', classKey: 'wizard' }))
      .toBe('Your Fireball applies Scorched to Wraith.');
    expect(formatCombat2Event({ ...event('status_missed', 'fireball', 0, { status: 'scorched' }), target },
      { characterId: 'caster', classKey: 'wizard' }))
      .toBe('Your Fireball does not apply Scorched to Wraith.');
  });

  it('renders authoritative XP, gold, loot and no-drop outcomes without calculating them', () => {
    const creature = { type: 'creature' as const, id: 'creature', name: 'Wraith' };
    expect(formatCombat2Event({ ...event('xp_reward', '', 25), target: creature }, context)).toBe('You gain 25 experience.');
    expect(formatCombat2Event({ ...event('gold_reward', '', 8), target: creature }, context)).toBe('You loot 8 gold.');
    expect(formatCombat2Event({ ...event('loot_drop', '', 0), target: creature }, context)).toBe('Loot drops from Wraith.');
    expect(formatCombat2Event({ ...event('loot_result', '', 0), target: creature, outcomeReason: 'no_drop' }, context)).toBe('No item drops from Wraith.');
  });

  it('renders committed item procs and durability without deriving either client-side', () => {
    const creature = { type: 'creature' as const, id: 'creature', name: 'Wraith' };
    expect(formatCombat2Event({ ...event('item_proc_damage', '', 7, { damageType: 'fire' }), target: creature }, context))
      .toBe('Your equipped item deals 7 damage to Wraith.');
    expect(formatCombat2Event(event('durability_lost', '', 1, { slot: 'main_hand', durabilityAfter: 99 }), context))
      .toBe('Your equipped main hand loses 1 durability.');
    expect(formatCombat2Event(event('equipment_broken', '', 1, { slot: 'off_hand', durabilityAfter: 0 }), context))
      .toBe('Your equipped off hand breaks.');
  });
});
