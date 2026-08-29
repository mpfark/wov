/**
 * scripts/dump-mechanic-mapping.ts — evidence only.
 *
 * Prints the mapping of every ACTIVE authored ability onto the closed
 * replacement mechanic registry, generated from the existing adapter
 * (`buildAbilityCatalog`) and the existing active-ability inventory. It is not a
 * second source of truth: it reads exactly what the resolver reads.
 *
 *   bun scripts/dump-mechanic-mapping.ts
 */

import inventory from '../src/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, buildAbilitySpec, type AuthoredAbilityRecord } from '../src/shared/combat2/catalog';

const records = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;
const { rejected } = buildAbilityCatalog(records);
const refusals = new Map(rejected.map((r) => [`${r.classKey}:${r.abilityKey}`, r]));

const rows = records
  .map((record) => {
    const key = `${record.classKey}:${record.abilityKey}`;
    const refusal = refusals.get(key);
    if (refusal) {
      return {
        class: record.classKey,
        ability: record.abilityKey,
        authored: record.mechanic ?? 'null',
        resolved: '-',
        status: 'refused',
        reason: `${refusal.reason}${refusal.detail ? ` (${refusal.detail})` : ''}`,
      };
    }
    const built = buildAbilitySpec(record);
    const spec = 'spec' in built ? built.spec : null;
    return {
      class: record.classKey,
      ability: record.abilityKey,
      authored: spec?.authoredMechanic ?? String(record.mechanic),
      resolved: spec?.mechanic ?? '-',
      status: spec && spec.authoredMechanic !== spec.mechanic ? 'mapped (normalized)' : 'mapped',
      reason: '',
    };
  })
  .sort((a, b) => (a.class + a.ability).localeCompare(b.class + b.ability));

const widths = {
  class: Math.max(5, ...rows.map((r) => r.class.length)),
  ability: Math.max(7, ...rows.map((r) => r.ability.length)),
  authored: Math.max(8, ...rows.map((r) => r.authored.length)),
  resolved: Math.max(8, ...rows.map((r) => r.resolved.length)),
  status: Math.max(6, ...rows.map((r) => r.status.length)),
};
const pad = (s: string, n: number): string => s.padEnd(n);

console.log(
  [
    pad('class', widths.class),
    pad('ability', widths.ability),
    pad('authored', widths.authored),
    pad('resolved', widths.resolved),
    pad('status', widths.status),
    'reason',
  ].join('  '),
);
for (const r of rows) {
  console.log(
    [
      pad(r.class, widths.class),
      pad(r.ability, widths.ability),
      pad(r.authored, widths.authored),
      pad(r.resolved, widths.resolved),
      pad(r.status, widths.status),
      r.reason,
    ].join('  '),
  );
}

const byMechanic = new Map<string, number>();
for (const r of rows) {
  if (r.resolved === '-') continue;
  byMechanic.set(r.resolved, (byMechanic.get(r.resolved) ?? 0) + 1);
}
console.log(
  `\ntotal ${rows.length}  mapped ${rows.filter((r) => r.status.startsWith('mapped')).length}  refused ${
    rows.filter((r) => r.status === 'refused').length
  }`,
);
console.log(
  '\nresolved mechanic counts:\n' +
    [...byMechanic.entries()].sort().map(([k, v]) => `  ${k}: ${v}`).join('\n'),
);
