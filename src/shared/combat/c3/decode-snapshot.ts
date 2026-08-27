/**
 * c3/decode-snapshot.ts — the only bridge from `public.encounter_snapshot_v2`
 * output into the C1 `EncounterSnapshot` and the C2 `SnapshotEnvelope`.
 *
 * Rules this module enforces, in order of importance:
 *
 *  1. Nothing is guessed. Every field the resolver reads is either present in
 *     the database snapshot, derived from it by an explicitly documented rule,
 *     or supplied through `SnapshotAux` (values the snapshot function does not
 *     return: mode, authoritative time, ability magnitudes, procs, config).
 *  2. Missing required fields fail. `undefined`/`null` in a required position
 *     raises a `decode_failed` C3Error naming the exact JSON path.
 *  3. Unknown fields fail. Each decoded object is checked against its allowed
 *     key set, so a renamed or added database column can never be silently
 *     dropped into a default.
 *  4. No clamping and no defaulting of gameplay values. Bounds belong to the
 *     resolver and to `commit_encounter_tick_v2`.
 *
 * The decoder is pure: no database handle, no clock, no logging. It is used by
 * the C3 orchestration module, which owns all IO.
 */

import { decodeError } from './errors';
import { normalizeBossCast, type BossCastContext } from './boss-cast-contract';
import {
  EFFECT_MECHANIC_REGISTRY,
  EFFECT_PARAMS_VERSION,
  buildBuffSnapshotFromEffects,
  validateEffectRow,
} from '../pure/effect-contract';
import {
  SNAPSHOT_VERSION,
  type SnapshotEnvelope,
  type ResolvedDropChance,
  type ResolvedStoredPower,
  type StoredPowerCapSource,
  type DropChanceSource,
} from '../c2/contract';
import type {
  ActionSnapshot,
  Attributes,
  ActiveCastSnapshot,
  BossCastSnapshot,
  CreatureSnapshot,
  EffectSnapshot,
  EncounterSnapshot,
  EngagementSnapshot,
  ParticipantSnapshot,
  ProcSnapshot,
  ResolutionMode,
  ResolverConfig,
  StanceSnapshot,
  WeaponSnapshot,

} from '../pure/types';

// ── strict primitive readers ───────────────────────────────────────

type Json = Record<string, unknown>;

function obj(value: unknown, path: string): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw decodeError(path, `expected object, received ${describe(value)}`);
  }
  return value as Json;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw decodeError(path, `expected array, received ${describe(value)}`);
  return value;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'missing';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function reqStr(o: Json, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw decodeError(`${path}.${key}`, `expected non-empty string, received ${describe(v)}`);
  }
  return v;
}

function optStr(o: Json, key: string, path: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    throw decodeError(`${path}.${key}`, `expected string or null, received ${describe(v)}`);
  }
  return v;
}

function reqNum(o: Json, key: string, path: string): number {
  const v = o[key];
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw decodeError(`${path}.${key}`, `expected finite number, received ${describe(v)}`);
  }
  return n;
}

function optNum(o: Json, key: string, path: string): number | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  return reqNum(o, key, path);
}

function reqBool(o: Json, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') {
    throw decodeError(`${path}.${key}`, `expected boolean, received ${describe(v)}`);
  }
  return v;
}

/** Fail on any key the C3 contract does not know about. */
function assertKnownKeys(o: Json, allowed: readonly string[], path: string): void {
  const set = new Set(allowed);
  const unknown = Object.keys(o).filter((k) => !set.has(k));
  if (unknown.length > 0) {
    throw decodeError(path, `unknown field(s): ${unknown.sort().join(', ')}`);
  }
}

function oneOf<T extends string>(value: string, allowed: readonly T[], path: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw decodeError(path, `expected one of ${allowed.join('|')}, received ${value}`);
  }
  return value as T;
}

function attrs(value: unknown, path: string): Attributes {
  const o = obj(value, path);
  assertKnownKeys(o, ['str', 'dex', 'con', 'int', 'wis', 'cha'], path);
  return {
    str: reqNum(o, 'str', path),
    dex: reqNum(o, 'dex', path),
    con: reqNum(o, 'con', path),
    int: reqNum(o, 'int', path),
    wis: reqNum(o, 'wis', path),
    cha: reqNum(o, 'cha', path),
  };
}

// ── auxiliary input (values the SQL snapshot does not carry) ────────

/**
 * Ability magnitude/mechanic resolution, done by the loader from admin config.
 *
 * The shape is owned by `./ability-resolve`, the ONE module that turns a
 * configured ability row into numbers, and re-exported here because the decoder
 * is the only consumer that copies it onto `ActionSnapshot`.
 */
import type { ResolvedAbilityConfig } from './ability-resolve';
export type { ResolvedAbilityConfig };



/**
 * Ability configuration is resolved **per caster**, not per ability key.
 *
 * `abilities.amount_calc` / `duration_calc` scale off the caster's level and
 * attribute modifiers, and the pure resolver consumes already-resolved numbers.
 * Keying the map by ability key alone would make two casters of the same class
 * share one magnitude, so the loader resolves each queued action against its own
 * character and registers it under this composite key.
 */
export function abilityConfigKey(characterId: string, abilityKey: string): string {
  return `${characterId}:${abilityKey}`;
}



/**
 * Reservation bookkeeping contract.
 *
 * `characters.reserved_buffs` and `characters.stance_state` record ONLY which
 * stance a character has switched on and how much CP that stance reserves.
 * They are deliberately NOT a combat buff bag: every semantic buff the resolver
 * reads is rebuilt from `public.active_effects` rows (see
 * `pure/effect-contract.ts`). The decoder therefore validates their shape and
 * derives nothing but reserved CP from them.
 */
