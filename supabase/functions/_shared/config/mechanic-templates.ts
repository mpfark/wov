/**
 * mechanic-templates.ts — Registry of coded mechanic handlers and the *named,
 * typed* calculation parameters each one exposes.
 *
 * CANONICAL OWNER for: which named mechanic calcs an ability row may carry, and
 * what each one means (label, unit, role, required-ness).
 *
 * There is deliberately **no `bonus_calc` catch-all**. Every tunable a coded
 * handler owns is declared here with its own semantic key, so the admin builder
 * can render it with the right unit and the validator can reject anything
 * unknown. Standing rule: no handler ships with hardcoded magnitudes.
 *
 * Stored shape: `abilities.mechanic_calcs jsonb` = `{ [paramKey]: AbilityCalc }`.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/config/mechanic-templates.ts`.
 */

import { validateCalc, type AbilityCalc } from '../formulas/ability-calc.ts';

export type MechanicCalcParamKey =
  | 'arrow_count' | 'max_stacks' | 'proc_chance' | 'stacks_applied'
  | 'per_arrow_multiplier' | 'per_stack_multiplier'
  | 'block_chance' | 'block_amount'
  | 'damage_reduction' | 'crit_reduction' | 'crit_edge' | 'retaliation_damage'
  | 'reserve_hp' | 'cp_per_tick' | 'regen_per_tick' | 'orb_chance'
  | 'final_multiplier' | 'flat_reduction' | 'dodge_chance' | 'damage_multiplier'
  | 'root_reduction';

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
    params?: MechanicCalcParam[];
    stackOp?: StackOpSpec;
  } = {},
): MechanicTemplate {
  return {
    mechanicKey,
    supportsAmount: opts.amount ?? true,
    supportsDuration: opts.duration ?? false,
    supportsInterval: opts.interval ?? false,
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
  t('power_strike'),
  t('aimed_shot'),
  t('backstab'),
  t('fireball'),
  t('smite', { params: [P('final_multiplier', 'Final ability multiplier', 'mult', 'multiplier')] }),
  t('cutting_words'),
  t('consecrate', {
    duration: true, interval: true,
    params: [P('final_multiplier', 'Final ability multiplier', 'mult', 'multiplier')],
  }),

  // ── Stack mechanics ───────────────────────────────────────────
  t('poison_buff', {
    duration: true,
    params: [
      P('proc_chance', 'Proc chance per hit', 'pct', 'chance'),
      P('max_stacks', 'Maximum stacks', 'count', 'threshold'),
      P('stacks_applied', 'Stacks applied per proc', 'count', 'magnitude'),
    ],
    stackOp: { stackType: 'poison_stacks', op: 'apply', timing: 'on_hit', owner: 'target' },
  }),
  t('execute_attack', {
    params: [P('per_stack_multiplier', 'Bonus per consumed stack', 'mult', 'multiplier')],
    stackOp: { stackType: 'poison_stacks', op: 'consume_all', timing: 'on_commit', owner: 'target' },
  }),
  t('ignite_buff', { duration: true, params: [P('orb_chance', 'Ignite orb chance', 'pct', 'chance')] }),
  t('ignite_consume', {
    params: [P('per_stack_multiplier', 'Bonus per consumed stack', 'mult', 'multiplier')],
    stackOp: { stackType: 'burn_stacks', op: 'consume_all', timing: 'on_commit', owner: 'target' },
  }),

  // ── Multi-hit ─────────────────────────────────────────────────
  t('multi_attack', {
    params: [
      P('arrow_count', 'Number of arrows', 'count', 'magnitude', true),
      P('per_arrow_multiplier', 'Damage ratio per arrow', 'mult', 'multiplier'),
    ],
  }),
  t('burst_damage', { params: [P('crit_edge', 'Crit range widening', 'flat', 'threshold')] }),

  // ── Buffs / mitigation ────────────────────────────────────────
  t('battle_cry', {
    duration: true,
    params: [
      P('damage_reduction', 'Incoming damage reduction', 'pct', 'rate'),
      P('crit_reduction', 'Crit damage reduction', 'pct', 'rate'),
    ],
  }),
  t('absorb_buff', { duration: true }),
  t('ally_absorb', { duration: true }),
  t('damage_buff', { duration: true, params: [P('damage_multiplier', 'Damage multiplier', 'mult', 'multiplier')] }),
  t('crit_buff', { duration: true }),
  t('block_buff', {
    duration: true,
    params: [
      P('block_chance', 'Bonus block chance', 'pct', 'chance'),
      P('block_amount', 'Bonus block amount', 'flat', 'magnitude'),
    ],
  }),
  t('reactive_holy', {
    duration: true,
    params: [P('retaliation_damage', 'Retaliation damage', 'hp', 'magnitude')],
  }),
  t('mitigation_buff', {
    duration: true,
    params: [P('flat_reduction', 'Flat damage reduction', 'flat', 'magnitude')],
  }),
  t('evasion_buff', { duration: true, params: [P('dodge_chance', 'Dodge chance', 'pct', 'chance')] }),
  t('stealth_buff', { duration: true, params: [P('damage_multiplier', 'Ambush multiplier', 'mult', 'multiplier')] }),
  t('disengage_buff', { duration: true, params: [P('damage_multiplier', 'Damage multiplier', 'mult', 'multiplier')] }),

  // ── Control ───────────────────────────────────────────────────
  t('root_debuff', { duration: true, params: [P('root_reduction', 'Damage reduction while rooted', 'pct', 'rate')] }),
  t('sunder_debuff', { duration: true }),
  t('dot_debuff', { duration: true, interval: true }),

  // ── Healing / sustain ─────────────────────────────────────────
  t('heal'),
  t('self_heal'),
  t('hp_transfer', { params: [P('reserve_hp', 'HP kept in reserve', 'hp', 'threshold')] }),
  t('party_regen', {
    duration: true, interval: true,
    params: [
      P('regen_per_tick', 'Healing per tick', 'hp', 'rate'),
      P('cp_per_tick', 'CP restored per tick', 'cp', 'rate'),
    ],
  }),
  t('regen_buff', {
    duration: true,
    params: [
      P('regen_per_tick', 'HP regen per tick', 'hp', 'rate'),
      P('cp_per_tick', 'CP regen per tick', 'cp', 'rate'),
    ],
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

  for (const param of template.params) {
    if (param.required && !(param.key in (calcs ?? {}))) {
      errors.push(`mechanic_calcs.${param.key} is required for mechanic "${mechanicKey}"`);
    }
  }
  return errors;
}

/** Publish gate: is every required calc present and valid for this ability row? */
export function validateAbilityForPublish(row: {
  mechanic_key: string;
  amount_calc?: AbilityCalc | null;
  duration_calc?: AbilityCalc | null;
  mechanic_calcs?: Record<string, AbilityCalc> | null;
}): string[] {
  const errors: string[] = [];
  if (row.amount_calc) {
    for (const err of validateCalc(row.amount_calc)) errors.push(`amount_calc: ${err}`);
  }
  if (row.duration_calc) {
    for (const err of validateCalc(row.duration_calc)) errors.push(`duration_calc: ${err}`);
  }
  errors.push(...validateMechanicCalcs(row.mechanic_key, row.mechanic_calcs));
  return errors;
}
