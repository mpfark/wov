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

import { decodeError } from './errors';
import type { ProposedTick } from '../pure/types';

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

export interface DecodedBatch {
  readonly envelopeVersion: number;
  readonly tick: number;
  readonly batchId: string;
  readonly mode: string;
  readonly events: readonly BatchEvent[];
  readonly characters: readonly BatchCharacter[];
  readonly creatures: readonly BatchCreature[];
  readonly deaths: readonly Json[];
  readonly kills: readonly Json[];
}

const BATCH_KEYS = [
  'v',
  'tick',
  'batch_id',
  'mode',
  'events',
  'characters',
  'creatures',
  'deaths',
  'kills',
] as const;

const EVENT_KEYS = [
  'seq',
  'type',
  'message',
  'characterId',
  'creatureId',
  'amount',
  'damageType',
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

  return {
    envelopeVersion,
    tick: reqNum(o, 'tick', p),
    batchId: reqStr(o, 'batch_id', p),
    mode: reqStr(o, 'mode', p),
    events,
    characters,
    creatures,
    deaths: arr(o.deaths, `${p}.deaths`).map((d, i) => obj(d, `${p}.deaths[${i}]`)),
    kills: arr(o.kills, `${p}.kills`).map((k, i) => obj(k, `${p}.kills[${i}]`)),
  };
}

/**
 * The deterministic delivery projection of a ProposedTick: exactly what
 * `commit_encounter_tick_v2` is expected to persist in the batch payload.
 *
 * Comparing this against `decodeTickBatch(...)` proves the committed batch is a
 * faithful projection of the pure result — no reordering, no re-derivation, no
 * lost field.
 */
export function projectBatchFromProposal(
  proposed: ProposedTick,
  batchId: string,
  spawnSeqByCreatureId: Readonly<Record<string, number>>,
): DecodedBatch {
  const killByCreature = new Map(proposed.kills.map((k) => [k.creatureId, k]));
  return {
    envelopeVersion: BATCH_ENVELOPE_VERSION,
    tick: proposed.tickNumber,
    batchId,
    mode: proposed.mode,
    events: proposed.events.map((e) => ({
      seq: e.seq,
      type: e.type,
      message: e.message,
      characterId: e.characterId,
      creatureId: e.creatureId,
      amount: e.amount,
      damageType: e.damageType,
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
  };
}
