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
  BossCastSnapshot,
  CreatureSnapshot,
  EffectSnapshot,
  EncounterSnapshot,
  EngagementSnapshot,
  ParticipantBuffSnapshot,
  ParticipantSnapshot,
  ProcSnapshot,
  ResolutionMode,
  ResolverConfig,
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

/** Ability magnitude/mechanic resolution, done by the loader from admin config. */
export interface ResolvedAbilityConfig {
  readonly mechanic: ActionSnapshot['mechanic'];
  readonly damageType: string | null;
  readonly cpCost: number;
  readonly amount: number;
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly statusKey: string | null;
  readonly statusChancePct: number;
  readonly maxStacks: number;
  readonly weaponBased: boolean;
}

/**
 * Buff-state key registry.
 *
 * `characters.reserved_buffs` and `characters.stance_state` are free-form JSON
 * owned by the stance RPCs, so they are not a typed contract. C3 pins the
 * mapping here: a key outside this registry is a decode failure rather than a
 * silently ignored buff.
 */
export const BUFF_KEY_REGISTRY = {
  stealth: 'stealth',
  damage_buff: 'damageBuff',
  ignite: 'damageBuff',
  envenom: 'damageBuff',
  mitigation_pct: 'mitigationPct',
  mitigation_flat: 'mitigationFlat',
  absorb_shield: 'absorbShield',
  dodge_chance: 'dodgeChance',
  crit_buff: 'critBuffBonus',
  block_buff: 'blockBuff',
  rooted: 'rooted',
} as const satisfies Record<string, keyof ParticipantBuffSnapshot>;

