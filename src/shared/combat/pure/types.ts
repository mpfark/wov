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

import type { ResolverMechanic } from './mechanics';

export type { ResolverMechanic };

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

/**
 * One `stack_apply` source carried by a participant (Envenom / Orbs of Fire).
 * Reserved stances are re-derived by the loader every tick from
 * `characters.reserved_buffs`, exactly as the legacy tick did, so the applier
 * list is authoritative input and never client-supplied magnitude.
 */
export interface StackApplierSnapshot {
  readonly abilityKey: string;
  /** `active_effects.effect_type` this applier writes: 'poison' | 'ignite' | … */
  readonly effectType: string;
  /** Qualifying event. Legacy: Envenom = weapon_hit, Ignite/Orbs = pulse. */
  readonly trigger: 'weapon_hit' | 'successful_pulse_hit';
  /** Proc chance 0..1 — the ability's `amount_calc`. */
  readonly chance: number;
  /** Per-tick DoT magnitude written on (re)application. */
  readonly dotPerTick: number;
  readonly durationMs: number;
  readonly intervalMs: number;
  /** Ceiling from the `max_stacks` mechanic calc. */
  readonly maxStacks: number;
  readonly damageType: string | null;
  /** Pulse appliers deal their own spark damage before the stack lands. */
  readonly pulseDamage: number;
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
  /**
   * Ambush multiplier of an active `stealth_buff`. Legacy safety floor is 2
   * when a legacy boolean bag arrives without a resolved multiplier.
   */
  readonly stealthMult?: number;
  /** One-shot outgoing multiplier from Disengage's next-hit window. */
  readonly nextHitBonusMult?: number;
  /** Shield Wall: bonus block chance / amount and the chance ceiling. */
  readonly blockChanceBonus?: number;
  readonly blockAmountBonus?: number;
  readonly blockChanceCap?: number;
  /**
   * Holy Shield retaliation damage per qualifying incoming hit. `null`/absent
   * means the reactive stance is not active.
   */
  readonly reactiveHolyDamage?: number | null;
  readonly reactiveHolyDamageType?: string | null;
  /** Active `stack_apply` sources, ordered by ability key. */
  readonly stackAppliers?: readonly StackApplierSnapshot[];
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
  /**
   * Physical presence on the encounter's node *right now*.
   *
   * The snapshot carries **complete participation** (attribution, durable
   * effect sources, contribution and reward rights), which is deliberately a
   * superset of the target roster. Only participants with `presentAtNode`
   * may be attacked, healed, buffed, regenerated or struck by a telegraphed
   * cast, and only they may act. Absent participants keep every attribution
   * right (their DoTs keep ticking, they still receive kill rewards).
   *
   * Never derived from delivery/RLS grace. Absent field = present (older
   * fixtures and back-compat).
   */
  readonly presentAtNode?: boolean;
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
  /** Reservation-backed stances, resolved by the loader. See `StanceSnapshot`. */
  readonly stances?: readonly StanceSnapshot[];
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
  readonly castKey: string;
  readonly label: string;
  readonly castTicks: number;
  readonly cooldownTicks: number;
  readonly damage: number;
  /** Flat damage everyone other than the primary target takes. */
  readonly damageAoe: number;
  readonly damageType: string | null;
  readonly targetMode: 'tank_strict' | 'tank_preferred' | 'random_alive';
  readonly channeling: boolean;
  readonly storedPowerCap: number;
  /** Fraction of the released pool the primary target takes. */
  readonly primaryShare: number;
  /** Fraction of the released pool every other eligible target takes. */
  readonly aoeShare: number;
  readonly consumeMode: 'all' | 'percent' | 'fixed' | 'preserve' | 'reset' | 'ignore';
  readonly consumePct: number;
  readonly consumeFixed: number;
  /** Autoattacks are suppressed while channeling and banked instead. */
  readonly pauseAutoattacks: boolean;
  /** Movement lock applied to everyone the resolved cast reaches. */
  readonly lockMs: number;
  readonly castingText: string | null;
  readonly castedText: string | null;
}


/** How a resolving cast treats the Stored Power pool it accumulated. */
export type StoredPowerConsumeMode =
  | 'all'
  | 'percent'
  | 'fixed'
  | 'preserve'
  | 'reset'
  | 'ignore';

/**
 * A telegraphed boss cast that was started on an earlier tick and is still
 * in flight. This is the missing persistence that made casts start, channel
 * and then never land: the resolver reads the authored contract back from the
 * cast row rather than from the creature, so a mid-channel configuration edit
 * cannot retune a cast that is already telegraphed.
 */
