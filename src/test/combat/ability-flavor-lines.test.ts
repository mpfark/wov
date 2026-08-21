/**
 * Authored ability flavor reaches the log line, and the structured amount is
 * never printed twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTickLogEvent } from '@/features/combat/events/tick-event-builder';
import {
  resetAbilityTextRegistry,
  setAbilityTextRegistry,
} from '@/features/combat/utils/ability-text';

const LOCAL = 'char-1';

beforeEach(() => {
  resetAbilityTextRegistry();
  setAbilityTextRegistry([
    {
      ability_key: 'ignite',
      label: 'Orbs of Fire',
      combat_text: {
        pulse_text: 'A flaming orb leaps from {attacker} and sears {target} (burn x{stacks})! [{damage}]',
        stack_text: "{attacker}'s orb of fire seared {target} with {ability}.",
      },
    },
  ]);
});

describe('authored ability flavor', () => {
  it('renders the authored pulse sentence and drops the duplicate amount token', () => {
    const ev = buildTickLogEvent(
      {
        type: 'stance_pulse',
        message: 'Aldric sears Wolf for 7.',
        character_id: LOCAL,
        creature_id: 'c1',
        creature_name: 'Wolf',
        damage: 7,
        stacks: 2,
        max_stacks: 5,
        ability_key: 'ignite',
        attacker_name: 'Aldric',
        target_name: 'Wolf',
      },
      LOCAL,
      'Aldric',
    );
    expect(ev).not.toBeNull();
    expect(ev!.remoteMessage).toContain('A flaming orb leaps from Aldric');
    expect(ev!.remoteMessage).toContain('(burn x2)');
    expect(ev!.amount).toBeUndefined();
    expect(ev!.amountKind).toBeUndefined();
    // Local perspective folds the actor to the second person mid-sentence.
    expect(ev!.message).toContain('leaps from you');

  });

  it('renders the authored stack sentence with the ability label and a stack amount', () => {
    const ev = buildTickLogEvent(
      {
        type: 'stack_applied',
        message: 'Aldric afflicts Wolf [3/5].',
        character_id: LOCAL,
        creature_id: 'c1',
        creature_name: 'Wolf',
        stacks: 3,
        max_stacks: 5,
        ability_key: 'ignite',
        attacker_name: 'Aldric',
        target_name: 'Wolf',
      },
      LOCAL,
      'Aldric',
    );
    expect(ev).not.toBeNull();
    expect(ev!.remoteMessage).toBe("Aldric's orb of fire seared Wolf with Orbs of Fire.");
    expect(ev!.amount).toBe(3);
    expect(ev!.amountKind).toBe('stacks');
  });

  it('keeps the server fallback when the ability authors no template', () => {
    const ev = buildTickLogEvent(
      {
        type: 'stance_pulse',
        message: 'Aldric sears Wolf for 4.',
        character_id: LOCAL,
        creature_id: 'c1',
        creature_name: 'Wolf',
        damage: 4,
        ability_key: 'unauthored_stance',
        attacker_name: 'Aldric',
        target_name: 'Wolf',
      },
      LOCAL,
      'Aldric',
    );
    expect(ev).not.toBeNull();
    expect(ev!.remoteMessage).toBe('Aldric sears Wolf for 4.');
    expect(ev!.amount).toBe(4);
    expect(ev!.amountKind).toBe('damage');
  });
});
