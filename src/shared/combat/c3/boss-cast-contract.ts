/**
 * c3/boss-cast-contract.ts — the single owner of the stored `creatures.boss_cast`
 * vocabulary.
 *
 * One module, two consumers: the C3 snapshot decoder (runtime) and the admin
 * creature editor (authoring/validation). There is deliberately no second
 * vocabulary anywhere else.
 *
 * ## Why compatibility mapping exists
 *
 * Every production row was authored against the pre-C3 millisecond vocabulary
 * (`label`, `amount`/`base_amount`, `cast_ms`, `cooldown_ms`, `cast_flavor`,
 * `accumulate.*`) and none carries an `ability_key`. The C3 decoder only spoke
 * the newer tick/`damage`/`casting_text` vocabulary and returned "no cast" for
 * any row without `ability_key`, so no telegraph has fired since the cutover.
 * This normalizer reads BOTH shapes and resolves them into one contract.
 *
 * ## Precedence (canonical wins, legacy is the fallback)
 *
 * | runtime field    | canonical key                   | legacy fallback                        |
 * |------------------|---------------------------------|----------------------------------------|
 * | abilityKey       | `ability_key` / `abilityKey`    | `cast_key` / `castKey` -> label slug   |
 * | castTicks        | `cast_ticks`                    | `cast_ms` / tickRate (rounded, min 1)  |
 * | cooldownTicks    | `cooldown_ticks`                | `cooldown_ms` / tickRate (min 1)       |
 * | damage           | `damage`                        | `base_amount` -> `amount` -> level curve|
 * | damageAoe        | `damage_aoe`                    | `base_aoe_amount`                      |
 * | castingText      | `casting_text`                  | `cast_flavor`                          |
 * | castedText       | `casted_text`                   | `hit_flavor`                           |
 * | channeling       | `channeling`                    | `accumulate.enabled` (default true)    |
 * | pauseAutoattacks | `pause_autoattacks`             | `accumulate.pause_autoattacks` (true)  |
 * | consumeFixed     | `stored_power.consume_fixed`    | `stored_power.consume_amount`          |
 *
 * A canonical key wins only when it carries a usable value: an empty or
 * whitespace-only canonical string is treated as *absent* (the legacy handler
 * trimmed authored prose and treated `''` as unset), never as an intentional
 * override that silently erases valid legacy prose.
 *
 * ## Historical semantics reproduced verbatim (pre-cutover `combat-tick`)
 *
 * - Eligibility: bosses telegraph unless `enabled === false`; rares are opt-in
 *   (`enabled === true`); regular creatures never telegraph. Rarity is passed
 *   in as explicit context and is never inferred from the label. Missing
 *   rarity fails closed (no cast).
 * - Damage never starts at zero: when no authored amount is positive, the
 *   legacy curve `8 + floor(level * 1.5)` applies.
 * - Timing defaults: 4000 ms cast, 20000 ms cooldown, 0.30 start chance.
 * - Cooldown runs from *resolution*, not from cast start (the resolver only
 *   decrements the cooldown on ticks where the boss is not channeling).
 * - `damage_type` is presentation only. A missing type is valid (the legacy
 *   handler passed `undefined` through to the log) — it is never defaulted to
 *   physical and never blocks the cast.
 *
 * Stored keys that no runtime consumer reads — `accumulate.source`,
 * `accumulate.method`, `accumulate.crit_during_cast` — are intentionally left
 * untouched in the database and reported here as unread rather than dropped.
 */

import type { BossCastSnapshot } from '../pure/types';

/** Keys the runtime resolves. Everything else in a stored row is preserved verbatim. */
export const BOSS_CAST_UNREAD_KEYS = [
  'accumulate.source',
  'accumulate.method',
  'accumulate.crit_during_cast',
] as const;

export const BOSS_CAST_DEFAULTS = {
  castMs: 4000,
  cooldownMs: 20000,
  chance: 0.30,
  label: 'Cataclysm',
  primaryShare: 1.0,
  aoeShare: 0.4,
  consumeMode: 'all' as const,
  consumePct: 100,
} as const;

export type CreatureRarity = 'regular' | 'rare' | 'boss';