export interface ActiveCastSnapshot {
  readonly castEventId: string;
  readonly creatureId: string;
  readonly abilityKey: string;
  readonly castKey: string;
  readonly label: string;
  readonly startedAtMs: number;
  readonly resolvesAtMs: number;
  /** Primary target chosen when the channel began. */
  readonly targetCharacterId: string | null;
  /** Authored flat damage, before Stored Power is added. */
  readonly baseDamage: number;
  readonly baseAoeDamage: number;
  readonly damageType: string | null;
  readonly primaryShare: number;
  readonly aoeShare: number;
  readonly consumeMode: StoredPowerConsumeMode;
  readonly consumePct: number;
  readonly consumeFixed: number;
  /** While channeling, the caster banks its paused autoattack instead. */
  readonly pauseAutoattacks: boolean;
  readonly storedPowerCap: number;
  readonly lockMs: number;
  readonly castedText: string | null;
}


/**
 * Presentation-only boss flavor line (`creatures.boss_crit_flavors`). Never
 * simulation input: it selects prose for a crit that already happened.
 */
export interface BossCritFlavorSnapshot {
  readonly name: string;
  readonly text: string;
  readonly weight: number;
  readonly damageType: string | null;
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
  /** Authored crit flavor pool (display only). */
  readonly bossCritFlavors?: readonly BossCritFlavorSnapshot[];
  /** Authored death cry (display only); empty/null = none. */
  readonly bossDeathCry?: string | null;
}

export interface EffectSnapshot {
  readonly id: string;
  /**
   * Row lifetime class (`active_effects.lifetime`).
   * - `timed`: expires at `expiresAtMs` like every ordinary status.
   * - `stance`: a CP-reservation-backed persistent state. It carries a
   *   no-expiry sentinel and is NEVER expired by the resolver; the only
   *   authority that removes it is the reservation itself (drop, replace,
   *   logout, death), enforced by the database trigger on
   *   `characters.reserved_buffs`.
   */
  readonly lifetime?: 'timed' | 'stance';
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
  /**
   * Mechanic that owns this row, when the effect is a persistent friendly
   * state the resolver must keep pulsing (`aura_pulse`, `party_regen`,
   * `regen_buff`). Absent/`null` for plain DoTs and stack rows, which are
   * driven purely by `isPeriodic` + `amountPerTick`.
   */
  readonly mechanic?: ResolverMechanic | null;
  /** Ability that created the row. Drives authored pulse text. */
  readonly abilityKey?: string | null;
  /** CP restored per pulse (`regen_buff`). */
  readonly cpPerTick?: number;
  /** `aura_pulse` / `party_regen`: pulse heals same-node allies. */
  readonly healsAllies?: boolean;
  /** `aura_pulse`: pulse burns same-node hostile creatures. */
  readonly damagesEnemies?: boolean;
  /** Ceiling for stack rows, carried so refreshes cannot exceed config. */
  readonly maxStacks?: number;
  /**
   * Scalar payload of a non-damaging state row: the ambush multiplier of a
   * `stealth_buff`, the dodge chance of an `evasion_buff`, the retaliation
   * damage of `reactive_holy`, and so on. Kept separate from `amountPerTick`
   * so a state row can never be mistaken for a damage-over-time row.
   */
  readonly magnitude?: number;
  /**
   * Mutable pool/charge state (`EFFECT_MECHANIC_REGISTRY[mechanic].remaining`):
   * the unspent Force Shield / Divine Aegis absorb HP, or the remaining charges
   * of a one-shot state. `null`/absent = the mechanic has no such state.
   */
  readonly remaining?: number | null;
  /** Validated, mechanic-scoped parameters. Never a free-form JSON bag. */
  readonly params?: Readonly<Record<string, number | boolean | string>>;
  readonly paramsVersion?: number;
}


/**
 * Loader-resolved, per-caster mechanic parameters. Every field is already
 * scaled for the acting character's level and attributes — the simulation never
 * recomputes a formula and never reads a class name. Fields are optional
 * because each mechanic consumes only its own subset; a missing field means the
 * mechanic falls back to its documented legacy default.
 */
export interface ActionParamsSnapshot {
  /** `multi_attack`: inclusive arrow-count range rolled once per cast. */
  readonly minHits?: number;
  readonly maxHits?: number;
  /** `stack_consume`: damage = amount * (1 + perStackMultiplier * stacks). */
  readonly perStackMultiplier?: number;
  /** `stack_consume` / `stack_apply`: `active_effects.effect_type` consumed. */
  readonly stackEffectType?: string;
  /** `stack_apply`: proc chance 0..1 and the event that can proc it. */
  readonly procChance?: number;
  readonly stackTrigger?: 'weapon_hit' | 'successful_pulse_hit';
  /** `stack_apply`: per-tick DoT magnitude written on (re)application. */
  readonly dotPerTick?: number;
  /**
   * `stack_apply`: finite lifetime of the LANDED stack, authored on the base
   * (`dot_duration_ms` + optional stat scaling / cap). Never the stance's own
   * lifetime — the stance is reservation-backed and does not expire.
   */
  readonly stackDurationMs?: number;
  /** `stack_apply` pulse spark damage applied before the stack lands. */
  readonly pulseDamage?: number;

