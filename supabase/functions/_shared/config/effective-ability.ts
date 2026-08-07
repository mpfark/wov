/**
 * effective-ability.ts — THE shared effective-ability resolver.
 *
 * CANONICAL OWNER for: base ability + validated class-assignment overrides =
 * the effective class ability. The client registry, the server combat authority
 * and the admin preview all resolve through this one module so they cannot
 * drift.
 *
 * Model:
 *  - `abilities` rows are the reusable **base library**.
 *  - `class_ability_assignments.overrides` is a **narrow, typed** per-class delta.
 *  - Nothing else may be overridden. Whole-formula fields (`amount_calc`,
 *    `duration_calc`, `interval_ms`), `cp_cost`, coefficients, identity
 *    (`ability_key`, `mechanic_key`) and lifecycle columns are base/column-owned.
 *
 * Scaling overrides are **attributes only**: a base calc term may be tagged
 * `role: 'primary' | 'secondary'`, and an override supplies the concrete
 * attribute for that role. A term's coefficient (`mult`), transform, rounding
 * and every other property are copied through untouched, so a class override can
 * never change a curve or a coefficient.
 *
 * Failure behaviour is deterministic: if validation reports any error the whole
 * override object is discarded and the base configuration is used — never a
 * partial merge. Callers surface the returned errors (server: audit log; admin:
 * visible errors + blocked save).
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/config/effective-ability.ts`.
 */

import type { AbilityCalc, CalcStat, CalcTerm } from '../formulas/ability-calc.ts';
import { getMechanicParams } from './mechanic-templates.ts';

/** Keys a class assignment may override. Mirrored by the SQL allowlist. */
export const OVERRIDE_KEYS = [
  'label',
  'description',
  'tooltip',
  'combat_text',
  'scaling',
  'mechanic_calcs',
] as const;

export type OverrideKey = typeof OVERRIDE_KEYS[number];

export const CALC_STATS: CalcStat[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export type ScalingRole = 'primary' | 'secondary';

export interface ScalingOverride {
  primary_attribute?: CalcStat;
  secondary_attribute?: CalcStat;
}

export interface AssignmentOverrides {
  label?: string;
  description?: string;
  tooltip?: string;
  combat_text?: Record<string, string | string[]>;
  scaling?: ScalingOverride;
  mechanic_calcs?: Record<string, AbilityCalc>;
}

/** The base-library fields the resolver reads. */
export interface BaseAbilityRow {
  ability_key: string;
  label: string;
  description: string;
  tooltip: string;
  mechanic_key: string;
  cp_cost: number;
  damage_type?: string | null;
  amount_calc?: AbilityCalc | null;
  duration_calc?: AbilityCalc | null;
  interval_ms?: number | null;
  mechanic_calcs?: Record<string, AbilityCalc> | null;
  combat_text?: Record<string, unknown> | null;
  /** Composed mechanic configuration, including the Status Application spec. */
  effect_config?: Record<string, unknown> | null;
}

export interface EffectiveAbility extends BaseAbilityRow {
  /** True when a validated override object was applied. */
  overridden: boolean;
}

const TEXT_KEYS: OverrideKey[] = ['label', 'description', 'tooltip'];
const MAX_TEXT = 500;

function calcTerms(calc: AbilityCalc | null | undefined): CalcTerm[] {
  return calc?.terms ?? [];
}

/** Roles actually tagged on any of the base ability's calcs. */
export function taggedScalingRoles(base: BaseAbilityRow): ScalingRole[] {
  const roles = new Set<ScalingRole>();
  const calcs: (AbilityCalc | null | undefined)[] = [
    base.amount_calc, base.duration_calc,
    ...Object.values(base.mechanic_calcs ?? {}),
  ];
  for (const calc of calcs) {
    for (const term of calcTerms(calc)) {
      if (term.source !== 'stat' && term.source !== 'stat_threshold') continue;
      if (term.role === 'primary' || term.role === 'secondary') roles.add(term.role);
    }
    for (const term of calcTerms(calc?.multiplierCalc)) {
      if (term.role === 'primary' || term.role === 'secondary') roles.add(term.role);
    }
  }
  return [...roles];
}

/**
 * Authoritative, mechanic-aware validation. Returns a list of human-readable
 * errors; empty means the override object may be applied as-is.
 */
export function validateAssignmentOverrides(
  base: BaseAbilityRow,
  overrides: unknown,
): string[] {
  const errors: string[] = [];
  if (overrides === null || overrides === undefined) return errors;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return ['overrides must be an object'];
  }
  const o = overrides as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (!(OVERRIDE_KEYS as readonly string[]).includes(key)) {
      errors.push(`overrides.${key}: not an overridable field`);
    }
  }

  for (const key of TEXT_KEYS) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== 'string') errors.push(`overrides.${key} must be a string`);
    else if ((o[key] as string).length > MAX_TEXT) {
      errors.push(`overrides.${key} exceeds ${MAX_TEXT} characters`);
    }
  }

  if (o.combat_text !== undefined) {
    const text = o.combat_text;
    if (typeof text !== 'object' || text === null || Array.isArray(text)) {
      errors.push('overrides.combat_text must be an object');
    } else {
      for (const [k, v] of Object.entries(text as Record<string, unknown>)) {
        const ok = typeof v === 'string'
          ? v.length <= MAX_TEXT
          : Array.isArray(v) && v.every(e => typeof e === 'string' && e.length <= MAX_TEXT);
        if (!ok) errors.push(`overrides.combat_text.${k} must be a string or string array`);
      }
    }
  }

  if (o.scaling !== undefined) {
    const scaling = o.scaling;
    if (typeof scaling !== 'object' || scaling === null || Array.isArray(scaling)) {
      errors.push('overrides.scaling must be an object');
    } else {
      const tagged = taggedScalingRoles(base);
      for (const [k, v] of Object.entries(scaling as Record<string, unknown>)) {
        if (k !== 'primary_attribute' && k !== 'secondary_attribute') {
          errors.push(`overrides.scaling.${k}: only primary_attribute and secondary_attribute are allowed`);
          continue;
        }
        if (typeof v !== 'string' || !CALC_STATS.includes(v as CalcStat)) {
          errors.push(`overrides.scaling.${k}: invalid attribute "${String(v)}"`);
          continue;
        }
        const role: ScalingRole = k === 'primary_attribute' ? 'primary' : 'secondary';
        if (!tagged.includes(role)) {
          errors.push(
            `overrides.scaling.${k}: ability "${base.ability_key}" has no ${role} scaling term`,
          );
        }
      }
    }
  }

  if (o.mechanic_calcs !== undefined) {
    const calcs = o.mechanic_calcs;
    if (typeof calcs !== 'object' || calcs === null || Array.isArray(calcs)) {
      errors.push('overrides.mechanic_calcs must be an object');
    } else {
      const allowed = getMechanicParams(base.mechanic_key).map(p => p.key as string);
      for (const [k, v] of Object.entries(calcs as Record<string, unknown>)) {
        if (!allowed.includes(k)) {
          errors.push(
            `overrides.mechanic_calcs.${k}: not a parameter of mechanic "${base.mechanic_key}"`,
          );
          continue;
        }
        if (typeof v !== 'object' || v === null || Array.isArray(v)
          || !Array.isArray((v as AbilityCalc).terms)) {
          errors.push(`overrides.mechanic_calcs.${k} must be a calc object`);
        }
      }
    }
  }

  return errors;
}

