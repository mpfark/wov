/**
 * Contract: no resolver event type may silently fall into the legacy grey path.
 *
 * The type inventory is extracted from the authoritative resolver source, so a
 * newly emitted type fails here instead of shipping as unstyled debug prose —
 * which is exactly how `ability_crit` regressed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SERVER_EVENT_TYPES } from '../log-event';
import { STAGE10_SERVER_TYPES } from '../reward-event-builder';

const RESOLVER = 'src/shared/combat/pure/resolver.ts';

/** Every string literal that can be the first argument of an `emit(...)` call. */
function resolverEventTypes(): string[] {
  const src = readFileSync(RESOLVER, 'utf8');
  const types = new Set<string>();
  const re = /emit\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Scan the first argument only: stop at the top-level comma (or the
    // message template literal), so unrelated literals never leak in.
    let depth = 0;
    let head = '';
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const ch = src[i];
      if (ch === '`') break;
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) break;
      head += ch;
    }
    // A ternary selects between two literal types; a comparison against a
    // non-type literal is discarded by requiring the literal to follow `?`,
    // `:` or start the argument.
    const cleaned = head.replace(/[a-zA-Z0-9_.$\[\]]+\s*[=!]==?\s*'[a-z0-9_]+'/g, '');
    for (const lit of cleaned.matchAll(/'([a-z0-9_]+)'/g)) types.add(lit[1]);
  }
  return [...types].sort();
}

/** Types the client attack builder owns (prose authored client-side). */
const ATTACK_BUILDER_TYPES = new Set([
  'attack_hit',
  'attack_miss',
  'offhand_hit',
  'offhand_miss',
  'autoattack_hit',
  'autoattack_crit',
  'autoattack_miss',
  'creature_hit',
  'creature_crit',
  'creature_miss',
]);

/**
 * Acknowledged ambient lines: narration and world/system beats that render as
 * neutral log text on purpose. Outcome lines may never be listed here.
 */
const AMBIENT_BY_DESIGN = new Set([
  'aura_damage',
  'aura_heal',
  'boss_cast_channel',
  'boss_cast_evaded',
  'boss_cast_fizzle',
  'boss_death_cry',
  'character_died',
  'creature_killed',
  'debuff_miss',
  'proc_damage',
  'proc_debuff',
  'proc_heal',
  'regen_pulse',
  'regen_pulse_cp',
  'stat_point',
  'respec',
  'level_bonus',
]);

const OUTCOME_PREFIX = /^(?:ability|attack|autoattack|offhand|creature)_(?:hit|crit|miss)$/;

describe('server event coverage', () => {
  const emitted = resolverEventTypes();

  it('extracts a plausible inventory from the resolver', () => {
    expect(emitted.length).toBeGreaterThan(30);
    expect(emitted).toContain('ability_crit');
  });

  it('claims every emitted type', () => {
    const known = new Set<string>([
      ...SERVER_EVENT_TYPES,
      ...STAGE10_SERVER_TYPES,
      ...ATTACK_BUILDER_TYPES,
      ...AMBIENT_BY_DESIGN,
    ]);
    const unclaimed = emitted.filter((t) => !known.has(t));
    expect(unclaimed).toEqual([]);
  });

  it('never allows an attack or ability outcome to be merely ambient', () => {
    const structured = new Set<string>([...SERVER_EVENT_TYPES, ...ATTACK_BUILDER_TYPES]);
    const outcomes = emitted.filter((t) => OUTCOME_PREFIX.test(t));
    expect(outcomes.filter((t) => !structured.has(t))).toEqual([]);
    expect(outcomes.filter((t) => AMBIENT_BY_DESIGN.has(t))).toEqual([]);
  });
});