const RESERVATION_ENTRY_KEYS = ['tier', 'reserved', 'activated_at'] as const;

export interface ReservationState {
  /** Stance keys currently switched on. Ordering is stable (sorted). */
  readonly activeStanceKeys: readonly string[];
  /** Total CP reserved by those stances. Bookkeeping only. */
  readonly reservedCp: number;
}


export interface SnapshotAux {
  /** Authoritative mode, from the claim. Never inferred by the resolver. */
  readonly mode: ResolutionMode;
  /** Authoritative time, from the orchestration module. */
  readonly nowMs: number;
  readonly ticksToSimulate: number;
  /** Keyed by `abilityConfigKey(characterId, abilityKey)`. A miss is a decode failure. */
  readonly abilityConfig: ReadonlyMap<string, ResolvedAbilityConfig>;

  /** Weapon procs, resolved from equipped items by the loader. */
  readonly procs: readonly ProcSnapshot[];
  readonly xpBoostMultiplier: number;
  readonly gemDropChance: number;
  readonly weaponProgression: ResolverConfig['weaponProgression'];
  /** `parties.tank_id` (else leader) per party. */
  readonly tankByPartyId: ReadonlyMap<string, string>;
  readonly uncappedXpCharacterIds: readonly string[];
  /** Per-creature salvage material key, from creature configuration. */
  readonly salvageMaterialKeyByCreatureId: ReadonlyMap<string, string | null>;
  /** Remaining boss cast cooldown in ticks, tracked by the orchestration. */
  readonly castCooldownTicksByCreatureId: ReadonlyMap<string, number>;
  /**
   * Stance keys switched on per character (`characters.reserved_buffs`). A key
   * whose ability the catalog does not configure is dropped here, so an
   * unconfigured stance can never fail a whole tick closed.
   */
  readonly stanceKeysByCharacterId?: ReadonlyMap<string, readonly string[]>;
}

export interface DecodedSnapshot {
  readonly snapshot: EncounterSnapshot;
  readonly envelope: SnapshotEnvelope;
  /** Per-character MP, needed by the C2 payload (`characters[].mpAfter`). */
  readonly mpByCharacterId: Readonly<Record<string, number>>;
  /** Per-character XP/level bookkeeping needed for reward level-up fields. */
  readonly progressionByCharacterId: Readonly<
    Record<string, { xp: number; level: number; unspentStatPoints: number; bhp: number }>
  >;
}

// ── section decoders ───────────────────────────────────────────────

/** Every top-level section `public.encounter_snapshot_v2` (v3) returns. */
const SNAPSHOT_ROOT_KEYS = [
  'loaded',
  'snapshotVersion',
  'encounterId',
  'nodeId',
  'tickNumber',
  'encounterVersion',
  'loadedAtMs',
  'tickRateMs',
  'lootFallbackChance',
  'claim',
  'cursor',
  'storedPower',
  'participants',
  'creatures',
  'engagements',
  'actions',
  'effects',
  'statusDefs',
  'casts',
  'lootConfig',
  'lootTables',
  'config',
  'scope',
  'stateDigest',
] as const;

const PARTICIPANT_KEYS = [

  'id', 'name', 'level', 'classKey', 'hp', 'maxHp', 'cp', 'maxCp', 'mp', 'maxMp', 'ac',
  'attrs', 'stanceState', 'reservedBuffs', 'partyId', 'joinedAtMs', 'rowVersion', 'equipment',
  'presentAtNode',
  // Participation generation: identity of THIS visit to the encounter.
  'generation',
  'xp', 'unspentStatPoints', 'respecPoints', 'bhp',
] as const;

const EQUIPMENT_KEYS = [
  'inventoryId', 'itemId', 'slot', 'currentDurability', 'rarity', 'itemLevel',
  'weaponTag', 'hands', 'weaponDie', 'procs', 'stats', 'appliedGems',
] as const;

const CREATURE_KEYS = [
  'id', 'name', 'level', 'rarity', 'hp', 'maxHp', 'ac', 'isAlive', 'spawnSeq', 'isHumanoid',
  'attrs', 'lootMode', 'lootTableId', 'lootTable', 'bossCast', 'configuredStoredPowerCap',
  'effectiveDropChance', 'dropChanceSource', 'rowVersion',
  // Durable telegraph recovery boundary.
  'castReadyAtMs',
  // Presentation-only boss flavor (crit prose pool + death cry).
  'bossCritFlavors', 'bossDeathCry',
] as const;


const EFFECT_KEYS = [
  'id', 'targetId', 'sourceId', 'effectType', 'stacks', 'amountPerTick', 'expiresAtMs',
  'intervalMs', 'nextTickAtMs', 'sourceAbilityKey', 'rowVersion',
  // Semantic effect contract (see pure/effect-contract.ts).
  'mechanic', 'magnitude', 'remaining', 'params', 'paramsVersion', 'damageType',
  // Lifetime class: 'timed' (default) or 'stance' (reservation-backed).
  'lifetime',
] as const;

/** Status classification the effect decoder consults for periodicity/amp. */
export interface EffectStatusDef {
  readonly key: string;
  readonly isPeriodic: boolean;
  readonly ampPct: number;
  readonly maxStacks: number;
}

