/** Read-only authoring export. Then run node scripts/publish-abilities.mjs. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex < 0
  ? resolve(import.meta.dirname, '../src/shared/combat/inventory/ability-publication-source.json')
  : resolve(process.argv[outputIndex + 1]);
const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing Supabase export configuration');
async function rest(path: string): Promise<any[]> {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key!, Authorization: `Bearer ${key!}` } });
  if (!res.ok) throw new Error(`Configuration export failed: ${res.status}`);
  return res.json();
}
const [assignments, abilities, bases, statuses, roles, classes] = await Promise.all([
  rest('class_ability_assignments?select=*&status=eq.active&order=class_key,class_ability_key'),
  rest('abilities?select=*'), rest('base_abilities?select=*'),
  rest('applied_statuses?select=*&order=key'), rest('class_ability_roles?select=*'), rest('classes?select=*'),
]);
const byId = (rows: any[]) => new Map(rows.map(row => [row.id, row]));
const abilityById = byId(abilities), baseById = byId(bases), roleById = byId(roles);
const source = {
  provenance: 'Read-only database authoring export; publication uses shared composition', classes, statuses,
  assignments: assignments.map(row => {
    const ability = abilityById.get(row.ability_id);
    if (!ability) throw new Error(`Missing ability for ${row.class_ability_key}`);
    return { ...row, role: roleById.get(row.role_id), ability: { ...ability, base: baseById.get(ability.base_ability_id) } };
  }),
};
writeFileSync(outputPath,
  JSON.stringify(source, null, 2) + '\n');
console.log(`Exported ${assignments.length} assignments. Run publication and review the diff.`);
