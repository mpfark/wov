import { describe, it, expect } from 'vitest';
import { buildTickLogEvent } from '../tick-event-builder';
import { SERVER_EVENT_TYPE_MAP } from '../log-event';
import { presentationForEvent } from '../presentation';

const ME = 'char-1';
const MY_NAME = 'Aldric';

describe('stage 7 — debuffs and crowd control', () => {
  it('maps player-applied control to a debuff event sourced by the player', () => {
    const ev = buildTickLogEvent(
      {
        type: 'sunder_applied',
        message: "Aldric's strike splits the Bell-Shell Matriarch's carapace!",
        character_id: ME,
        creature_id: 'cr-9',
        creature_name: 'Bell-Shell Matriarch',
      },
      ME,
      MY_NAME,
    )!;

    expect(ev.type).toBe('debuff');
    expect(ev.effectType).toBe('sunder');
    expect(ev.source).toEqual({ kind: 'player', id: ME });
    expect(ev.target?.kind).toBe('creature');
    expect(ev.message.startsWith('Your strike')).toBe(true);
    expect(presentationForEvent(ev).family).toBe('action');
  });

  it('flips orientation for creature-applied control and marks it notable', () => {
    const ev = buildTickLogEvent(
      {
        type: 'stagger',
        message: 'Yrsa Rimefeather staggers Aldric!',
        character_id: ME,
        creature_id: 'cr-3',
        creature_name: 'Yrsa Rimefeather',
      },
      ME,
      MY_NAME,
    )!;

    expect(ev.source?.kind).toBe('creature');
    expect(ev.target).toEqual({ kind: 'player', id: ME });
    expect(ev.severity).toBe('notable');
    expect(presentationForEvent(ev).family).toBe('threat');
  });

  it('treats DoT applications as status, not damage', () => {
    const ev = buildTickLogEvent(
      {
        type: 'bleed_applied',
        message: 'Aldric rends the Gloomstalker — it bleeds! [7]',
        character_id: ME,
        creature_id: 'cr-4',
        creature_name: 'Gloomstalker',
        damage: 7,
      },
      ME,
      MY_NAME,
    )!;

    expect(ev.type).toBe('debuff');
    expect(ev.effectType).toBe('bleed');
    expect(ev.amount).toBeUndefined();
    expect(ev.amountKind).toBeUndefined();
  });

  it('routes resists to mitigation', () => {
    const ev = buildTickLogEvent(
      { type: 'debuff_resist', message: 'Aldric shrugs off the curse!', character_id: ME },
      ME,
      MY_NAME,
    )!;
    expect(ev.type).toBe('mitigation');
    expect(presentationForEvent(ev).family).toBe('support');
  });

  it('keeps every stage-7 server type registered in the exhaustive map', () => {
    for (const t of [
      'debuff_applied',
      'debuff_expired',
      'debuff_resist',
      'sunder_applied',
      'root_applied',
      'snare_applied',
      'weaken_applied',
      'stagger',
      'movement_lock',
      'cc_break',
    ] as const) {
      expect(SERVER_EVENT_TYPE_MAP[t]).toBeTruthy();
    }
  });

  it('leaves other stages untouched', () => {
    expect(buildTickLogEvent({ type: 'attack_hit', message: 'x' }, ME, MY_NAME)).toBeNull();
  });
});
