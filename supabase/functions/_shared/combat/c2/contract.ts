/**
 * c2/contract.ts — the versioned C2 boundary around the pure C1 resolver.
 *
 * C1 owns simulation. C2 owns *authority*: which rows the simulation was
 * allowed to read, at which versions, and how the proposal is committed.
 *
 * Nothing here is wired into production execution. Combat stays in
 * maintenance until C5.
 *
 * Precedence rules implemented here (loader-side, never in SQL, never in the
 * resolver):
 *
 *   loot chance     authored creature override -> pool config default for the
 *                   creature's rarity -> LOOT_FALLBACK_CHANCE (0.5, the legacy
 *                   value; preserved deliberately, not changed to 0)
 *
 *   stored power    active cast override -> casting creature configuration ->
 *                   encounter configured default -> inactive (cap 0)
 *                   Stored Power is *per cast/creature*, never collapsed into
 *                   one encounter-wide cap.
 */

import type { ProposedTick, ResolutionMode } from '../pure/types.ts';

/** Explicit legacy fallback. Documented, golden-tested, deliberately not 0. */
export const LOOT_FALLBACK_CHANCE = 0.5;

/**
 * Contract v3 (C3 checkpoint 1):
 *  - snapshot carries xp / unspentStatPoints / respecPoints / bhp
 *  - effect timing is named `nextTickAtMs` (active_effects.next_tick_at)
 *  - level-ups travel in their own `progression` block
 */
export const SNAPSHOT_VERSION = 3 as const;
export const PROPOSED_TICK_VERSION = 3 as const;

// ── envelope ───────────────────────────────────────────────────────

export interface EncounterClaim {
  readonly token: string;
  readonly tick: number;
  readonly attempt: number;
  readonly leaseUntilMs: number;
  readonly mode: ResolutionMode;
}

export interface EncounterCursor {
  readonly tickNumber: number;
  readonly tickAtMs: number;
  readonly tickState: string;
  readonly resolvingTick: number | null;
}

/**
 * The exact row ids the snapshot read. The commit digest is parameterised by
 * this scope, so rows created *after* `loadedAtMs` (a newly submitted action,
 * a newly joined participant, a new engagement) cannot invalidate this tick —
 * they become eligible on the next one. A snapshotted row that changed,
 * vanished or was consumed does change its domain hash -> state_conflict.
 */
export interface SnapshotScope {
  readonly participantIds: readonly string[];
  readonly creatureIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly effectIds: readonly string[];
  readonly inventoryIds: readonly string[];
  readonly castIds: readonly string[];
  /** `"<creatureId>><characterId>"`, matching the SQL digest encoding. */
  readonly engagementPairs: readonly string[];
  readonly lootTableIds: readonly string[];
  readonly loadedAtMs: number;
}

/** Per-domain hashes plus one configuration version. */
export interface StateDigest {
  readonly participants: string;
  readonly characters: string;
  readonly creatures: string;
  readonly engagements: string;
  readonly actions: string;
  readonly effects: string;
  readonly equipment: string;
  readonly casts: string;
  readonly storedPower: string;
  readonly configVersion: string;
}

export type StoredPowerCapSource =
  | 'active_cast'
  | 'casting_creature'
  | 'encounter_default'
  | 'inactive';

export interface ResolvedStoredPower {
  readonly creatureId: string | null;
  readonly current: number;
  readonly cap: number;
  readonly capSource: StoredPowerCapSource;
  readonly active: boolean;
}

export type DropChanceSource = 'creature' | 'pool_config' | 'legacy_fallback';

export interface ResolvedDropChance {
  readonly chance: number;
  readonly source: DropChanceSource;
}

