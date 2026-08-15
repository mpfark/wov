/**
 * status-contract.ts — THE authored-status configuration contract.
 *
 * `applied_statuses` is Layer 3 of the ability composer: it owns the mechanics
 * of a landed status (effect identity, magnitude scaling, duration, interval,
 * damage type and stack/refresh policy). If a required definition is missing or
 * malformed the composer would previously fall through to the bare base config,
 * where the status quietly became `durationMs: 0` with zero magnitude — the
 * mechanic silently disabled instead of loudly broken.
 *
 * This module is the single place that decides whether authored status
 * configuration is usable. It produces structured problems with two codes:
 *
 *   `missing_status_definition` — a required status, or a status an active
 *                                 ability references, does not exist.
 *   `invalid_status_definition` — the definition exists but cannot drive the
 *                                 mechanic it claims (no magnitude input, no
 *                                 duration, no interval for a periodic status,
 *                                 no damage type, no stack policy, …).
 *
 * Both codes are refusals, never defaults: the combat orchestration fails the
 * tick closed with the problem list as its reason.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/config/status-contract.ts`.
 */

/** The `applied_statuses` row shape this contract reads. */
export interface AppliedStatusRow {
  key?: string | null;
  effect_type?: string | null;
  classification?: string | null;
  stack_noun?: string | null;
  /** Periodic marker; a `dot` classification must set it. */
  is_periodic?: boolean | null;
  tick_interval_ms?: number | null;
  magnitude?: Record<string, unknown> | null;
  duration?: Record<string, unknown> | null;
  stacks?: Record<string, unknown> | null;
  modifier?: Record<string, unknown> | null;
  default_damage_type?: string | null;
}

/** One active ability's reference to a status (from `abilities`). */
export interface AbilityStatusReference {
  ability_key?: string | null;
  applied_status?: string | null;
  status_trigger?: string | null;
  status_chance_pct?: number | null;
  status_application_enabled?: boolean | null;
  mechanic_key?: string | null;
}

export type StatusProblemCode = 'missing_status_definition' | 'invalid_status_definition';

export interface StatusProblem {
  readonly code: StatusProblemCode;
  /** Status key the problem is about. */
  readonly status: string;
  /** Referencing ability, when the problem was found through a reference. */
  readonly ability?: string;
  readonly detail: string;
}

/** Status classifications the runtime knows how to apply. */
export const STATUS_CLASSIFICATIONS = ['dot', 'damage_amp'] as const;
export type StatusClassification = (typeof STATUS_CLASSIFICATIONS)[number];

/** Triggers the runtime knows how to schedule an application on. */
export const STATUS_TRIGGERS = [
  'weapon_hit',
  'ability_hit',
  'pulse',
  'successful_pulse_hit',
  'on_hit',
] as const;

/** A status the game may never run without. */
export interface RequiredStatusContract {
  readonly key: string;
  readonly effectType: string;
  readonly classification: StatusClassification;
  /** A damage type is required for anything that deals damage. */
  readonly damageType: string | null;
}

/**
 * The authored statuses combat depends on. Each entry pins the identity that
 * must not silently drift (Ignite must stay its own fire DoT and must never be
 * substituted by Scorched, Envenom's poison must stay poison).
 */
export const REQUIRED_STATUS_CONTRACTS: readonly RequiredStatusContract[] = [
  { key: 'poison', effectType: 'poison', classification: 'dot', damageType: 'poison' },
  { key: 'ignite', effectType: 'ignite', classification: 'dot', damageType: 'fire' },
  { key: 'bleed', effectType: 'bleed', classification: 'dot', damageType: 'physical' },
  { key: 'scorched', effectType: 'scorched', classification: 'dot', damageType: 'fire' },
  { key: 'chilled', effectType: 'chilled', classification: 'damage_amp', damageType: null },
];

export const REQUIRED_STATUS_KEYS: readonly string[] =
  REQUIRED_STATUS_CONTRACTS.map((c) => c.key);

