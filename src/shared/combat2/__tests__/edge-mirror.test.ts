import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const toDeno = (text: string) => text
  .replace(/(from\s+')(\.[^']*?)(')/g, (whole, before, path, after) =>
    path.endsWith('.ts') || path.endsWith('.json') ? whole : `${before}${path}.ts${after}`)
  .replace(/(import\(\s*')(\.[^']*?)('\s*\))/g, (whole, before, path, after) =>
    path.endsWith('.ts') || path.endsWith('.json') ? whole : `${before}${path}.ts${after}`);

describe('Combat2 deployed engine source parity', () => {
  for (const file of readdirSync('src/shared/combat2').filter(name => name.endsWith('.ts'))) {
    it(`${file} uses exactly the tested engine with Deno import extensions`, () => {
      expect(readFileSync(`supabase/functions/_shared/combat2/${file}`, 'utf8'))
        .toBe(toDeno(readFileSync(`src/shared/combat2/${file}`, 'utf8')));
    });
  }
});