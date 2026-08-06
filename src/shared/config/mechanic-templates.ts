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

import { validateCalc, type AbilityCalc } from '../formulas/ability-calc';

export type MechanicCalcParamKey =
  | 'arrow_count'
  | 'max_stacks' | 'per_stack_multiplier'
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
  // Consolidated reusable weapon strike (Phase 3). One base ability powers
  // every class signature weapon attack; the class assignment supplies the
  // name, wording and the primary scaling attribute.
  t('weapon_attack', { requiresAmount: true }),
  // Consolidated reusable spell strike (Phase 4). Fireball, Smite, Judgment and
  // Cutting Words all run through this one base; the class assignment supplies
  // the name, wording, damage type and the casting attribute.
  t('spell_attack', { requiresAmount: true }),
  // (Legacy per-class attack mechanics — power_strike / aimed_shot / backstab /
  // fireball / smite / cutting_words — were removed once every row moved to the
  // consolidated `weapon_attack` and `spell_attack` bases.)

  // Consolidation Group D: ONE reusable node aura. Whether it mends allies
  // (`effect_config.heals_allies`), sears engaged creatures
  // (`effect_config.damages_enemies`) and which attribute drives the pulse
  // (`effect_config.magnitude_stat`) are configuration, so Consecrate is just
  // the Templar identity of this base.
  t('aura_pulse', {
    duration: true, interval: true,
    requiresAmount: true, requiresDuration: true, requiresInterval: true,
  }),

  // ── Stack mechanics ───────────────────────────────────────────
  // Consolidation Group D: ONE reusable stack applier. `amount_calc` is the
  // proc chance and `max_stacks` the ceiling; whether it fires on weapon hits
  // or pulses each heartbeat (`effect_config.trigger`), which persistent effect
  // it writes (`effect_config.effect_type`), which attribute drives the
  // per-tick damage and how long the stack lingers are all configuration —
  // Envenom and Orbs of Fire are class identities of this one base.
  t('stack_apply', {
    requiresAmount: true,
    params: [P('max_stacks', 'Maximum stacks', 'count', 'threshold', true)],
    stackOp: { stackType: 'poison_stacks', op: 'apply', timing: 'on_hit', owner: 'target' },
  }),
  // Consolidation Group D: ONE reusable stack finisher. Which stack it eats
  // (`effect_config.stack_type`: poison | ignite) and whether it rolls the
  // weapon die (`effect_config.weapon_based`) are configuration, so Eviscerate
  // and Conflagrate are the same base ability with different identity.
  t('stack_consume', {
    requiresAmount: true,
    params: [P('per_stack_multiplier', 'Bonus per consumed stack', 'mult', 'multiplier', true)],
    stackOp: { stackType: 'poison_stacks', op: 'consume_all', timing: 'on_commit', owner: 'target' },
  }),


  // ── Multi-hit ─────────────────────────────────────────────────
  // Consolidation Group G: ONE reusable volley. `amount_calc` is the FULL
  // per-arrow magnitude (weapon die + stat), the attribute that rolls to hit is
  // `effect_config.attack_stat`, and every log line is authored in
  // `combat_text` (`cast_text` / `hit_text` / `miss_text`) — Barrage is the
  // Ranger identity of this base.
  t('multi_attack', {
    requiresAmount: true,
    params: [
      P('arrow_count', 'Number of arrows', 'count', 'magnitude', true),
    ],
  }),
  // Consolidation Group G: ONE reusable burst nuke. The rolling/scaling
  // attribute (`effect_config.stat`), the crit-threshold floor
  // (`effect_config.crit_threshold_floor`) and the wording are configuration —
  // Grand Finale is the Bard identity of this base.
  t('burst_damage', {
    requiresAmount: true,
    params: [P('crit_edge', 'Crit range widening', 'flat', 'threshold', true)],
  }),

  // ── Buffs / mitigation ────────────────────────────────────────
  // `amount_calc` carries the headline magnitude of each buff (damage
  // reduction, absorb pool, crit widening, ambush multiplier, …).
  // Consolidation Group D: ONE reusable incoming-damage mitigation buff.
  // Whether it shaves a percentage of each hit or a flat amount
  // (`effect_config.mitigation_mode`), whether it also softens crits
  // (`effect_config.applies_crit_reduction`), the shield kicker
  // (`effect_config.shield_dr_bonus`) and whether it taunts
  // (`effect_config.is_taunt`) are all configuration — Battle Cry (percent
  // stance) and Divine Challenge (flat, timed taunt) are class identities of
  // this one base.
  t('mitigation_buff', { duration: true, requiresAmount: true }),
  // Consolidated absorb shield (Phase 6). Force Shield (stance, self) and
  // Divine Aegis (instant, ally) share this base; the class assignment supplies
  // the name, wording, target scope and the pool/duration attributes.
  t('absorb_buff', { duration: true, requiresAmount: true }),
  // Consolidation Group F: ONE reusable offensive self-buff. Whether it
  // multiplies outgoing damage or widens the crit range
  // (`effect_config.offense_mode`: 'damage_mult' | 'crit_edge') is
  // configuration, so Arcane Surge (Wizard) and Eagle Eye (Ranger) are class
  // identities of this one base.
  t('offense_buff', { duration: true, requiresAmount: true }),
  // Consolidation Group G: ONE reusable block-boost stance. The bonus chance
  // and amount are named calcs; the final block-chance ceiling is
  // `effect_config.block_chance_cap` — Shield Wall is the Templar identity.
  t('block_buff', {
    duration: true,
    params: [
      P('block_chance', 'Bonus block chance', 'pct', 'chance', true),
      P('block_amount', 'Bonus block amount', 'flat', 'magnitude', true),
    ],
  }),
  // Consolidation Group G: ONE reusable reactive-retaliation stance. The
  // magnitude/kicker attributes (`effect_config.magnitude_stat` / `kicker_stat`)
  // and the retaliation wording (`combat_text.retaliate_text`) are
  // configuration — Holy Shield is the Templar identity of this base.
  t('reactive_holy', {
    duration: true,
    params: [P('retaliation_damage', 'Retaliation damage', 'hp', 'magnitude', true)],
  }),
  // Consolidation Group E: ONE reusable evasion buff. Cloak of Shadows
  // (chance-based dodge) and Disengage (certain dodge + next-hit window) share
  // this base; `effect_config.dodge_chance`, `next_hit_window_ms` and
  // `evasion_source` are configuration, not separate mechanics.
  t('evasion_buff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('stealth_buff', { duration: true, requiresAmount: true, requiresDuration: true }),

  // ── Control ───────────────────────────────────────────────────
  t('root_debuff', { duration: true, requiresAmount: true, requiresDuration: true }),
  t('sunder_debuff', { duration: true, requiresAmount: true, requiresDuration: true }),
  // Consolidation Group D: ONE reusable ticking damage debuff. The persistent
  // effect row it writes (`effect_config.effect_type`), whether the per-tick
  // magnitude rolls the weapon die (`effect_config.weapon_based`), the scaling
  // attributes and the stack ceiling (`effect_config.max_stacks`) are all
  // configuration — Rend is the Warrior identity of this base.
  t('dot_debuff', {
    duration: true, interval: true,
    requiresAmount: true, requiresDuration: true, requiresInterval: true,
  }),

  // ── Healing / sustain ─────────────────────────────────────────
  // Consolidated self/target heal (Phase 4): Heal and Second Wind share this
  // base, differing only by configured attribute and authored text.
  t('heal', { requiresAmount: true }),
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
