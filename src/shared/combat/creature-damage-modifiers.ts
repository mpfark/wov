/**
 * creature-damage-modifiers.ts — the ONE shared stage that applies
 * target-side incoming-damage modifiers to player damage against creatures.
 *
 * It runs after the per-source amount is final and immediately before the
 * shared `resolveDamage()` clamp. It never writes creature state, never
 * recomputes source damage, and never infers anything from log text or
 * ability names: the caller passes an explicit source classification.
 *
 * Eligibility has exactly ONE owner: the reusable status definition
 * (`applied_statuses.modifier.eligible_sources`). `NEVER_AMPLIFIED` is a
 * separate hard safety rule, not a definition of eligibility.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/combat/creature-damage-modifiers.ts`.
 */

export type CreatureDamageSource =
  // Categories a status definition may declare eligible.
  | 'weapon' | 'ability' | 'stance' | 'dot' | 'proc'
  // Categories that are never amplified.
  | 'reflect' | 'self' | 'environment';

/** Hard runtime safety rule. Not a definition of eligibility. */
export const NEVER_AMPLIFIED: ReadonlySet<CreatureDamageSource> =
  new Set<CreatureDamageSource>(['reflect', 'self', 'environment']);

/** One active amplification instance, resolved from an `active_effects` row. */
export interface DamageAmpInstance {
  /** Reusable status key (e.g. `chilled`). Same key never stacks. */
  statusKey: string;
  /** Whole percent, straight from the status definition. */
  pct: number;
  /** The categories this status amplifies — status-owned. */
  eligibleSources: CreatureDamageSource[];
  /** Start of the current uninterrupted instance (ms epoch). */
  startedAt: number;
  /** Exclusive end of the active window (ms epoch). */
  expiresAt: number;
}

/** Minimal shape of an `applied_statuses` row this module reads. */
export interface DamageAmpStatusDef {
  key: string;
  effect_type: string;
  classification?: string | null;
  modifier?: {
    kind?: string;
    value?: number;
    eligible_sources?: string[];
  } | null;
}

/** Minimal shape of an `active_effects` row this module reads. */
export interface ActiveEffectRow {
  target_id: string;
  effect_type: string;
  started_at?: number | null;
  expires_at: number;
}

const KNOWN_SOURCES: ReadonlySet<string> = new Set([
  'weapon', 'ability', 'stance', 'dot', 'proc', 'reflect', 'self', 'environment',
]);

function sanitizeSources(raw: unknown): CreatureDamageSource[] {
  if (!Array.isArray(raw)) return [];
  const out: CreatureDamageSource[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !KNOWN_SOURCES.has(v)) continue;
    const src = v as CreatureDamageSource;
    // Hard safety rule: dropped even if a status definition lists it.
    if (NEVER_AMPLIFIED.has(src)) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}

/** Is this status definition a damage-amplification status? */
export function isDamageAmpStatus(def: DamageAmpStatusDef | null | undefined): boolean {
  return !!def && def.classification === 'damage_amp'
    && def.modifier?.kind === 'damage_taken_pct';
}

/** True when the status definition ticks periodic damage. */
export function isPeriodicStatus(def: DamageAmpStatusDef | null | undefined): boolean {
  return !!def && def.classification === 'dot';
}

/**
 * Build the per-creature amplification snapshot for one point in time.
 * Callers freeze this at tick start so results never depend on iteration order.
 */
export function buildAmpSnapshot(
  effects: ActiveEffectRow[],
  statusDefsByEffectType: Record<string, DamageAmpStatusDef>,
  at: number,
): Record<string, DamageAmpInstance[]> {
  const out: Record<string, DamageAmpInstance[]> = {};
  for (const eff of effects || []) {
    const def = statusDefsByEffectType[eff.effect_type];
    if (!isDamageAmpStatus(def)) continue;
    const pct = Number(def.modifier?.value);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    const startedAt = typeof eff.started_at === 'number' ? eff.started_at : -Infinity;
    if (!(startedAt <= at && at < eff.expires_at)) continue;
    (out[eff.target_id] ||= []).push({
      statusKey: def.key,
      pct,
      eligibleSources: sanitizeSources(def.modifier?.eligible_sources),
      startedAt,
      expiresAt: eff.expires_at,
    });
  }
  return out;
}

/**
 * Aggregate active instances into one percent for a given damage source.
 * Same status key never stacks (strongest instance wins); distinct keys add.
 */
export function resolveAmpPct(
  instances: DamageAmpInstance[] | undefined,
  source: CreatureDamageSource,
): number {
  if (!instances || instances.length === 0) return 0;
  if (NEVER_AMPLIFIED.has(source)) return 0;
  const strongestByKey = new Map<string, DamageAmpInstance>();
  for (const inst of instances) {
    if (!inst.eligibleSources.includes(source)) continue;
    const current = strongestByKey.get(inst.statusKey);
    if (!current
      || inst.pct > current.pct
      || (inst.pct === current.pct && inst.expiresAt > current.expiresAt)) {
      strongestByKey.set(inst.statusKey, inst);
    }
  }
  let total = 0;
  for (const inst of strongestByKey.values()) total += inst.pct;
  return total;
}

/**
 * Apply the resolved percent to an already-calculated amount.
 * Non-positive damage is returned UNCHANGED: an amplifier can never turn
 * 0 damage into 1.
 */
export function applyCreatureDamageModifiers(input: {
  amount: number;
  source: CreatureDamageSource;
  ampPct: number;
}): number {
  const { amount, source, ampPct } = input;
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  if (!Number.isFinite(ampPct) || ampPct <= 0) return amount;
  if (NEVER_AMPLIFIED.has(source)) return amount;
  return Math.max(1, Math.floor(amount * (1 + ampPct / 100)));
}

/** Convenience: snapshot lookup + aggregation + application in one call. */
export function amplify(
  amount: number,
  source: CreatureDamageSource,
  instances: DamageAmpInstance[] | undefined,
): number {
  return applyCreatureDamageModifiers({
    amount,
    source,
    ampPct: resolveAmpPct(instances, source),
  });
}

/**
 * Derive the exclusive expiry boundary for a tick-count duration.
 * The half-tick margin exists only so heartbeat jitter cannot silently drop a
 * promised tick; it can never grant an extra one.
 */
export function expiryFromTicks(startedAt: number, ticks: number, tickRateMs: number): number {
  const n = Math.max(1, Math.floor(ticks));
  return startedAt + n * tickRateMs + Math.floor(tickRateMs / 2);
}
