/**
 * C3a — Authoritative active-ability inventory dump.
 *
 * Derives the inventory from the LIVE configuration (class_ability_assignments
 * joined to abilities and base_abilities), never from a hand-maintained list.
 *
 * Usage: bun scripts/dump-active-ability-inventory.ts
 * Output: src/shared/combat/inventory/active-abilities.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !KEY) throw new Error('missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY');

async function rest(path: string): Promise<any[]> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}` },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const [assignments, abilities, bases] = await Promise.all([
  rest('class_ability_assignments?select=*&status=eq.active&order=class_key,unlock_level'),
  rest('abilities?select=*'),
  rest('base_abilities?select=*'),
]);

const abilityById = new Map(abilities.map((a) => [a.id, a]));
const baseById = new Map(bases.map((b) => [b.id, b]));

const rows = assignments
  .map((caa) => {
    const a = abilityById.get(caa.ability_id);
    if (!a || a.status !== 'active') return null;
    const base = a.base_ability_id ? baseById.get(a.base_ability_id) : undefined;
    const pick = <T>(k: string, ...src: any[]): T | null => {
      for (const s of src) if (s && s[k] !== null && s[k] !== undefined) return s[k] as T;
      return null;
    };
    return {
      classKey: caa.class_key,
      classAbilityKey: caa.class_ability_key,
      abilityKey: a.ability_key,
      label: a.label,
      unlockLevel: caa.unlock_level,
      isDefault: caa.is_default ?? false,
      baseKey: base?.base_key ?? null,
      mechanic: pick<string>('mechanic_key', a, base),
      abilityType: a.ability_type ?? null,
      targetType: pick<string>('target_type', a, base) ?? base?.default_target_type ?? null,
      damageType: a.damage_type ?? null,
      activationMode: pick<string>('activation_mode', a, base),
      cpCost: pick<number>('cp_cost', a, base) ?? 0,
      cpReservePct: pick<number>('cp_reserve_pct', a, base),
      intervalMs: pick<number>('interval_ms', a, base),
      primaryAttribute: a.primary_attribute ?? null,
      secondaryAttribute: a.secondary_attribute ?? null,
      classScale: a.class_scale ?? null,
      appliedStatus: a.applied_status ?? null,
      statusTrigger: a.status_trigger ?? null,
      statusChancePct: a.status_chance_pct ?? null,
      statusApplicationEnabled: a.status_application_enabled ?? null,
      onHitEffect: a.on_hit_effect ?? null,
      amountCalc: pick('amount_calc', a, base),
      durationCalc: pick('duration_calc', a, base),
      mechanicCalcs: pick('mechanic_calcs', a, base) ?? {},
      effectConfig: pick('effect_config', a, base) ?? {},
      overrides: caa.overrides ?? {},
      triggerType: base?.trigger_type ?? null,
      capabilities: base?.capabilities ?? {},
    };
  })
  .filter(Boolean)
  .sort((x: any, y: any) =>
    x.classKey === y.classKey
      ? x.classAbilityKey.localeCompare(y.classAbilityKey)
      : x.classKey.localeCompare(y.classKey),
  );

const mechanics = [...new Set(rows.map((r: any) => r.mechanic))].sort();

const out = {
  generatedBy: 'scripts/dump-active-ability-inventory.ts',
  source: 'class_ability_assignments x abilities x base_abilities (status=active)',
  abilityCount: rows.length,
  mechanics,
  abilities: rows,
};

const target = resolve(import.meta.dir ?? '.', '../src/shared/combat/inventory/active-abilities.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${target}: ${rows.length} abilities, ${mechanics.length} mechanics`);
console.log(mechanics.join(', '));
