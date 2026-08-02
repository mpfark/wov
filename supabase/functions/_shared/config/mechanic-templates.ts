/**
 * mechanic-templates.ts — Registry of coded mechanic handlers and the *named,
 * typed* calculation parameters each one exposes.
 *
 * CANONICAL OWNER for: which named mechanic calcs an ability row may carry, what
 * each one means (label, unit, role, required-ness), and which of
 * `amount_calc` / `duration_calc` / `interval_ms` an *active* row must provide.
 *
 * There is deliberately **no `bonus_calc` catch-all**. Every tunable a coded
 * handler owns is declared here with its own semantic key, so the admin builder
 * can render it with the right unit and the validator can reject anything
 * unknown. Standing rule: no handler ships with hardcoded magnitudes.
 *
 * Fully-wired policy: a parameter only exists here if a coded consumer actually
 * reads it. Parameters that merely duplicated `amount_calc` (a mechanic's single
 * headline magnitude — proc chance, damage reduction, root reduction, ambush
 * multiplier, per-tick regen …) were removed rather than left as dead knobs
 * that silently shadow the amount curve.
 *
 * Stored shape: `abilities.mechanic_calcs jsonb` = `{ [paramKey]: AbilityCalc }`.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/config/mechanic-templates.ts`.
 */

import { validateCalc, type AbilityCalc } from '../formulas/ability-calc.ts';

export type MechanicCalcParamKey =
  | 'arrow_count'
  | 'max_stacks' | 'per_stack_multiplier'
  | 'pulse_damage' | 'burn_damage'
  | 'block_chance' | 'block_amount'
  | 'crit_edge' | 'retaliation_damage'
  | 'reserve_hp' | 'cp_per_tick';

export type MechanicCalcUnit = 'count' | 'pct' | 'mult' | 'hp' | 'cp' | 'flat' | 'ms';

export type MechanicCalcRole = 'magnitude' | 'rate' | 'multiplier' | 'chance' | 'threshold';

export interface MechanicCalcParam {
  key: MechanicCalcParamKey;
  label: string;
  unit: MechanicCalcUnit;
  required: boolean;
  role: MechanicCalcRole;
}

export type StackType = 'poison_stacks' | 'burn_stacks';

export interface StackOpSpec {
  stackType: StackType;
  op: 'apply' | 'consume_all' | 'consume_n';
  timing: 'on_hit' | 'on_commit';
  owner: 'target';
}

export interface MechanicTemplate {
  mechanicKey: string;
  supportsAmount: boolean;
  supportsDuration: boolean;
  supportsInterval: boolean;
  /**
   * Hard requirements for an *active* ability row. The coded handler has no
   * fallback formula, so publishing without these would resolve to a constant
   * safety floor at runtime — the validator rejects the row instead.
   */
  requiresAmount: boolean;
  requiresDuration: boolean;
  requiresInterval: boolean;
  params: MechanicCalcParam[];
  requiresStackOp?: StackOpSpec;
}

/** Canonical mapping from configurable stack names to `active_effects.effect_type`. */
export const STACK_EFFECT_TYPE: Record<StackType, 'poison' | 'ignite'> = {
  poison_stacks: 'poison',
  burn_stacks: 'ignite',
};

const P = (
  key: MechanicCalcParamKey,
  label: string,
  unit: MechanicCalcUnit,
  role: MechanicCalcRole,
  required = false,
): MechanicCalcParam => ({ key, label, unit, role, required });

function t(
  mechanicKey: string,
  opts: {
    amount?: boolean; duration?: boolean; interval?: boolean;
    requiresAmount?: boolean; requiresDuration?: boolean; requiresInterval?: boolean;
    params?: MechanicCalcParam[];
    stackOp?: StackOpSpec;
  } = {},
): MechanicTemplate {
  const supportsAmount = opts.amount ?? true;
  const supportsDuration = opts.duration ?? false;
  const supportsInterval = opts.interval ?? false;
  return {
    mechanicKey,
    supportsAmount,
    supportsDuration,
    supportsInterval,
    requiresAmount: supportsAmount && (opts.requiresAmount ?? false),
    requiresDuration: supportsDuration && (opts.requiresDuration ?? false),
    requiresInterval: supportsInterval && (opts.requiresInterval ?? false),
    params: opts.params ?? [],
    ...(opts.stackOp ? { requiresStackOp: opts.stackOp } : {}),
  };
}

