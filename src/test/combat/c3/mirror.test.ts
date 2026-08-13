import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The edge runtime executes a mirrored copy of `src/shared/combat/**` (Deno
 * needs explicit `.ts` specifiers). This test proves the mirror is the same
 * code the golden/parity suites validate: `scripts/sync-combat-shared.py`
 * writes it, this pins it.
 */
const SRC = 'src/shared/combat';
const DST = 'supabase/functions/_shared/combat';
const TREES = ['pure', 'c2', 'c3'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === '__tests__') return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}


const toDeno = (text: string) =>
  text.replace(/(from\s+')(\.[^']*?)(')/g, (whole, a, spec, b) =>
    spec.endsWith('.ts') || spec.endsWith('.json') ? whole : `${a}${spec}.ts${b}`,
  );

describe('edge combat mirror', () => {
  const files = TREES.flatMap((tree) => walk(join(SRC, tree)));

  it('mirrors every shared combat module into the edge runtime', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const src of files) {
      const rel = relative(SRC, src);
      const mirrored = readFileSync(join(DST, rel), 'utf8');
      expect(mirrored, `${rel} drifted from ${src}`).toBe(toDeno(readFileSync(src, 'utf8')));
    }
  });
});
