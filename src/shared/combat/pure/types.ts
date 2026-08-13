/**
 * pure/types.ts — the C1 simulation boundary contract.
 *
 * Two types own the whole boundary:
 *
 *   EncounterSnapshot  everything the simulation may read (immutable)
 *   ProposedTick       everything the simulation wants to change (data only)
 *
 * The resolver in `pure/resolver.ts` is a total function of the snapshot:
 * no database handle, no Realtime channel, no logger, no clock, no
 * `Math.random`. Authoritative time arrives as `nowMs`; the authoritative
 * tick number arrives as `tickNumber` (from the encounter claim) and seeds
 * every roll.
 *
 * NOTHING in this file or in `pure/` is wired to production yet (C1).
 * Ability magnitudes, status definitions, drop chances and other
 * admin-configured values are resolved by the *loader* (a C2 concern) and
 * enter as plain numbers, so config authority stays in the database while
 * the simulation stays pure.
 */

export type ResolutionMode = 'live' | 'catchup';

export type AttrKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type Attributes = { readonly [K in AttrKey]: number };

/** Damage bookkeeping category. Mirrors the legacy `sourceKind` strings. */
export type DamageSource =
  | 'autoattack'
  | 'ability'
  | 'stance'
  | 'dot'
  | 'proc'
  | 'boss_cast'
  | 'creature';

// ── Snapshot ───────────────────────────────────────────────────────

export interface WeaponSnapshot {
  readonly tag: string | null;
  readonly hands: 1 | 2;
  readonly itemLevel: number | null;
  readonly rarity: string | null;
  /** Ordered, stable: equipped inventory ids used for durability picks. */
  readonly equippedInventoryIds: readonly string[];
}

export interface ParticipantBuffSnapshot {
  readonly stealth: boolean;
  readonly damageBuff: boolean;
  /** Percentage damage reduction (Battle Cry). 0..1 */
  readonly mitigationPct: number;
  /** Flat damage reduction (Divine Challenge). */
  readonly mitigationFlat: number;
  /** Absorb pool (Force Shield / Divine Aegis). */
  readonly absorbShield: number;
  /** Evasion stance dodge chance. 0..1 */
  readonly dodgeChance: number;
  /** Crit-range reduction from Eagle Eye and friends. */
  readonly critBuffBonus: number;
  /** Shield Wall stance active. */
  readonly blockBuff: boolean;
  readonly rooted: boolean;
}

export interface ParticipantSnapshot {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly classKey: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly cp: number;
  readonly maxCp: number;
  /** Effective attributes (base + equipment + gems), already resolved. */
  readonly attrs: Attributes;
  readonly ac: number;
  readonly hasShield: boolean;
  readonly weapon: WeaponSnapshot;
  readonly buffs: ParticipantBuffSnapshot;
  readonly partyId: string | null;
  /** Designated tank of its party (`parties.tank_id`, else leader). */
  readonly isTank: boolean;
  /** Stable tiebreaker for ordering; never a wall clock read inside sim. */
  readonly joinedAtMs: number;
  readonly isUncappedXp: boolean;
  /** Current MP, from the snapshotted character row. */
  readonly mp: number;
  readonly maxMp: number;
  /** Progression inputs. Level-up side effects are derived from these only. */
  readonly xp: number;
  readonly unspentStatPoints: number;
  readonly respecPoints: number;
  /**
   * Aggregated equipment/gem bonuses (`str`..`cha`, `hp`), summed by the
   * decoder from the snapshotted equipment rows. Needed because max HP/CP/MP
   * recalculation on level-up is a function of *effective* attributes.
   */
  readonly equipmentBonuses: Readonly<Record<string, number>>;
}

export interface CreatureLootEntrySnapshot {
  readonly type: string;
  readonly itemId: string | null;
  readonly chance: number;
  readonly min: number;
  readonly max: number;
}

export interface BossCastSnapshot {
  readonly abilityKey: string;
  readonly label: string;
  readonly castTicks: number;
  readonly cooldownTicks: number;
  readonly damage: number;
  readonly damageType: string | null;
  readonly targetMode: 'tank_strict' | 'tank_preferred' | 'random_alive';
  readonly channeling: boolean;
  readonly storedPowerCap: number;
  readonly castingText: string | null;
  readonly castedText: string | null;
}

export interface CreatureSnapshot {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly rarity: 'regular' | 'rare' | 'boss';
  readonly hp: number;
  readonly maxHp: number;
  readonly ac: number;
  readonly attrs: Attributes;
  readonly isAlive: boolean;
  readonly isHumanoid: boolean;
  readonly lootMode: 'legacy_table' | 'item_pool' | 'salvage_only';
  readonly lootTableId: string | null;
  readonly dropChance: number | null;
  readonly lootTable: readonly CreatureLootEntrySnapshot[];
  readonly salvageMaterialKey: string | null;
  readonly bossCast: BossCastSnapshot | null;
  readonly storedPower: number;
  readonly storedPowerCap: number;
  /** Remaining cooldown in ticks before the next cast may start. */
  readonly castCooldownTicks: number;
}

