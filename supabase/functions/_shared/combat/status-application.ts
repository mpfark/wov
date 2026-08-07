/**
 * status-application.ts — THE one way an ability applies a reusable status.
 *
 * Consolidation: the old "Applied Status" (`abilities.applied_status`) and the
 * old "Optional On-Hit Effect" (`abilities.on_hit_effect`) were two competing
 * ways to hang Bleed / Poison / Ignite / Chilled off an ability. There is now
 * exactly ONE model:
 *
 *   - `applied_statuses` (reusable status) owns the MECHANICS: effect type,
 *     classification, per-tick magnitude (flat or role-scaled), duration rules,
 *     stack behaviour, tick interval, damage type, amplification payload.
 *   - the configured ability owns the APPLICATION: which status, WHEN it
 *     triggers, the chance, and whether the application exists at all.
 *
 * Ownership boundary, restated for clarity:
 *   `status_application_enabled = false` → the application DOES NOT EXIST.
 *   `status_chance_pct = 0`              → the application exists and is wired,
 *                                          but never succeeds.
 *   `status_chance_pct = null`           → the chance comes from the ability's
 *                                          own (stat-scaled) amount calc.
 *
 * Triggers are SUCCESSFUL QUALIFYING EVENTS. A miss, an invalid target, a
 * cancelled attack or a dead target never applies a status:
 *   - `ability_hit`            the ability's own attack landed damage
 *   - `weapon_hit`             an autoattack landed while the stance is up
 *   - `successful_pulse_hit`   a stance's automatic attack actually landed
 *   - `activation`             the ability resolved (no attack roll involved)
 *
 * `status_target` is NOT stored: it is derived from the base ability, which is
 * always enemy-facing for status appliers today, so configuration can never
 * contradict the base.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/combat/status-application.ts`.
 */

export type StatusTrigger =
  | 'ability_hit'
  | 'weapon_hit'
  | 'successful_pulse_hit'
  | 'activation';

export const STATUS_TRIGGERS: StatusTrigger[] = [
  'ability_hit', 'weapon_hit', 'successful_pulse_hit', 'activation',
];

export const STATUS_TRIGGER_LABELS: Record<StatusTrigger, string> = {
  ability_hit: 'On a landed ability hit',
  weapon_hit: 'On a landed weapon hit',
  successful_pulse_hit: 'On a landed automatic (stance) hit',
  activation: 'On activation',
};

/** Legacy stance trigger words mapped onto the canonical vocabulary. */
const LEGACY_TRIGGERS: Record<string, StatusTrigger> = {
  on_hit: 'weapon_hit',
  pulse: 'successful_pulse_hit',
  none: 'activation',
};

export interface StatusApplicationSpec {
  statusKey: string;
  effectType: string;
  label: string;
  /** 'dot' | 'damage_amp' | … — from the reusable status definition. */
  classification: string;
  isPeriodic: boolean;
  trigger: StatusTrigger;
  /** null = derive from the ability's amount calc. */
  chancePct: number | null;
  /** Periodic magnitude: flat per-tick damage (no attribute scaling). */
  flat: number | null;
  statMult: number;
  globalMult: number;
  /** Concrete attribute the status magnitude scales from (role already bound). */
  statAttr: string | null;
  durationMs: number;
  durationPerPointMs: number;
  durationCapMs: number | null;
  durationStat: string | null;
  /** Non-periodic statuses: authoritative duration in combat ticks. */
  durationTicks: number | null;
  tickRateMs: number | null;
  maxStacksCalc: unknown;
  /** Amplification payload (damage_amp statuses only). */
  ampKind: string | null;
  ampPct: number;
  ampEligibleSources: string[];
}

