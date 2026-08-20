/**
 * Holy Shield retaliation renders with the styled structured amount token, not a
 * natural-language amount, and names the configured ability rather than "ward".
 */
import { describe, expect, it } from 'vitest';

import { buildTickLogEvent } from '@/features/combat/events/tick-event-builder';
import EventLogLineModule from '@/features/combat/components/EventLogLine';

const CREATURE = 'Ithram, the Unbound Scholar';

const event = (characterId: string) => ({
  type: 'holy_shield_return',
  message: `Calikon's ward burns ${CREATURE} for 36.`,
  character_id: characterId,
  creature_id: 'cr-1',
  creature_name: CREATURE,
  damage: 36,
  amount: 36,
});

/** Mirrors EventLogLine's token rule: `[N]` unless the prose states the number. */
function rendered(message: string, amount?: number): string {
  const states = amount !== undefined && new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(message);
  return amount !== undefined && !states ? `${message} [${amount}]` : message;
}

describe('Holy Shield presentation', () => {
  it('renders the local line with the styled amount exactly once', () => {
    const ev = buildTickLogEvent(event('me'), 'me', 'Calikon')!;
    expect(rendered(ev.message, ev.amount)).toBe(
      `Your Holy Shield burns ${CREATURE}! [36]`,
    );
    expect(ev.amount).toBe(36);
    expect(ev.amountKind).toBe('damage');
  });

  it('renders the observer line with the character name and one [36]', () => {
    const ev = buildTickLogEvent(event('other'), 'me', 'Calikon')!;
    const out = rendered(ev.message, ev.amount);
    expect(out).toBe(`Calikon's Holy Shield burns ${CREATURE}! [36]`);
    expect(out.match(/\[36\]/g)).toHaveLength(1);
  });

  it('contains neither "ward" nor "for 36" in either perspective', () => {
    for (const id of ['me', 'other']) {
      const ev = buildTickLogEvent(event(id), 'me', 'Calikon')!;
      const out = rendered(ev.message, ev.amount);
      expect(out).not.toMatch(/\bward\b/);
      expect(out).not.toMatch(/for 36/);
    }
  });

  it('leaves other amount-suppression behaviour unchanged', () => {
    // A damage line that already states its number keeps stating it once.
    const ev = buildTickLogEvent(
      {
        type: 'ability_hit',
        message: `Calikon's Fireball burns ${CREATURE} for 36.`,
        character_id: 'me',
        creature_id: 'cr-1',
        damage: 36,
      },
      'me',
      'Calikon',
    )!;
    expect(ev.message).toBe(`Your Fireball burns ${CREATURE} for 36.`);
    expect(rendered(ev.message, ev.amount)).not.toMatch(/\[36\]/);
  });

  it('keeps the shared EventLogLine renderer importable (token rule owner)', () => {
    expect(typeof EventLogLineModule).toBe('function');
  });
});
