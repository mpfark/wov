/**
 * ability-calc.ts — Structured, data-driven ability calculation evaluator (v2).
 *
 * CANONICAL OWNER for: how a JSON `amount_calc` / `duration_calc` / named
 * mechanic calc record from the `abilities` table turns into a concrete number
 * at runtime.
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
 *   1. primary   = base + Σ term(i)          (per-term rounding only)
 *   2. withConst = primary × (finalMult ?? 1)
 *   3. mult      = multiplierCalc ? eval(multiplierCalc) : 1
 *   4. value     = clamp(rounding(multRounding(withConst × mult)))
 *
 * `postMult` is the v1 spelling of `finalMult`; they are one concept and both
 * are honoured (finalMult wins when both are present).
 *
 * Randomness: this module NEVER generates randomness. Neither `dice` terms nor
 * bounded-random `range` spreads call `Math.random`. The caller injects a
 * `RollSource` through `CalcInputs.roll` and a `RandomSource` through
 * `CalcInputs.random`; without them the evaluator falls back to the
 * deterministic `diceMode` (default `average`) / `rangeMode` (default `mid`) so
 * the admin preview and parity tests stay reproducible. Given the same injected
 * randomness, the evaluator always produces the same result.
 *
 * Pure TS, zero deps beyond sibling formula primitives. Mirrored byte-for-byte
 * (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/formulas/ability-calc.ts`.
 */

import { diminishing, diminishingFloat } from './stats.ts';
import { getEffectiveCombatMod, type EffectiveProfile } from './effective.ts';

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

/** Dice a `dice` term may roll. `weapon_main` resolves the equipped main-hand die. */
export type CalcDie = 'weapon_main' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12';

/** Allowlisted runtime context values a `context` term may read. */
export type CalcContextKey = 'active_stacks' | 'consumed_stacks';

export interface CalcTerm {
  source: 'const' | 'stat' | 'level' | 'stat_threshold' | 'dice' | 'context';
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
  /** Number of dice for `dice`. Defaults to 1. Valid range 1–20. */
  count?: number;
  /** Die type for `dice`. */
  die?: CalcDie;
  /** Sides used when `die: 'weapon_main'` and no weapon is equipped. Defaults to 4. */
  fallbackDie?: number;
  /** Context key for `context`. */
  contextKey?: CalcContextKey;
  /** Rounding applied to this term alone (before summing). */
  rounding?: CalcRounding;
  /** Optional label used by `describeCalc` / admin tooltips. */
  label?: string;
}

/**
 * Explicit bounded-random spread, added to `base + Σterms`.
 *
 * This is how a *variable* magnitude stays variable under configuration (e.g.
 * the 30–45 s poison duration). The evaluator never invents the random value:
 * it is supplied through `CalcInputs.random`. With no supplied randomness the
 * spread resolves deterministically through `CalcInputs.rangeMode`.
 *
 * `min === max` is legal and means "fixed" — a fixed-duration ability is simply
 * one with no `range` at all, or a degenerate one.
 */
export interface CalcRange {
  min: number;
  max: number;
  /** Rounding applied to the interpolated spread alone. */
  rounding?: CalcRounding;
}

export interface AbilityCalc {
  /** Contract version. Absent / 1 = pre-rework record; 2 = current contract. */
  version?: 1 | 2;
  base: number;
  terms: CalcTerm[];
  /** Bounded-random spread resolved from injected randomness (see `CalcRange`). */
  range?: CalcRange;
  /** v1 spelling of `finalMult`. Kept for stored records. */
  postMult?: number;
  /** Constant ability rider (judgment 0.8, consecrate 0.65). */
  finalMult?: number;
  /** Calculated multiplier (per-stack riders). Nesting depth is limited to 2. */
  multiplierCalc?: AbilityCalc;
  /** Rounding applied to `withConst × mult` before the outer rounding. */
  multRounding?: CalcRounding;
  rounding?: CalcRounding;
  floor?: number | null;
  cap?: number | null;
  unit: CalcUnit;
  /** Free-form admin note describing intent (e.g. "STR magnitude"). */
  note?: string;
}

/** Injectable dice roller: given the number of sides, return 1..sides. */
export type RollSource = (sides: number) => number;

/** Deterministic dice resolution used when no `RollSource` is injected. */
export type DiceMode = 'average' | 'min' | 'max';

/**
 * Injectable unit-random source for bounded `range` spreads: returns a value in
 * `[0, 1]`. `0` resolves to `range.min`, `1` resolves to `range.max`.
 */
export type RandomSource = () => number;

/** Deterministic range resolution used when no `RandomSource` is injected. */
export type RangeMode = 'mid' | 'min' | 'max';

