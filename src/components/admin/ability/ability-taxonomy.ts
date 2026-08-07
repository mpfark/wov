/**
 * Shared taxonomy vocabularies for the ability admin surfaces.
 *
 * Kept in one module so the Base Ability editor, the authored (class) ability
 * editor and the create dialogs can never drift apart.
 */
export const ABILITY_TYPES = ['damage', 'heal', 'buff', 'debuff', 'utility'] as const;
export const ACTIVATION_MODES = ['instant', 'queued', 'stance'] as const;
export const TARGET_TYPES = ['self', 'ally', 'enemy', 'party', 'node'] as const;

/** How a base ability's follow-up status is triggered. */
export const TRIGGER_TYPES = [
  { value: 'none', label: 'None — resolves immediately on activation' },
  { value: 'on_hit', label: 'On weapon hit — subsequent weapon hits carry the status' },
  { value: 'pulse', label: 'Automatic attack — the stance attacks on its own interval' },
] as const;

/** Configuration sections a base ability may expose on its class abilities. */
export const CAPABILITY_SECTIONS = [
  { key: 'identity', label: 'Identity and class' },
  { key: 'activation', label: 'Activation and targeting' },
  { key: 'damage', label: 'Damage configuration' },
  { key: 'scaling', label: 'Scaling attributes' },
  { key: 'damage_type', label: 'Damage type' },
  { key: 'amount', label: 'Amount / magnitude' },
  { key: 'duration', label: 'Duration' },
  { key: 'interval', label: 'Tick interval' },
  { key: 'combat_text', label: 'Combat flavour text' },
  { key: 'stance', label: 'Stance configuration' },
  { key: 'status_application', label: 'Status application' },
] as const;

export type CapabilityKey = typeof CAPABILITY_SECTIONS[number]['key'];

/** Read a base ability's capability list defensively. */
export function capabilityList(raw: unknown): CapabilityKey[] {
  if (!Array.isArray(raw)) return [];
  const known = CAPABILITY_SECTIONS.map(c => c.key) as string[];
  return raw.filter((k): k is CapabilityKey => typeof k === 'string' && known.includes(k));
}

export function hasCapability(raw: unknown, key: CapabilityKey): boolean {
  return capabilityList(raw).includes(key);
}
