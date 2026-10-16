import { supabase } from '@/integrations/supabase/client';

// Deliberately off until the database candidate and caller composition have been
// installed/verified. Never fall back to direct table mutations on RPC failure.
export const CREATURE_ADMIN_ENABLED = false;
export const CREATURE_ADMIN_GATE = 'Creature editing is disabled pending the new database authority cutover.';
export const CREATURE_CONFIG_KEYS = ['name', 'description', 'level', 'rarity', 'is_aggressive',
  'is_humanoid', 'respawn_seconds', 'boss_crit_flavors', 'boss_death_cry', 'boss_cast',
  'regen_percent_4s'] as const;
export type CreatureConfig = Record<string, unknown>;
export type CreatureAction = 'save' | 'create' | 'move' | 'delete';
export interface CreatureCommand {
  action: CreatureAction;
  id: string;
  expected: CreatureConfig;
  patch: CreatureConfig;
}
export type CreatureResult = { ok: boolean; kind: string; creatureId: string };

export function configuration(row: CreatureConfig): CreatureConfig {
  return Object.fromEntries(CREATURE_CONFIG_KEYS.map(k => [k,
    k === 'regen_percent_4s' ? String(row[k] ?? 2) : k === 'is_aggressive' ? row.base_aggressive ?? row.is_aggressive ?? false : row[k] ??
      (k === 'boss_cast' ? null : k === 'boss_crit_flavors' ? [] : k === 'boss_death_cry' ? '' : null)]));
}

export function configurationChange(before: CreatureConfig, desired: CreatureConfig) {
  const patch: CreatureConfig = {}, expected: CreatureConfig = {};
  for (const key of CREATURE_CONFIG_KEYS) {
    // Decimal representation is normalized before comparison; SQL validates it.
    const same = key === 'regen_percent_4s'
      ? Number(before[key]) === Number(desired[key])
      : JSON.stringify(before[key]) === JSON.stringify(desired[key]);
    if (!same) { patch[key] = desired[key]; expected[key] = before[key]; }
  }
  if ('level' in patch || 'rarity' in patch) {
    expected.level = before.level; expected.rarity = before.rarity;
    expected.max_hp = before.max_hp;
  }
  return { expected, patch };
}

export function decodeCreatureResult(value: unknown, id: string): CreatureResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.creatureId !== id || typeof r.ok !== 'boolean' || typeof r.kind !== 'string') return null;
  if (r.ok && !['updated', 'created', 'already_matches', 'deleted', 'already_absent'].includes(r.kind)) return null;
  if (!r.ok && !['not_authorized', 'invalid_request', 'stale', 'not_found', 'identity_exists',
    'combat_active', 'retained_references', 'integration_required', 'unsupported_boss'].includes(r.kind)) return null;
  return r as unknown as CreatureResult;
}

export async function mutateCreature(command: CreatureCommand): Promise<CreatureResult> {
  if (!CREATURE_ADMIN_ENABLED) throw new Error(CREATURE_ADMIN_GATE);
  const { data, error } = await supabase.rpc('admin_creature_mutate' as never, {
    _action: command.action, _creature_id: command.id,
    _expected: command.expected, _patch: command.patch,
  } as never);
  if (error) throw new Error(`Outcome unknown. Refresh/reconcile before changing this request: ${error.message}`);
  const result = decodeCreatureResult(data, command.id);
  if (!result) throw new Error('Outcome unknown: malformed creature response. Refresh and reconcile; do not create a new identity.');
  return result;
}
