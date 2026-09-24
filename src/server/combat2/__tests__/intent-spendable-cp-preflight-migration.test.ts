import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const file = 'supabase/migrations/20260924110000_combat2_intent_spendable_cp_preflight.sql';
const sql = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const typesFile = 'src/integrations/supabase/types.ts';

function databaseMember(path: readonly string[]): ts.Type {
  const program = ts.createProgram([typesFile], { noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(typesFile);
  const database = source?.statements.find((node): node is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(node) && node.name.text === 'Database');
  if (!database) throw new Error('generated Database type is missing');
  let type = checker.getTypeFromTypeNode(database.type);
  for (const name of path) {
    const symbol = type.getProperty(name);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (!symbol || !declaration) throw new Error(`generated Database member is missing: ${path.join('.')}`);
    type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  }
  return type;
}

function generatedFields(table: string): Set<string> {
  return new Set(databaseMember(['public', 'Tables', table, 'Row']).getProperties().map((field) => field.name));
}

function referencedFields(alias: string): Set<string> {
  return new Set([...sql.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'g'))]
    .map((match) => match[1]).filter((field) => field !== 'id' || !alias.startsWith('_')));
}

const rowTypes: Readonly<Record<string, string>> = {
  v_existing: 'node_intent',
  v_character: 'characters',
  v_fighter: 'node_fighter',
};
const aliases: Readonly<Record<string, string>> = {
  ca: 'class_ability_assignments',
  a: 'abilities',
  ba: 'base_abilities',
  ne: 'node_effect',
  c: 'characters',
  nf: 'node_fighter',
};

describe('Combat2 intent spendable-CP preflight migration', () => {
  it('keeps the installed queue authority private behind the public eight-argument contract', () => {
    expect(sql).toContain('ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)');
    expect(sql).toContain('RENAME TO combat_intent_without_spendable_cp_preflight');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO authenticated, service_role');
  });

  it('type-checks every composite and qualified row field against the generated schema contract', () => {
    for (const [alias, table] of Object.entries({ ...rowTypes, ...aliases })) {
      const fields = generatedFields(table);
      const references = referencedFields(alias);
      expect(references.size, `${alias} should have mapped SQL fields`).toBeGreaterThan(0);
      for (const field of references) expect(fields.has(field), `${alias}.${field} must exist on ${table}.Row`).toBe(true);
    }
    expect(generatedFields('characters').has('max_cp')).toBe(true);
    expect(generatedFields('node_fighter').has('max_cp')).toBe(false);
    expect(referencedFields('v_fighter').has('max_cp')).toBe(false);
    expect(referencedFields('v_character').has('max_cp')).toBe(true);

    const args = new Set(databaseMember(['public', 'Functions', 'combat_intent', 'Args'])
      .getProperties().map((field) => field.name));
    expect(args).toEqual(new Set(['_encounter_id', '_character_id', '_intent_kind', '_ability_key',
      '_stance_key', '_target_creature_id', '_target_character_id', '_request_id']));
  });

  it('guards the complete prerequisite schema and installed predecessor before renaming it', () => {
    const guard = sql.slice(sql.indexOf('DO $$'), sql.indexOf('ALTER FUNCTION public.combat_intent'));
    for (const [alias, table] of Object.entries({ ...rowTypes, ...aliases })) {
      for (const field of referencedFields(alias)) {
        expect(guard, `${table}.${field} must be guarded`).toContain(`('${table}','${field}')`);
      }
    }
    expect(guard).toContain("table_name = 'node_fighter' AND column_name = 'max_cp'");
    expect(guard).toContain("pg_get_functiondef('public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)'::regprocedure)");
    expect(guard).toContain("to_regprocedure('public.combat_intent_without_ability_support_gate(uuid,uuid,text,text,text,uuid,uuid)')");
    expect(guard).toContain("position('combat_intent_without_ability_support_gate' IN v_predecessor)");
  });

  it('makes request replay payload-exact before returning the installed idempotent result', () => {
    for (const field of ['encounter_id', 'character_id', 'intent_kind', 'ability_key', 'stance_key',
      'target_creature_id', 'target_character_id']) {
      expect(sql).toContain(`v_existing.${field} IS DISTINCT FROM _${field}`);
    }
    expect(sql).toContain("'reason', 'request_id_conflict'");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('combat_intent:' || _character_id::text, 0))");
  });

  it('uses authored CP fields and active authoritative reservations without queuing on refusal', () => {
    expect(sql).toContain('COALESCE(a.cp_cost, ba.cp_cost, 0)');
    expect(sql).toContain('COALESCE(a.cp_reserve_pct, ba.cp_reserve_pct, 0)');
    expect(sql).toContain('ne.target_character_id = _character_id');
    expect(sql).toContain('AND ne.is_reservation');
    expect(sql).toContain('v_available := GREATEST(0, COALESCE(v_character.cp, 0) - v_reserved)');
    expect(sql).toContain('nf.character_id = v_character.id');
    expect(sql).toContain('COALESCE(v_character.max_cp, 0)');
    expect(sql).not.toContain('v_fighter.max_cp');
    expect(sql).toContain("CASE WHEN _intent_kind = 'stance_activate'");
    expect(sql).toContain("'kind', 'insufficient_resource'");
    expect(sql).toContain("'reason', 'insufficient_cp'");
    const refusal = sql.indexOf("'reason', 'insufficient_cp'");
    const delegate = sql.lastIndexOf('RETURN public.combat_intent_without_spendable_cp_preflight(');
    expect(refusal).toBeGreaterThan(0);
    expect(delegate).toBeGreaterThan(refusal);
  });
});