const ROLES = new Set(['primary', 'secondary']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Does this definition carry a usable duration (ms window or tick count)? */
function durationProblems(row: AppliedStatusRow): string[] {
  const problems: string[] = [];
  const dur = obj(row.duration);
  const baseMs = dur.base_ms;
  const ticks = dur.duration_ticks;
  const hasMs = isFiniteNumber(baseMs) && baseMs > 0;
  const hasTicks = isFiniteNumber(ticks) && ticks >= 1;
  if (!hasMs && !hasTicks) {
    problems.push('duration: neither duration.base_ms > 0 nor duration.duration_ticks >= 1');
  }
  if (baseMs !== undefined && baseMs !== null && !hasMs) {
    problems.push('duration.base_ms is present but not a positive number');
  }
  const perPoint = dur.per_point_ms;
  if (perPoint !== undefined && perPoint !== null) {
    if (!isFiniteNumber(perPoint) || perPoint < 0) {
      problems.push('duration.per_point_ms is present but not a non-negative number');
    } else if (perPoint > 0 && !ROLES.has(String(dur.role ?? ''))) {
      problems.push('duration.per_point_ms scales with an attribute but duration.role is unset');
    }
  }
  const cap = dur.cap_ms;
  if (cap !== undefined && cap !== null) {
    if (!isFiniteNumber(cap) || cap <= 0) {
      problems.push('duration.cap_ms is present but not a positive number');
    } else if (hasMs && cap < (baseMs as number)) {
      problems.push('duration.cap_ms is below duration.base_ms');
    }
  }
  return problems;
}

/** Magnitude/scaling inputs: a DoT must produce a non-zero per-tick amount. */
function magnitudeProblems(row: AppliedStatusRow): string[] {
  const problems: string[] = [];
  const mag = obj(row.magnitude);
  const flat = mag.flat;
  const statMult = mag.stat_mult;
  const globalMult = mag.global_mult;
  const hasFlat = isFiniteNumber(flat) && flat > 0;
  const hasStat = isFiniteNumber(statMult) && statMult > 0;
  if (!hasFlat && !hasStat) {
    problems.push('magnitude: neither magnitude.flat > 0 nor magnitude.stat_mult > 0');
  }
  if (hasStat && !ROLES.has(String(mag.role ?? ''))) {
    problems.push('magnitude.stat_mult scales with an attribute but magnitude.role is unset');
  }
  if (globalMult !== undefined && globalMult !== null &&
      (!isFiniteNumber(globalMult) || globalMult <= 0)) {
    problems.push('magnitude.global_mult is present but not a positive number');
  }
  return problems;
}

/** Stack / refresh policy: a ceiling must exist and must be at least one. */
function stackProblems(row: AppliedStatusRow): string[] {
  const problems: string[] = [];
  const stacks = obj(row.stacks);
  const calc = obj(stacks.max_stacks_calc);
  if (Object.keys(calc).length === 0) {
    problems.push('stacks.max_stacks_calc is missing (no stack/refresh ceiling)');
    return problems;
  }
  const base = calc.base;
  if (!isFiniteNumber(base) || base < 1) {
    problems.push('stacks.max_stacks_calc.base must be a number >= 1');
  }
  if (calc.terms !== undefined && calc.terms !== null && !Array.isArray(calc.terms)) {
    problems.push('stacks.max_stacks_calc.terms must be an array when present');
  }
  const role = stacks.role;
  if (role !== undefined && role !== null && !ROLES.has(String(role))) {
    problems.push('stacks.role is present but is not primary/secondary');
  }
  return problems;
}

/** Damage-amplification statuses carry a modifier instead of a magnitude. */
function modifierProblems(row: AppliedStatusRow): string[] {
  const problems: string[] = [];
  const mod = obj(row.modifier);
  if (Object.keys(mod).length === 0) {
    problems.push('modifier is missing for a damage_amp status');
    return problems;
  }
  if (!nonEmpty(mod.kind)) problems.push('modifier.kind is missing');
  if (!isFiniteNumber(mod.value) || (mod.value as number) === 0) {
    problems.push('modifier.value must be a non-zero number');
  }
  const sources = mod.eligible_sources;
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every((s) => nonEmpty(s))) {
    problems.push('modifier.eligible_sources must be a non-empty array of source names');
  }
  return problems;
}

/**
 * Validate one status definition against its declared classification. When a
 * required contract is supplied, identity (effect type, classification, damage
 * type) is pinned to it as well, so Ignite can never quietly become Scorched.
 */
export function validateStatusDefinition(
  row: AppliedStatusRow,
  contract?: RequiredStatusContract,
): string[] {
  const problems: string[] = [];
  const key = nonEmpty(row.key) ? row.key.trim() : '';
  if (!key) problems.push('key is missing');
  if (!nonEmpty(row.effect_type)) problems.push('effect_type is missing');

  const classification = nonEmpty(row.classification) ? row.classification.trim() : '';
  if (!(STATUS_CLASSIFICATIONS as readonly string[]).includes(classification)) {
    problems.push(`classification "${classification}" is not one of ${STATUS_CLASSIFICATIONS.join('/')}`);
  }

  if (contract) {
    if (row.effect_type !== contract.effectType) {
      problems.push(`effect_type must be "${contract.effectType}" (found "${row.effect_type}")`);
    }
    if (classification !== contract.classification) {
      problems.push(`classification must be "${contract.classification}" (found "${classification}")`);
    }
    if (contract.damageType && row.default_damage_type !== contract.damageType) {
      problems.push(
        `default_damage_type must be "${contract.damageType}" (found "${row.default_damage_type}")`,
      );
    }
  }

  problems.push(...durationProblems(row));
  problems.push(...stackProblems(row));

  if (classification === 'dot') {
    problems.push(...magnitudeProblems(row));
    const interval = row.tick_interval_ms;
    if (!isFiniteNumber(interval) || interval <= 0) {
      problems.push('tick_interval_ms must be a positive number for a periodic status');
    }
    if (!nonEmpty(row.default_damage_type)) {
      problems.push('default_damage_type is required for a damaging status');
    }
  } else if (classification === 'damage_amp') {
    problems.push(...modifierProblems(row));
  }

  return problems;
}

