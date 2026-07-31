/**
 * ability-calc.ts — Structured, data-driven ability calculation evaluator.
 *
 * CANONICAL OWNER for: how a JSON `amount_calc` / `duration_calc` record from
 * the `abilities` table turns into a concrete number at runtime.
 *
 * Design goals:
 *  - Every legacy hardcoded formula in the ability handlers must be expressible
 *    (see `ability-calc-parity.test.ts`, which pins evaluator output against
 *    the original inline math across the full stat/level range).
 *  - Durations stay in **milliseconds** (wall-clock `expires_at` model). No
 *    cooldowns exist in this system.
 *  - Admin-editable and previewable: `describeCalc` renders a human-readable
 *    formula string for the admin UI without evaluating it.
 *
 * Evaluation order (fixed, never configurable — admins reason about one order):
 *   1. value = base + Σ terms
 *   2. value *= postMult        (if set)
 *   3. rounding                 (none | floor | round | ceil)
 *   4. floor clamp              (Math.max)
 *   5. cap clamp                (Math.min)
 *
 * Pure TS, zero deps beyond sibling formula primitives. Mirrored byte-for-byte
 * to `supabase/functions/_shared/formulas/ability-calc.ts`.
 */

import { diminishing, diminishingFloat } from './stats';
import { getEffectiveCombatMod, type EffectiveProfile } from './effective';

export type CalcStat = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type CalcRounding = 'none' | 'floor' | 'round' | 'ceil';

/** What the produced number means. Presentation + validation only. */
export type CalcUnit =
  | 'ms'          // duration in milliseconds
  | 'hp'          // hit points (heal / shield pool / damage)
  | 'flat'        // flat integer (AC reduction, crit range widening)
  | 'count'       // discrete count (arrows, stacks)
  | 'percent'     // 0..1 ratio meant to be shown as %
  | 'multiplier'; // 0..N damage multiplier

/** Threshold step: `+add` once the source mod reaches `at`. */
export interface CalcThresholdStep {
  at: number;
  add: number;
}

export type CalcTransform =
  /** floor(sqrt(mod)) capped — integer diminishing returns. */
  | { kind: 'diminishing'; cap: number }
  /** sqrt(mod) * perPoint capped — float diminishing returns. */
  | { kind: 'diminishing_float'; perPoint: number; cap: number }
  /** Soft-cap curve from the shared effective-mod profiles. */
  | { kind: 'soft'; profile: EffectiveProfile };

export interface CalcTerm {
  source: 'const' | 'stat' | 'level' | 'stat_threshold';
  /** Required for `stat` and `stat_threshold`. */
  stat?: CalcStat;
  /** Multiplier applied after the transform. Defaults to 1. */
  mult?: number;
  /** Clamp a negative stat modifier to 0 before use. Defaults to false. */
  clampAtZero?: boolean;
  /** Optional non-linear shaping (stat sources only). */
  transform?: CalcTransform;
  /** Threshold ladder for `stat_threshold`. */
  steps?: CalcThresholdStep[];
  /** Rounding applied to this term alone (before summing). */
  rounding?: CalcRounding;
  /** Optional label used by `describeCalc` / admin tooltips. */
  label?: string;
}

export interface AbilityCalc {
  base: number;
  terms: CalcTerm[];
  postMult?: number;
  rounding?: CalcRounding;
  floor?: number | null;
  cap?: number | null;
  unit: CalcUnit;
  /** Free-form admin note describing intent (e.g. "STR magnitude"). */
  note?: string;
}

export interface CalcInputs {
  level: number;
  /** Pre-computed stat *modifiers* (base + renown + gear, already modded). */
  mods: Record<CalcStat, number>;
}

function applyRounding(value: number, rounding: CalcRounding | undefined): number {
  switch (rounding) {
    case 'floor': return Math.floor(value);
    case 'round': return Math.round(value);
    case 'ceil': return Math.ceil(value);
    default: return value;
  }
}

function applyTransform(value: number, transform: CalcTransform | undefined): number {
  if (!transform) return value;
  switch (transform.kind) {
    case 'diminishing':
      return diminishing(value, transform.cap);
    case 'diminishing_float':
      return diminishingFloat(value, transform.perPoint, transform.cap);
    case 'soft':
      return getEffectiveCombatMod(value, transform.profile);
    default:
      return value;
  }
}

function termSourceValue(term: CalcTerm, inputs: CalcInputs): number {
  switch (term.source) {
    case 'const':
      return 1;
    case 'level':
      return inputs.level;
    case 'stat': {
      const raw = term.stat ? (inputs.mods[term.stat] ?? 0) : 0;
      return term.clampAtZero ? Math.max(0, raw) : raw;
    }
    case 'stat_threshold': {
      const raw = term.stat ? (inputs.mods[term.stat] ?? 0) : 0;
      const mod = term.clampAtZero === false ? raw : Math.max(0, raw);
      let sum = 0;
      for (const step of term.steps ?? []) {
        if (mod >= step.at) sum += step.add;
      }
      return sum;
    }
    default:
      return 0;
  }
}

