import { describe, it, expect } from 'vitest';
import { buildTickLogEvent } from '../tick-event-builder';
import { mapServerEventType } from '../log-event';

const ME = 'char-1';
const MY_NAME = 'Aldric';

describe('Phase 3 — canonical ability identity propagation', () => {
  it('carries the server-stamped ability_key onto ability events', () => {
    const ev = buildTickLogEvent(
      {
        type: 'ability_hit',
        message: 'Aldric hurls a fireball at Bandit! [22]',
        character_id: ME,
        creature_id: 'cr-1',
        creature_name: 'Bandit',
        damage: 22,
        ability_key: 'fireball',
      },
      ME,
      MY_NAME,
    )!;
    expect(ev.type).toBe('ability');
    expect(ev.abilityKey).toBe('fireball');
    // Identity is additive metadata only — it never becomes the classifier.
    expect(ev.effectType).toBeUndefined();
  });

  it('carries the ability_key onto debuff applications from the same cast', () => {
    const ev = buildTickLogEvent(
      {
        type: 'bleed_applied',
        message: 'Aldric rends Bandit — blood weeps from the gash! [4/tick]',
        character_id: ME,
        creature_id: 'cr-1',
        ability_key: 'rend',
      },
      ME,
      MY_NAME,
    )!;
    expect(ev.type).toBe('debuff');
    expect(ev.effectType).toBe('bleed');
    expect(ev.abilityKey).toBe('rend');
  });

  it('maps dot_tick server events structurally and keeps the source ability key', () => {
    expect(mapServerEventType('dot_tick')).toBe('dot_tick');
    const ev = buildTickLogEvent(
      { type: 'dot_tick', message: "Bandit bleeds from Aldric's Rend. [4]", ability_key: 'rend' },
      ME,
      MY_NAME,
    )!;
    expect(ev.type).toBe('dot_tick');
    expect(ev.abilityKey).toBe('rend');
  });

  it('leaves abilityKey unset when the server sends no identity', () => {
    const ev = buildTickLogEvent(
      { type: 'ability_fail', message: 'Aldric doesn\u2019t have enough CP!', character_id: ME },
      ME,
      MY_NAME,
    )!;
    expect(ev.abilityKey).toBeUndefined();
  });
});
