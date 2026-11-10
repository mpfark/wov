import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const toDeno = (text: string) => text
  .replace(/(from\s+')(\.[^']*?)(')/g, (whole, before, path, after) =>
    path.endsWith('.ts') || path.endsWith('.json') ? whole : `${before}${path}.ts${after}`)
  .replace(/(import\(\s*')(\.[^']*?)('\s*\))/g, (whole, before, path, after) =>
    path.endsWith('.ts') || path.endsWith('.json') ? whole : `${before}${path}.ts${after}`);

describe('Combat2 deployed engine source parity', () => {
  const files = [
    ...readdirSync('src/shared/combat2').filter(name => name.endsWith('.ts')),
    ...readdirSync('src/shared/combat2/rules').filter(name => name.endsWith('.ts')).map(name => `rules/${name}`),
  ];
  for (const file of files) {
    it(`${file} uses exactly the tested engine with Deno import extensions`, () => {
      expect(readFileSync(`supabase/functions/_shared/combat2/${file}`, 'utf8'))
        .toBe(toDeno(readFileSync(`src/shared/combat2/${file}`, 'utf8')));
    });
  }
});
describe('workers run only the engine', () => {
  it('no engine file imports or re-exports code outside the engine', () => {
    const files = readdirSync('supabase/functions/_shared/combat2', { recursive: true }) as string[];
    for (const file of files.filter(name => name.endsWith('.ts'))) {
      const text = readFileSync(`supabase/functions/_shared/combat2/${file}`, 'utf8');
      const outside = [...text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1])
        .filter(p => p.startsWith('../'));
      expect(outside, file).toEqual([]);
    }
  });
});
