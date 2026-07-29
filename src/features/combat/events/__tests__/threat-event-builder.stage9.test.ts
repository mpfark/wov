import { describe, it, expect } from 'vitest';
import {
  buildAggroEvent,
  buildEngageEvent,
  buildTauntEvent,
  buildPositioningEvent,
} from '../threat-event-builder';
import { familyForEvent, presentationForEvent } from '../presentation';

const PLAYER = { kind: 'player' as const, id: 'p1', name: 'Aldric' };
const CREATURE = { id: 'c1', name: 'Yrsa Rimefeather' };

describe('stage 9 — threat / aggro', () => {
  it('creature aggro is creature-sourced, notable and renders as threat', () => {
    for (const kind of ['initial', 'reengage', 'join'] as const) {
      const ev = buildAggroEvent(kind, CREATURE, PLAYER);
      expect(ev.type).toBe('aggro');
      expect(ev.source).toEqual({ kind: 'creature', id: 'c1', name: CREATURE.name });
      expect(ev.target).toEqual(PLAYER);
      expect(ev.effectType).toBe(kind);
      expect(ev.severity).toBe('notable');
      expect(familyForEvent(ev)).toBe('threat');
      expect(ev.message).toContain(CREATURE.name);
    }
  });

  it('aggro prose carries no leading control glyph', () => {
    for (let i = 0; i < 25; i++) {
      const ev = buildAggroEvent('initial', CREATURE);
      expect(ev.message.startsWith(CREATURE.name)).toBe(true);
    }
  });

  it('player engaging a target is player-sourced action', () => {
    const ev = buildEngageEvent(CREATURE, PLAYER);
    expect(ev.type).toBe('aggro');
    expect(ev.source).toEqual(PLAYER);
    expect(ev.target?.kind).toBe('creature');
    expect(ev.effectType).toBe('engage');
    expect(familyForEvent(ev)).toBe('action');
    expect(ev.message).toBe('You start attacking Yrsa Rimefeather.');
    expect(ev.remoteMessage).toBe('Aldric starts attacking Yrsa Rimefeather.');
  });
});

describe('stage 9 — taunts', () => {
  it('taunts are player-sourced and keep the canonical [N] suffix', () => {
    const ev = buildTauntEvent('Divine Challenge! You mitigate incoming blows for 34s. [7]', PLAYER, CREATURE);
    expect(ev.type).toBe('taunt');
    expect(ev.source).toEqual(PLAYER);
    expect(ev.target?.id).toBe('c1');
    expect(ev.effectType).toBe('taunt');
    expect(familyForEvent(ev)).toBe('action');
    expect(ev.message).toMatch(/\[7\]$/);
  });
});

describe('stage 9 — positioning', () => {
  it('routine repositioning stays routine action', () => {
    const ev = buildPositioningEvent('flee', 'You flee to the north!', PLAYER);
    expect(ev.type).toBe('positioning');
    expect(ev.effectType).toBe('flee');
    expect(ev.severity).toBeUndefined();
    const pres = presentationForEvent(ev);
    expect(pres.family).toBe('action');
    expect(pres.severity).toBe('routine');
    expect(pres.marker).toBeNull();
  });

  it('failures the player must notice are notable', () => {
    for (const kind of ['wimp_flee', 'movement_locked', 'no_escape'] as const) {
      const ev = buildPositioningEvent(kind, 'something happened', PLAYER);
      expect(ev.severity).toBe('notable');
      expect(familyForEvent(ev)).toBe('action');
    }
  });

  it('a cast lost by moving away is a routine positioning line, not an error', () => {
    const ev = buildPositioningEvent('fizzle', 'Your Fireball fizzles as you move away.', PLAYER);
    expect(ev.type).toBe('positioning');
    expect(ev.amount).toBeUndefined();
    expect(presentationForEvent(ev).severity).toBe('routine');
  });
});