/**
 * Tag a base ability's stat terms with scaling ROLES derived from the owning
 * class's configured `primary_attribute` / `secondary_attribute`.
 *
 * This is the "A-with-roles" step: authors never hand-tag terms. A term that
 * scales off the class's primary attribute becomes `role: 'primary'`, one that
 * scales off the secondary becomes `role: 'secondary'`, and everything else
 * stays untagged (and therefore not overridable). Only the role tag is added —
 * coefficients, transforms and rounding are untouched.
 */
export function tagScalingRoles(
  base: BaseAbilityRow,
  scaling: { primary?: CalcStat | null; secondary?: CalcStat | null } | null | undefined,
): BaseAbilityRow {
  if (!scaling || (!scaling.primary && !scaling.secondary)) return base;
  const tagTerm = (term: CalcTerm): CalcTerm => {
    if (term.source !== 'stat' && term.source !== 'stat_threshold') return term;
    if (term.role) return term;
    if (scaling.primary && term.stat === scaling.primary) return { ...term, role: 'primary' };
    if (scaling.secondary && term.stat === scaling.secondary) return { ...term, role: 'secondary' };
    return term;
  };
  const tagCalc = (calc: AbilityCalc | null | undefined): AbilityCalc | null | undefined => {
    // Malformed rows pass through untouched — shape errors are reported by the
    // publish contract, not silently rewritten here.
    if (!calc || !Array.isArray(calc.terms)) return calc;
    return {
      ...calc,
      terms: calc.terms.map(tagTerm),
      ...(calc.multiplierCalc && Array.isArray(calc.multiplierCalc.terms)
        ? { multiplierCalc: { ...calc.multiplierCalc, terms: calc.multiplierCalc.terms.map(tagTerm) } }
        : {}),
    };
  };
  const mechanic = base.mechanic_calcs
    ? Object.fromEntries(
        Object.entries(base.mechanic_calcs).map(([k, v]) => [k, tagCalc(v) as AbilityCalc]),
      )
    : base.mechanic_calcs;
  return {
    ...base,
    amount_calc: tagCalc(base.amount_calc) ?? null,
    duration_calc: tagCalc(base.duration_calc) ?? null,
    ...(mechanic ? { mechanic_calcs: mechanic } : {}),
  };
}

