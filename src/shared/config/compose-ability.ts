/**
 * compose-ability.ts — THE two-layer ability composer.
 *
 * Layer 1 (`base_abilities`): shared MECHANICS and NUMBERS. CP cost / reserve,
 * amount + duration formulas, interval, mechanic parameters, mechanic
 * configuration, and which On-Hit Effects the mechanic permits. A base never
 * names a concrete character attribute: attribute dependencies inside
 * `effect_config` are expressed as named scaling ROLES via
 * `effect_config.stat_roles` (`{"<key>": "primary" | "secondary"}`).
 *
 * Layer 2 (`abilities`): one CONFIGURED USE per class ability. It owns identity
 * (key, label, description, tooltip, combat text, damage type), the concrete
 * attributes bound to the primary/secondary roles, the optional applied status,
 * the optional On-Hit Effect, and exactly one numeric balancing control:
 * `class_scale` (the legacy per-class magnitude rider).
 *
 * Layer 3 (`applied_statuses`): reusable damage-over-time / status definitions
 * (Poison, Ignite, Bleed). They own magnitude coefficients, duration rules,
 * intervals and stack behaviour, and they also express attribute dependencies as
 * roles so the same status can be driven by a different attribute per use.
 *
 * `composeAbilityRow` flattens the three layers back into the single row shape
 * every existing consumer already understands (client registry, server calc
 * registry, admin preview), so the runtime keeps reading ONE resolved shape.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/config/compose-ability.ts`.
 */

import type { AbilityCalc, CalcStat, CalcTerm } from '../formulas/ability-calc';

export type ScalingRoleName = 'primary' | 'secondary';

export interface AppliedStatusDef {
  key: string;
  label?: string;
  effect_type: string;
  classification?: string;
  stack_noun?: string | null;
  tick_interval_ms?: number | null;
  magnitude?: {
    /** Flat per-tick magnitude — no attribute scaling at all. */
    flat?: number;
    stat_mult?: number;
    global_mult?: number;
    role?: ScalingRoleName | null;
  } | null;

  duration?: {
    base_ms?: number;
    per_point_ms?: number;
    cap_ms?: number;
    /**
     * Authoritative duration for non-periodic combat statuses: a whole number
     * of combat ticks. The runtime derives the expiry boundary from the live
     * tick cadence, so the promise ("the next N ticks") survives cadence changes.
     */
    duration_ticks?: number;
    role?: ScalingRoleName | null;
  } | null;
  stacks?: {
    role?: ScalingRoleName | null;
    max_stacks_calc?: AbilityCalc | null;
  } | null;
  /** Non-DoT modifier payload (damage-amplification statuses only). */
  modifier?: {
    kind?: string;
    value?: number;
    eligible_sources?: string[];
  } | null;
  default_damage_type?: string | null;
}

/** The `base_abilities` fields the composer reads. */
export interface BaseLayerRow {
  base_key: string;
  mechanic_key: string;
  activation_mode?: string | null;
  target_type?: string | null;
  default_target_type?: string | null;
  cp_cost?: number | null;
  cp_reserve_pct?: number | null;
  amount_calc?: AbilityCalc | null;
  duration_calc?: AbilityCalc | null;
  interval_ms?: number | null;
  mechanic_calcs?: Record<string, AbilityCalc> | null;
  effect_config?: Record<string, unknown> | null;
  supports_secondary_scaling?: boolean | null;
}

/** The `abilities` (configured use) fields the composer reads. */
export interface ConfiguredUseRow {
  ability_key: string;
  label: string;
  description: string;
  tooltip: string;
  mechanic_key: string;
  ability_type?: string | null;
  damage_type?: string | null;
  status?: string | null;
  combat_text?: Record<string, unknown> | null;
  class_scale?: number | null;
  primary_attribute?: string | null;
  secondary_attribute?: string | null;
  /** Status Application: which reusable status, when, how likely, and whether at all. */
  applied_status?: string | null;
  status_trigger?: string | null;
  status_chance_pct?: number | null;
  status_application_enabled?: boolean | null;
  /**
   * @deprecated Legacy one-off On-Hit Effect. Read ONLY as a narrowly scoped
   * compatibility path while the last ability migrates to Status Application.
   */
  on_hit_effect?: Record<string, unknown> | null;
  /** @deprecated Archive only — never read by the runtime. */
  effect_config?: Record<string, unknown> | null;
}


