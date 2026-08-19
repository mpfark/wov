/**
 * c3/decode-batch.ts — the only bridge from a committed
 * `encounter_tick_batches.payload` row back into typed presentation state.
 *
 * The batch is the *delivery* projection of a committed tick: the presentation
 * events plus the character/creature/death/kill state the clients need in order
 * to render the tick they did not resolve themselves.
 *
 * Rules, mirroring `decode-snapshot.ts`:
 *  1. Unknown fields fail. A renamed or added column in the SQL projection can
 *     never be silently dropped.
 *  2. Missing required fields fail, naming the exact JSON path.
 *  3. No clamping, no defaulting of gameplay values.
 *
 * Versioning note: the batch envelope carries its own `v`, independent of the
 * snapshot/proposal contract version (currently 3). The batch is a delivery
 * format, not an authority contract — bumping the authority contract does not
 * invalidate already-delivered batches, so the two version lines are separate
 * on purpose. `BATCH_ENVELOPE_VERSION` is the value written by
 * `commit_encounter_tick_v2`.
 */

import { decodeError } from './errors.ts';
import type { ProposedTick } from '../pure/types.ts';

export const BATCH_ENVELOPE_VERSION = 3 as const;

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

function assertKnownKeys(o: Json, allowed: readonly string[], path: string): void {
  const set = new Set(allowed);
  const unknown = Object.keys(o).filter((k) => !set.has(k));
  if (unknown.length > 0) {
    throw decodeError(path, `unknown field(s): ${unknown.sort().join(', ')}`);
  }
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

function optBool(o: Json, key: string, path: string): boolean | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  return reqBool(o, key, path);
}

function reqBool(o: Json, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') {
    throw decodeError(`${path}.${key}`, `expected boolean, received ${describe(v)}`);
  }
  return v;
}

export interface BatchEvent {
  readonly seq: number;
  readonly type: string;
  readonly message: string;
  readonly characterId: string | null;
  readonly creatureId: string | null;
  readonly amount: number | null;
  readonly damageType: string | null;
  /**
   * Presentation metadata (see `PresentationEvent`). Display-only: the client
   * turns these into MUD-style tier + flavor prose. Optional so an older
   * committed batch still decodes.
   */
  readonly attackerName: string | null;
  readonly targetName: string | null;
  readonly attackerClass: string | null;
  readonly weaponTag: string | null;
  readonly isCrit: boolean | null;
  readonly isHumanoid: boolean | null;
  readonly abilityKey: string | null;
}

export interface BatchCharacter {
  readonly characterId: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly cpBefore: number;
  readonly cpAfter: number;
  readonly absorbShieldAfter: number;
  readonly died: boolean;
}

export interface BatchCreature {
  readonly creatureId: string;
  readonly spawnSeq: number;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly killed: boolean;
  readonly creatureName: string | null;
}

/** One committed telegraph transition: start, resolve or fizzle. */
export interface BatchCast {
  readonly creatureId: string;
  readonly abilityKey: string;
  readonly castKey: string;
  readonly phase: 'start' | 'resolve' | 'fizzle';
  readonly resolvesAtMs: number;
  /** Durable cast-row id; null only for a cast that started and landed in one tick. */
  readonly castEventId: string | null;
  readonly label: string | null;
  readonly castMs: number;
  readonly storedPowerCap: number;
  readonly targets: readonly Json[];
}

export interface BatchStoredPower {
  readonly creatureId: string;
  readonly currentAfter: number;
  readonly cap: number;
}



export interface DecodedBatch {
  readonly envelopeVersion: number;
  readonly tick: number;
  readonly batchId: string;
  readonly mode: string;
  readonly ticksProcessed: number;
  readonly events: readonly BatchEvent[];
  readonly characters: readonly BatchCharacter[];
  readonly creatures: readonly BatchCreature[];
  readonly deaths: readonly Json[];
  readonly kills: readonly Json[];
  /**
   * Delivery-only passthrough sections (v3). These are the committed proposal
   * arrays verbatim — the client needs them to reconcile a tick it did not
   * resolve (rewards, level-ups, spent buffs, refused actions, effect changes)
   * without a second round trip. They are intentionally not re-typed here: the
   * pure resolver owns their shape, and re-declaring it would create a second
   * source of truth.
   */
  readonly rewards: readonly Json[];
  readonly progression: readonly Json[];
  readonly consumedBuffs: readonly Json[];
  readonly rejectedActions: readonly Json[];
  readonly consumedActionIds: readonly string[];
  readonly effectUpserts: readonly Json[];
  readonly effectDeleteTargetIds: readonly string[];
  /**
   * Telegraph lifecycle committed by this tick. The client's telegraph UI is
   * driven exclusively by these transitions, so a start it never saw cannot
   * leave a ghost bar and a resolve it never saw cannot leave one running.
   */
  readonly casts: readonly BatchCast[];
  /** Stored Power after this tick, per channelling creature. */
  readonly storedPower: readonly BatchStoredPower[];
  readonly session: Json;
}

