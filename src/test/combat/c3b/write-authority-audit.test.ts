/**
 * C3b — static write-authority audit.
 *
 * Two invariants that must hold across the whole repository, not just in one
 * file:
 *   1. No authoritative combat write exists outside commit_encounter_tick_v2.
 *   2. The deleted legacy execution modules have no reference left anywhere —
 *      static import, dynamic import(), or string path.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'supabase/functions'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '__snapshots__']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = ROOTS.flatMap(r => walk(r));

/**
 * Code only. Prose in a doc comment may legitimately name a retired module or
 * describe randomness that no longer exists, and an audit that reads comments
 * measures documentation, not behaviour.
 */
function code(p: string): string {
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Modules retired with the legacy execution paths, by deployed path. */
const DELETED_MODULES = [
  '_shared/combat-resolver',
  '_shared/kill-resolver',
  '_shared/ability-telemetry',
  '_shared/reward-calculator',
  'combat/tick-commit',
  'combat/tick-owner',
  'combat/proc-runtime',
  'combat/cast-events',
  'combat/offense-buff',
];

/**
 * Tables only `commit_encounter_tick_v2` may write during combat resolution.
 * Non-combat game features (blacksmith, marketplace, admin tools, movement)
 * legitimately touch characters/inventory, so the audit is scoped to the
 * combat surface: the two handlers and the shared combat modules.
 */
const COMBAT_SOURCES = FILES.filter(f =>
  !f.includes('__tests__') && !f.includes('/test/') &&
  (f.startsWith('supabase/functions/combat-tick/') ||
    f.startsWith('supabase/functions/combat-catchup/') ||
    f.startsWith('supabase/functions/_shared/combat/') ||
    f.startsWith('src/shared/combat/')));

const AUTHORITATIVE_TABLES = [
  'characters', 'creatures', 'active_effects', 'encounter_kill_awards',
  'encounter_death_loot', 'encounter_tick_batches',
  'encounter_engagements', 'encounter_cast_events', 'node_ground_loot',
  'combat_actions', 'character_inventory', 'character_materials',
];

describe('C3b — deleted legacy modules are unreferenced', () => {
  it('has no static import, dynamic import or path string for any retired module', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.includes('write-authority-audit')) continue;
      const src = code(file);
      for (const mod of DELETED_MODULES) {
        if (src.includes(`${mod}.ts`) || src.includes(`${mod}'`) || src.includes(`${mod}"`)) {
          offenders.push(`${file} -> ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses no dynamic import() inside the combat execution surface', () => {
    const offenders = COMBAT_SOURCES.filter(f => /\bimport\s*\(/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});

describe('C3b — commit_encounter_tick_v2 is the only authoritative writer', () => {
  it('performs no table mutation anywhere in the combat surface', () => {
    const offenders: string[] = [];
    for (const file of COMBAT_SOURCES) {
      const src = code(file);
      for (const table of AUTHORITATIVE_TABLES) {
        const pattern = new RegExp(`from\\(['"\`]${table}['"\`]\\)[\\s\\S]{0,200}?\\.(update|insert|upsert|delete)\\(`);
        if (pattern.test(src)) offenders.push(`${file} -> ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('calls no legacy mutation RPC from the combat surface', () => {
    const forbidden = [
      'encounter_apply_damage', 'encounter_apply_heal', 'encounter_apply_character_damage',
      'encounter_apply_character_heal', 'encounter_apply_character_resource',
      'commit_encounter_tick', 'award_party_member', 'damage_party_member',
      'grant_searched_item', 'encounter_stored_power_add', 'encounter_stored_power_consume',
    ];
    const offenders: string[] = [];
    for (const file of COMBAT_SOURCES) {
      const src = code(file);
      for (const fn of forbidden) {
        // `commit_encounter_tick_v2` is the permitted writer; the quoted-literal
        // match is exact, so it is not confused with its legacy predecessor.
        if (new RegExp(`['"\`]${fn}['"\`]`).test(src)) offenders.push(`${file} -> ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('draws no randomness outside the seeded tick RNG', () => {
    const offenders = COMBAT_SOURCES
      .filter(f => !f.endsWith('tick-rng.ts'))
      .filter(f => /Math\.random/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});