export interface BossCastContext {
  /** Explicit classification. Never derived from the cast label. */
  readonly rarity: CreatureRarity | null | undefined;
  /** Immutable creature identity — the anchor for collision-safe identities. */
  readonly creatureId: string;
  /** Creature level, for the historical damage curve fallback. */
  readonly level: number;
  /** Authoritative tick rate from the snapshot, never a client constant. */
  readonly tickRateMs: number;
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A number is usable when it is finite. Non-numeric and NaN are "absent". */
function num(o: Rec | null, key: string): number | null {
  if (!o) return null;
  const raw = o[key];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** A positive number, the shape the legacy handler required for timing/damage. */
function posNum(o: Rec | null, key: string): number | null {
  const n = num(o, key);
  return n !== null && n > 0 ? n : null;
}

/** Trimmed string, or null. Empty/whitespace is "absent", matching history. */
function str(o: Rec | null, key: string): string | null {
  if (!o) return null;
  const raw = o[key];
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function bool(o: Rec | null, key: string): boolean | null {
  if (!o) return null;
  const raw = o[key];
  return typeof raw === 'boolean' ? raw : null;
}

/** Raised when the caller supplies timing context the contract cannot honour. */
export class BossCastContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BossCastContractError';
  }
}

/** The authoritative tick rate must be a finite, positive millisecond value. */
export function isValidTickRateMs(tickRateMs: unknown): tickRateMs is number {
  return typeof tickRateMs === 'number' && Number.isFinite(tickRateMs) && tickRateMs > 0;
}

/**
 * ms -> ticks on the authoritative grid: rounded, never below one tick.
 *
 * There is deliberately no fallback rate. Timing comes from the
 * encounter/snapshot cadence; silently substituting 2000 ms would let a broken
 * context publish casts on a grid nobody authorised. An invalid rate fails
 * closed.
 */
export function msToTicks(ms: number, tickRateMs: number, minTicks = 1): number {
  if (!isValidTickRateMs(tickRateMs)) {
    throw new BossCastContractError(
      `boss cast timing requires an authoritative tick rate; received ${String(tickRateMs)}`,
    );
  }
  return Math.max(minTicks, Math.round(ms / tickRateMs));
}

/**
 * The label slug used as a *temporary* identity for rows that predate
 * `ability_key`. Punctuation and case collapse, so "Headsman's Measure" and
 * "Headsmans  measure" produce the same slug — which is exactly why the slug is
 * never used bare: it is always anchored to the immutable creature id.
 */
export function slugifyCastLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Deterministic, order-independent disambiguation. Anchored to the immutable
 * creature id, so a rerun of the backfill and the decoder fallback agree, and
 * a later label rename never moves the identity.
 */
export function disambiguateCastKey(slug: string, creatureId: string): string {
  return `${slug}__${creatureId.replace(/-/g, '').slice(0, 8)}`;
}

/**
 * The ONE fallback identity rule, shared by the single-row runtime decoder and
 * the backfill. A single row cannot know whether another boss shares its label,
 * so the creature-anchored form is always used — the decoder and the migration
 * therefore derive byte-identical keys, and punctuation/case collisions stay
 * unique because the anchor differs.
 */
export function deriveCastFallbackKey(
  label: string | null | undefined,
  creatureId: string,
): string | null {
  const anchor = (creatureId ?? '').trim();
  if (!anchor) return null;
  const slug = slugifyCastLabel((label ?? '').trim() || BOSS_CAST_DEFAULTS.label)
    || slugifyCastLabel(BOSS_CAST_DEFAULTS.label);
  return disambiguateCastKey(slug, anchor);
}

export interface CastIdentityRow {
  readonly creatureId: string;
  readonly label: string | null | undefined;
  /** Already-stored canonical key, if any. Always preserved. */
  readonly abilityKey?: string | null;
}

export interface CastIdentityResult {
  readonly creatureId: string;
  readonly key: string;
  /** True when the key came from the creature-anchored label fallback. */
  readonly derived: boolean;
}

/**
 * Derive canonical identities for a set of rows using exactly the rule the
 * runtime decoder applies to a single row. Stable across reruns and independent
 * of order: the result depends only on (label, creatureId).
 */
export function deriveCastIdentities(rows: readonly CastIdentityRow[]): CastIdentityResult[] {
  return rows.map((r) => {
    const existing = r.abilityKey?.trim();
    if (existing) return { creatureId: r.creatureId, key: existing, derived: false };
    return {
      creatureId: r.creatureId,
      key: deriveCastFallbackKey(r.label, r.creatureId) ?? '',
      derived: true,
    };
  });
}


/** Validation used by the backfill: keys must exist, be non-empty and unique. */
export function validateCastIdentities(results: readonly CastIdentityResult[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const r of results) {
    if (!r.key || !r.key.trim()) problems.push(`${r.creatureId}: empty cast identity`);
    const prior = seen.get(r.key);
    if (prior) problems.push(`duplicate cast identity "${r.key}" (${prior}, ${r.creatureId})`);
    else seen.set(r.key, r.creatureId);
  }
  return problems;
}

/**
 * Historical eligibility rule, reproduced exactly from the deleted handler:
 *   boss  -> enabled unless explicitly false
 *   rare  -> disabled unless explicitly true
 *   other -> never
 * Unknown/missing rarity fails closed.
 */
export function castEnabled(
  rarity: CreatureRarity | null | undefined,
  enabled: boolean | null,
): boolean {
  if (rarity === 'boss') return enabled !== false;
  if (rarity === 'rare') return enabled === true;
  return false;
}

/** The historical flat-damage curve for rows that authored no positive amount. */
export function legacyCastDamage(level: number): number {
  const lvl = Number.isFinite(level) && level > 0 ? level : 1;
  return 8 + Math.floor(lvl * 1.5);
}

/**
 * True when a stored cast object should be treated as live for this rarity.
 * The single owner of "is this cast on?", shared by the runtime decoder and the
 * admin editor's load transform so the checkbox can never disagree with the
 * resolver.
 */
export function bossCastIsEnabled(raw: unknown, rarity: CreatureRarity | null | undefined): boolean {
  if (!isRec(raw) || Object.keys(raw).length === 0) return false;
  return castEnabled(rarity, bool(raw, 'enabled'));
}

/**
 * Normalize a stored `boss_cast` object into the runtime contract, or null when
 * the creature does not telegraph. Never throws on legacy shapes; throws only
 * when the *caller's* timing context is invalid (see `msToTicks`).
 */
export function normalizeBossCast(raw: unknown, ctx: BossCastContext): BossCastSnapshot | null {
  if (!isRec(raw) || Object.keys(raw).length === 0) return null;
  if (!castEnabled(ctx.rarity, bool(raw, 'enabled'))) return null;
  if (!isValidTickRateMs(ctx.tickRateMs)) {
    throw new BossCastContractError(
      `boss cast decode requires an authoritative tick rate; received ${String(ctx.tickRateMs)}`,
    );
  }

  const acc = isRec(raw.accumulate) ? (raw.accumulate as Rec) : null;
  const sp = isRec(raw.stored_power) ? (raw.stored_power as Rec) : null;

  const label = str(raw, 'label') ?? BOSS_CAST_DEFAULTS.label;
  const abilityKey =
    str(raw, 'ability_key') ??
    str(raw, 'abilityKey') ??
    str(raw, 'cast_key') ??
    str(raw, 'castKey') ??
    deriveCastFallbackKey(label, ctx.creatureId);
  if (!abilityKey) return null;


  const castTicks =
    posNum(raw, 'cast_ticks') ??
    msToTicks(posNum(raw, 'cast_ms') ?? BOSS_CAST_DEFAULTS.castMs, ctx.tickRateMs);
  const cooldownTicks =
    posNum(raw, 'cooldown_ticks') ??
    msToTicks(posNum(raw, 'cooldown_ms') ?? BOSS_CAST_DEFAULTS.cooldownMs, ctx.tickRateMs);

  const damage =
    posNum(raw, 'damage') ??
    posNum(raw, 'base_amount') ??
    posNum(raw, 'amount') ??
    legacyCastDamage(ctx.level);
  const damageAoe = num(raw, 'damage_aoe') ?? num(raw, 'base_aoe_amount') ?? 0;

  const rawChance = num(raw, 'chance');
  const chance = rawChance === null
    ? BOSS_CAST_DEFAULTS.chance
    : Math.max(0, Math.min(1, rawChance));

  const channeling = bool(raw, 'channeling') ?? bool(acc, 'enabled') ?? true;
  const pauseAutoattacks = bool(raw, 'pause_autoattacks') ?? bool(acc, 'pause_autoattacks') ?? true;

  const targetModeRaw = str(raw, 'target_mode') ?? 'tank_preferred';
  const targetMode: BossCastSnapshot['targetMode'] =
    targetModeRaw === 'tank_strict' || targetModeRaw === 'random_alive'
      ? targetModeRaw
      : 'tank_preferred';

  const consumeModeRaw = str(sp, 'consume_mode') ?? str(raw, 'consume_mode') ?? BOSS_CAST_DEFAULTS.consumeMode;
  const consumeMode: BossCastSnapshot['consumeMode'] =
    consumeModeRaw === 'percent' || consumeModeRaw === 'fixed' || consumeModeRaw === 'preserve' ||
    consumeModeRaw === 'reset' || consumeModeRaw === 'ignore'
      ? consumeModeRaw
      : 'all';

  return {
    abilityKey,
    castKey: str(raw, 'cast_key') ?? str(raw, 'castKey') ?? abilityKey,
    label,
    castTicks: Math.max(1, Math.floor(castTicks)),
    cooldownTicks: Math.max(1, Math.floor(cooldownTicks)),
    damage: Math.max(0, Math.floor(damage)),
    damageAoe: Math.max(0, Math.floor(damageAoe)),
    damageType: str(raw, 'damage_type'),
    targetMode,
    chance,
    channeling,
    storedPowerCap: Math.max(0, Math.floor(num(sp, 'cap') ?? 0)),
    primaryShare: num(sp, 'primary_share') ?? BOSS_CAST_DEFAULTS.primaryShare,
    aoeShare: num(sp, 'aoe_share') ?? BOSS_CAST_DEFAULTS.aoeShare,
    consumeMode,
    consumePct: num(sp, 'consume_pct') ?? num(raw, 'consume_pct') ?? BOSS_CAST_DEFAULTS.consumePct,
    consumeFixed:
      num(sp, 'consume_fixed') ?? num(sp, 'consume_amount') ??
      num(raw, 'consume_fixed') ?? num(raw, 'consume_amount') ?? 0,
    pauseAutoattacks: channeling && pauseAutoattacks,
    lockMs: Math.max(0, Math.floor(num(raw, 'lock_ms') ?? 0)),
    castingText: str(raw, 'casting_text') ?? str(raw, 'cast_flavor'),
    castedText: str(raw, 'casted_text') ?? str(raw, 'hit_flavor'),
  };
}

/**
 * The one canonical persisted shape. The database and the admin editor write
 * exactly these keys (millisecond timing, `base_amount`/`base_aoe_amount`,
 * `cast_flavor`/`hit_flavor`, `accumulate.*`) — the vocabulary the rows and the
 * cast RPCs already speak. Newer tick/`damage`/`casting_text` aliases stay
 * *readable* for hand-authored rows but are never written, so there is one
 * source of truth per value. Genuinely unknown keys are preserved verbatim.
 */
export interface CanonicalBossCastInput {
  readonly abilityKey: string;
  readonly enabled: boolean;
  readonly label: string;
  readonly damageType: string | null;
  readonly castFlavor: string | null;
  readonly hitFlavor: string | null;
  readonly baseAmount: number;
  readonly baseAoeAmount: number;
  readonly castMs: number;
  readonly cooldownMs: number;
  readonly chance: number;
  readonly lockMs: number;
  readonly targetMode: BossCastSnapshot['targetMode'];
  readonly storedPower: {
    readonly consumeMode: string;
    readonly consumePct: number;
    readonly consumeAmount: number;
    readonly primaryShare: number;
    readonly aoeShare: number;
    readonly cap: number | null;
  };
  readonly accumulate: {
    readonly enabled: boolean;
    readonly source: string;
    readonly method: string;
    readonly pauseAutoattacks: boolean;
    readonly critDuringCast: string;
  };
}

/** Keys the canonical writer owns. Anything else in a stored row is preserved. */
export const CANONICAL_BOSS_CAST_KEYS = [
  'ability_key', 'enabled', 'label', 'damage_type', 'cast_flavor', 'hit_flavor',
  'base_amount', 'base_aoe_amount', 'cast_ms', 'cooldown_ms', 'chance', 'lock_ms',
  'target_mode', 'stored_power', 'accumulate',
] as const;

/** Legacy duplicates the canonical writer removes, so no value has two homes. */
export const RETIRED_BOSS_CAST_KEYS = ['amount', 'cast_ticks', 'cooldown_ticks', 'damage', 'damage_aoe', 'casting_text', 'casted_text'] as const;

/**
 * Build the canonical stored object, preserving unknown keys from `existing`.
 * Idempotent: feeding the output back through the reader and the writer
 * produces a byte-identical object.
 */
export function buildCanonicalBossCast(
  input: CanonicalBossCastInput,
  existing?: unknown,
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};
  if (isRec(existing)) {
    const owned = new Set<string>([...CANONICAL_BOSS_CAST_KEYS, ...RETIRED_BOSS_CAST_KEYS]);
    for (const [k, v] of Object.entries(existing)) {
      if (!owned.has(k)) preserved[k] = v;
    }
  }
  const existingAcc = isRec(existing) && isRec((existing as Rec).accumulate)
    ? ((existing as Rec).accumulate as Rec)
    : null;
  const accPreserved: Record<string, unknown> = {};
  if (existingAcc) {
    const owned = new Set(['enabled', 'source', 'method', 'pause_autoattacks', 'crit_during_cast']);
    for (const [k, v] of Object.entries(existingAcc)) if (!owned.has(k)) accPreserved[k] = v;
  }
  const existingSp = isRec(existing) && isRec((existing as Rec).stored_power)
    ? ((existing as Rec).stored_power as Rec)
    : null;
  const spPreserved: Record<string, unknown> = {};
  if (existingSp) {
    const owned = new Set(['consume_mode', 'consume_pct', 'consume_amount', 'consume_fixed', 'primary_share', 'aoe_share', 'cap']);
    for (const [k, v] of Object.entries(existingSp)) if (!owned.has(k)) spPreserved[k] = v;
  }