const BATCH_KEYS = [
  'v',
  'tick',
  'batch_id',
  'mode',
  'ticks_processed',
  'events',
  'characters',
  'creatures',
  'deaths',
  'kills',
  'rewards',
  'progression',
  'consumedBuffs',
  'rejectedActions',
  'consumedActionIds',
  'effectUpserts',
  'effectDeleteTargetIds',
  'casts',
  'storedPower',
  'session',
] as const;

const CAST_KEYS = [
  'creatureId',
  'abilityKey',
  'castKey',
  'phase',
  'resolvesAtMs',
  'castEventId',
  'label',
  'castMs',
  'storedPowerCap',
  'targets',
] as const;

const STORED_POWER_KEYS = ['creatureId', 'currentAfter', 'cap'] as const;

const EVENT_KEYS = [
  'seq',
  'type',
  'message',
  'characterId',
  'creatureId',
  'amount',
  'damageType',
  'attackerName',
  'targetName',
  'attackerClass',
  'weaponTag',
  'isCrit',
  'isHumanoid',
  'abilityKey',
] as const;

const CHARACTER_KEYS = [
  'characterId',
  'hpBefore',
  'hpAfter',
  'cpBefore',
  'cpAfter',
  'absorbShieldAfter',
  'died',
] as const;

const CREATURE_KEYS = [
  'creatureId',
  'spawnSeq',
  'hpBefore',
  'hpAfter',
  'killed',
  'creatureName',
] as const;

