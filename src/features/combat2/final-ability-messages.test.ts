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
});
