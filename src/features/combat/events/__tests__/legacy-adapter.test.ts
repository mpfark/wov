/**
 * Parity guard for the Phase 3 structured-log migration.
 *
 * Every historical log string must render with the SAME family colour,
 * accent edge and marker after passing through the legacy adapter as it did
 * through the old string classifier. When this suite is green the swap is
 * invisible to players.
 */
import { describe, it, expect } from 'vitest';
import { classifyLogLine, toPresentation } from '@/features/combat/utils/event-log-styles';
import { legacyStringToEvent } from '@/features/combat/events/legacy-adapter';
import { presentationForEvent } from '@/features/combat/events/presentation';

const CORPUS: string[] = [
  '⚔️ You strike the Bell-Shell Matriarch for [12] damage.',
  '⚔️ You start attacking Yrsa Rimefeather.',
  '💥 CRITICAL! You cleave the Direwolf for [31] damage.',
  '🩸 The Direwolf bleeds for [4] damage.',
  '🔥 Ignite burns the Direwolf for [6] damage.',
  '🧪 Venom courses through the Direwolf for [3] damage.',
  '🌑 Shadow gnaws at the Direwolf for [5] damage.',
  '❤️ You heal yourself for [9].',
  '✝️ Holy light mends your wounds for [7].',
  '🛡️ Your shield absorbs [8] damage.',
  '🌀 Ser Caldris raises his blade toward the vaulted dark.',
  '☠️ The Direwolf has been defeated!',
  '💀 You have died.',
  '🎉 Level Up! You are now level 12.',
  '📦 You pick up an item.',
  '📜 Your Ashen Blade sold for 1,200 gold.',
  '⚠️ You cannot teleport while in combat!',
  '✨ IDDQD — A surge of insight floods you! 2x XP for 1 hour.',
  'You hurry after Kaelen.',
  'Exits: north, east',
  'Kaelen says, "Well met."',
  'Kaelen whispers, "Meet me at the bridge."',
  '⚔️ Kaelen strikes the Direwolf for [7] damage. (remote)',
];

describe('legacy log string → structured event parity', () => {
  for (const line of CORPUS) {
    it(`preserves presentation for: ${line.slice(0, 48)}`, () => {
      const legacy = toPresentation(line, classifyLogLine(line));
      const next = presentationForEvent(legacyStringToEvent(line));

      expect(next.textClass).toBe(legacy.textClass);
      expect(next.edgeClass).toBe(legacy.edgeClass);
      expect(next.marker).toBe(legacy.marker);
      expect(next.strong).toBe(legacy.strong);
    });
  }

  it('keeps the original text verbatim, including embedded emoji', () => {
    for (const line of CORPUS) {
      expect(legacyStringToEvent(line).legacy?.raw).toBe(line);
    }
  });

  it('never re-mints an id supplied by the emitter or DB row', () => {
    const ev = legacyStringToEvent('📦 You pick up an item.', { id: 'row-1' });
    expect(ev.id).toBe('row-1');
  });

  it('marks the tick divider as a control event with no prose', () => {
    const ev = legacyStringToEvent('---tick---');
    expect(ev.effectType).toBe('tick_separator');
    expect(ev.message).toBe('');
  });

  it('rewrites observer perspective for remote party lines', () => {
    const ev = legacyStringToEvent('⚔️ You strike the Direwolf.', { remoteName: 'Kaelen' });
    expect(ev.message).toContain('Kaelen strike');
    expect(ev.observed).toBe(true);
  });
});