const num = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null =>
  (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/** Canonicalise any stored/legacy trigger word. */
export function normalizeStatusTrigger(raw: unknown): StatusTrigger | null {
  const s = str(raw);
  if (!s) return null;
  if ((STATUS_TRIGGERS as string[]).includes(s)) return s as StatusTrigger;
  return LEGACY_TRIGGERS[s] ?? null;
}

/**
 * Read the composed `effect_config` of an ability into a Status Application
 * spec. Returns null when the ability declares no (enabled) application.
 */
export function readStatusApplication(
  effectConfig: Record<string, unknown> | null | undefined,
): StatusApplicationSpec | null {
  const cfg = effectConfig ?? {};
  if (cfg.status_enabled !== true) return null;
  const statusKey = str(cfg.status_key);
  const effectType = str(cfg.effect_type) ?? str(cfg.amp_effect_type);
  const trigger = normalizeStatusTrigger(cfg.status_trigger) ?? normalizeStatusTrigger(cfg.trigger);
  if (!statusKey || !effectType || !trigger) return null;

  const classification = str(cfg.status_classification) ?? 'dot';
  const isPeriodic = classification !== 'damage_amp';
  const chanceRaw = cfg.status_chance_pct;
  const chancePct = typeof chanceRaw === 'number' && Number.isFinite(chanceRaw)
    ? Math.min(100, Math.max(0, chanceRaw))
    : null;

  return {
    statusKey,
    effectType,
    label: str(cfg.status_label) ?? str(cfg.amp_label) ?? statusKey,
    classification,
    isPeriodic,
    trigger,
    chancePct,
    flat: typeof cfg.dot_flat_damage === 'number' ? cfg.dot_flat_damage : null,
    statMult: num(cfg.dot_stat_mult, 1),
    globalMult: num(cfg.dot_global_mult, 1),
    statAttr: str(cfg.dot_stat),
    durationMs: num(cfg.dot_duration_ms, 0),
    durationPerPointMs: num(cfg.dot_duration_per_point_ms, 0),
    durationCapMs: typeof cfg.dot_duration_cap_ms === 'number' ? cfg.dot_duration_cap_ms : null,
    durationStat: str(cfg.dot_duration_stat),
    durationTicks: typeof cfg.amp_duration_ticks === 'number'
      ? Math.max(1, Math.floor(cfg.amp_duration_ticks)) : null,
    tickRateMs: typeof cfg.tick_rate_ms === 'number' ? cfg.tick_rate_ms : null,
    maxStacksCalc: cfg.max_stacks_calc ?? null,
    ampKind: str(cfg.amp_kind),
    ampPct: num(cfg.amp_pct, 0),
    ampEligibleSources: Array.isArray(cfg.amp_eligible_sources)
      ? (cfg.amp_eligible_sources as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
  };
}

/**
 * Chance decision. `sample` is a caller-supplied 0..1 value so the caller owns
 * randomness: live combat passes `Math.random()`, deterministic replays pass
 * `statusSample(...)`. Both paths must produce identical results for the same
 * sample — that is the parity contract.
 *
 * `scaledChance` is the ability's own amount-calc chance (0..1), used only when
 * the configuration leaves `chancePct` empty.
 */
export function statusChanceSucceeds(
  spec: Pick<StatusApplicationSpec, 'chancePct'>,
  sample: number,
  scaledChance?: number | null,
): boolean {
  const chance = spec.chancePct !== null
    ? spec.chancePct / 100
    : Math.max(0, Math.min(1, typeof scaledChance === 'number' ? scaledChance : 0));
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  return sample < chance;
}

/**
 * Deterministic 0..1 sampler for historical (replayed) events.
 *
 * The same event identity always yields the same sample, so a replay can never
 * reroll history. Note this does NOT reproduce a live `Math.random()` outcome —
 * live and replay agree only when handed the same sample; determinism of the
 * replay path is what keeps offscreen processing stable.
 */
export function statusSample(parts: Array<string | number>): number {
  const seed = parts.join('|');
  // FNV-1a, then a single xorshift scramble for better low-bit spread.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h << 13; h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5; h >>>= 0;
  return (h >>> 8) / 0x01000000;
}

/** Per-tick magnitude of a periodic status. Flat statuses ignore attributes. */
export function statusDamagePerTick(
  spec: StatusApplicationSpec,
  input: { effectiveStatMod: number; bondMult?: number },
): number {
  const bond = typeof input.bondMult === 'number' && input.bondMult > 0 ? input.bondMult : 1;
  const base = spec.flat !== null
    ? spec.flat
    : Math.max(0, input.effectiveStatMod) * spec.statMult * spec.globalMult;
  return Math.max(1, Math.floor(base * bond));
}

/** Duration of a periodic status, including its optional attribute extension. */
export function statusDurationMs(
  spec: StatusApplicationSpec,
  durationStatMod: number,
): number {
  let ms = spec.durationMs;
  if (spec.durationStat) {
    ms += Math.max(0, durationStatMod) * spec.durationPerPointMs;
    if (spec.durationCapMs !== null) ms = Math.min(spec.durationCapMs, ms);
  }
  return Math.max(0, Math.floor(ms));
}