/** Strictly decode one committed `encounter_tick_batches.payload`. */
export function decodeTickBatch(raw: unknown): DecodedBatch {
  const p = 'batch';
  const o = obj(raw, p);
  assertKnownKeys(o, BATCH_KEYS, p);

  const envelopeVersion = reqNum(o, 'v', p);
  if (envelopeVersion !== BATCH_ENVELOPE_VERSION) {
    throw decodeError(
      `${p}.v`,
      `unsupported batch envelope version ${envelopeVersion}, expected ${BATCH_ENVELOPE_VERSION}`,
    );
  }

  const events = arr(o.events, `${p}.events`).map((raw, i) => {
    const ep = `${p}.events[${i}]`;
    const e = obj(raw, ep);
    assertKnownKeys(e, EVENT_KEYS, ep);
    return {
      seq: reqNum(e, 'seq', ep),
      type: reqStr(e, 'type', ep),
      message: reqStr(e, 'message', ep),
      characterId: optStr(e, 'characterId', ep),
      creatureId: optStr(e, 'creatureId', ep),
      amount: optNum(e, 'amount', ep),
      damageType: optStr(e, 'damageType', ep),
      attackerName: optStr(e, 'attackerName', ep),
      targetName: optStr(e, 'targetName', ep),
      attackerClass: optStr(e, 'attackerClass', ep),
      weaponTag: optStr(e, 'weaponTag', ep),
      isCrit: optBool(e, 'isCrit', ep),
      isHumanoid: optBool(e, 'isHumanoid', ep),
      abilityKey: optStr(e, 'abilityKey', ep),
    } satisfies BatchEvent;
  });

  const characters = arr(o.characters, `${p}.characters`).map((raw, i) => {
    const cp = `${p}.characters[${i}]`;
    const c = obj(raw, cp);
    assertKnownKeys(c, CHARACTER_KEYS, cp);
    return {
      characterId: reqStr(c, 'characterId', cp),
      hpBefore: reqNum(c, 'hpBefore', cp),
      hpAfter: reqNum(c, 'hpAfter', cp),
      cpBefore: reqNum(c, 'cpBefore', cp),
      cpAfter: reqNum(c, 'cpAfter', cp),
      absorbShieldAfter: reqNum(c, 'absorbShieldAfter', cp),
      died: reqBool(c, 'died', cp),
    } satisfies BatchCharacter;
  });

  const creatures = arr(o.creatures, `${p}.creatures`).map((raw, i) => {
    const cp = `${p}.creatures[${i}]`;
    const c = obj(raw, cp);
    assertKnownKeys(c, CREATURE_KEYS, cp);
    return {
      creatureId: reqStr(c, 'creatureId', cp),
      spawnSeq: reqNum(c, 'spawnSeq', cp),
      hpBefore: reqNum(c, 'hpBefore', cp),
      hpAfter: reqNum(c, 'hpAfter', cp),
      killed: reqBool(c, 'killed', cp),
      creatureName: optStr(c, 'creatureName', cp),
    } satisfies BatchCreature;
  });

  // Telegraph fields were added in envelope v3; a batch committed without any
  // boss activity may omit them entirely, which decodes as "no casts".
  const casts = arr(o.casts ?? [], `${p}.casts`).map((raw, i) => {
    const kp = `${p}.casts[${i}]`;
    const k = obj(raw, kp);
    assertKnownKeys(k, CAST_KEYS, kp);
    const phase = reqStr(k, 'phase', kp);
    if (phase !== 'start' && phase !== 'resolve' && phase !== 'fizzle') {
      throw decodeError(`${kp}.phase`, `expected start|resolve|fizzle, received ${describe(phase)}`);
    }
    return {
      creatureId: reqStr(k, 'creatureId', kp),
      abilityKey: reqStr(k, 'abilityKey', kp),
      castKey: reqStr(k, 'castKey', kp),
      phase,
      resolvesAtMs: reqNum(k, 'resolvesAtMs', kp),
      castEventId: optStr(k, 'castEventId', kp),
      label: optStr(k, 'label', kp),
      castMs: reqNum(k, 'castMs', kp),
      storedPowerCap: reqNum(k, 'storedPowerCap', kp),
      targets: arr(k.targets, `${kp}.targets`).map((t, ti) => obj(t, `${kp}.targets[${ti}]`)),
    } satisfies BatchCast;
  });

  const storedPower = arr(o.storedPower ?? [], `${p}.storedPower`).map((raw, i) => {
    const sp = `${p}.storedPower[${i}]`;
    const s = obj(raw, sp);
    assertKnownKeys(s, STORED_POWER_KEYS, sp);
    return {
      creatureId: reqStr(s, 'creatureId', sp),
      currentAfter: reqNum(s, 'currentAfter', sp),
      cap: reqNum(s, 'cap', sp),
    } satisfies BatchStoredPower;
  });


  const jsonArr = (value: unknown, key: string): Json[] =>
    arr(value, `${p}.${key}`).map((v, i) => obj(v, `${p}.${key}[${i}]`));
  const strArr = (value: unknown, key: string): string[] =>
    arr(value, `${p}.${key}`).map((v, i) => {
      if (typeof v !== 'string' || v.length === 0) {
        throw decodeError(`${p}.${key}[${i}]`, `expected non-empty string, received ${describe(v)}`);
      }
      return v;
    });

  return {
    envelopeVersion,
    tick: reqNum(o, 'tick', p),
    batchId: reqStr(o, 'batch_id', p),
    mode: reqStr(o, 'mode', p),
    ticksProcessed: reqNum(o, 'ticks_processed', p),
    events,
    characters,
    creatures,
    deaths: jsonArr(o.deaths, 'deaths'),
    kills: jsonArr(o.kills, 'kills'),
    rewards: jsonArr(o.rewards, 'rewards'),
    progression: jsonArr(o.progression, 'progression'),
    consumedBuffs: jsonArr(o.consumedBuffs, 'consumedBuffs'),
    rejectedActions: jsonArr(o.rejectedActions, 'rejectedActions'),
    consumedActionIds: strArr(o.consumedActionIds, 'consumedActionIds'),
    effectUpserts: jsonArr(o.effectUpserts, 'effectUpserts'),
    effectDeleteTargetIds: strArr(o.effectDeleteTargetIds, 'effectDeleteTargetIds'),
    casts,
    storedPower,
    session: obj(o.session, `${p}.session`),
  };
}

