/**
 * shared-mirror-identity.test.ts — the `src/shared` ↔ `supabase/functions/_shared`
 * mirrors must stay byte-identical apart from Deno's `.ts` import specifiers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const PAIRS: Array<[string, string]> = [
  ['src/shared/formulas/ability-calc.ts', 'supabase/functions/_shared/formulas/ability-calc.ts'],
  ['src/shared/config/mechanic-templates.ts', 'supabase/functions/_shared/config/mechanic-templates.ts'],
  ['src/shared/combat/ability-magnitude.ts', 'supabase/functions/_shared/combat/ability-magnitude.ts'],
  ['src/shared/config/effective-ability.ts', 'supabase/functions/_shared/config/effective-ability.ts'],
  ['src/shared/combat/tick-rng.ts', 'supabase/functions/_shared/combat/tick-rng.ts'],
  ['src/shared/combat/tick-rng.ts', 'supabase/functions/_shared/combat/tick-rng.ts'],
  ['src/shared/formulas/combat.ts', 'supabase/functions/_shared/formulas/combat.ts'],
  ['src/shared/formulas/stats.ts', 'supabase/functions/_shared/formulas/stats.ts'],
];


/** Strip `.ts` extensions from relative import specifiers so both sides compare equal. */
function normalize(source: string): string {
  return source.replace(/from '(\.[^']*?)\.ts'/g, "from '$1'");
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

/**
 * Deno resolves relative specifiers literally: a mirrored file that lost its
 * `.ts` extensions compiles under Vite but fails to bundle on deploy.
 */
describe('edge mirrors keep Deno import specifiers', () => {
  it('has no extensionless relative import in supabase/functions', () => {
    const out = execFileSync('bash', [
      '-c',
      "grep -rn \"from '\\.\\.\\?/[^']*'\" supabase/functions --include=*.ts | grep -vE \"from '[^']*\\.(tsx|ts|json)'\" || true",
    ], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    expect(out).toBe('');
  });
});