export interface EffectSnapshot {
  readonly id: string;
  readonly targetKind: 'character' | 'creature';
  readonly targetId: string;
  readonly effectType: string;
  readonly stacks: number;
  readonly amountPerTick: number;
  readonly expiresAtMs: number;
  readonly intervalMs: number;
  /**
   * Absolute epoch ms at which this effect is next due to tick — the exact
   * semantics of `active_effects.next_tick_at`, which is the column it is
   * decoded from and committed back to. It is NOT "when it last ticked", and
   * it has nothing to do with the encounter cursor or with
   * `combat_sessions.last_tick_at`.
   */
  readonly nextTickAtMs: number;
  readonly damageType: string | null;
  /** Character that applied it — reward attribution for DoT kills. */
  readonly sourceCharacterId: string | null;
  readonly isPeriodic: boolean;
  /** Damage amplification percent this effect grants against its target. */
  readonly ampPct: number;
}

export interface ActionSnapshot {
  readonly id: string;
  readonly characterId: string;
  readonly creatureId: string | null;
  readonly allyId: string | null;
  readonly abilityKey: string;
  readonly mechanic:
    | 'weapon_attack'
    | 'spell_attack'
    | 'heal'
    | 'dot_debuff'
    | 'absorb_buff'
    | 'mitigation_buff'
    | 'offense_buff'
    | 'control_debuff';
  readonly damageType: string | null;
  readonly cpCost: number;
  /** Magnitude resolved by the loader from admin config. */
  readonly amount: number;
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly statusKey: string | null;
  readonly statusChancePct: number;
  readonly maxStacks: number;
  /** Physical abilities roll the weapon die on top of the amount. */
  readonly weaponBased: boolean;
  /** Stable queue position (`combat_actions.created_at` rank). */
  readonly sequence: number;
}

export interface EngagementSnapshot {
  readonly creatureId: string;
  readonly characterId: string;
  readonly lastActionAtMs: number;
}

export interface ProcSnapshot {
  readonly id: string;
  readonly characterId: string;
  readonly kind: 'lifesteal' | 'elemental' | 'weaken' | 'heal_pulse';
  readonly chance: number;
  readonly amount: number;
  readonly weight: number;
  readonly damageType: string | null;
  readonly label: string;
}

export interface ResolverConfig {
  readonly xpBoostMultiplier: number;
  readonly gemDropChance: number;
  readonly weaponProgression: {
    readonly tier1_level: number;
    readonly tier2_level: number;
    readonly tier3_level: number;
  };
  /** Applied-status definition table, keyed lookup done via ordered list. */
  readonly statusDefs: readonly {
    readonly key: string;
    readonly isPeriodic: boolean;
    readonly ampPct: number;
    readonly maxStacks: number;
  }[];
}

export interface EncounterSnapshot {
  readonly mode: ResolutionMode;
  readonly encounterId: string;
  readonly nodeId: string;
  /** Authoritative tick number from the encounter claim. Seeds all RNG. */
  readonly tickNumber: number;
  readonly ticksToSimulate: number;
  readonly tickRateMs: number;
  /** Authoritative time. The simulation never calls Date.now(). */
  readonly nowMs: number;
  readonly participants: readonly ParticipantSnapshot[];
  readonly creatures: readonly CreatureSnapshot[];
  readonly effects: readonly EffectSnapshot[];
  readonly actions: readonly ActionSnapshot[];
  readonly engagements: readonly EngagementSnapshot[];
  readonly procs: readonly ProcSnapshot[];
  readonly config: ResolverConfig;
}

// ── ProposedTick ───────────────────────────────────────────────────

export interface CharacterMutation {
  readonly characterId: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly cpBefore: number;
  readonly cpAfter: number;
  readonly absorbShieldAfter: number;
  readonly died: boolean;
}

export interface CreatureMutation {
  readonly creatureId: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly killed: boolean;
  /** Attribution for the killing blow. */
  readonly lastSourceCharacterId: string | null;
  readonly lastSourceKind: DamageSource | null;
}

export interface EffectUpsert {
  readonly targetKind: 'character' | 'creature';
  readonly targetId: string;
  readonly effectType: string;
  readonly stacks: number;
  readonly amountPerTick: number;
  readonly expiresAtMs: number;
  readonly intervalMs: number;
  /** Next due time, written verbatim to `active_effects.next_tick_at`. */
  readonly nextTickAtMs: number;
  readonly damageType: string | null;
  readonly sourceCharacterId: string | null;
}