export interface SnapshotAux {
  /** Authoritative mode, from the claim. Never inferred by the resolver. */
  readonly mode: ResolutionMode;
  /** Authoritative time, from the orchestration module. */
  readonly nowMs: number;
  readonly ticksToSimulate: number;
  /** Keyed by `combat_actions.ability_key`. A missing key is a decode failure. */
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

const PARTICIPANT_KEYS = [
  'id', 'name', 'level', 'classKey', 'hp', 'maxHp', 'cp', 'maxCp', 'mp', 'maxMp', 'ac',
  'attrs', 'stanceState', 'reservedBuffs', 'partyId', 'joinedAtMs', 'rowVersion', 'equipment',
  'xp', 'unspentStatPoints', 'bhp',
] as const;

const EQUIPMENT_KEYS = [
  'inventoryId', 'itemId', 'slot', 'currentDurability', 'rarity', 'itemLevel',
  'weaponTag', 'hands', 'weaponDie', 'procs', 'stats', 'appliedGems',
] as const;

const CREATURE_KEYS = [
  'id', 'name', 'level', 'rarity', 'hp', 'maxHp', 'ac', 'isAlive', 'spawnSeq', 'isHumanoid',
  'attrs', 'lootMode', 'lootTableId', 'lootTable', 'bossCast', 'configuredStoredPowerCap',
  'effectiveDropChance', 'dropChanceSource', 'rowVersion',
] as const;

const EFFECT_KEYS = [
  'id', 'targetId', 'sourceId', 'effectType', 'stacks', 'amountPerTick', 'expiresAtMs',
  'intervalMs', 'lastTickAtMs', 'sourceAbilityKey', 'rowVersion',
] as const;

const ACTION_KEYS = [
  'id', 'characterId', 'creatureId', 'allyId', 'abilityKey', 'clientSeq',
  'eligibleAfterMs', 'rowVersion',
] as const;

const ENGAGEMENT_KEYS = ['creatureId', 'characterId', 'lastActionAtMs'] as const;

function decodeBuffs(participant: Json, path: string): ParticipantBuffSnapshot {
  const buffs: {
    stealth: boolean; damageBuff: boolean; mitigationPct: number; mitigationFlat: number;
    absorbShield: number; dodgeChance: number; critBuffBonus: number; blockBuff: boolean;
    rooted: boolean;
  } = {
    stealth: false, damageBuff: false, mitigationPct: 0, mitigationFlat: 0,
    absorbShield: 0, dodgeChance: 0, critBuffBonus: 0, blockBuff: false, rooted: false,
  };

  for (const source of ['reservedBuffs', 'stanceState'] as const) {
    const raw = participant[source];
    if (raw === undefined || raw === null) continue;
    const state = obj(raw, `${path}.${source}`);
    for (const [key, value] of Object.entries(state)) {
      const target = (BUFF_KEY_REGISTRY as Record<string, keyof ParticipantBuffSnapshot>)[key];
      if (!target) {
        throw decodeError(
          `${path}.${source}.${key}`,
          'buff key is not in BUFF_KEY_REGISTRY; register it before it can affect combat',
        );
      }
      const bag = buffs as unknown as Record<string, number | boolean>;
      if (typeof bag[target] === 'boolean') {
        bag[target] = Boolean(value);
      } else {
        const n = typeof value === 'string' ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          throw decodeError(`${path}.${source}.${key}`, `expected numeric buff value, received ${describe(value)}`);
        }
        bag[target] = Math.max(Number(bag[target] ?? 0), n);
      }

    }
  }
  return buffs;
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

function decodeBossCast(value: unknown, path: string): BossCastSnapshot | null {
  if (value === undefined || value === null) return null;
  const o = obj(value, path);
  if (Object.keys(o).length === 0) return null;
  const abilityKey = optStr(o, 'ability_key', path) ?? optStr(o, 'abilityKey', path);
  if (!abilityKey) return null;
  const storedPower = o.stored_power ? obj(o.stored_power, `${path}.stored_power`) : null;
  return {
    abilityKey,
    label: optStr(o, 'label', path) ?? abilityKey,
    castTicks: optNum(o, 'cast_ticks', path) ?? 1,
    cooldownTicks: optNum(o, 'cooldown_ticks', path) ?? 0,
    damage: optNum(o, 'damage', path) ?? 0,
    damageType: optStr(o, 'damage_type', path),
    targetMode: oneOf(
      optStr(o, 'target_mode', path) ?? 'tank_preferred',
      ['tank_strict', 'tank_preferred', 'random_alive'] as const,
      `${path}.target_mode`,
    ),
    channeling: Boolean(o.channeling),
    storedPowerCap: storedPower ? (optNum(storedPower, 'cap', `${path}.stored_power`) ?? 0) : 0,
    castingText: optStr(o, 'casting_text', path),
    castedText: optStr(o, 'casted_text', path),
  };
}

// ── entry point ────────────────────────────────────────────────────

export function decodeEncounterSnapshot(raw: unknown, aux: SnapshotAux): DecodedSnapshot {
  const root = obj(raw, '$');
  if (root.loaded !== true) {
    throw decodeError('$.loaded', `snapshot not loaded (reason=${String(root.reason ?? 'unknown')})`);
  }
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
      buffs: decodeBuffs(p, path),
      partyId,
      isTank: partyId ? aux.tankByPartyId.get(partyId) === id : true,
      joinedAtMs: reqNum(p, 'joinedAtMs', path),
      isUncappedXp: uncapped.has(id),
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

    const bossCast = decodeBossCast(c.bossCast, `${path}.bossCast`);
    const configuredCap = reqNum(c, 'configuredStoredPowerCap', path);

    creatures.push({
      id,
      name: reqStr(c, 'name', path),
      level: reqNum(c, 'level', path),
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
      storedPower: 0, // per-creature accumulation is encounter-scoped; see envelope.storedPower
      storedPowerCap: configuredCap,
      castCooldownTicks: aux.castCooldownTicksByCreatureId.get(id) ?? 0,
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

  const creatureIds = new Set(creatures.map((c) => c.id));

  // status definitions
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

  // effects
  const effects: EffectSnapshot[] = [];
  const effectIds: string[] = [];
  arr(root.effects, '$.effects').forEach((entry, i) => {
    const path = `$.effects[${i}]`;
    const e = obj(entry, path);
    assertKnownKeys(e, EFFECT_KEYS, path);
    const id = reqStr(e, 'id', path);
    const targetId = reqStr(e, 'targetId', path);
    const effectType = reqStr(e, 'effectType', path);
    const def = statusByKey.get(effectType);
    const intervalMs = reqNum(e, 'intervalMs', path);
    // Contract correction: the SQL snapshot exposes `active_effects.next_tick_at`
    // under the key `lastTickAtMs`. C1 means "when it last ticked", so the
    // decoder converts rather than mislabelling the value.
    const nextTickAtMs = reqNum(e, 'lastTickAtMs', path);
    effects.push({
      id,
      targetKind: creatureIds.has(targetId) ? 'creature' : 'character',
      targetId,
      effectType,
      stacks: reqNum(e, 'stacks', path),
      amountPerTick: reqNum(e, 'amountPerTick', path),
      expiresAtMs: reqNum(e, 'expiresAtMs', path),
      intervalMs,
      lastTickAtMs: nextTickAtMs - intervalMs,
      damageType: null,
      sourceCharacterId: optStr(e, 'sourceId', path),
      isPeriodic: def?.isPeriodic ?? false,
      ampPct: def?.ampPct ?? 0,
    });
    effectIds.push(id);
  });

  // actions
  const actions: ActionSnapshot[] = [];
  const actionIds: string[] = [];
  arr(root.actions, '$.actions').forEach((entry, i) => {
    const path = `$.actions[${i}]`;
    const a = obj(entry, path);
    assertKnownKeys(a, ACTION_KEYS, path);
    const abilityKey = reqStr(a, 'abilityKey', path);
    const cfg = aux.abilityConfig.get(abilityKey);
    if (!cfg) {
      throw decodeError(`${path}.abilityKey`, `no resolved ability configuration for "${abilityKey}"`);
    }
    const id = reqStr(a, 'id', path);
    actions.push({
      id,
      characterId: reqStr(a, 'characterId', path),
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
  assertScopeMatches(envelope.scope, {
    participantIds: participants.map((p) => p.id),
    creatureIds: creatures.map((c) => c.id),
    actionIds,
    effectIds,
    inventoryIds: Object.keys(durabilityByInventoryId),
  });

  return { snapshot, envelope, mpByCharacterId, progressionByCharacterId };
}

function assertScopeMatches(
  scope: SnapshotEnvelope['scope'],
  decoded: {
    participantIds: string[]; creatureIds: string[]; actionIds: string[];
    effectIds: string[]; inventoryIds: string[];
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
  compare('actionIds', decoded.actionIds);
  compare('effectIds', decoded.effectIds);
  compare('inventoryIds', decoded.inventoryIds);
}