/** The flat, composed row shape the rest of the system already consumes. */
export interface ComposedAbilityRow {
  ability_key: string;
  label: string;
  description: string;
  tooltip: string;
  mechanic_key: string;
  ability_type?: string | null;
  damage_type?: string | null;
  target_type?: string | null;
  activation_mode?: string | null;
  status?: string | null;
  cp_cost: number;
  cp_reserve_pct?: number | null;
  amount_calc: AbilityCalc | null;
  duration_calc: AbilityCalc | null;
  interval_ms: number | null;
  mechanic_calcs: Record<string, AbilityCalc>;
  effect_config: Record<string, unknown>;
  combat_text: Record<string, unknown>;
  /** Composition provenance, for admin display and diagnostics. */
  base_key: string;
  class_scale: number;
}

function isCalcStat(v: unknown): v is CalcStat {
  return v === 'str' || v === 'dex' || v === 'con'
    || v === 'int' || v === 'wis' || v === 'cha';
}

/** Resolve a named scaling role to the configured use's concrete attribute. */
export function resolveRoleAttribute(
  use: ConfiguredUseRow,
  role: ScalingRoleName | null | undefined,
): CalcStat | null {
  if (role === 'primary') {
    return isCalcStat(use.primary_attribute) ? use.primary_attribute : null;
  }
  if (role === 'secondary') {
    return isCalcStat(use.secondary_attribute) ? use.secondary_attribute : null;
  }
  return null;
}

/** Rewrite role-tagged stat terms in a calc to the use's concrete attributes. */
function bindRolesInCalc(
  calc: AbilityCalc | null | undefined,
  use: ConfiguredUseRow,
): AbilityCalc | null {
  if (!calc || !Array.isArray(calc.terms)) return calc ?? null;
  const bind = (term: CalcTerm): CalcTerm => {
    if (term.source !== 'stat' && term.source !== 'stat_threshold') return term;
    const attr = resolveRoleAttribute(use, term.role as ScalingRoleName | undefined);
    // Only `stat` is ever rewritten; coefficients and transforms pass through.
    return attr ? { ...term, stat: attr } : term;
  };
  return {
    ...calc,
    terms: calc.terms.map(bind),
    ...(calc.multiplierCalc && Array.isArray(calc.multiplierCalc.terms)
      ? { multiplierCalc: { ...calc.multiplierCalc, terms: calc.multiplierCalc.terms.map(bind) } }
      : {}),
  };
}

/** Apply the configured use's `class_scale` as the calc's final multiplier. */
function applyClassScale(calc: AbilityCalc | null, scale: number): AbilityCalc | null {
  if (!calc || scale === 1) return calc;
  const current = typeof calc.finalMult === 'number' ? calc.finalMult
    : typeof (calc as { postMult?: number }).postMult === 'number'
      ? (calc as { postMult?: number }).postMult as number
      : 1;
  return { ...calc, finalMult: current * scale };
}

/**
 * Expand an applied-status definition into the `effect_config` keys the combat
 * runtime reads, binding the status's scaling roles to the use's attributes.
 *
 * Non-periodic (damage-amplification) statuses take a separate branch: they own
 * no periodic magnitude and must never leak `dot_*` keys or the DoT
 * `effect_type` into a mechanic that would then treat them as a DoT.
 */
export function statusEffectConfig(
  status: AppliedStatusDef,
  use: ConfiguredUseRow,
): Record<string, unknown> {
  // Status Application: identity + trigger + chance, shared by every branch so
  // the runtime resolves ONE spec regardless of classification.
  const application: Record<string, unknown> = {
    status_key: status.key,
    status_label: status.label ?? status.key,
    status_classification: status.classification ?? 'dot',
    status_trigger: use.status_trigger ?? null,
    status_chance_pct: typeof use.status_chance_pct === 'number' ? use.status_chance_pct : null,
    status_enabled: use.status_application_enabled === true,
  };

  if (status.classification === 'damage_amp') {
    const cfg: Record<string, unknown> = {
      ...application,
      amp_status_key: status.key,
      amp_effect_type: status.effect_type,
      amp_label: status.label ?? status.key,
      amp_kind: status.modifier?.kind ?? 'damage_taken_pct',
      amp_pct: typeof status.modifier?.value === 'number' ? status.modifier.value : 0,
      amp_eligible_sources: status.modifier?.eligible_sources ?? [],
    };
    const ticks = status.duration?.duration_ticks;
    if (typeof ticks === 'number') cfg.amp_duration_ticks = Math.max(1, Math.floor(ticks));
    return cfg;
  }

  const cfg: Record<string, unknown> = { ...application, effect_type: status.effect_type };
  if (status.stack_noun) cfg.stack_noun = status.stack_noun;
  if (typeof status.tick_interval_ms === 'number') cfg.tick_rate_ms = status.tick_interval_ms;


  const mag = status.magnitude ?? {};
  // A flat status (e.g. Scorched) deals a fixed amount per tick and ignores
  // attributes entirely — no role is bound and no multipliers apply.
  if (typeof mag.flat === 'number') cfg.dot_flat_damage = mag.flat;
  if (typeof mag.stat_mult === 'number') cfg.dot_stat_mult = mag.stat_mult;
  if (typeof mag.global_mult === 'number') cfg.dot_global_mult = mag.global_mult;
  const magAttr = resolveRoleAttribute(use, mag.role);
  if (magAttr) cfg.dot_stat = magAttr;

  const dur = status.duration ?? {};
  if (typeof dur.base_ms === 'number') cfg.dot_duration_ms = dur.base_ms;
  if (typeof dur.per_point_ms === 'number') cfg.dot_duration_per_point_ms = dur.per_point_ms;
  if (typeof dur.cap_ms === 'number') cfg.dot_duration_cap_ms = dur.cap_ms;
  const durAttr = resolveRoleAttribute(use, dur.role);
  if (durAttr) cfg.dot_duration_stat = durAttr;

  const stacks = status.stacks ?? {};
  if (stacks.max_stacks_calc) {
    cfg.max_stacks_calc = bindRolesInCalc(stacks.max_stacks_calc, use);
  }
  return cfg;
}