export interface EffectDecodeContext {
  /** Ids present in `$.creatures` — the ONE way target kind is derived. */
  readonly creatureIds: ReadonlySet<string>;
  readonly statusByKey: ReadonlyMap<string, EffectStatusDef>;
  /** JSON path prefix, so harnesses can report their own provenance. */
  readonly path?: string;
}

/**
 * Decode the `$.effects` section of a snapshot into `EffectSnapshot` rows.
 *
 * Extracted from `decodeEncounterSnapshot` so the persistence round-trip tests
 * exercise the exact production decode path rather than a second, drifting
 * implementation. Semantic rows are validated against the closed
 * mechanic/parameter registry; unknown mechanics and parameters fail closed
 * with the exact JSON path.
 */
export function decodeEffectsSection(
  entries: readonly unknown[],
  ctx: EffectDecodeContext,
): { effects: EffectSnapshot[]; effectIds: string[] } {
  const root = ctx.path ?? '$.effects';
  const effects: EffectSnapshot[] = [];
  const effectIds: string[] = [];
  entries.forEach((entry, i) => {
    const path = `${root}[${i}]`;
    const e = obj(entry, path);
    assertKnownKeys(e, EFFECT_KEYS, path);
    const id = reqStr(e, 'id', path);
    const targetId = reqStr(e, 'targetId', path);
    const effectType = reqStr(e, 'effectType', path);
    const def = ctx.statusByKey.get(effectType);
    const intervalMs = reqNum(e, 'intervalMs', path);
    // `nextTickAtMs` is `active_effects.next_tick_at` verbatim: the absolute
    // epoch-ms due time of this effect's next periodic tick. No derivation,
    // no relation to the encounter cursor or to combat_sessions.last_tick_at.
    const nextTickAtMs = reqNum(e, 'nextTickAtMs', path);
    const targetKind = ctx.creatureIds.has(targetId) ? 'creature' : 'character';
    const mechanic = optStr(e, 'mechanic', path);
    const sourceCharacterId = optStr(e, 'sourceId', path);
    const magnitude = optNum(e, 'magnitude', path);
    const remaining = optNum(e, 'remaining', path);
    const damageType = optStr(e, 'damageType', path);
    let params: Readonly<Record<string, number | boolean | string>> | undefined;
    if (mechanic) {
      try {
        params = validateEffectRow(
          {
            mechanic,
            targetKind,
            sourceCharacterId,
            magnitude,
            remaining,
            intervalMs,
            paramsVersion: optNum(e, 'paramsVersion', path) ?? EFFECT_PARAMS_VERSION,
            params: e.params ?? {},
          },
          path,
        );
      } catch (err) {
        throw decodeError(path, err instanceof Error ? err.message : String(err));
      }
    } else if (e.params !== undefined && e.params !== null && Object.keys(obj(e.params, `${path}.params`)).length > 0) {
      throw decodeError(`${path}.params`, 'params require a registered mechanic');
    }
    effects.push({
      id,
      lifetime: optStr(e, 'lifetime', path) === 'stance' ? 'stance' : 'timed',
      targetKind,
      targetId,
      effectType,
      stacks: reqNum(e, 'stacks', path),
      amountPerTick: reqNum(e, 'amountPerTick', path),
      expiresAtMs: reqNum(e, 'expiresAtMs', path),
      intervalMs,
      nextTickAtMs,
      // `params.damageType` is the contract-carried truth. The `damage_type`
      // column is a legacy mirror that the committer does not rewrite, so a row
      // re-persisted by a later tick keeps its typing only through params.
      damageType:
        damageType ?? (typeof params?.damageType === 'string' ? params.damageType : undefined),

      sourceCharacterId,
      isPeriodic: def?.isPeriodic ?? (mechanic ? EFFECT_MECHANIC_REGISTRY[mechanic].periodic : false),
      ampPct: def?.ampPct ?? 0,
      mechanic: (mechanic as EffectSnapshot['mechanic']) ?? null,
      abilityKey: optStr(e, 'sourceAbilityKey', path),
      cpPerTick: typeof params?.cpPerTick === 'number' ? params.cpPerTick : 0,
      healsAllies: params?.healsAllies === true,
      damagesEnemies: params?.damagesEnemies === true,
      maxStacks: typeof params?.maxStacks === 'number' ? params.maxStacks : def?.maxStacks,
      magnitude: magnitude ?? undefined,
      remaining,
      params,
      paramsVersion: EFFECT_PARAMS_VERSION,
    });
    effectIds.push(id);
  });
  return { effects, effectIds };
}

const ACTION_KEYS = [
  'id', 'characterId', 'creatureId', 'allyId', 'abilityKey', 'clientSeq',
  'eligibleAfterMs', 'rowVersion',
] as const;

const ENGAGEMENT_KEYS = ['creatureId', 'characterId', 'lastActionAtMs'] as const;

/**
 * Validate reservation bookkeeping and return it. NOTHING here reaches the
 * resolver's buff bag — a stance key is not a combat buff. Malformed entries
 * still fail closed so a stance RPC change cannot pass unnoticed.
 */
