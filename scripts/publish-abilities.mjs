import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const temporary = mkdtempSync(join(tmpdir(), 'wov-ability-publication-'));
try {
  const modulePath = join(temporary, 'publisher.mjs');
  await build({ entryPoints: [join(root, 'src/shared/config/publish-abilities.ts')],
    outfile: modulePath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { publishAbilities } = await import(pathToFileURL(modulePath).href);
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = resolve(root, inputIndex < 0
    ? 'src/shared/combat/inventory/ability-publication-source.json' : process.argv[inputIndex + 1]);
  const source = JSON.parse(readFileSync(inputPath, 'utf8'));
  const canonicalSource = JSON.stringify(source);
  const inventory = { ...publishAbilities(source),
    sourceHash: createHash('sha256').update(canonicalSource).digest('hex') };
  const output = JSON.stringify(inventory, null, 2) + '\n';
  const outputIndex = process.argv.indexOf('--output');
  const targets = outputIndex < 0 ? ['src/shared/combat/inventory/active-abilities.json',
    'supabase/functions/_shared/combat2/active-abilities.json'] : [process.argv[outputIndex + 1]];
  for (const target of targets) {
    const path = join(root, target);
    if (process.argv.includes('--check')) {
      if (readFileSync(path, 'utf8') !== output) throw new Error(`Stale catalogue: ${target}`);
    } else writeFileSync(path, output);
  }
  console.log(`Ability publication ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${inventory.abilityCount} records`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