/** Index rows by key, ignoring keyless rows. */
export function indexStatusRows(
  rows: readonly AppliedStatusRow[] | null | undefined,
): Record<string, AppliedStatusRow> {
  const out: Record<string, AppliedStatusRow> = {};
  for (const row of rows ?? []) if (nonEmpty(row?.key)) out[row.key!.trim()] = row;
  return out;
}

/**
 * Every required status must exist and be usable, and every status that IS
 * authored must be internally consistent (a broken optional status would fail
 * exactly the same way at runtime).
 */
export function validateStatusDefinitions(
  rows: readonly AppliedStatusRow[] | null | undefined,
): StatusProblem[] {
  const byKey = indexStatusRows(rows);
  const problems: StatusProblem[] = [];

  for (const contract of REQUIRED_STATUS_CONTRACTS) {
    const row = byKey[contract.key];
    if (!row) {
      problems.push({
        code: 'missing_status_definition',
        status: contract.key,
        detail: `required status "${contract.key}" is not authored in applied_statuses`,
      });
      continue;
    }
    for (const detail of validateStatusDefinition(row, contract)) {
      problems.push({ code: 'invalid_status_definition', status: contract.key, detail });
    }
  }

  for (const [key, row] of Object.entries(byKey)) {
    if (REQUIRED_STATUS_KEYS.includes(key)) continue;
    for (const detail of validateStatusDefinition(row)) {
      problems.push({ code: 'invalid_status_definition', status: key, detail });
    }
  }

  return problems;
}

/**
 * Every active ability that applies a status must resolve to an existing,
 * compatible definition with usable application semantics. A missing reference
 * is a refusal, never a fallback to "no status".
 */
export function validateAbilityStatusReferences(
  abilities: readonly AbilityStatusReference[] | null | undefined,
  rows: readonly AppliedStatusRow[] | null | undefined,
): StatusProblem[] {
  const byKey = indexStatusRows(rows);
  const problems: StatusProblem[] = [];

  for (const ability of abilities ?? []) {
    const statusKey = nonEmpty(ability.applied_status) ? ability.applied_status.trim() : '';
    if (!statusKey) continue;
    if (ability.status_application_enabled === false) continue;
    const abilityKey = nonEmpty(ability.ability_key) ? ability.ability_key.trim() : '(unknown)';

    const row = byKey[statusKey];
    if (!row) {
      problems.push({
        code: 'missing_status_definition',
        status: statusKey,
        ability: abilityKey,
        detail: `ability "${abilityKey}" applies status "${statusKey}", which is not authored`,
      });
      continue;
    }

    const defProblems = validateStatusDefinition(
      row,
      REQUIRED_STATUS_CONTRACTS.find((c) => c.key === statusKey),
    );
    for (const detail of defProblems) {
      problems.push({
        code: 'invalid_status_definition', status: statusKey, ability: abilityKey, detail,
      });
    }

    const trigger = nonEmpty(ability.status_trigger) ? ability.status_trigger.trim() : '';
    if (!(STATUS_TRIGGERS as readonly string[]).includes(trigger)) {
      problems.push({
        code: 'invalid_status_definition', status: statusKey, ability: abilityKey,
        detail: `status_trigger "${trigger}" is not one of ${STATUS_TRIGGERS.join('/')}`,
      });
    }

    // `stack_apply` derives its chance from the base's amount_calc; every other
    // mechanic needs an explicit percentage, and 0 would disable the mechanic.
    const mechanic = nonEmpty(ability.mechanic_key) ? ability.mechanic_key.trim() : '';
    if (mechanic !== 'stack_apply') {
      const pct = ability.status_chance_pct;
      if (!isFiniteNumber(pct) || pct <= 0 || pct > 100) {
        problems.push({
          code: 'invalid_status_definition', status: statusKey, ability: abilityKey,
          detail: `status_chance_pct must be a number in (0, 100] (found ${String(pct)})`,
        });
      }
    }
  }

  return problems;
}

/** One-line, diagnosable renderings for logs and refusal reasons. */
export function formatStatusProblems(problems: readonly StatusProblem[]): string[] {
  return problems.map((p) =>
    `${p.code}: ${p.status}${p.ability ? ` (via ${p.ability})` : ''} — ${p.detail}`,
  );
}
