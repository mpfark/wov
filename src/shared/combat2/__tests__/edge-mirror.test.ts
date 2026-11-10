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
  it('no engine file imports code outside the engine except the status contract', () => {
    const files = readdirSync('supabase/functions/_shared/combat2', { recursive: true }) as string[];
    for (const file of files.filter(name => name.endsWith('.ts'))) {
      const text = readFileSync(`supabase/functions/_shared/combat2/${file}`, 'utf8');
      const outside = [...text.matchAll(/from\s+'([^']+)'/g)].map(m => m[1])
        .filter(p => p.startsWith('../') && !(file.startsWith('rules/') && p.startsWith('./')));
      const allowed = (p: string) => p === '../config/status-contract.ts' || (file.startsWith('rules/') && p.startsWith('../'))
        && false;
      expect(outside.filter(p => !allowed(p)), file).toEqual([]);
    }
  });
});