  /**
   * `burst_damage`: crit-threshold widening in d20 points (lower threshold is
   * easier). Never a probability — the one attack roll decides the crit.
   */
  readonly critEdge?: number;
  /** `burst_damage`: the lowest crit threshold the widening may reach. */
  readonly critThresholdFloor?: number;
  /** `hp_transfer`: HP the caster may never be reduced below. */
  readonly reserveHp?: number;
  readonly minReserveHp?: number;
  /** `reactive_holy`: retaliation damage per qualifying incoming hit. */
  readonly retaliationDamage?: number;
  /** `block_buff`: additive block chance / amount and the chance ceiling. */
  readonly blockChance?: number;
  readonly blockAmount?: number;
  readonly blockChanceCap?: number;
  /** `evasion_buff`: dodge chance, and Disengage's next-hit window. */
  readonly dodgeChance?: number;
  readonly nextHitWindowMs?: number;
  readonly nextHitBonusMult?: number;
  readonly evasionSource?: 'cloak' | 'disengage';
  /** `stealth_buff`: ambush damage multiplier. */
  readonly ambushMult?: number;
  /** `regen_buff`: per-pulse resources and recast merge rule. */
  readonly hpPerTick?: number;
  readonly cpPerTick?: number;
  readonly refreshPolicy?: 'best_of' | 'replace';
  /** `mitigation_buff`: percent vs flat incoming-damage reduction. */
  readonly mode?: 'percent' | 'flat';
  /** `offense_buff`: outgoing damage multiplier vs crit-range widening. */
  readonly offenseMode?: 'damage_mult' | 'crit_edge';
  /**
   * `control_debuff`: which weakening the effect represents.
   * `ac_reduction` lowers the creature's effective AC for roll-based attacks;
   * `damage_reduction` lowers the creature's outgoing damage.
   */
  readonly controlMode?: 'ac_reduction' | 'damage_reduction';
  /** `aura_pulse` / `party_regen`: which sides the pulse touches. */
  readonly healsAllies?: boolean;
  readonly damagesEnemies?: boolean;

}

export interface ActionSnapshot {
  readonly id: string;
  readonly characterId: string;
  readonly creatureId: string | null;
  readonly allyId: string | null;
  readonly abilityKey: string;
  readonly mechanic: ResolverMechanic;
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
  /** Per-caster resolved mechanic parameters. */
  readonly params?: ActionParamsSnapshot;
}


/**
 * A stance the character currently has switched on, with its configuration
 * already resolved by the loader from `characters.reserved_buffs`.
 *
 * The reservation is the ONE authority for a stance's existence; this snapshot
 * only carries the numbers needed to (re)materialise the stance's semantic
 * `active_effects` row when it is missing, so a stance keeps working across
 * ticks, restarts and re-entries without ever being re-cast by the client.
 */