/**
 * The deterministic delivery projection of a ProposedTick: exactly what
 * `commit_encounter_tick_v2` is expected to persist in the batch payload.
 *
 * Comparing this against `decodeTickBatch(...)` proves the committed batch is a
 * faithful projection of the pure result — no reordering, no re-derivation, no
 * lost field. Key order matters: the round-trip test compares serialisations.
 */
export function projectBatchFromProposal(
  proposed: ProposedTick,
  batchId: string,
  spawnSeqByCreatureId: Readonly<Record<string, number>>,
  /** Cast-row ids observed in the committed batch, positional with `proposed.casts`. */
  castEventIds?: readonly (string | null)[],
  /** Absolute Stored Power the committer clamped to, per creature. */
  storedPowerAfter?: Readonly<Record<string, number>>,
): DecodedBatch {
  const killByCreature = new Map(proposed.kills.map((k) => [k.creatureId, k]));
  return {
    envelopeVersion: BATCH_ENVELOPE_VERSION,
    tick: proposed.tickNumber,
    batchId,
    mode: proposed.mode,
    ticksProcessed: proposed.ticksProcessed ?? 1,
    events: proposed.events.map((e) => ({
      seq: e.seq,
      type: e.type,
      message: e.message,
      characterId: e.characterId,
      creatureId: e.creatureId,
      amount: e.amount,
      damageType: e.damageType,
      attackerName: e.attackerName ?? null,
      targetName: e.targetName ?? null,
      attackerClass: e.attackerClass ?? null,
      weaponTag: e.weaponTag ?? null,
      isCrit: e.isCrit ?? null,
      isHumanoid: e.isHumanoid ?? null,
      abilityKey: e.abilityKey ?? null,
    })),
    characters: proposed.characters.map((c) => ({
      characterId: c.characterId,
      hpBefore: c.hpBefore,
      hpAfter: c.hpAfter,
      cpBefore: c.cpBefore,
      cpAfter: c.cpAfter,
      absorbShieldAfter: c.absorbShieldAfter,
      died: c.died,
    })),
    creatures: proposed.creatures.map((c) => ({
      creatureId: c.creatureId,
      spawnSeq: spawnSeqByCreatureId[c.creatureId] ?? 1,
      hpBefore: c.hpBefore,
      hpAfter: c.hpAfter,
      killed: c.killed,
      creatureName: killByCreature.get(c.creatureId)?.creatureName ?? null,
    })),
    deaths: [],
    kills: [],
    rewards: (proposed.rewards ?? []) as unknown as Json[],
    progression: (proposed.progression ?? []) as unknown as Json[],
    consumedBuffs: (proposed.consumedBuffs ?? []) as unknown as Json[],
    rejectedActions: (proposed.rejectedActions ?? []) as unknown as Json[],
    consumedActionIds: [...(proposed.consumedActionIds ?? [])],
    effectUpserts: (proposed.effectUpserts ?? []) as unknown as Json[],
    effectDeleteTargetIds: [...(proposed.effectDeleteTargetIds ?? [])],
    // The committer owns the row id of a `start`, so a caller comparing against
    // a real committed batch supplies the ids it observed; everything else in
    // the transition is projected straight from the pure result.
    casts: (proposed.casts ?? []).map((c, i) => ({
      creatureId: c.creatureId,
      abilityKey: c.abilityKey,
      castKey: c.castKey,
      phase: c.phase,
      resolvesAtMs: c.resolvesAtMs,
      castEventId: castEventIds?.[i] ?? c.castEventId ?? null,
      label: c.config?.label ?? c.castKey ?? c.abilityKey,
      castMs: c.config ? Math.max(0, c.config.resolvesAtMs - c.config.startedAtMs) : 0,
      storedPowerCap: c.config?.storedPowerCap ?? 0,
      targets: c.targets.map((t) => ({
        characterId: t.characterId,
        damage: t.damage,
        applied: t.applied,
        isPrimary: t.isPrimary,
      })) as unknown as Json[],
    })),
    storedPower: (proposed.storedPower ?? []).map((s) => ({
      creatureId: s.creatureId,
      currentAfter: storedPowerAfter?.[s.creatureId] ?? Math.max(0, s.delta),
      cap: s.cap,
    })),
    session: (proposed.session ?? { ended: false, nextDueAtMs: 0 }) as unknown as Json,
  };
}
