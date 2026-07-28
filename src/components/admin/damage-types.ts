/**
 * Canonical damage types for authored boss content (crit flavors, boss casts).
 * Kept as a closed list so admins pick instead of typing (no typo drift).
 */
export const DAMAGE_TYPES = [
  { value: 'physical', label: '⚔️ Physical' },
  { value: 'fire', label: '🔥 Fire' },
  { value: 'frost', label: '❄️ Frost' },
  { value: 'lightning', label: '⚡ Lightning' },
  { value: 'poison', label: '🧪 Poison' },
  { value: 'necrotic', label: '💀 Necrotic' },
  { value: 'holy', label: '✨ Holy' },
  { value: 'shadow', label: '🌑 Shadow' },
  { value: 'arcane', label: '🔮 Arcane' },
  { value: 'psychic', label: '🌀 Psychic' },
] as const;

export const DAMAGE_TYPE_NONE = 'none';

export type DamageTypeValue = (typeof DAMAGE_TYPES)[number]['value'];