export interface StanceSnapshot {
  readonly stanceKey: string;
  readonly abilityKey: string;
  readonly mechanic: ResolverMechanic;
  readonly damageType: string | null;
  readonly amount: number;
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly statusKey: string | null;
  readonly statusChancePct: number;
  readonly maxStacks: number;
  readonly weaponBased: boolean;
  readonly params?: ActionParamsSnapshot;
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
  /**
   * Policy C. Present only when background simulation was genuinely suspended
   * (world asleep / worker unscheduled) and later resumed. Periodic pulses whose
   * due time falls inside the window are skipped without damage or healing;
   * effects whose lifetime ended inside it still expire authoritatively.
   */
  readonly pauseBoundary?: { readonly suspendedAtMs: number; readonly resumedAtMs: number } | null;
  readonly participants: readonly ParticipantSnapshot[];
  readonly creatures: readonly CreatureSnapshot[];
  readonly effects: readonly EffectSnapshot[];
  readonly actions: readonly ActionSnapshot[];
  readonly engagements: readonly EngagementSnapshot[];
  readonly procs: readonly ProcSnapshot[];
  /** Telegraphed casts started on an earlier tick and still in flight. */
  readonly activeCasts: readonly ActiveCastSnapshot[];
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
  /** See `EffectSnapshot.lifetime`. Omitted means `timed`. */
  readonly lifetime?: 'timed' | 'stance';
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
  /**
   * Persistent-friendly-state metadata, mirrored from `EffectSnapshot`. These
   * are how `aura_pulse`, `party_regen` and `regen_buff` survive between ticks
   * and behave identically in live and catch-up resolution.
   */
  readonly mechanic?: ResolverMechanic | null;
  readonly abilityKey?: string | null;
  readonly cpPerTick?: number;
  readonly healsAllies?: boolean;
  readonly damagesEnemies?: boolean;
  readonly maxStacks?: number;
  /** Scalar payload of a non-damaging state row. See `EffectSnapshot`. */
  readonly magnitude?: number;
  /** Mutable pool/charge state written back every tick. See `EffectSnapshot`. */
  readonly remaining?: number | null;
  /** Validated, mechanic-scoped parameters. See `EffectSnapshot`. */
  readonly params?: Readonly<Record<string, number | boolean | string>>;
  readonly paramsVersion?: number;
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

/** One damaged target of a resolved cast. */
export interface CastTargetProposal {
  readonly characterId: string;
  readonly damage: number;
  readonly applied: number;
  readonly isPrimary: boolean;
}

export interface CastMutation {
  readonly creatureId: string;
  readonly abilityKey: string;
  readonly castKey: string;
  readonly phase: 'start' | 'resolve' | 'fizzle';
  /**
   * The cast row this mutation closes. `null` on `start`, where the committer
   * creates the row; always set on `resolve`/`fizzle`, so a duplicate or
   * concurrent cast row can never be closed by the wrong mutation.
   */
  readonly castEventId: string | null;
  readonly resolvesAtMs: number;
  readonly targetCharacterId: string | null;
  /** Primary damage: authored flat plus the primary share of the pool. */
  readonly damage: number;
  /** Damage every other eligible target took. */
  readonly aoeDamage: number;
  readonly damageType: string | null;
  readonly text: string | null;
  /** Stored Power actually released by this resolution. */
  readonly storedPowerConsumed: number;
  /** Movement lock the resolution imposes on the targets it reached. */
  readonly lockMs: number;
  readonly targets: readonly CastTargetProposal[];
  /** Frozen authored contract, persisted on `start` and read back on resolve. */
  readonly config: ActiveCastSnapshot | null;
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
  /**
   * Presentation metadata — never simulation input. The resolver already knows
   * who swung at whom with what, so it carries those facts to the client which
   * owns the MUD-style tier/flavor prose. Absent = unknown, and the client
   * falls back to the plain authored `message`.
   */
  readonly attackerName?: string | null;
  readonly targetName?: string | null;
  readonly attackerClass?: string | null;
  readonly weaponTag?: string | null;
  readonly isCrit?: boolean | null;
  readonly isHumanoid?: boolean | null;
  /** Canonical `abilities.ability_key`, for ability lines. */
  readonly abilityKey?: string | null;
  /**
   * Status-stack facts for lines whose authored template names them
   * (`{stacks}` / `{max_stacks}`). Presentation only — the authoritative stack
   * count still travels on the effect rows.
   */
  readonly stacks?: number | null;
  readonly maxStacks?: number | null;
  /** Status identity (`ignite`, `poison`, …) for lines that name the effect. */
  readonly effectType?: string | null;
  /**
   * Deterministic correlation identity: every event belonging to ONE beat (a
   * stance pulse and the stack it landed; a creature swing and the mitigation
   * that ate it) carries the same `groupId`. Presentation may combine events
   * that share it; the committed batch always keeps them separate.
   */
  readonly groupId?: string | null;
  /** Damage the beat attempted before mitigation. */
  readonly attemptedAmount?: number | null;
  /** Damage removed by mitigation. */
  readonly mitigatedAmount?: number | null;
  /** Damage that actually reached the target. */
  readonly appliedAmount?: number | null;
  /** Mitigation identity (`block`, …) — never inferred from prose. */
  readonly mitigationSource?: string | null;
  /** Chosen boss crit flavor: authored name + placeholder text. */
  readonly bossFlavorName?: string | null;
  readonly bossFlavorText?: string | null;
}



export interface RejectedAction {
  readonly actionId: string;
  readonly reason:
    | 'no_target'
    | 'target_dead'
    | 'caster_dead'
    | 'insufficient_cp'
    /** `hp_transfer`: the caster cannot pay without breaching its HP reserve. */
    | 'insufficient_hp'
    /** The caster (or its target) left the encounter's node. */
    | 'not_present';
}

export interface ConsumedBuffProposal {
  readonly characterId: string;
  readonly buff: string;
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
  /**
   * One-shot buffs spent this tick (`stealth`, `disengage`). The committer
   * clears them so a consumed ambush cannot empower a second hit.
   */
  readonly consumedBuffs: readonly ConsumedBuffProposal[];
  readonly rejectedActions: readonly RejectedAction[];
  readonly session: SessionProposal;
  readonly events: readonly PresentationEvent[];
}