  return {
    ...preserved,
    ability_key: input.abilityKey,
    enabled: input.enabled,
    label: input.label,
    damage_type: input.damageType,
    cast_flavor: input.castFlavor,
    hit_flavor: input.hitFlavor,
    base_amount: Math.max(0, Math.floor(input.baseAmount)),
    base_aoe_amount: Math.max(0, Math.floor(input.baseAoeAmount)),
    cast_ms: Math.max(1, Math.floor(input.castMs)),
    cooldown_ms: Math.max(1000, Math.floor(input.cooldownMs)),
    chance: Math.max(0, Math.min(1, input.chance)),
    lock_ms: Math.max(0, Math.floor(input.lockMs)),
    target_mode: input.targetMode,
    stored_power: {
      ...spPreserved,
      consume_mode: input.storedPower.consumeMode,
      consume_pct: input.storedPower.consumePct,
      consume_amount: Math.max(0, Math.floor(input.storedPower.consumeAmount)),
      primary_share: input.storedPower.primaryShare,
      aoe_share: input.storedPower.aoeShare,
      cap: input.storedPower.cap && input.storedPower.cap > 0 ? Math.floor(input.storedPower.cap) : null,
    },
    accumulate: {
      ...accPreserved,
      enabled: input.accumulate.enabled,
      source: input.accumulate.source,
      method: input.accumulate.method,
      pause_autoattacks: input.accumulate.pauseAutoattacks,
      crit_during_cast: input.accumulate.critDuringCast,
    },
  };
}

