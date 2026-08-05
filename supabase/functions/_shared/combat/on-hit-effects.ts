/**
 * on-hit-effects.ts — THE typed registry for optional On-Hit Effects.
 *
 * Phase 2 of the ability-consolidation model. A reusable base ability may
 * DECLARE which on-hit effects it supports (`abilities.effect_config.on_hit_allowed`),
 * and a class assignment may CONFIGURE at most one of them
 * (`class_ability_assignments.overrides.on_hit_effect`).
 *
 * Guarantees:
 *  - Server-authoritative: the trigger roll happens only on the server, after a
 *    hit has already landed. A miss can never apply an on-hit effect.
 *  - Bounded: chance, duration, per-tick damage and stack cap are range-checked
 *    in three places (SQL trigger, this module, admin UI) with identical bounds.
 *  - Reuses the existing persistent DoT machinery — an on-hit effect writes an
 *    ordinary `active_effects` row of a known `effect_type`, so ticking, purging
 *    and offscreen reconciliation need no new code path.
 *
 * Mirrored (modulo Deno `.ts` specifiers) to
 * `supabase/functions/_shared/combat/on-hit-effects.ts`.
 */

export type OnHitEffectKey = 'bleed' | 'poison' | 'ignite';

export interface OnHitEffectDef {
  key: OnHitEffectKey;
  label: string;
  /** `active_effects.effect_type` written when the effect triggers. */
  effectType: string;
  /** Canonical damage type carried into the log for this effect. */
  damageType: string;
  /** Hard ceiling on stacks regardless of configuration. */
  stackCeiling: number;
  description: string;
}

export const ON_HIT_EFFECTS: Record<OnHitEffectKey, OnHitEffectDef> = {
  bleed: {
    key: 'bleed', label: 'Bleed', effectType: 'bleed', damageType: 'physical',
    stackCeiling: 5,
    description: 'An open wound that ticks physical damage.',
  },
  poison: {
    key: 'poison', label: 'Poison', effectType: 'poison', damageType: 'poison',
    stackCeiling: 5,
    description: 'A stacking venom that ticks poison damage and fuels finishers.',
  },
  ignite: {
    key: 'ignite', label: 'Burn', effectType: 'ignite', damageType: 'fire',
    stackCeiling: 5,
    description: 'A burn that ticks fire damage and fuels consume-style abilities.',
  },
};

export const ON_HIT_EFFECT_KEYS = Object.keys(ON_HIT_EFFECTS) as OnHitEffectKey[];

/** Configuration authored on a class assignment. */
export interface OnHitEffectConfig {
  effect: OnHitEffectKey;
  /** 1–100. Rolled once per landed hit. */
  chance_pct: number;
  /** 1000–60000 ms. */
  duration_ms: number;
  /** 0–200. Omitted / 0 means the effect applies no direct tick damage. */
  damage_per_tick?: number;
  /** 1–10, further clamped by the effect's `stackCeiling`. */
  max_stacks?: number;
}

export const ON_HIT_BOUNDS = {
  chance_pct: { min: 1, max: 100 },
  duration_ms: { min: 1000, max: 60_000 },
  damage_per_tick: { min: 0, max: 200 },
  max_stacks: { min: 1, max: 10 },
} as const;

const ALLOWED_FIELDS = ['effect', 'chance_pct', 'duration_ms', 'damage_per_tick', 'max_stacks'];

/** Effects a base ability declares support for. */
export function allowedOnHitEffects(
  effectConfig: Record<string, unknown> | null | undefined,
): OnHitEffectKey[] {
  const raw = effectConfig?.on_hit_allowed;
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is OnHitEffectKey =>
    typeof k === 'string' && (ON_HIT_EFFECT_KEYS as string[]).includes(k));
}

function numberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validate one authored on-hit effect against the base ability's allowlist.
 * Returns human-readable errors; empty means the config may be applied.
 */
export function validateOnHitEffect(
  config: unknown,
  allowed: OnHitEffectKey[],
): string[] {
  const errors: string[] = [];
  if (config === null || config === undefined) return errors;
  if (typeof config !== 'object' || Array.isArray(config)) {
    return ['on_hit_effect must be an object'];
  }
  const c = config as Record<string, unknown>;

  for (const key of Object.keys(c)) {
    if (!ALLOWED_FIELDS.includes(key)) errors.push(`on_hit_effect.${key}: unknown field`);
  }

  const effect = c.effect;
  if (typeof effect !== 'string' || !(ON_HIT_EFFECT_KEYS as string[]).includes(effect)) {
    errors.push(`on_hit_effect.effect: invalid effect "${String(effect)}"`);
  } else if (!allowed.includes(effect as OnHitEffectKey)) {
    errors.push(`on_hit_effect.effect: base ability does not allow on-hit effect "${effect}"`);
  }

  if (!numberInRange(c.chance_pct, ON_HIT_BOUNDS.chance_pct.min, ON_HIT_BOUNDS.chance_pct.max)) {
    errors.push('on_hit_effect.chance_pct must be a number between 1 and 100');
  }
  if (!numberInRange(c.duration_ms, ON_HIT_BOUNDS.duration_ms.min, ON_HIT_BOUNDS.duration_ms.max)) {
    errors.push('on_hit_effect.duration_ms must be a number between 1000 and 60000');
  }
  if (c.damage_per_tick !== undefined
    && !numberInRange(c.damage_per_tick, ON_HIT_BOUNDS.damage_per_tick.min, ON_HIT_BOUNDS.damage_per_tick.max)) {
    errors.push('on_hit_effect.damage_per_tick must be a number between 0 and 200');
  }
  if (c.max_stacks !== undefined
    && !numberInRange(c.max_stacks, ON_HIT_BOUNDS.max_stacks.min, ON_HIT_BOUNDS.max_stacks.max)) {
    errors.push('on_hit_effect.max_stacks must be a number between 1 and 10');
  }

  return errors;
}

export interface OnHitTrigger {
  def: OnHitEffectDef;
  durationMs: number;
  damagePerTick: number;
  maxStacks: number;
}

/**
 * Pure trigger decision: `roll` is a caller-supplied 0..1 sample so the caller
 * owns randomness (and tests are deterministic). Returns null when the effect
 * does not trigger, or the configuration is absent/invalid.
 *
 * MUST only be called after a hit has landed.
 */
export function rollOnHitEffect(
  config: OnHitEffectConfig | null | undefined,
  roll: number,
): OnHitTrigger | null {
  if (!config) return null;
  const def = ON_HIT_EFFECTS[config.effect];
  if (!def) return null;
  if (validateOnHitEffect(config, [config.effect]).length > 0) return null;
  if (roll >= config.chance_pct / 100) return null;
  return {
    def,
    durationMs: Math.round(config.duration_ms),
    damagePerTick: Math.max(0, Math.round(config.damage_per_tick ?? 0)),
    maxStacks: Math.min(def.stackCeiling, Math.max(1, Math.round(config.max_stacks ?? 1))),
  };
}