/** Evaluate a single term to its contribution. */
export function evaluateTerm(term: CalcTerm, inputs: CalcInputs): number {
  // Threshold ladders already produce their own additive value; transforms and
  // multipliers still apply for flexibility (e.g. ms-per-step).
  const source = termSourceValue(term, inputs);
  const shaped = term.source === 'stat' ? applyTransform(source, term.transform) : source;
  const scaled = shaped * (term.mult ?? 1);
  return applyRounding(scaled, term.rounding);
}

/** Evaluate a structured calculation to a concrete number. */
export function evaluateCalc(calc: AbilityCalc, inputs: CalcInputs): number {
  let value = calc.base;
  for (const term of calc.terms) value += evaluateTerm(term, inputs);
  if (calc.postMult !== undefined) value *= calc.postMult;
  value = applyRounding(value, calc.rounding);
  if (calc.floor !== null && calc.floor !== undefined) value = Math.max(calc.floor, value);
  if (calc.cap !== null && calc.cap !== undefined) value = Math.min(calc.cap, value);
  return value;
}

/** Convenience: evaluate an optional calc, returning null when absent. */
export function evaluateOptionalCalc(
  calc: AbilityCalc | null | undefined,
  inputs: CalcInputs,
): number | null {
  return calc ? evaluateCalc(calc, inputs) : null;
}

// ── Admin preview ─────────────────────────────────────────────────

function describeTerm(term: CalcTerm): string {
  const mult = term.mult ?? 1;
  let body: string;
  switch (term.source) {
    case 'const':
      body = `${mult}`;
      return term.rounding && term.rounding !== 'none' ? `${term.rounding}(${body})` : body;
    case 'level':
      body = mult === 1 ? 'level' : `level × ${mult}`;
      break;
    case 'stat_threshold': {
      const steps = (term.steps ?? []).map(s => `${term.stat?.toUpperCase()}≥${s.at} → +${s.add * mult}`);
      return steps.length ? `[${steps.join(', ')}]` : '0';
    }
    case 'stat':
    default: {
      const stat = term.stat?.toUpperCase() ?? '?';
      let inner = term.clampAtZero ? `max(0, ${stat})` : stat;
      if (term.transform) {
        if (term.transform.kind === 'diminishing') inner = `dim(${inner}, cap ${term.transform.cap})`;
        else if (term.transform.kind === 'diminishing_float') inner = `dim(${inner}, ${term.transform.perPoint}/pt, cap ${term.transform.cap})`;
        else inner = `soft(${inner}, ${term.transform.profile})`;
      }
      body = mult === 1 ? inner : `${inner} × ${mult}`;
      break;
    }
  }
  return term.rounding && term.rounding !== 'none' ? `${term.rounding}(${body})` : body;
}

/** Render a readable formula for the admin ability editor. */
export function describeCalc(calc: AbilityCalc): string {
  const parts: string[] = [];
  if (calc.base !== 0 || calc.terms.length === 0) parts.push(`${calc.base}`);
  for (const term of calc.terms) parts.push(describeTerm(term));
  let out = parts.join(' + ');
  if (calc.postMult !== undefined) out = `(${out}) × ${calc.postMult}`;
  if (calc.rounding && calc.rounding !== 'none') out = `${calc.rounding}(${out})`;
  if (calc.floor !== null && calc.floor !== undefined) out = `max(${calc.floor}, ${out})`;
  if (calc.cap !== null && calc.cap !== undefined) out = `min(${calc.cap}, ${out})`;
  return `${out} ${unitSuffix(calc.unit)}`.trim();
}

function unitSuffix(unit: CalcUnit): string {
  switch (unit) {
    case 'ms': return 'ms';
    case 'hp': return 'HP';
    case 'percent': return '(ratio)';
    case 'multiplier': return '×';
    default: return '';
  }
}

/** Structural validation for admin-submitted calcs. Returns error strings. */
export function validateCalc(calc: AbilityCalc): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(calc.base)) errors.push('base must be a finite number');
  if (!Array.isArray(calc.terms)) errors.push('terms must be an array');
  if (calc.floor != null && calc.cap != null && calc.floor > calc.cap) {
    errors.push('floor cannot exceed cap');
  }
  for (const [i, term] of (calc.terms ?? []).entries()) {
    if ((term.source === 'stat' || term.source === 'stat_threshold') && !term.stat) {
      errors.push(`term ${i}: stat is required for source "${term.source}"`);
    }
    if (term.source === 'stat_threshold' && !(term.steps ?? []).length) {
      errors.push(`term ${i}: stat_threshold requires at least one step`);
    }
    if (term.mult !== undefined && !Number.isFinite(term.mult)) {
      errors.push(`term ${i}: mult must be a finite number`);
    }
  }
  return errors;
}
