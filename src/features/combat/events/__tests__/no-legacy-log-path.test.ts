/**
 * Repo-wide guard for the Phase 3 structured-log migration.
 *
 * Two invariants:
 *  1. No string-based `addLog` / `addLocalLog` emitter exists anywhere.
 *     Every log must be a structured `GameLogEvent`.
 *  2. The legacy string→event adapter (and the string classifier it wraps)
 *     is imported ONLY from the documented compatibility boundary files
 *     listed in ADAPTER_ALLOWLIST. Those are the inbound edges that still
 *     receive plain strings (DB rows, older-client broadcasts).
 *
 * When the adapter's removal criteria are met, delete the adapter, the
 * allowlist entries, and this file's second test together.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'supabase/functions'];
const EXTS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Files still allowed to touch the legacy string adapter / classifier. */
const ADAPTER_ALLOWLIST = new Set([
  // The adapter itself and its barrel re-export.
  'src/features/combat/events/legacy-adapter.ts',
  'src/features/combat/events/index.ts',
  // The string classifier the adapter wraps.
  'src/features/combat/utils/event-log-styles.ts',
  // Inbound boundaries: node-channel creature broadcasts + party_combat_log
  // rows that may still carry `message` text from older clients.
  'src/pages/GamePage.tsx',
  'src/features/combat/hooks/useCombatDriver.ts',
  // Parity suites.
  'src/features/combat/events/__tests__/legacy-adapter.test.ts',
  'src/features/combat/events/__tests__/no-legacy-log-path.test.ts',
]);

const ADAPTER_TOKENS = /\b(legacyStringToEvent|rewriteLegacyRemote|classifyLogLine|toPresentation)\b/;
/** Any identifier shaped like a string-log emitter, e.g. addLog / addLocalLog. */
const STRING_EMITTER = /\b(addLog|addLocalLog|addLogMessage|appendLog)\b/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some(e => full.endsWith(e))) out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap(d => walk(join(ROOT, d))).map(f =>
  relative(ROOT, f).split(sep).join('/'),
);

const SELF = 'src/features/combat/events/__tests__/no-legacy-log-path.test.ts';

function offenders(pattern: RegExp, allow: Set<string> = new Set()): string[] {
  const hits: string[] = [];
  for (const file of FILES) {
    if (file === SELF || allow.has(file)) continue;
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe('legacy log path guard', () => {
  it('scans a non-trivial number of source files', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('has no string-based addLog emitter anywhere', () => {
    expect(offenders(STRING_EMITTER)).toEqual([]);
  });

  it('confines the legacy string adapter to documented boundary files', () => {
    expect(offenders(ADAPTER_TOKENS, ADAPTER_ALLOWLIST)).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still uses the adapter', () => {
    const stale = [...ADAPTER_ALLOWLIST].filter(file => {
      if (file.endsWith('no-legacy-log-path.test.ts')) return false;
      let src: string;
      try {
        src = readFileSync(join(ROOT, file), 'utf8');
      } catch {
        return true; // file gone — prune the entry
      }
      return !ADAPTER_TOKENS.test(src);
    });
    expect(stale).toEqual([]);
  });
});