export interface CalcInputs {
  level: number;
  /** Pre-computed stat *modifiers* (base + renown + gear, already modded). */
  mods: Record<CalcStat, number>;
  /** Runtime context values readable by `context` terms. */
  context?: Partial<Record<CalcContextKey, number>>;
  /** Sides of the equipped main-hand weapon die, when known. */
  weaponDie?: number | null;
  /** Injected roller. Randomness lives at the call site, never in here. */
  roll?: RollSource;
  /** Deterministic dice behaviour when `roll` is absent. Defaults to `average`. */
  diceMode?: DiceMode;
  /**
   * Injected unit-random source for bounded `range` spreads. Randomness lives
   * at the call site, never in here.
   */
  random?: RandomSource;
  /** Deterministic range behaviour when `random` is absent. Defaults to `mid`. */
  rangeMode?: RangeMode;
}

const MAX_TERMS = 12;
const MAX_DICE_COUNT = 20;
const DIE_SIDES: Record<Exclude<CalcDie, 'weapon_main'>, number> = {
  d4: 4, d6: 6, d8: 8, d10: 10, d12: 12,
};

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

/** Sides this term's die resolves to for the given inputs. */
export function resolveDieSides(term: CalcTerm, inputs: CalcInputs): number {
  if (term.die === 'weapon_main' || term.die === undefined) {
    const weapon = inputs.weaponDie;
    if (weapon && Number.isFinite(weapon) && weapon > 0) return Math.floor(weapon);
    return Math.max(1, Math.floor(term.fallbackDie ?? 4));
  }
  return DIE_SIDES[term.die] ?? Math.max(1, Math.floor(term.fallbackDie ?? 4));
}

function rollDice(term: CalcTerm, inputs: CalcInputs): number {
  const sides = resolveDieSides(term, inputs);
  const count = Math.max(1, Math.min(MAX_DICE_COUNT, Math.floor(term.count ?? 1)));
  if (inputs.roll) {
    let total = 0;
    for (let i = 0; i < count; i++) total += inputs.roll(sides);
    return total;
  }
  switch (inputs.diceMode) {
    case 'min': return count;
    case 'max': return count * sides;
    default: return count * ((sides + 1) / 2);
  }
}

/**
 * Resolve a bounded-random spread.
 *
 * Never calls `Math.random`: the unit-random value is supplied through
 * `inputs.random`. `0` → `min`, `1` → `max`, and any repeated supplied input
 * yields the same result. Without an injected source the spread resolves
 * deterministically via `inputs.rangeMode` (default `mid`).
 */
export function resolveRange(range: CalcRange, inputs: CalcInputs): number {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : min;
  if (max <= min) return applyRounding(min, range.rounding);

  let ratio: number;
  if (inputs.random) {
    const raw = inputs.random();
    ratio = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
  } else {
    switch (inputs.rangeMode) {
      case 'min': ratio = 0; break;
      case 'max': ratio = 1; break;
      default: ratio = 0.5; break;
    }
  }
  // Exact endpoints at the boundaries — no float drift on min/max.
  if (ratio === 0) return applyRounding(min, range.rounding);
  if (ratio === 1) return applyRounding(max, range.rounding);
  return applyRounding(min + (max - min) * ratio, range.rounding);
}



