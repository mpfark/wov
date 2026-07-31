/**
 * Canonical damage types for authored content (crit flavors, boss casts,
 * abilities). Thin admin-facing view over the shared registry in
 * `@/shared/combat/damage-types` — that module is the single source of truth.
 */
import { DAMAGE_TYPE_OPTIONS, type DamageTypeKey } from '@/shared/combat/damage-types';

export const DAMAGE_TYPES = DAMAGE_TYPE_OPTIONS;

export const DAMAGE_TYPE_NONE = 'none';

export type DamageTypeValue = DamageTypeKey;