function decodeReservation(participant: Json, path: string): ReservationState {
  const keys = new Set<string>();
  let reservedCp = 0;
  for (const source of ['reservedBuffs', 'stanceState'] as const) {
    const raw = participant[source];
    if (raw === undefined || raw === null) continue;
    const state = obj(raw, `${path}.${source}`);
    for (const [key, value] of Object.entries(state)) {
      if (value === null || value === undefined) continue;
      keys.add(key);
      if (typeof value === 'object' && !Array.isArray(value)) {
        const entry = value as Json;
        const unknown = Object.keys(entry).filter(
          (k) => !(RESERVATION_ENTRY_KEYS as readonly string[]).includes(k),
        );
        if (unknown.length > 0) {
          throw decodeError(
            `${path}.${source}.${key}`,
            `unknown reservation field(s): ${unknown.sort().join(', ')}`,
          );
        }
        reservedCp += Math.max(0, optNum(entry, 'reserved', `${path}.${source}.${key}`) ?? 0);
        continue;
      }
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        // Legacy flag-shaped activation marker. Activation only, never a value.
        continue;
      }
      throw decodeError(
        `${path}.${source}.${key}`,
        `expected reservation bookkeeping object, received ${describe(value)}`,
      );
    }
  }
  return { activeStanceKeys: [...keys].sort(), reservedCp };
}


/**
 * Aggregate equipment + gem bonuses from the snapshotted equipment rows.
 * Level-up recalculation needs *effective* attributes, and this is the only
 * place they are derived — always from snapshot data, never from a live read.
 */
const BONUS_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'hp', 'cp', 'mp', 'ac'] as const;

function sumEquipmentBonuses(equipment: readonly Json[], path: string): Record<string, number> {
  const total: Record<string, number> = {};
  equipment.forEach((eq, i) => {
    for (const source of ['stats', 'appliedGems'] as const) {
      const raw = eq[source];
      if (raw === undefined || raw === null) continue;
      const rows = Array.isArray(raw) ? raw : [raw];
      rows.forEach((row, j) => {
        const o = obj(row, `${path}[${i}].${source}[${j}]`);
        for (const key of BONUS_KEYS) {
          const v = o[key];
          if (v === undefined || v === null) continue;
          const n = typeof v === 'string' ? Number(v) : v;
          if (typeof n !== 'number' || !Number.isFinite(n)) {
            throw decodeError(`${path}[${i}].${source}.${key}`, `expected numeric bonus, received ${describe(v)}`);
          }
          total[key] = (total[key] ?? 0) + n;
        }
      });
    }
  });
  return total;
}

function decodeWeapon(equipment: readonly Json[], path: string): WeaponSnapshot {
  const equippedInventoryIds = equipment.map((e, i) => reqStr(e, 'inventoryId', `${path}[${i}]`));
  const mainHand = equipment.find((e) => optStr(e, 'slot', path) === 'main_hand');
  if (!mainHand) {
    // Unarmed is a legitimate state (new characters own no gear).
    return { tag: null, hands: 1, itemLevel: null, rarity: null, equippedInventoryIds };
  }
  const hands = optNum(mainHand, 'hands', path) ?? 1;
  if (hands !== 1 && hands !== 2) {
    throw decodeError(`${path}.hands`, `expected 1 or 2, received ${hands}`);
  }
  return {
    tag: optStr(mainHand, 'weaponTag', path),
    hands,
    itemLevel: optNum(mainHand, 'itemLevel', path),
    rarity: optStr(mainHand, 'rarity', path),
    equippedInventoryIds,
  };
}

/**
 * Boss casts are decoded by the shared boss-cast contract, which owns the
 * complete stored vocabulary (canonical and legacy) and the historical
 * eligibility rule. Rarity, level and the authoritative tick rate are handed in
 * as explicit context — never inferred from the cast itself.
 */
function decodeBossCast(
  value: unknown,
  ctx: BossCastContext,
): BossCastSnapshot | null {
  if (value === undefined || value === null) return null;
  return normalizeBossCast(value, ctx);
}


/**
 * An in-flight telegraph. The frozen contract lives under `payload.config`
 * (written by the C2 payload builder). Rows created before that contract
 * existed fall back to the authored creature defaults so a legacy channel
 * still lands instead of hanging forever.
 */
function decodeActiveCast(value: unknown, path: string): ActiveCastSnapshot | null {
  const o = obj(value, path);
  const castEventId = reqStr(o, 'id', path);
  const creatureId = reqStr(o, 'creatureId', path);
  const startedAtMs = optNum(o, 'startedAtMs', path) ?? 0;
  const resolvesAtMs = optNum(o, 'expiresAtMs', path) ?? startedAtMs;
  const payload = o.payload ? obj(o.payload, `${path}.payload`) : {};
  const cfg = payload.config ? obj(payload.config, `${path}.payload.config`) : null;
  const abilityKey = optStr(o, 'abilityKey', path) ?? optStr(o, 'castKey', path);
  if (!abilityKey) return null;
  const storedPower = payload.stored_power
    ? obj(payload.stored_power, `${path}.payload.stored_power`)
    : null;
  return {
    castEventId,
    creatureId,
    abilityKey,
    castKey: optStr(o, 'castKey', path) ?? abilityKey,
    label: (cfg ? optStr(cfg, 'label', path) : null) ?? optStr(payload, 'label', path) ?? abilityKey,
    startedAtMs,
    resolvesAtMs,
    targetCharacterId:
      (cfg ? optStr(cfg, 'targetCharacterId', path) : null) ??
      optStr(payload, 'targetCharacterId', path),
    baseDamage: (cfg ? optNum(cfg, 'baseDamage', path) : null) ?? optNum(payload, 'damage', path) ?? 0,
    baseAoeDamage:
      (cfg ? optNum(cfg, 'baseAoeDamage', path) : null) ?? optNum(payload, 'aoe_amount', path) ?? 0,
    damageType:
      (cfg ? optStr(cfg, 'damageType', path) : null) ?? optStr(payload, 'damage_type', path),
    primaryShare: (cfg ? optNum(cfg, 'primaryShare', path) : null) ?? 1,
    aoeShare: (cfg ? optNum(cfg, 'aoeShare', path) : null) ?? 0,
    consumeMode: oneOf(
      (cfg ? optStr(cfg, 'consumeMode', path) : null) ?? 'all',
      ['all', 'percent', 'fixed', 'preserve', 'reset', 'ignore'] as const,
      `${path}.consumeMode`,
    ),
    consumePct: (cfg ? optNum(cfg, 'consumePct', path) : null) ?? 100,
    consumeFixed: (cfg ? optNum(cfg, 'consumeFixed', path) : null) ?? 0,
    pauseAutoattacks: cfg ? Boolean(cfg.pauseAutoattacks) : true,
    storedPowerCap:
      (cfg ? optNum(cfg, 'storedPowerCap', path) : null) ??
      (storedPower ? (optNum(storedPower, 'cap', path) ?? 0) : 0),
    lockMs: (cfg ? optNum(cfg, 'lockMs', path) : null) ?? optNum(payload, 'lock_ms', path) ?? 0,
    castedText: (cfg ? optStr(cfg, 'castedText', path) : null) ?? optStr(payload, 'text', path),
  };
}