function termSourceValue(term: CalcTerm, inputs: CalcInputs): number {
  switch (term.source) {
    case 'const':
      return 1;
    case 'level':
      return inputs.level;
    case 'dice':
      return rollDice(term, inputs);
    case 'context': {
      const raw = term.contextKey ? (inputs.context?.[term.contextKey] ?? 0) : 0;
      return term.clampAtZero === false ? raw : Math.max(0, raw);
    }
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

/** The constant rider for a calc — `finalMult` wins over the v1 `postMult`. */
export function constantMultiplier(calc: AbilityCalc): number | undefined {
  if (calc.finalMult !== undefined) return calc.finalMult;
  return calc.postMult;
}

/** Evaluate a structured calculation to a concrete number. */
export function evaluateCalc(calc: AbilityCalc, inputs: CalcInputs, depth = 0): number {
  let value = calc.base;
  for (const term of calc.terms) value += evaluateTerm(term, inputs);
  if (calc.range) value += resolveRange(calc.range, inputs);

  const constMult = constantMultiplier(calc);
  if (constMult !== undefined) value *= constMult;

  if (calc.multiplierCalc && depth < 2) {
    value *= evaluateCalc(calc.multiplierCalc, inputs, depth + 1);
  }
  value = applyRounding(value, calc.multRounding);

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

/** Does this calc (or a nested multiplier) roll dice? Drives seeded-roll tests. */
export function calcUsesDice(calc: AbilityCalc): boolean {
  if (calc.terms?.some(t => t.source === 'dice')) return true;
  return calc.multiplierCalc ? calcUsesDice(calc.multiplierCalc) : false;
}

/**
 * Does this calc (or a nested multiplier) carry a *variable* bounded-random
 * range? Fixed magnitudes answer `false` — that is the invariant the
 * variable-duration tests assert against.
 */
export function calcUsesRange(calc: AbilityCalc): boolean {
  if (calc.range && calc.range.max > calc.range.min) return true;
  return calc.multiplierCalc ? calcUsesRange(calc.multiplierCalc) : false;
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
    case 'dice': {
      const count = Math.max(1, Math.floor(term.count ?? 1));
      const die = term.die === undefined || term.die === 'weapon_main'
        ? `weapon${term.fallbackDie ? ` (unarmed d${term.fallbackDie})` : ''}`
        : term.die;
      const inner = `${count}${term.die && term.die !== 'weapon_main' ? term.die : `× ${die}`}`;
      body = mult === 1 ? inner : `${inner} × ${mult}`;
      break;
    }
    case 'context': {
      const inner = term.contextKey ?? '?';
      body = mult === 1 ? inner : `${inner} × ${mult}`;
      break;
    }
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
  if (calc.base !== 0 || (calc.terms.length === 0 && !calc.range)) parts.push(`${calc.base}`);
  for (const term of calc.terms) parts.push(describeTerm(term));
  if (calc.range) {
    parts.push(
      calc.range.max > calc.range.min
        ? `random(${calc.range.min}–${calc.range.max})`
        : `${calc.range.min}`,
    );
  }
  let out = parts.join(' + ');
  const constMult = constantMultiplier(calc);
  if (constMult !== undefined) out = `(${out}) × ${constMult}`;
  if (calc.multiplierCalc) out = `(${out}) × [${describeCalc(calc.multiplierCalc)}]`;
  if (calc.multRounding && calc.multRounding !== 'none') out = `${calc.multRounding}(${out})`;
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

const VALID_SOURCES = new Set<CalcTerm['source']>([
  'const', 'stat', 'level', 'stat_threshold', 'dice', 'context',
]);
const VALID_DICE = new Set<CalcDie>(['weapon_main', 'd4', 'd6', 'd8', 'd10', 'd12']);
const VALID_CONTEXT = new Set<CalcContextKey>(['active_stacks', 'consumed_stacks']);

/** Structural validation for admin-submitted calcs. Returns error strings. */
export function validateCalc(calc: AbilityCalc, depth = 0): string[] {
  const errors: string[] = [];
  if (!calc || typeof calc !== 'object') return ['calc must be an object'];
  if (depth > 2) return ['nesting depth above 2 is not allowed'];
  if (!Number.isFinite(calc.base)) errors.push('base must be a finite number');
  if (!Array.isArray(calc.terms)) errors.push('terms must be an array');
  else if (calc.terms.length > MAX_TERMS) errors.push(`no more than ${MAX_TERMS} terms are allowed`);
  if (calc.floor != null && calc.cap != null && calc.floor > calc.cap) {
    errors.push('floor cannot exceed cap');
  }
  if (calc.range !== undefined) {
    const r = calc.range;
    if (!r || typeof r !== 'object') {
      errors.push('range must be an object with min and max');
    } else {
      if (!Number.isFinite(r.min)) errors.push('range.min must be a finite number');
      if (!Number.isFinite(r.max)) errors.push('range.max must be a finite number');
      if (Number.isFinite(r.min) && Number.isFinite(r.max) && r.min > r.max) {
        errors.push('range.min cannot exceed range.max');
      }
    }
  }
  if (calc.finalMult !== undefined && !Number.isFinite(calc.finalMult)) {
    errors.push('finalMult must be a finite number');
  }
  if (calc.postMult !== undefined && !Number.isFinite(calc.postMult)) {
    errors.push('postMult must be a finite number');
  }
  if (calc.finalMult !== undefined && calc.postMult !== undefined) {
    errors.push('use finalMult only — postMult is the legacy spelling of the same value');
  }
  for (const [i, term] of (calc.terms ?? []).entries()) {
    if (!VALID_SOURCES.has(term.source)) {
      errors.push(`term ${i}: unknown source "${term.source}"`);
      continue;
    }
    if ((term.source === 'stat' || term.source === 'stat_threshold') && !term.stat) {
      errors.push(`term ${i}: stat is required for source "${term.source}"`);
    }
    if (term.source === 'stat_threshold' && !(term.steps ?? []).length) {
      errors.push(`term ${i}: stat_threshold requires at least one step`);
    }
    if (term.source === 'dice') {
      if (term.die !== undefined && !VALID_DICE.has(term.die)) {
        errors.push(`term ${i}: unknown die "${term.die}"`);
      }
      const count = term.count ?? 1;
      if (!Number.isFinite(count) || count < 1 || count > MAX_DICE_COUNT) {
        errors.push(`term ${i}: dice count must be between 1 and ${MAX_DICE_COUNT}`);
      }
      if (term.fallbackDie !== undefined && (!Number.isFinite(term.fallbackDie) || term.fallbackDie < 1)) {
        errors.push(`term ${i}: fallbackDie must be a positive number`);
      }
    }
    if (term.source === 'context' && !VALID_CONTEXT.has(term.contextKey as CalcContextKey)) {
      errors.push(`term ${i}: unknown context key "${term.contextKey}"`);
    }
    if (term.mult !== undefined && !Number.isFinite(term.mult)) {
      errors.push(`term ${i}: mult must be a finite number`);
    }
  }
  if (calc.multiplierCalc) {
    for (const err of validateCalc(calc.multiplierCalc, depth + 1)) {
      errors.push(`multiplierCalc: ${err}`);
    }
  }
  return errors;
}
