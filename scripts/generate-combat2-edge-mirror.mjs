import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'src/shared/combat2');
const destinationRoot = join(root, 'supabase/functions/_shared/combat2');

const toDeno = (source) => {
  const rewrite = (whole, before, specifier, after) =>
    specifier.endsWith('.ts') || specifier.endsWith('.json') ? whole : `${before}${specifier}.ts${after}`;
  return source
    .replace(/(from\s+')([.][^']*?)(')/g, rewrite)
    .replace(/(import\(\s*')([.][^']*?)('\s*\))/g, rewrite);
};

const files = (directory) => readdirSync(directory).flatMap((entry) => {
  if (entry === '__tests__') return [];
  const path = join(directory, entry);
  return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
});

for (const source of files(sourceRoot)) {
  const destination = join(destinationRoot, relative(sourceRoot, source));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, toDeno(readFileSync(source, 'utf8')));
}

// Formula modules reached by the Combat2 resolver are part of the same Edge
// bundle boundary. Keep their Deno mirrors generator-owned as well.
for (const name of ['resources.ts', 'stats.ts', 'classes.ts']) {
  const source = join(root, 'src/shared/formulas', name);
  const destination = join(root, 'supabase/functions/_shared/formulas', name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, toDeno(readFileSync(source, 'utf8')));
}

const workerSource = join(root, 'src/server/combat2/process-node-tick-once.ts');
writeFileSync(join(destinationRoot, 'process-node-tick-once.ts'),
  toDeno(readFileSync(workerSource, 'utf8'))
    .replaceAll('../../shared/combat2/', './')
    .replaceAll('../../shared/config/', '../config/'));
const dispatcherSource = join(root, 'src/server/combat2/dispatch-node-ticks-once.ts');
writeFileSync(join(destinationRoot, 'dispatch-node-ticks-once.ts'), toDeno(readFileSync(dispatcherSource, 'utf8')));
cpSync(join(root, 'src/shared/combat/inventory/active-abilities.json'), join(destinationRoot, 'active-abilities.json'));