/**
 * base ability (mechanics + numbers) + configured use (identity + attributes)
 * + applied status = the flat row every consumer reads.
 */
export function composeAbilityRow(
  use: ConfiguredUseRow,
  base: BaseLayerRow | null | undefined,
  statuses?: Record<string, AppliedStatusDef> | null,
): ComposedAbilityRow {
  const scale = typeof use.class_scale === 'number' && use.class_scale > 0 ? use.class_scale : 1;
  const baseCfg = { ...(base?.effect_config ?? {}) } as Record<string, unknown>;
  const roles = (baseCfg.stat_roles ?? {}) as Record<string, ScalingRoleName>;
  delete baseCfg.stat_roles;

  // Bind base `*_stat` roles to this use's concrete attributes.
  for (const [key, role] of Object.entries(roles)) {
    const attr = resolveRoleAttribute(use, role);
    if (attr) baseCfg[key] = attr;
  }

  // Legacy compatibility ONLY: the last ability still on the retired one-off
  // On-Hit Effect keeps working until its Status Application is switched on.
  if (use.on_hit_effect) baseCfg.on_hit_effect = use.on_hit_effect;

  const statusDef = use.applied_status ? statuses?.[use.applied_status] : undefined;
  const effectConfig = statusDef
    ? { ...baseCfg, ...statusEffectConfig(statusDef, use) }
    : baseCfg;


  const mechanicCalcs: Record<string, AbilityCalc> = {};
  for (const [k, v] of Object.entries(base?.mechanic_calcs ?? {})) {
    mechanicCalcs[k] = bindRolesInCalc(v, use) as AbilityCalc;
  }

  return {
    // Identity: configured use.
    ability_key: use.ability_key,
    label: use.label,
    description: use.description,
    tooltip: use.tooltip,
    mechanic_key: base?.mechanic_key ?? use.mechanic_key,
    ability_type: use.ability_type ?? null,
    damage_type: use.damage_type ?? statusDef?.default_damage_type ?? null,
    status: use.status ?? null,
    combat_text: (use.combat_text ?? {}) as Record<string, unknown>,
    // Numbers: base layer (plus the one class balancing dial).
    target_type: base?.target_type ?? base?.default_target_type ?? null,
    activation_mode: base?.activation_mode ?? null,
    cp_cost: typeof base?.cp_cost === 'number' ? base.cp_cost : 0,
    cp_reserve_pct: base?.cp_reserve_pct ?? null,
    amount_calc: applyClassScale(bindRolesInCalc(base?.amount_calc, use), scale),
    duration_calc: bindRolesInCalc(base?.duration_calc, use),
    interval_ms: base?.interval_ms ?? null,
    mechanic_calcs: mechanicCalcs,
    effect_config: effectConfig,
    base_key: base?.base_key ?? '',
    class_scale: scale,
  };
}

/** Index a list of applied-status rows by key. */
export function indexAppliedStatuses(
  rows: AppliedStatusDef[] | null | undefined,
): Record<string, AppliedStatusDef> {
  const out: Record<string, AppliedStatusDef> = {};
  for (const row of rows ?? []) if (row?.key) out[row.key] = row;
  return out;
}