export interface SnapshotEnvelope {
  readonly snapshotVersion: typeof SNAPSHOT_VERSION;
  readonly encounterId: string;
  readonly nodeId: string;
  readonly tickNumber: number;
  readonly encounterVersion: number;
  readonly loadedAtMs: number;
  readonly claim: EncounterClaim;
  readonly cursor: EncounterCursor;
  readonly scope: SnapshotScope;
  readonly stateDigest: StateDigest;
  /** Per-creature spawn generation, needed for death occurrence ids. */
  readonly spawnSeqByCreatureId: Readonly<Record<string, number>>;
  /** Current durability of every snapshotted equipped item. */
  readonly durabilityByInventoryId: Readonly<Record<string, number>>;
  /** Resolved before simulation; the resolver only ever sees a number. */
  readonly dropChanceByCreatureId: Readonly<Record<string, ResolvedDropChance>>;
  /** Per cast/creature, never one global cap. */
  readonly storedPower: readonly ResolvedStoredPower[];
  readonly lootFallbackChance: number;
}

// ── proposals added by C2 ──────────────────────────────────────────

/**
 * Structured character death. Exactly one per character per tick, whatever
 * killed them (direct damage, DoT tick, boss cast / Stored Power release).
 */
export interface CharacterDeathProposal {
  readonly characterId: string;
  readonly tickNumber: number;
  readonly sourceKind: 'damage' | 'dot' | 'boss_cast' | 'unknown';
  readonly sourceCreatureId: string | null;
  readonly sourceCharacterId: string | null;
  readonly amount: number | null;
  readonly damageType: string | null;
}

/** Derived presence bookkeeping only. Never cadence, ownership or roster. */
export interface SessionPresenceProposal {
  readonly sessionId: string | null;
  readonly ended: boolean;
  readonly engagedCreatureIds: readonly string[];
}

export interface ProposedTickV2 {
  readonly proposedTickVersion: typeof PROPOSED_TICK_VERSION;
  readonly core: ProposedTick;
  readonly deaths: readonly CharacterDeathProposal[];
  readonly session: SessionPresenceProposal;
  /** Derived level-up side effects. Empty on every non-level-up tick. */
  readonly progression: ProposedTick['progression'];
}

// ── precedence resolvers (loader side) ─────────────────────────────

export interface LootPoolConfigLike {
  readonly drop_chance_regular: number | null;
  readonly drop_chance_rare: number | null;
  readonly drop_chance_boss: number | null;
}

export function resolveEffectiveDropChance(
  creature: { rarity: 'regular' | 'rare' | 'boss'; dropChance: number | null },
  poolConfig: LootPoolConfigLike | null | undefined,
): ResolvedDropChance {
  if (creature.dropChance !== null && creature.dropChance !== undefined) {
    return { chance: creature.dropChance, source: 'creature' };
  }
  const fromPool =
    creature.rarity === 'boss'
      ? poolConfig?.drop_chance_boss
      : creature.rarity === 'rare'
        ? poolConfig?.drop_chance_rare
        : poolConfig?.drop_chance_regular;
  if (fromPool !== null && fromPool !== undefined) {
    return { chance: fromPool, source: 'pool_config' };
  }
  return { chance: LOOT_FALLBACK_CHANCE, source: 'legacy_fallback' };
}

export function resolveStoredPower(input: {
  readonly creatureId: string | null;
  readonly current: number;
  readonly activeCastCap: number | null;
  readonly creatureConfiguredCap: number | null;
  readonly encounterDefaultCap: number | null;
}): ResolvedStoredPower {
  const pick = (
    value: number | null,
    source: StoredPowerCapSource,
  ): { cap: number; capSource: StoredPowerCapSource } | null =>
    value !== null && value !== undefined && value > 0 ? { cap: value, capSource: source } : null;

  const resolved =
    pick(input.activeCastCap, 'active_cast') ??
    pick(input.creatureConfiguredCap, 'casting_creature') ??
    pick(input.encounterDefaultCap, 'encounter_default') ??
    { cap: 0, capSource: 'inactive' as StoredPowerCapSource };

  return {
    creatureId: input.creatureId,
    current: input.current,
    cap: resolved.cap,
    capSource: resolved.capSource,
    active: resolved.capSource !== 'inactive',
  };
}
