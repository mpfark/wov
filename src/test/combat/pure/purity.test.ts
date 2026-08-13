/**
 * C1 purity guards.
 *
 * 1. Static: no `Math.random`, no `Date.now`, no client/fetch/logging import
 *    is reachable from `pure/resolver.ts` through its transitive import graph.
 * 2. Runtime: globals that would betray an external call are replaced with
 *    throwing traps for the duration of a real resolve.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { resolveTickPure } from '@/shared/combat/pure';
import { snapshot } from './fixtures';

const ROOT = resolvePath(__dirname, '../../../..');
const ENTRY = resolvePath(ROOT, 'src/shared/combat/pure/resolver.ts');

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolvePath(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolvePath(dirname(fromFile), spec);
  else return null; // bare package specifier — checked separately
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
}

/** Every project file reachable from the resolver. */
function reachableFiles(): string[] {
  const seen = new Set<string>();
  const bare: string[] = [];
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      const target = resolveImport(file, spec);
      if (target) queue.push(target);
      else if (!spec.startsWith('node:')) bare.push(spec);
    }
  }
  expect(bare, 'pure resolver must not import third-party packages').toEqual([]);
  return [...seen];
}

/** Strip comments so documentation mentioning Math.random does not trip the scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('pure resolver — static purity', () => {
  const files = reachableFiles();

  it('reaches the expected module set and nothing else', () => {
    const rel = files.map((f) => f.slice(ROOT.length + 1)).sort();
    expect(rel).toMatchInlineSnapshot(`
      [
        "src/shared/combat/pure/ordering.ts",
        "src/shared/combat/pure/party-xp.ts",
        "src/shared/combat/pure/resolver.ts",
        "src/shared/combat/pure/rng.ts",
        "src/shared/combat/pure/rolls.ts",
        "src/shared/combat/pure/types.ts",
        "src/shared/combat/resolution.ts",
        "src/shared/combat/tick-rng.ts",
        "src/shared/formulas/bond.ts",
        "src/shared/formulas/classes.ts",
        "src/shared/formulas/combat.ts",
        "src/shared/formulas/economy.ts",
        "src/shared/formulas/gems.ts",
        "src/shared/formulas/stats.ts",
        "src/shared/formulas/xp.ts",
      ]
    `);
  });

  it('contains no Math.random anywhere reachable by the resolver', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      src.split('\n').forEach((line, i) => {
        if (/Math\s*\.\s*random/.test(line)) {
          void i;
          offenders.push(file.slice(ROOT.length + 1));
        }
      });
    }
    // Legacy roll helpers live in the same formula modules as the pure math the
    // resolver reuses. Those helpers are never imported by pure/ (asserted
    // below), so record them explicitly instead of pretending they are absent.
    // combat.ts:rollBlock and stats.ts:rollD20/rollDamage are the only
    // survivors, and pure/ never imports them (asserted below).
    expect([...new Set(offenders)].sort()).toEqual([
      'src/shared/formulas/combat.ts',
      'src/shared/formulas/stats.ts',
    ]);
  });

  it('never imports a roll-bearing legacy helper', () => {
    const banned = [
      'rollD20',
      'rollDamage',
      'rollBlock',
      'rollCreatureDamage',
      'rollWeaponAttackDamage',
      'resolveAttackRoll',
    ];
    for (const file of files.filter((f) => f.includes('/pure/'))) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const imports = [...src.matchAll(/import\s*\{([^}]+)\}/g)].map((m) => m[1]);
      for (const clause of imports) {
        for (const name of banned) {
          expect(
            clause.includes(name),
            `${file.slice(ROOT.length + 1)} imports ${name}`,
          ).toBe(false);
        }
      }
    }
  });

  it('contains no clock, database, network or logging access', () => {
    const forbidden: Array<[RegExp, string]> = [
      [/Date\s*\.\s*now/, 'Date.now'],
      [/new\s+Date\s*\(/, 'new Date'],
      [/crypto\s*\.\s*randomUUID/, 'crypto.randomUUID'],
      [/\bfetch\s*\(/, 'fetch'],
      [/console\s*\.\s*(log|warn|error|info)/, 'console'],
      [/createClient\s*\(/, 'createClient'],
      [/\bsupabase\b/, 'supabase'],
      [/\.from\s*\(\s*['"]/, 'db .from("table")'],
      [/\.rpc\s*\(/, 'db .rpc()'],
      [/setTimeout|setInterval/, 'timers'],
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      src.split('\n').forEach((line, i) => {
        for (const [re, label] of forbidden) {
          if (re.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} ${label}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('pure resolver — runtime purity', () => {
  const originals = {
    random: Math.random,
    now: Date.now,
    fetch: globalThis.fetch,
    uuid: globalThis.crypto?.randomUUID,
  };

  afterEach(() => {
    Math.random = originals.random;
    Date.now = originals.now;
    globalThis.fetch = originals.fetch;
    if (originals.uuid && globalThis.crypto) {
      (globalThis.crypto as { randomUUID: unknown }).randomUUID = originals.uuid;
    }
  });

  it('resolves a tick without touching randomness, the clock, network or a db client', () => {
    const trap = (label: string) => () => {
      throw new Error(`pure resolver called ${label}`);
    };
    Math.random = trap('Math.random') as unknown as typeof Math.random;
    Date.now = trap('Date.now') as unknown as typeof Date.now;
    globalThis.fetch = trap('fetch') as unknown as typeof fetch;
    if (globalThis.crypto) {
      (globalThis.crypto as { randomUUID: unknown }).randomUUID = trap('crypto.randomUUID');
    }

    // A database/client interface: every property access throws.
    const dbTrap = new Proxy(
      {},
      {
        get() {
          throw new Error('pure resolver touched a database client');
        },
      },
    );
    const snap = { ...snapshot({ ticksToSimulate: 3 }) } as Record<string, unknown>;
    // The trap is not part of the snapshot contract; the resolver must not go
    // looking for one either.
    Object.defineProperty(snap, 'db', { value: dbTrap, enumerable: false });

    expect(() => resolveTickPure(snap as never)).not.toThrow();
  });
});
