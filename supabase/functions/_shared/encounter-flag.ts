/**
 * Feature flag for the M2 encounter-owned creature-HP write path.
 *
 * Three modes (env `ENCOUNTER_HP_WRITES`):
 *   • `off`     — only the legacy `damage_creature` path runs. (default)
 *   • `shadow`  — legacy path is authoritative; `encounter_apply_damage_dry_run`
 *                 is invoked in parallel per creature and any HP / kill /
 *                 aggression divergence is logged. No gameplay impact.
 *   • `on`      — `writeCreatureState` dispatches only through
 *                 `encounter_apply_damage`. Legacy path is skipped.
 *
 * Optional allowlist `ENCOUNTER_HP_WRITES_NODE_IDS` (comma-separated node
 * ids) scopes the non-`off` state to a subset of nodes during rollout.
 */
export type EncounterFlagMode = 'off' | 'shadow' | 'on';

export function readEncounterFlagMode(nodeId: string | null | undefined): EncounterFlagMode {
  const raw = (Deno.env.get('ENCOUNTER_HP_WRITES') ?? 'off').toLowerCase();
  const mode: EncounterFlagMode = raw === 'on' ? 'on' : raw === 'shadow' ? 'shadow' : 'off';
  if (mode === 'off') return 'off';

  const allow = (Deno.env.get('ENCOUNTER_HP_WRITES_NODE_IDS') ?? '').trim();
  if (!allow) return mode;
  if (!nodeId) return 'off';
  return allow.split(',').map((s) => s.trim()).includes(nodeId) ? mode : 'off';
}

/**
 * Legacy boolean helper — true only when the encounter path is authoritative.
 * Shadow mode returns false because gameplay writes still go through the
 * legacy `damage_creature` path.
 */
export function readEncounterFlag(nodeId: string | null | undefined): boolean {
  return readEncounterFlagMode(nodeId) === 'on';
}