/**
 * Authoring-side validation. Applies to *enabled* casts only: a disabled legacy
 * configuration is allowed to stay incomplete rather than forcing the admin to
 * finish or delete it.
 *
 * `chance` is accepted on the inclusive range [0, 1] — exactly the range the
 * runtime contract accepts. (A stored 0 means "never starts"; it is a distinct
 * authoring statement from `enabled: false`, which also stops accumulation.)
 */
export function validateCanonicalBossCast(
  stored: Record<string, unknown>,
  ctx: BossCastContext,
): string[] {
  const problems: string[] = [];
  if (bool(stored, 'enabled') === false) return problems;
  if (!isValidTickRateMs(ctx.tickRateMs)) {
    return ['no authoritative tick rate available for boss-cast timing'];
  }
  if (!str(stored, 'ability_key')) problems.push('missing stable cast identity (ability_key)');
  if (!str(stored, 'label')) problems.push('missing cast label');
  if ((posNum(stored, 'cast_ms') ?? 0) <= 0) problems.push('cast duration must be at least one tick');
  if ((posNum(stored, 'cooldown_ms') ?? 0) <= 0) problems.push('cooldown must be positive');
  const chance = num(stored, 'chance');
  if (chance === null || chance < 0 || chance > 1) problems.push('start chance must be between 0 and 1');
  const sp = isRec(stored.stored_power) ? (stored.stored_power as Rec) : null;
  const damage = (posNum(stored, 'base_amount') ?? 0) + (num(stored, 'base_aoe_amount') ?? 0) + (num(sp, 'cap') ?? 0);
  if (damage <= 0) problems.push('cast would land for zero damage (set flat damage, AoE damage or a Stored Power cap)');
  if (!normalizeBossCast(stored, ctx)) {
    problems.push('cast is enabled but does not decode into a runnable contract');
  }

  return problems;
}
