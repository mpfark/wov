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

/**
 * Legacy corpus. Historical log strings carried decorative glyph prefixes.
 * Emitters no longer produce them, but the legacy boundary must still classify
 * them identically. Fixtures are built from explicit codepoints at runtime so
 * this source file itself contains no emoji literal.
 */
const cp = (...codes: number[]) => String.fromCodePoint(...codes);

const CORPUS: string[] = [
  `${cp(0x2694)}${cp(0xFE0F)} You strike the Bell-Shell Matriarch for [12] damage.`,
  `${cp(0x2694)}${cp(0xFE0F)} You start attacking Yrsa Rimefeather.`,
  `${cp(0x1F4A5)} CRITICAL! You cleave the Direwolf for [31] damage.`,
  `${cp(0x1FA78)} The Direwolf bleeds for [4] damage.`,
  `${cp(0x1F525)} Ignite burns the Direwolf for [6] damage.`,
  `${cp(0x1F9EA)} Venom courses through the Direwolf for [3] damage.`,
  `${cp(0x1F311)} Shadow gnaws at the Direwolf for [5] damage.`,
  `${cp(0x2764)}${cp(0xFE0F)} You heal yourself for [9].`,
  `${cp(0x271D)}${cp(0xFE0F)} Holy light mends your wounds for [7].`,
  `${cp(0x1F6E1)}${cp(0xFE0F)} Your shield absorbs [8] damage.`,
  `${cp(0x1F300)} Ser Caldris raises his blade toward the vaulted dark.`,
  `${cp(0x2620)}${cp(0xFE0F)} The Direwolf has been defeated!`,
  `${cp(0x1F480)} You have died.`,
  `${cp(0x1F389)} Level Up! You are now level 12.`,
  `${cp(0x1F4E6)} You pick up an item.`,
  `${cp(0x1F4DC)} Your Ashen Blade sold for 1,200 gold.`,
  `${cp(0x26A0)}${cp(0xFE0F)} You cannot teleport while in combat!`,
  `${cp(0x2728)} IDDQD — A surge of insight floods you! 2x XP for 1 hour.`,
  `You hurry after Kaelen.`,
  `Exits: north, east`,
  `Kaelen says, "Well met."`,
  `Kaelen whispers, "Meet me at the bridge."`,
  `${cp(0x2694)}${cp(0xFE0F)} Kaelen strikes the Direwolf for [7] damage. (remote)`,
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

  it('keeps the original text verbatim, including legacy glyph prefixes', () => {
    for (const line of CORPUS) {
      expect(legacyStringToEvent(line).legacy?.raw).toBe(line);
    }
  });

  it('never re-mints an id supplied by the emitter or DB row', () => {
    const ev = legacyStringToEvent('You pick up an item.', { id: 'row-1' });
    expect(ev.id).toBe('row-1');
  });

  it('marks the tick divider as a control event with no prose', () => {
    const ev = legacyStringToEvent('---tick---');
    expect(ev.effectType).toBe('tick_separator');
    expect(ev.message).toBe('');
  });

  it('rewrites observer perspective for remote party lines', () => {
    const ev = legacyStringToEvent('You strike the Direwolf.', { remoteName: 'Kaelen' });
    expect(ev.message).toContain('Kaelen strike');
    expect(ev.observed).toBe(true);
  });
});