export interface KillProposal {
  readonly creatureId: string;
  readonly creatureName: string;
  readonly creatureLevel: number;
  readonly rarity: string;
  readonly killerCharacterId: string | null;
  readonly recipientCharacterIds: readonly string[];
}

export interface RewardProposal {
  readonly characterId: string;
  readonly creatureId: string;
  readonly xp: number;
  readonly gold: number;
  readonly renown: number;
}

/**
 * One level-up (or level-42 XP cap) side effect, fully derived from the
 * snapshotted character plus the configured formulas. The commit function
 * applies exactly these named fields — there is no arbitrary column patch.
 */
export interface ProgressionMutation {
  readonly characterId: string;
  readonly levelBefore: number;
  readonly levelAfter: number;
  /** Absolute XP remainder after subtracting the level requirement. */
  readonly xpAfter: number;
  readonly maxHpAfter: number;
  readonly maxCpAfter: number;
  readonly maxMpAfter: number;
  /** Resources refilled by the level-up, bounded by the new maxima. */
  readonly hpAfter: number;
  readonly cpAfter: number;
  readonly mpAfter: number;
  /** Class level bonuses (every third level). Deltas, never absolutes. */
  readonly attributeDeltas: Readonly<Record<string, number>>;
  readonly unspentStatPointsDelta: number;
  readonly respecPointsDelta: number;
}

export interface LootProposal {
  readonly creatureId: string;
  readonly creatureName: string;
  readonly creatureLevel: number;
  readonly creatureRarity: string;
  readonly mode: 'legacy' | 'item_pool';
  readonly lootTableId: string | null;
  readonly itemId: string | null;
  /** `null` means "the committer applies the pool default for this mode". */
  readonly dropChance: number | null;
}

export interface MaterialProposal {
  readonly characterId: string;
  readonly materialKey: string;
  readonly quantity: number;
}

export interface GemProposal {
  readonly characterId: string;
  readonly gemKey: string;
}

export interface BondProposal {
  readonly characterId: string;
  readonly amount: number;
  readonly creatureLevel: number;
  readonly isBoss: boolean;
}

export interface DurabilityProposal {
  readonly characterId: string;
  readonly inventoryId: string;
}

export interface CastMutation {
  readonly creatureId: string;
  readonly abilityKey: string;
  readonly phase: 'start' | 'resolve' | 'fizzle';
  readonly resolvesAtMs: number;
  readonly targetCharacterId: string | null;
  readonly damage: number;
  readonly damageType: string | null;
  readonly text: string | null;
}

export interface StoredPowerMutation {
  readonly creatureId: string;
  readonly delta: number;
  readonly cap: number;
}

export interface SessionProposal {
  readonly ended: boolean;
  /**
   * Diagnostic only: the next due time this tick implies
   * (`nowMs + ticksProcessed * tickRateMs`). Cadence lives exclusively on the
   * encounter cursor, and this value is deliberately NOT written to
   * `combat_sessions.last_tick_at` — the commit function ignores it.
   */
  readonly nextDueAtMs: number;
}

export interface PresentationEvent {
  readonly seq: number;
  readonly type: string;
  readonly message: string;
  readonly characterId: string | null;
  readonly creatureId: string | null;
  readonly amount: number | null;
  readonly damageType: string | null;
}

export interface RejectedAction {
  readonly actionId: string;
  readonly reason: 'no_target' | 'target_dead' | 'caster_dead' | 'insufficient_cp';
}

export interface ProposedTick {
  readonly encounterId: string;
  readonly tickNumber: number;
  readonly mode: ResolutionMode;
  readonly ticksProcessed: number;
  readonly resolvedAtMs: number;
  /** Number of RNG samples drawn — a determinism fingerprint. */
  readonly rngDraws: number;
  readonly characters: readonly CharacterMutation[];
  readonly creatures: readonly CreatureMutation[];
  readonly effectUpserts: readonly EffectUpsert[];
  readonly effectDeleteIds: readonly string[];
  readonly effectDeleteTargetIds: readonly string[];
  readonly engagementsJoin: readonly EngagementSnapshot[];
  readonly engagementsPurgeCreatureIds: readonly string[];
  readonly casts: readonly CastMutation[];
  readonly storedPower: readonly StoredPowerMutation[];
  readonly durability: readonly DurabilityProposal[];
  readonly kills: readonly KillProposal[];
  readonly rewards: readonly RewardProposal[];
  readonly progression: readonly ProgressionMutation[];
  readonly loot: readonly LootProposal[];
  readonly materials: readonly MaterialProposal[];
  readonly gems: readonly GemProposal[];
  readonly bonds: readonly BondProposal[];
  readonly consumedActionIds: readonly string[];
  readonly rejectedActions: readonly RejectedAction[];
  readonly session: SessionProposal;
  readonly events: readonly PresentationEvent[];
}