// ── entry point ────────────────────────────────────────────────────

export function decodeEncounterSnapshot(raw: unknown, aux: SnapshotAux): DecodedSnapshot {
  const root = obj(raw, '$');
  if (root.loaded !== true) {
    throw decodeError('$.loaded', `snapshot not loaded (reason=${String(root.reason ?? 'unknown')})`);
  }
  // Root strictness: an added or renamed top-level section of
  // `encounter_snapshot_v2` must fail loudly here, never be dropped silently.
  assertKnownKeys(root, SNAPSHOT_ROOT_KEYS, '$');
  if (reqNum(root, 'snapshotVersion', '$') !== SNAPSHOT_VERSION) {
    throw decodeError('$.snapshotVersion', `expected ${SNAPSHOT_VERSION}`);
  }


  const encounterId = reqStr(root, 'encounterId', '$');
  const nodeId = reqStr(root, 'nodeId', '$');
  const tickNumber = reqNum(root, 'tickNumber', '$');
  const loadedAtMs = reqNum(root, 'loadedAtMs', '$');
  const tickRateMs = reqNum(root, 'tickRateMs', '$');

  // claim / cursor
  const claimRaw = obj(root.claim, '$.claim');
  assertKnownKeys(claimRaw, ['token', 'tick', 'attempt', 'leaseUntilMs', 'mode'], '$.claim');
  const claim = {
    token: reqStr(claimRaw, 'token', '$.claim'),
    tick: reqNum(claimRaw, 'tick', '$.claim'),
    attempt: reqNum(claimRaw, 'attempt', '$.claim'),
    leaseUntilMs: reqNum(claimRaw, 'leaseUntilMs', '$.claim'),
    // `claim.mode` is the *database* mode vocabulary (live|effects_only); the
    // C1 resolver mode vocabulary is (live|catchup) and arrives through aux.
    mode: aux.mode,
  } as const;
  const dbMode = reqStr(claimRaw, 'mode', '$.claim');
  const expectedDbMode = aux.mode === 'live' ? 'live' : 'effects_only';
  if (dbMode !== expectedDbMode) {
    throw decodeError('$.claim.mode', `claim mode ${dbMode} does not match requested ${aux.mode}`);
  }

  const cursorRaw = obj(root.cursor, '$.cursor');
  assertKnownKeys(cursorRaw, ['tickNumber', 'tickAtMs', 'tickState', 'resolvingTick'], '$.cursor');
  const cursor = {
    tickNumber: reqNum(cursorRaw, 'tickNumber', '$.cursor'),
    tickAtMs: reqNum(cursorRaw, 'tickAtMs', '$.cursor'),
    tickState: reqStr(cursorRaw, 'tickState', '$.cursor'),
    resolvingTick: optNum(cursorRaw, 'resolvingTick', '$.cursor'),
  } as const;

  // ── status definitions ───────────────────────────────────────────
  const statusDefs = arr(root.statusDefs, '$.statusDefs').map((entry, i) => {
    const path = `$.statusDefs[${i}]`;
    const s = obj(entry, path);
    const modifier = s.modifier ? obj(s.modifier, `${path}.modifier`) : {};
    const stacks = s.stacks ? obj(s.stacks, `${path}.stacks`) : {};
    return {
      key: reqStr(s, 'key', path),
      isPeriodic: s.is_periodic === true,
      ampPct: optNum(modifier, 'amp_pct', `${path}.modifier`) ?? 0,
      maxStacks: optNum(stacks, 'max', `${path}.stacks`) ?? 1,
    };
  });
  const statusByKey = new Map(statusDefs.map((s) => [s.key, s]));

  // ── effects ──────────────────────────────────────────────────────
  // Decoded BEFORE participants: `active_effects` is the single authority for
  // semantic combat state, so every participant's buff bag is rebuilt from
  // these rows on every tick (see pure/effect-contract.ts).
  const snapshotCreatureIds = new Set(
    arr(root.creatures, '$.creatures').map((c, i) => reqStr(obj(c, `$.creatures[${i}]`), 'id', `$.creatures[${i}]`)),
  );
  const { effects, effectIds } = decodeEffectsSection(
    arr(root.effects, '$.effects'),
    { creatureIds: snapshotCreatureIds, statusByKey },
  );


  // participants

  const participants: ParticipantSnapshot[] = [];
  const durabilityByInventoryId: Record<string, number> = {};
  const mpByCharacterId: Record<string, number> = {};
  const progressionByCharacterId: DecodedSnapshot['progressionByCharacterId'] = {};
  const uncapped = new Set(aux.uncappedXpCharacterIds);

  arr(root.participants, '$.participants').forEach((entry, i) => {
    const path = `$.participants[${i}]`;
    const p = obj(entry, path);
    assertKnownKeys(p, PARTICIPANT_KEYS, path);
    const id = reqStr(p, 'id', path);
    const equipment = arr(p.equipment, `${path}.equipment`).map((e, j) => {
      const eq = obj(e, `${path}.equipment[${j}]`);
      assertKnownKeys(eq, EQUIPMENT_KEYS, `${path}.equipment[${j}]`);
      durabilityByInventoryId[reqStr(eq, 'inventoryId', `${path}.equipment[${j}]`)] =
        reqNum(eq, 'currentDurability', `${path}.equipment[${j}]`);
      return eq;
    });
    const partyId = optStr(p, 'partyId', path);
    // Shape-checked for reserved CP; the semantic side of a stance is resolved
    // from configuration below and materialised by the resolver.
    decodeReservation(p, path);
    const stances: StanceSnapshot[] = [];
    for (const stanceKey of aux.stanceKeysByCharacterId?.get(id) ?? []) {
      const cfg = aux.abilityConfig.get(abilityConfigKey(id, stanceKey));
      if (!cfg) continue;
      stances.push({
        stanceKey,
        abilityKey: stanceKey,
        mechanic: cfg.mechanic,
        damageType: cfg.damageType,
        amount: cfg.amount,
        durationMs: cfg.durationMs,
        intervalMs: cfg.intervalMs,
        statusKey: cfg.statusKey,
        statusChancePct: cfg.statusChancePct,
        maxStacks: cfg.maxStacks,
        weaponBased: cfg.weaponBased,
        ...(cfg.params ? { params: cfg.params } : {}),
      });
    }
    const hasShield = equipment.some((e) => optStr(e, 'slot', path) === 'off_hand');

    participants.push({
      id,
      name: reqStr(p, 'name', path),
      level: reqNum(p, 'level', path),
      classKey: reqStr(p, 'classKey', path),
      hp: reqNum(p, 'hp', path),
      maxHp: reqNum(p, 'maxHp', path),
      cp: reqNum(p, 'cp', path),
      maxCp: reqNum(p, 'maxCp', path),
      attrs: attrs(p.attrs, `${path}.attrs`),
      ac: reqNum(p, 'ac', path),
      hasShield,
      weapon: decodeWeapon(equipment, `${path}.equipment`),
      // The ONE source of semantic buffs: persisted effect rows. Reservation
      // bookkeeping is validated separately and contributes nothing numeric.
      buffs: buildBuffSnapshotFromEffects(id, effects, aux.nowMs),
      partyId,
      isTank: partyId ? aux.tankByPartyId.get(partyId) === id : true,
      joinedAtMs: reqNum(p, 'joinedAtMs', path),
      // Complete participation arrives; presence is the target filter. A
      // snapshot without the flag predates it and is treated as present.
      presentAtNode: p.presentAtNode === undefined || p.presentAtNode === null
        ? true
        : p.presentAtNode === true,
      isUncappedXp: uncapped.has(id),
      mp: reqNum(p, 'mp', path),
      maxMp: reqNum(p, 'maxMp', path),
      xp: reqNum(p, 'xp', path),
      unspentStatPoints: reqNum(p, 'unspentStatPoints', path),
      respecPoints: reqNum(p, 'respecPoints', path),
      stances,
      equipmentBonuses: sumEquipmentBonuses(equipment, `${path}.equipment`),
    });

    mpByCharacterId[id] = reqNum(p, 'mp', path);
    (progressionByCharacterId as Record<string, unknown>)[id] = {
      xp: reqNum(p, 'xp', path),
      level: reqNum(p, 'level', path),
      unspentStatPoints: reqNum(p, 'unspentStatPoints', path),
      bhp: reqNum(p, 'bhp', path),
    };
  });

  // creatures
  const creatures: CreatureSnapshot[] = [];
  const spawnSeqByCreatureId: Record<string, number> = {};
  const dropChanceByCreatureId: Record<string, ResolvedDropChance> = {};

  // Stored Power is banked on the encounter row, but it is *owned* by the
  // creature that is channelling. The resolver debits the bank from the
  // creature's own pool, so the accumulator must be seeded onto that creature
  // here — otherwise every consume mode debits an empty pool.
  const spSeed = obj(root.storedPower, '$.storedPower');
  const spSeedCurrent = reqNum(spSeed, 'current', '$.storedPower');
  const spSeedCreatureId = optStr(spSeed, 'castingCreatureId', '$.storedPower');

  arr(root.creatures, '$.creatures').forEach((entry, i) => {

    const path = `$.creatures[${i}]`;
    const c = obj(entry, path);
    assertKnownKeys(c, CREATURE_KEYS, path);
    const id = reqStr(c, 'id', path);
    const rarity = oneOf(reqStr(c, 'rarity', path), ['regular', 'rare', 'boss'] as const, `${path}.rarity`);

    const lootTable = arr(c.lootTable ?? [], `${path}.lootTable`).map((e, j) => {
      const lp = `${path}.lootTable[${j}]`;
      const l = obj(e, lp);
      return {
        type: optStr(l, 'type', lp) ?? 'item',
        itemId: optStr(l, 'item_id', lp) ?? optStr(l, 'itemId', lp),
        chance: optNum(l, 'chance', lp) ?? 0,
        min: optNum(l, 'min', lp) ?? 0,
        max: optNum(l, 'max', lp) ?? 0,
      };
    });

    const creatureLevel = reqNum(c, 'level', path);
    const bossCast = decodeBossCast(c.bossCast, {
      rarity,
      creatureId: id,
      level: creatureLevel,
      tickRateMs,
    });

    // Display-only: tolerant by design (authored free text, no gameplay effect).
    const bossCritFlavors = arr(c.bossCritFlavors ?? [], `${path}.bossCritFlavors`)
      .map((e, j) => {
        const fp = `${path}.bossCritFlavors[${j}]`;
        const f = obj(e, fp);
        return {
          name: optStr(f, 'name', fp) ?? '',
          text: optStr(f, 'text', fp) ?? '',
          weight: optNum(f, 'weight', fp) ?? 1,
          damageType: optStr(f, 'damage_type', fp) ?? optStr(f, 'damageType', fp),
        };
      })
      .filter((f) => f.text.length > 0);
    const configuredCap = reqNum(c, 'configuredStoredPowerCap', path);

    creatures.push({
      id,
      name: reqStr(c, 'name', path),
      level: creatureLevel,
      rarity,
      hp: reqNum(c, 'hp', path),
      maxHp: reqNum(c, 'maxHp', path),
      ac: reqNum(c, 'ac', path),
      attrs: attrs(c.attrs, `${path}.attrs`),
      isAlive: reqBool(c, 'isAlive', path),
      isHumanoid: reqBool(c, 'isHumanoid', path),
      lootMode: oneOf(
        reqStr(c, 'lootMode', path),
        ['legacy_table', 'item_pool', 'salvage_only'] as const,
        `${path}.lootMode`,
      ),
      lootTableId: optStr(c, 'lootTableId', path),
      // Already resolved by the loot precedence in SQL: never null, never -1.
      dropChance: reqNum(c, 'effectiveDropChance', path),
      lootTable,
      salvageMaterialKey: aux.salvageMaterialKeyByCreatureId.get(id) ?? null,
      bossCast,
      // Encounter-scoped accumulator, attributed to its owning channeller.
      storedPower: spSeedCreatureId && id === spSeedCreatureId ? spSeedCurrent : 0,

      storedPowerCap: configuredCap,
      castCooldownTicks: aux.castCooldownTicksByCreatureId.get(id) ?? 0,
      bossCritFlavors: bossCritFlavors,
      bossDeathCry: optStr(c, 'bossDeathCry', path),
    });

    spawnSeqByCreatureId[id] = reqNum(c, 'spawnSeq', path);
    dropChanceByCreatureId[id] = {
      chance: reqNum(c, 'effectiveDropChance', path),
      source: oneOf(
        reqStr(c, 'dropChanceSource', path),
        ['creature', 'pool_config', 'legacy_fallback'] as const,
        `${path}.dropChanceSource`,
      ) as DropChanceSource,
    };
  });


  // status definitions and effects are decoded before participants, because a
  // participant's semantic buff bag is rebuilt from its persisted effect rows.


  // actions
  const actions: ActionSnapshot[] = [];
  const actionIds: string[] = [];
  // Effects-only (catch-up) resolution never consumes a queued action, so it
  // must not require one to be resolvable either: the caster is typically no
  // longer present at the node, and its ability configuration is intentionally
  // absent from the snapshot. The rows stay pending for the next live tick.
  const actionEntries = aux.mode === 'live' ? arr(root.actions, '$.actions') : [];
  actionEntries.forEach((entry, i) => {
    const path = `$.actions[${i}]`;
    const a = obj(entry, path);
    assertKnownKeys(a, ACTION_KEYS, path);
    const abilityKey = reqStr(a, 'abilityKey', path);
    const characterId = reqStr(a, 'characterId', path);
    const cfg = aux.abilityConfig.get(abilityConfigKey(characterId, abilityKey));
    if (!cfg) {
      throw decodeError(
        `${path}.abilityKey`,
        `no resolved ability configuration for "${abilityKey}" on character ${characterId}`,
      );
    }
    const id = reqStr(a, 'id', path);
    actions.push({
      id,
      characterId,

      creatureId: optStr(a, 'creatureId', path),
      allyId: optStr(a, 'allyId', path),
      abilityKey,
      mechanic: cfg.mechanic,
      damageType: cfg.damageType,
      cpCost: cfg.cpCost,
      amount: cfg.amount,
      durationMs: cfg.durationMs,
      intervalMs: cfg.intervalMs,
      statusKey: cfg.statusKey,
      statusChancePct: cfg.statusChancePct,
      maxStacks: cfg.maxStacks,
      weaponBased: cfg.weaponBased,
      // Per-caster mechanic parameters, resolved from configuration. Absent for
      // mechanics whose behaviour needs none — never a partial default.
      ...(cfg.params ? { params: cfg.params } : {}),
      sequence: reqNum(a, 'clientSeq', path),


    });
    actionIds.push(id);
  });

  // engagements
  const engagements: EngagementSnapshot[] = arr(root.engagements, '$.engagements').map((entry, i) => {
    const path = `$.engagements[${i}]`;
    const e = obj(entry, path);
    assertKnownKeys(e, ENGAGEMENT_KEYS, path);
    return {
      creatureId: reqStr(e, 'creatureId', path),
      characterId: reqStr(e, 'characterId', path),
      lastActionAtMs: reqNum(e, 'lastActionAtMs', path),
    };
  });

  // stored power (encounter accumulator + resolved cap, per cast/creature)
  const spRaw = obj(root.storedPower, '$.storedPower');
  assertKnownKeys(
    spRaw,
    ['current', 'cap', 'capSource', 'castingCreatureId', 'sourceId'],
    '$.storedPower',
  );
  const resolvedStoredPower: ResolvedStoredPower[] = [
    {
      creatureId: optStr(spRaw, 'castingCreatureId', '$.storedPower'),
      current: reqNum(spRaw, 'current', '$.storedPower'),
      cap: reqNum(spRaw, 'cap', '$.storedPower'),
      capSource: oneOf(
        reqStr(spRaw, 'capSource', '$.storedPower'),
        ['active_cast', 'casting_creature', 'encounter_default', 'inactive'] as const,
        '$.storedPower.capSource',
      ) as StoredPowerCapSource,
      active: reqStr(spRaw, 'capSource', '$.storedPower') !== 'inactive',
    },
    // Every creature also carries its own configured cap, so nothing is
    // collapsed into a single encounter-wide value.
    ...creatures
      .filter((c) => c.storedPowerCap > 0 && c.id !== optStr(spRaw, 'castingCreatureId', '$.storedPower'))
      .map((c) => ({
        creatureId: c.id,
        current: 0,
        cap: c.storedPowerCap,
        capSource: 'casting_creature' as StoredPowerCapSource,
        active: false,
      })),
  ];

  // scope + digest are passed through verbatim: the commit recomputes the
  // digest from the same scope, so any transformation here would be a bug.
  const scopeRaw = obj(root.scope, '$.scope');
  const digestRaw = obj(root.stateDigest, '$.stateDigest');
  for (const key of [
    'participants', 'characters', 'creatures', 'engagements', 'actions',
    'effects', 'equipment', 'casts', 'storedPower', 'configVersion',
  ]) {
    if (typeof digestRaw[key] !== 'string') {
      throw decodeError(`$.stateDigest.${key}`, `expected string hash, received ${describe(digestRaw[key])}`);
    }
  }

  const snapshot: EncounterSnapshot = {
    mode: aux.mode,
    encounterId,
    nodeId,
    tickNumber,
    ticksToSimulate: aux.ticksToSimulate,
    tickRateMs,
    nowMs: aux.nowMs,
    participants,
    creatures,
    effects,
    actions,
    engagements,
    activeCasts: arr(root.casts, '$.casts')
      .map((c, i) => decodeActiveCast(c, `$.casts[${i}]`))
      .filter((c): c is ActiveCastSnapshot => c !== null),
    procs: aux.procs,
    config: {
      xpBoostMultiplier: aux.xpBoostMultiplier,
      gemDropChance: aux.gemDropChance,
      weaponProgression: aux.weaponProgression,
      statusDefs,
    },
  };

  const envelope: SnapshotEnvelope = {
    snapshotVersion: SNAPSHOT_VERSION,
    encounterId,
    nodeId,
    tickNumber,
    encounterVersion: reqNum(root, 'encounterVersion', '$'),
    loadedAtMs,
    claim,
    cursor,
    scope: scopeRaw as unknown as SnapshotEnvelope['scope'],
    stateDigest: digestRaw as unknown as SnapshotEnvelope['stateDigest'],
    spawnSeqByCreatureId,
    durabilityByInventoryId,
    dropChanceByCreatureId,
    storedPower: resolvedStoredPower,
    lootFallbackChance: reqNum(root, 'lootFallbackChance', '$'),
  };

  // The scope must describe exactly what was decoded, or the commit would
  // validate a different row set than the one simulated.
  assertScopeMatches(envelope.scope, aux.mode, {
    participantIds: participants.map((p) => p.id),
    creatureIds: creatures.map((c) => c.id),
    actionIds,
    effectIds,
    inventoryIds: Object.keys(durabilityByInventoryId),
    // Party composition is configuration: the scope must name every party the
    // tank selection depended on, or the commit digest would not cover it.
    partyIds: [
      ...new Set(participants.map((p) => p.partyId).filter((id): id is string => Boolean(id))),
    ],
  });

  return { snapshot, envelope, mpByCharacterId, progressionByCharacterId };
}