/**
 * Every mechanic key currently referenced by an `abilities` row, with its
 * declared named calc parameters.
 */
export const MECHANIC_TEMPLATES: MechanicTemplate[] = [
  // ── Weapon-scaled direct attacks ──────────────────────────────
  t('power_strike', { requiresAmount: true }),
  t('aimed_shot', { requiresAmount: true }),
  t('backstab', { requiresAmount: true }),
  t('fireball', { requiresAmount: true }),
  t('smite', { requiresAmount: true }),
  t('cutting_words', { requiresAmount: true }),
  t('consecrate', {
    duration: true, interval: true,
    requiresAmount: true, requiresDuration: true, requiresInterval: true,
  }),

  // ── Stack mechanics ───────────────────────────────────────────
  // `amount_calc` is the proc chance; `max_stacks` is the separate ceiling.
  t('poison_buff', {
    requiresAmount: true,
    params: [P('max_stacks', 'Maximum stacks', 'count', 'threshold', true)],
    stackOp: { stackType: 'poison_stacks', op: 'apply', timing: 'on_hit', owner: 'target' },
  }),
  t('execute_attack', {
    requiresAmount: true,
    params: [P('per_stack_multiplier', 'Bonus per consumed stack', 'mult', 'multiplier', true)],
    stackOp: { stackType: 'poison_stacks', op: 'consume_all', timing: 'on_commit', owner: 'target' },
  }),
  // `amount_calc` is the orb pulse chance; the remaining burn behavior is
  // explicitly configurable and consumed by combat-tick.
  t('ignite_buff', {
    duration: true, interval: true,
    requiresAmount: true, requiresDuration: true, requiresInterval: true,
    params: [
      P('pulse_damage', 'Orb pulse damage', 'hp', 'magnitude', true),
      P('burn_damage', 'Burn damage per tick', 'hp', 'magnitude', true),
      P('max_stacks', 'Maximum burn stacks', 'count', 'threshold', true),
    ],
    stackOp: { stackType: 'burn_stacks', op: 'apply', timing: 'on_hit', owner: 'target' },
  }),
  t('ignite_consume', {
    requiresAmount: true,
    params: [P('per_stack_multiplier', 'Bonus per consumed stack', 'mult', 'multiplier', true)],
    stackOp: { stackType: 'burn_stacks', op: 'consume_all', timing: 'on_commit', owner: 'target' },
  }),

  // ── Multi-hit ─────────────────────────────────────────────────
  // `amount_calc` is the FULL per-arrow magnitude (weapon die + stat), so there
  // is no separate per-arrow ratio knob.
  t('multi_attack', {
    requiresAmount: true,
    params: [
      P('arrow_count', 'Number of arrows', 'count', 'magnitude', true),
    ],
  }),
  t('burst_damage', {
    requiresAmount: true,
    params: [P('crit_edge', 'Crit range widening', 'flat', 'threshold', true)],
  }),

  // ── Buffs / mitigation ────────────────────────────────────────
  // `amount_calc` carries the headline magnitude of each buff (damage
  // reduction, absorb pool, crit widening, ambush multiplier, …).
  t('battle_cry', { duration: true, requiresAmount: true }),
  t('absorb_buff', { duration: true, requiresAmount: true }),
  t('ally_absorb', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('damage_buff', { duration: true, requiresAmount: true }),
  t('crit_buff', { duration: true, requiresAmount: true }),
  t('block_buff', {
    duration: true,
    params: [
      P('block_chance', 'Bonus block chance', 'pct', 'chance', true),
      P('block_amount', 'Bonus block amount', 'flat', 'magnitude', true),
    ],
  }),
  t('reactive_holy', {
    duration: true,
    params: [P('retaliation_damage', 'Retaliation damage', 'hp', 'magnitude', true)],
  }),
  t('mitigation_buff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('evasion_buff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('stealth_buff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('disengage_buff', { duration: true, requiresAmount: true, requiresDuration: true }),

  // ── Control ───────────────────────────────────────────────────
  t('root_debuff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('sunder_debuff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('dot_debuff', {
    duration: true, interval: true,
    requiresAmount: true, requiresDuration: true, requiresInterval: true,
  }),

  // ── Healing / sustain ─────────────────────────────────────────
  t('heal', { requiresAmount: true }),
  t('self_heal', { requiresAmount: true }),
  t('hp_transfer', {
    requiresAmount: true,
    params: [P('reserve_hp', 'HP kept in reserve', 'hp', 'threshold', true)],
  }),
  t('party_regen', {
    duration: true, interval: true,
    requiresAmount: true, requiresDuration: true, requiresInterval: true,
  }),
  t('regen_buff', {
    duration: true,
    requiresAmount: true, requiresDuration: true,
    params: [P('cp_per_tick', 'CP regen per tick', 'cp', 'rate', true)],
  }),
];

const BY_KEY = new Map(MECHANIC_TEMPLATES.map(m => [m.mechanicKey, m]));

export function getMechanicTemplate(mechanicKey: string): MechanicTemplate | null {
  return BY_KEY.get(mechanicKey) ?? null;
}

export function getMechanicParams(mechanicKey: string): MechanicCalcParam[] {
  return getMechanicTemplate(mechanicKey)?.params ?? [];
}

/**
 * Validate a `mechanic_calcs` record against its mechanic template.
 * Unknown param keys, missing required params and invalid calcs are errors.
 */
export function validateMechanicCalcs(
  mechanicKey: string,
  calcs: Record<string, AbilityCalc> | null | undefined,
  opts: { enforceRequired?: boolean } = {},
): string[] {
  const template = getMechanicTemplate(mechanicKey);
  if (!template) return [`unknown mechanic key "${mechanicKey}"`];

  const errors: string[] = [];
  const entries = Object.entries(calcs ?? {});
  const allowed = new Set(template.params.map(p => p.key as string));

  for (const [key, calc] of entries) {
    if (!allowed.has(key)) {
      errors.push(`mechanic_calcs.${key}: not a parameter of mechanic "${mechanicKey}"`);
      continue;
    }
    for (const err of validateCalc(calc)) errors.push(`mechanic_calcs.${key}: ${err}`);
  }

  if (opts.enforceRequired !== false) {
    for (const param of template.params) {
      if (param.required && !(param.key in (calcs ?? {}))) {
        errors.push(`mechanic_calcs.${param.key} is required for mechanic "${mechanicKey}"`);
      }
    }
  }
  return errors;
}

/**
 * Publish gate: is this ability row complete and valid?
 *
 * Requirements are only enforced for rows that will actually resolve in combat
 * (`status === 'active'`; omitted status is treated as active). Draft rows are
 * still shape-checked so the admin builder reports malformed calcs early, but an
 * unfinished draft is allowed to be missing pieces.
 */
export function validateAbilityForPublish(row: {
  mechanic_key: string;
  amount_calc?: AbilityCalc | null;
  duration_calc?: AbilityCalc | null;
  interval_ms?: number | null;
  mechanic_calcs?: Record<string, AbilityCalc> | null;
  status?: string | null;
}): string[] {
  const errors: string[] = [];
  const template = getMechanicTemplate(row.mechanic_key);
  const active = (row.status ?? 'active') === 'active';

  if (row.amount_calc) {
    for (const err of validateCalc(row.amount_calc)) errors.push(`amount_calc: ${err}`);
  }
  if (row.duration_calc) {
    for (const err of validateCalc(row.duration_calc)) errors.push(`duration_calc: ${err}`);
  }

  if (template) {
    // Unsupported fields are always an error: a value stored here would never
    // be read, which is exactly the silent misconfiguration to prevent.
    if (row.amount_calc && !template.supportsAmount) {
      errors.push(`amount_calc: mechanic "${row.mechanic_key}" does not use an amount`);
    }
    if (row.duration_calc && !template.supportsDuration) {
      errors.push(`duration_calc: mechanic "${row.mechanic_key}" does not use a duration`);
    }
    if (row.interval_ms != null && !template.supportsInterval) {
      errors.push(`interval_ms: mechanic "${row.mechanic_key}" does not tick`);
    }

    if (active) {
      if (template.requiresAmount && !row.amount_calc) {
        errors.push(`amount_calc is required for mechanic "${row.mechanic_key}"`);
      }
      if (template.requiresDuration && !row.duration_calc) {
        errors.push(`duration_calc is required for mechanic "${row.mechanic_key}"`);
      }
      if (template.requiresInterval && !(row.interval_ms && row.interval_ms > 0)) {
        errors.push(`interval_ms is required for mechanic "${row.mechanic_key}"`);
      }
    }
  }

  errors.push(...validateMechanicCalcs(row.mechanic_key, row.mechanic_calcs, {
    enforceRequired: active,
  }));
  return errors;
}
