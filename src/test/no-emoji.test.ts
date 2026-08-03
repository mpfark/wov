/**
 * Repository guard: no emoji literals anywhere in application source.
 *
 * The game's visual language is text + colour only (see the emoji purge).
 * Legacy log classification may still *recognise* historical glyphs, but it
 * must express them as explicit `\u{...}` escapes so the source stays clean.
 *
 * Allowed above U+2000: typographic ornaments and math/arrow symbols used for
 * layout (box drawing, arrows, ✦ ❧ ✕ ★ ◆ ● ♂ ♀ …). Anything in the emoji
 * blocks, or with an Emoji_Presentation-style variation selector, fails.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = ['src', 'supabase/functions'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SELF = 'src/test/no-emoji.test.ts';

/** Ranges that are unambiguously emoji / pictographic. */
const EMOJI_RANGES: Array<[number, number]> = [
  [0x1f000, 0x1faff],
  [0x1f1e6, 0x1f1ff], // regional indicators
  [0x2600, 0x2604],
  [0x2607, 0x263f], // ornamental stars U+2605-2606 stay allowed
  [0x2643, 0x26ff], // misc symbols; gender signs U+2640-2642 stay allowed
  [0x2b00, 0x2bff],
  [0x23e9, 0x23fa], // media / hourglass controls
  [0xfe0f, 0xfe0f], // variation selector-16
];

const isEmoji = (cp: number) => EMOJI_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('emoji-free source', () => {
  it('contains no emoji literals in src/ or edge functions', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const rel = relative('.', file);
        if (rel === SELF) continue;
        const text = readFileSync(file, 'utf8');
        text.split('\n').forEach((line, i) => {
          for (const ch of line) {
            const cp = ch.codePointAt(0)!;
            if (isEmoji(cp)) {
              offenders.push(`${rel}:${i + 1} U+${cp.toString(16).toUpperCase()}`);
              break;
            }
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
