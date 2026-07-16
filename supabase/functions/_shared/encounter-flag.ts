/**
 * Feature flag for the M2 encounter-owned creature-HP write path.
 *
 * Exclusive: when `on`, `writeCreatureState` dispatches only through
 * `encounter_apply_damage`. When `off`, only the legacy `damage_creature`
 * path runs. Never both in the same tick.
 *
 * Optional allowlist `ENCOUNTER_HP_WRITES_NODE_IDS` (comma-separated node
 * ids) scopes the `on` state to a subset of nodes during rollout.
 */
export function readEncounterFlag(nodeId: string | null | undefined): boolean {
  const raw = (Deno.env.get('ENCOUNTER_HP_WRITES') ?? 'off').toLowerCase();
  if (raw !== 'on') return false;

  const allow = (Deno.env.get('ENCOUNTER_HP_WRITES_NODE_IDS') ?? '').trim();
  if (!allow) return true;
  if (!nodeId) return false;
  return allow.split(',').map((s) => s.trim()).includes(nodeId);
}