function assertScopeMatches(
  scope: SnapshotEnvelope['scope'],
  mode: 'live' | 'catchup',
  decoded: {
    participantIds: string[]; creatureIds: string[]; actionIds: string[];
    effectIds: string[]; inventoryIds: string[]; partyIds: string[];
  },
): void {
  const compare = (name: keyof typeof decoded, actual: readonly string[]) => {
    const expected = [...(scope[name] ?? [])].sort();
    const got = [...decoded[name]].sort();
    if (expected.length !== got.length || expected.some((v, i) => v !== got[i])) {
      throw decodeError(`$.scope.${name}`, `scope disagrees with decoded rows (${expected.length} vs ${got.length})`);
    }
    void actual;
  };
  compare('participantIds', decoded.participantIds);
  compare('creatureIds', decoded.creatureIds);
  if (mode === 'live') {
    compare('actionIds', decoded.actionIds);
  } else if (decoded.actionIds.length > 0) {
    // Effects-only resolution decodes no action by design. The scope still
    // names the pending rows the snapshot read, so the commit digest keeps
    // covering them (a newly queued action before commit is a state conflict);
    // what must never happen is a decoded action in this mode.
    throw decodeError('$.scope.actionIds', 'effects-only resolution decoded a queued action');
  }
  compare('effectIds', decoded.effectIds);
  compare('inventoryIds', decoded.inventoryIds);
  compare('partyIds', decoded.partyIds);
}
