/**
 * shared-mirror-identity.test.ts — the `src/shared` ↔ `supabase/functions/_shared`
 * mirrors must stay byte-identical apart from Deno's `.ts` import specifiers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAIRS: Array<[string, string]> = [
  ['src/shared/formulas/ability-calc.ts', 'supabase/functions/_shared/formulas/ability-calc.ts'],
  ['src/shared/config/mechanic-templates.ts', 'supabase/functions/_shared/config/mechanic-templates.ts'],
  ['src/shared/combat/ability-magnitude.ts', 'supabase/functions/_shared/combat/ability-magnitude.ts'],
];

/** Strip `.ts` extensions from relative import specifiers so both sides compare equal. */
function normalize(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/from '(\.[^']*?)\.ts'/g, "from '$1'");
}

describe('shared mirror identity', () => {
  for (const [client, server] of PAIRS) {
    it(`${client} matches its server mirror`, () => {
      const a = normalize(readFileSync(resolve(process.cwd(), client), 'utf8'));
      const b = normalize(readFileSync(resolve(process.cwd(), server), 'utf8'));
      expect(b).toBe(a);
    });
  }
});