function applyScalingToCalc(
  calc: AbilityCalc | null | undefined,
  scaling: ScalingOverride,
): AbilityCalc | null | undefined {
  if (!calc || !Array.isArray(calc.terms)) return calc;
  const rewriteTerm = (term: CalcTerm): CalcTerm => {
    if (term.source !== 'stat' && term.source !== 'stat_threshold') return term;
    const attr = term.role === 'primary'
      ? scaling.primary_attribute
      : term.role === 'secondary' ? scaling.secondary_attribute : undefined;
    // Only the `stat` field is ever rewritten — `mult`, transforms, rounding
    // and thresholds are copied through untouched.
    return attr ? { ...term, stat: attr } : term;
  };
  return {
    ...calc,
    terms: calc.terms.map(rewriteTerm),
    ...(calc.multiplierCalc && Array.isArray(calc.multiplierCalc.terms)
      ? { multiplierCalc: { ...calc.multiplierCalc, terms: calc.multiplierCalc.terms.map(rewriteTerm) } }
      : {}),
  };
}

/**
 * base ability + validated class overrides = effective class ability.
 * Invalid overrides are discarded wholesale and reported through `errors`.
 */
export function resolveEffectiveAbility(
  base: BaseAbilityRow,
  assignment?: { overrides?: unknown } | null,
): { ability: EffectiveAbility; errors: string[] } {
  const raw = assignment?.overrides;
  const hasOverrides = !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.keys(raw as object).length > 0;
  if (!hasOverrides) {
    return { ability: { ...base, overridden: false }, errors: [] };
  }

  const errors = validateAssignmentOverrides(base, raw);
  if (errors.length > 0) {
    // Deterministic failure: base configuration only, never a partial merge.
    return { ability: { ...base, overridden: false }, errors };
  }

  const o = raw as AssignmentOverrides;
  const ability: EffectiveAbility = {
    ...base, overridden: true,
  };

  if (o.label !== undefined) ability.label = o.label;
  if (o.description !== undefined) ability.description = o.description;
  if (o.tooltip !== undefined) ability.tooltip = o.tooltip;
  if (o.combat_text !== undefined) {
    ability.combat_text = { ...(base.combat_text ?? {}), ...o.combat_text };
  }
  if (o.mechanic_calcs !== undefined) {
    ability.mechanic_calcs = { ...(base.mechanic_calcs ?? {}), ...o.mechanic_calcs };
  }
  if (o.scaling !== undefined) {
    ability.amount_calc = applyScalingToCalc(ability.amount_calc, o.scaling) ?? null;
    ability.duration_calc = applyScalingToCalc(ability.duration_calc, o.scaling) ?? null;
    if (ability.mechanic_calcs) {
      const next: Record<string, AbilityCalc> = {};
      for (const [k, v] of Object.entries(ability.mechanic_calcs)) {
        next[k] = applyScalingToCalc(v, o.scaling) as AbilityCalc;
      }
      ability.mechanic_calcs = next;
    }
  }

  return { ability, errors: [] };
}

/**
 * Fetch-boundary helper: rewrite joined `class_ability_assignments` rows so the
 * embedded `ability` object is already the EFFECTIVE ability (base + validated
 * overrides). Every consumer downstream — client registry, loadout options,
 * server calc registry, admin preview — therefore reads one resolved shape and
 * cannot forget to merge.
 *
 * Rows whose overrides fail validation keep the base ability and contribute an
 * error string; callers decide how to surface them (audit log / admin UI).
 */
export function applyAssignmentOverrides<
  T extends { class_key?: string; overrides?: unknown; ability?: BaseAbilityRow | null },
>(
  rows: T[] | null | undefined,
  /**
   * Per-class scaling attributes (`classes.primary_attribute` /
   * `secondary_attribute`). Supplied by the caller so this module stays free of
   * registry imports and byte-identical on both sides.
   */
  classScaling?: (classKey: string) => { primary?: CalcStat | null; secondary?: CalcStat | null } | null,
): { rows: T[]; errors: string[] } {
  const errors: string[] = [];
  const out: T[] = [];
  for (const row of rows ?? []) {
    const raw = row?.ability;
    if (!raw) { out.push(row); continue; }
    const base = classScaling
      ? tagScalingRoles(raw, classScaling(row.class_key ?? ''))
      : raw;
    const { ability, errors: rowErrors } = resolveEffectiveAbility(base, row);
    for (const err of rowErrors) {
      errors.push(`${row.class_key ?? '?'}:${base.ability_key}: ${err}`);
    }
    out.push({ ...row, ability });
  }
  return { rows: out, errors };
}
