import { describe, it, expect } from 'vitest';
import { buildTickLogEvent } from '../tick-event-builder';
import { SERVER_EVENT_TYPE_MAP } from '../log-event';
import { presentationForEvent } from '../presentation';

const ME = 'char-1';
const MY_NAME = 'Aldric';
const CREATURE = { creature_id: 'cr-7', creature_name: 'Yrsa Rimefeather' };

describe('stage 8 — debuff break / resist / stacking interactions', () => {
  it('orients player resilience with the player as source', () => {
    const ev = buildTickLogEvent(
      { type: 'cc_break', message: 'Aldric breaks free of the frozen grasp!', character_id: ME, ...CREATURE },
      ME,
      MY_NAME,
    )!;

    expect(ev.type).toBe('debuff');
    expect(ev.effectType).toBe('cc_break');
    expect(ev.severity).toBe('notable');
    expect(ev.source).toEqual({ kind: 'player', id: ME });
    expect(ev.target?.kind).toBe('creature');
    expect(presentationForEvent(ev).family).toBe('action');
  });

  it('orients creature resilience with the creature as source', () => {
    const ev = buildTickLogEvent(
      { type: 'creature_resist', message: 'Yrsa Rimefeather resists the snare!', character_id: ME, ...CREATURE },
      ME,
      MY_NAME,
    )!;

    expect(ev.source?.kind).toBe('creature');
    expect(ev.target).toEqual({ kind: 'player', id: ME });
    expect(ev.effectType).toBe('resist');
    expect(ev.severity).toBe('notable');
    expect(presentationForEvent(ev).family).toBe('threat');
  });

  it('routes player immunity and diminishing returns to mitigation', () => {
    for (const t of ['cc_immune', 'cc_diminish', 'debuff_immune', 'debuff_cleansed']) {
      const ev = buildTickLogEvent({ type: t, message: 'Aldric is unaffected.', character_id: ME }, ME, MY_NAME)!;
      expect(ev.type).toBe('mitigation');
      expect(ev.source).toEqual({ kind: 'player', id: ME });
      expect(presentationForEvent(ev).family).toBe('support');
    }
  });

  it('carries a structured stack count, never a damage number', () => {
    const ev = buildTickLogEvent(
      {
        type: 'debuff_stack',
        message: 'Poison thickens on Yrsa Rimefeather. [12]',
        character_id: ME,
        stacks: 3,
        damage: 12,
        effect_type: 'poison',
        ...CREATURE,
      },
      ME,
      MY_NAME,
    )!;

    expect(ev.amount).toBe(3);
    expect(ev.amountKind).toBe('stacks');
    expect(ev.effectType).toBe('poison');
  });

  it('omits the amount when the server sends no stack count', () => {
    const ev = buildTickLogEvent(
      { type: 'debuff_refreshed', message: 'The bleed is renewed.', character_id: ME, ...CREATURE },
      ME,
      MY_NAME,
    )!;
    expect(ev.amount).toBeUndefined();
    expect(ev.amountKind).toBeUndefined();
  });

  it('flags reaching max stacks as notable', () => {
    const ev = buildTickLogEvent(
      { type: 'debuff_max_stacks', message: 'Poison is at full potency!', character_id: ME, stacks: 5, ...CREATURE },
      ME,
      MY_NAME,
    )!;
    expect(ev.severity).toBe('notable');
    expect(ev.amount).toBe(5);
  });

  it('keeps every stage-8 server type registered in the exhaustive map', () => {
    for (const t of [
      'cc_break',
      'cc_diminish',
      'cc_immune',
      'creature_immune',
      'creature_resist',
      'debuff_cleansed',
      'debuff_immune',
      'debuff_max_stacks',
      'debuff_refreshed',
      'debuff_stack',
      'stack_consumed',
    ] as const) {
      expect(SERVER_EVENT_TYPE_MAP[t]).toBeTruthy();
    }
  });
});
