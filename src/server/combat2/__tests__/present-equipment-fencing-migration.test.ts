import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'supabase/migrations/20261001100000_combat2_present_equipment_fencing.sql';
const sql = readFileSync(PATH, 'utf8').replaceAll('\r\n', '\n');
const base = readFileSync(
  'supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql',
  'utf8',
).replaceAll('\r\n', '\n');
const start = base.indexOf('CREATE OR REPLACE FUNCTION public.node_tick_claim(');
const end = base.indexOf('REVOKE ALL ON FUNCTION public.node_tick_claim(', start);
const repositoryPredecessor = base.slice(start, end)
  .replace('public.node_tick_claim(', 'public.node_tick_claim_without_canary_gate(');

const equipmentProjectionPattern = /(FROM\s+public\.character_inventory\s+ci\s+LEFT\s+JOIN\s+public\.items\s+it\s+ON\s+it\.id\s*=\s*ci\.item_id\s+WHERE\s+ci\.character_id\s*=\s*ch\.id)(\s+AND\s+ci\.equipped_slot\s+IS\s+NOT\s+NULL)/gs;

function patchDefinition(definition: string): string {
  const matches = [...definition.matchAll(equipmentProjectionPattern)];
  if (matches.length !== 1) throw new Error(`expected one equipment projection, found ${matches.length}`);
  return definition.replace(equipmentProjectionPattern, '$1 AND nf.present$2');
}

function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let startAt = 0;
  for (let i = 0; i < source.length;) {
    if (source.startsWith('--', i)) {
      const newline = source.indexOf('\n', i + 2);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === quote) {
          if (source[i + 1] === quote) { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    if (quote === '$') {
      const delimiter = source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const close = source.indexOf(delimiter, i + delimiter.length);
        if (close < 0) throw new Error(`unclosed SQL dollar quote ${delimiter}`);
        i = close + delimiter.length;
        continue;
      }
    }
    if (quote === ';') {
      statements.push(source.slice(startAt, i + 1).trim());
      startAt = i + 1;
    }
    i++;
  }
  if (source.slice(startAt).trim()) throw new Error('trailing incomplete SQL statement');
  return statements.filter(Boolean);
}

describe('Combat2 present-fighter equipment fencing migration', () => {
  it('patches only the actual equipment projection and preserves historical fighters', () => {
    const patched = patchDefinition(repositoryPredecessor);
    expect(patched).toContain('WHERE ci.character_id = ch.id AND nf.present AND ci.equipped_slot IS NOT NULL');
    expect(patched).toContain("'fighters', COALESCE((");
    expect(patched).toContain('WHERE nf.encounter_id = e.id');
    expect(patched).not.toContain('WHERE nf.encounter_id = e.id AND nf.present');
  });

  it('accepts insignificant whitespace and fails closed on zero or multiple projections', () => {
    const compact = repositoryPredecessor.replace(
      'WHERE ci.character_id = ch.id AND ci.equipped_slot IS NOT NULL',
      'WHERE\n ci.character_id=ch.id\tAND\nci.equipped_slot IS NOT NULL',
    );
    expect(patchDefinition(compact)).toMatch(/ch\.id AND nf\.present\s+AND\s+ci\.equipped_slot/);
    expect(() => patchDefinition(repositoryPredecessor.replace('ci.equipped_slot IS NOT NULL', 'ci.equipped_slot IS NULL')))
      .toThrow('found 0');
    expect(() => patchDefinition(`${repositoryPredecessor}\n${repositoryPredecessor}`)).toThrow('found 2');
  });

  it('retains claim authority, wrapper composition and schema-aware guards', () => {
    for (const marker of [
      "owner_name <> 'postgres'", 'NOT security_definer', "volatility <> 'v'",
      "settings IS DISTINCT FROM ARRAY['search_path=public']::text[]",
      "column_name = 'present'", "data_type = 'boolean'", "column_name = 'equipped_slot'",
      'p.proacl IS NOT DISTINCT FROM acl', 'p.proowner = owner_oid',
      'public.node_tick_claim_without_boss_timing(uuid,integer)',
    ]) expect(sql).toContain(marker);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.node_tick_claim\s*\(/i);
  });

  it('preserves commit protection for changed, forged and omitted present equipment', () => {
    const commit = readFileSync(
      'supabase/migrations/20260909195259_2f0ee956-21cb-4eeb-94ff-2be48319b7af.sql',
      'utf8',
    );
    for (const marker of [
      'nf.character_id=x.character_id AND nf.entry_seq=x.entry_seq AND nf.present',
      'ci.current_durability=x.durability',
      'ci.applied_gems=x.applied_gems',
      "ci.stat_override IS NOT DISTINCT FROM x.stat_override",
      "NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence'",
      "'loadout_changed'",
    ]) expect(commit).toContain(marker);
  });

  it('contains complete runner-compatible statements without a trailing postflight block', () => {
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements.every(statement => statement.endsWith(';'))).toBe(true);
    expect(statements.some(statement => /^(BEGIN|COMMIT|ROLLBACK)\s*;$/i.test(statement))).toBe(false);
    expect(statements[0]).toMatch(/^--[\s\S]*DO \$migration\$/);
    expect(statements[1]).toMatch(/^COMMENT ON FUNCTION/);
  });
});
