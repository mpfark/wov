/**
 * pure/resolver.ts — the C1 pure deterministic encounter resolver.
 *
 * `resolveTickPure(snapshot) -> ProposedTick` is a total function:
 *
 *   - no database handle, no Realtime channel, no fetch, no logger
 *   - no `Math.random()` — every roll comes from `pure/rng.ts`
 *   - no `Date.now()` — authoritative time arrives as `snapshot.nowMs`
 *   - no mutable module state — all working state is local to the call
 *
 * It proposes; it never applies. The committer (C2) is the only thing that
 * may turn a `ProposedTick` into database writes. Nothing in production calls
 * this module yet.
 *
 * Live vs catch-up: `snapshot.mode` is a real semantic switch, not a label.
 * `live` runs the full simulation. `effects_only` may only advance already
 * persisted state — periodic effect ticks, expiry, deaths/rewards and closure
 * of an already-started boss cast. It never swings a player or creature
 * autoattack, never consumes a pending action, never starts a new cast, never
 * banks Stored Power from a simulated autoattack and never degrades durability.
 * Ordering, seeds and the claim-based ownership model are identical in both.
 */

import { getStatModifier } from '../../formulas/stats';
import { DEFAULT_WEAPON_PROGRESSION } from '../../formulas/combat';
import { getCreatureXp, getXpForLevel, getXpPenalty } from '../../formulas/xp';
import { getClassLevelBonuses } from '../../formulas/classes';
import { getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp } from '../../formulas/resources';
import { getChaGoldMultiplier } from '../../formulas/economy';
import { bondGainForKill } from '../../formulas/bond';
import { PRIMARY_GEM_KEYS } from '../../formulas/gems';
import { resolveDamage, resolveHeal, absorbFromShield } from '../resolution';
import { EFFECT_PARAMS_VERSION } from './effect-contract';
import { getPartyXpBonus } from './party-xp';
import type { ResolverMechanic } from './mechanics';
import { createTickRandom } from './rng';
import {
  orderActions,
  orderCreatures,
  orderEffects,
  orderEngagements,
  orderParticipants,
  orderProcs,
  orderTankPool,
  sortBy,
  sortIds,
} from './ordering';
import {
  scaleCreatureDamage,
  seededAttackRoll,
  seededBlock,
  seededCreatureAttack,
  seededCreatureDamage,
  seededDodge,
  seededWeaponAbilityDamage,
} from './rolls';
import type {
  ActionSnapshot,
  ActiveCastSnapshot,
  BondProposal,
  CastMutation,
  CastTargetProposal,
  CharacterMutation,
  CreatureMutation,
  CreatureSnapshot,
  DurabilityProposal,
  EffectUpsert,
  EncounterSnapshot,
  EngagementSnapshot,
  GemProposal,
  KillProposal,
  LootProposal,
  MaterialProposal,
  Attributes,
  ParticipantSnapshot,
  PresentationEvent,
  ProgressionMutation,
  ProposedTick,
  RejectedAction,
  RewardProposal,
  StoredPowerMutation,
} from './types';

interface Working {
  hp: Map<string, number>;
  cp: Map<string, number>;
  shield: Map<string, number>;
  cHp: Map<string, number>;
  cKilled: Set<string>;
  cLastSource: Map<string, { characterId: string | null; kind: CreatureMutation['lastSourceKind'] }>;
  storedPower: Map<string, number>;
  castCooldown: Map<string, number>;
  /** In-flight telegraphed casts, keyed by caster. At most one per creature. */
  activeCasts: Map<string, ActiveCastSnapshot>;
  hitters: Set<string>;
}

/**
 * The committer's authoritative effect identity: `(source_id, target_id,
 * effect_type)`. Every stage that proposes or rewrites an effect row keys off
 * this one helper, so identity logic is never duplicated or drifted.
 */
function effectIdentity(
  row: { sourceCharacterId?: string | null; targetId: string; effectType: string },
): string {
  return `${row.sourceCharacterId ?? 'null'}|${row.targetId}|${row.effectType}`;
}



export function resolveTickPure(snapshot: EncounterSnapshot): ProposedTick {
  const rng = createTickRandom({
    encounterId: snapshot.encounterId,
    tickNumber: snapshot.tickNumber,
  });
  const progression = snapshot.config.weaponProgression ?? DEFAULT_WEAPON_PROGRESSION;
  const tickRate = snapshot.tickRateMs;
  const ticks = Math.max(0, Math.floor(snapshot.ticksToSimulate));

  const participants = orderParticipants(snapshot.participants);
  const creatures = orderCreatures(snapshot.creatures);
  const actions = orderActions(snapshot.actions);

  /**
   * Stance materialisation.
   *
   * A stance lives in `characters.reserved_buffs` (the reservation is its only
   * authority) but its *semantic* row lives in `active_effects`. When the row
   * is missing — first tick after activation, or after any restart — the
   * resolver re-materialises it by running the stance's own configuration
   * through the ordinary application path as a zero-cost intent. It is never a
   * re-cast: no CP is charged, nothing is queued by the client, and the row it
   * writes carries `lifetime: 'stance'` so nothing can expire it.
   */
  const stanceRowKey = (characterId: string, abilityKey: string) => `${characterId}|${abilityKey}`;
  const stanceByRow = new Map<string, { characterId: string; abilityKey: string }>();
  const stanceActions: ActionSnapshot[] = [];
  for (const p of snapshot.participants) {
    for (const st of p.stances ?? []) {
      stanceByRow.set(stanceRowKey(p.id, st.abilityKey), { characterId: p.id, abilityKey: st.abilityKey });
      const materialised = snapshot.effects.some(
        (e) =>
          e.targetKind === 'character' &&
          e.targetId === p.id &&
          e.lifetime === 'stance' &&
          (e.abilityKey ?? null) === st.abilityKey,
      );
      if (materialised) continue;
      stanceActions.push({
        id: `stance:${p.id}:${st.stanceKey}`,
        characterId: p.id,
        creatureId: null,
        allyId: null,
        abilityKey: st.abilityKey,
        mechanic: st.mechanic,
        damageType: st.damageType,
        // The reservation already paid for this stance.
        cpCost: 0,
        amount: st.amount,
        durationMs: st.durationMs,
        intervalMs: st.intervalMs,
        statusKey: st.statusKey,
        statusChancePct: st.statusChancePct,
        maxStacks: st.maxStacks,
        weaponBased: st.weaponBased,
        sequence: -1,
        ...(st.params ? { params: st.params } : {}),
      });
    }
  }
  const stanceActionIds = new Set(stanceActions.map((a) => a.id));
  const effects = orderEffects(snapshot.effects);
  const engagements = orderEngagements(snapshot.engagements);
  const procs = orderProcs(snapshot.procs);

  const byParticipant = new Map(participants.map((p) => [p.id, p]));
  const byCreature = new Map(creatures.map((c) => [c.id, c]));

  const w: Working = {
    hp: new Map(participants.map((p) => [p.id, p.hp])),
    cp: new Map(participants.map((p) => [p.id, p.cp])),
    shield: new Map(participants.map((p) => [p.id, p.buffs.absorbShield])),
    cHp: new Map(creatures.map((c) => [c.id, c.hp])),
    cKilled: new Set<string>(),
    cLastSource: new Map(),
    storedPower: new Map(creatures.map((c) => [c.id, c.storedPower])),
    castCooldown: new Map(creatures.map((c) => [c.id, c.castCooldownTicks])),
    activeCasts: new Map(snapshot.activeCasts.map((c) => [c.creatureId, c])),
    hitters: new Set<string>(),
  };

  const events: PresentationEvent[] = [];
  let seq = 0;
  /** Monotonic swing counter — the tail of a creature swing's correlation id. */
  let creatureSwing = 0;

  const emit = (
    type: string,
    message: string,
    extra: Partial<Omit<PresentationEvent, 'seq' | 'type' | 'message'>> = {},
  ) => {
    events.push({
      seq: seq++,
      type,
      message,
      characterId: extra.characterId ?? null,
      creatureId: extra.creatureId ?? null,
      amount: extra.amount ?? null,
      damageType: extra.damageType ?? null,
      attackerName: extra.attackerName ?? null,
      targetName: extra.targetName ?? null,
      attackerClass: extra.attackerClass ?? null,
      weaponTag: extra.weaponTag ?? null,
      isCrit: extra.isCrit ?? null,
      isHumanoid: extra.isHumanoid ?? null,
      abilityKey: extra.abilityKey ?? null,
      stacks: extra.stacks ?? null,
      maxStacks: extra.maxStacks ?? null,
      effectType: extra.effectType ?? null,
      groupId: extra.groupId ?? null,
      attemptedAmount: extra.attemptedAmount ?? null,
      mitigatedAmount: extra.mitigatedAmount ?? null,
      appliedAmount: extra.appliedAmount ?? null,
      mitigationSource: extra.mitigationSource ?? null,



      bossFlavorName: extra.bossFlavorName ?? null,
      bossFlavorText: extra.bossFlavorText ?? null,
    });
  };

  /**
   * Presentation metadata for a player-sourced line. Pure lookup of facts the
   * resolver already holds — the client turns these into tier + flavor prose.
   */
  const presentPlayer = (
    attacker: ParticipantSnapshot,
    target: CreatureSnapshot,
    isCrit?: boolean,
  ) => ({
    attackerName: attacker.name,
    targetName: target.name,
    attackerClass: attacker.classKey,
    weaponTag: attacker.weapon.tag ?? null,
    isHumanoid: target.isHumanoid,
    isCrit: isCrit ?? false,
  });

  const presentAbility = (
    attacker: ParticipantSnapshot,
    target: CreatureSnapshot,
    abilityKey: string,
    isCrit?: boolean,
  ) => ({ ...presentPlayer(attacker, target, isCrit), abilityKey });

  /** Presentation metadata for a creature-sourced line (creature is attacker). */
  const presentCreature = (
    attacker: CreatureSnapshot,
    target: ParticipantSnapshot,
    isCrit?: boolean,
  ) => ({
    attackerName: attacker.name,
    targetName: target.name,
    isHumanoid: attacker.isHumanoid,
    isCrit: isCrit ?? false,
  });

  /**
   * Pick the authored crit flavor for a boss blow. Presentation only, but drawn
   * from a named RNG stream so a replayed tick yields the same line.
   */
  const bossCritFlavor = (attacker: CreatureSnapshot, tickIndex: number) => {
    const pool = attacker.bossCritFlavors ?? [];
    if (pool.length === 0) return {};
    const pick =
      rng.weighted('boss_crit_flavor', pool, (f) => f.weight, attacker.id, tickIndex) ?? pool[0];
    return {
      bossFlavorName: pick.name || null,
      bossFlavorText: pick.text,
      ...(pick.damageType ? { damageType: pick.damageType } : {}),
    };
  };

  const effectUpserts: EffectUpsert[] = [];
  const effectDeleteIds = new Set<string>();
  /**
   * Advanced `next_tick_at` per snapshotted effect id. Written back as an
   * upsert so a periodic effect's schedule survives the commit instead of
   * re-firing on every tick.
   */
  const effectNextDue = new Map<string, number>();
  const effectDeleteTargetIds = new Set<string>();
  const casts: CastMutation[] = [];
  const storedPowerMut = new Map<string, StoredPowerMutation>();
  const kills: KillProposal[] = [];
  const rewards: RewardProposal[] = [];
  const loot: LootProposal[] = [];
  const materials: MaterialProposal[] = [];
  const gems: GemProposal[] = [];
  const bonds: BondProposal[] = [];
  const durability: DurabilityProposal[] = [];
  const consumedActionIds: string[] = [];
  const rejectedActions: RejectedAction[] = [];
  const engagementsJoin: EngagementSnapshot[] = [];
  const purgeCreatureIds = new Set<string>();

  // ── helpers (all closures over local state only) ────────────────

  const isAliveP = (id: string): boolean => (w.hp.get(id) ?? 0) > 0;
  const isAliveC = (id: string): boolean =>
    !w.cKilled.has(id) && (w.cHp.get(id) ?? 0) > 0;

  /**
   * Stance rows are reservation-backed persistent state: they carry a
   * no-expiry sentinel and the resolver has no authority to expire them. Only
   * the CP reservation (drop, replace, logout, death) removes a stance, via the
   * database trigger on `characters.reserved_buffs`.
   */
  const isStance = (e: { lifetime?: 'timed' | 'stance' }): boolean => e.lifetime === 'stance';

  /** True while an effect row is still in force at `at`. */
  const effectLive = (e: { lifetime?: 'timed' | 'stance'; expiresAtMs: number }, at: number) =>
    isStance(e) || e.expiresAtMs > at;

  /** Amp percent currently applied to a creature by damage-amp statuses. */
  const ampPctFor = (creatureId: string, nowMs: number): number => {
    let pct = 0;
    for (const e of effects) {
      if (e.targetKind !== 'creature' || e.targetId !== creatureId) continue;
      if (!(e.ampPct > 0)) continue;
      if (!effectLive(e, nowMs)) continue;
      pct += e.ampPct;
    }
    return pct;
  };

  /**
   * Target eligibility. The snapshot keeps every participant (so attribution,
   * durable effects and reward rights survive a player walking away), but only
   * characters physically standing on the encounter node may be hit, healed,
   * regenerated or caught by a telegraphed cast — and only they may act.
   */
  const isPresent = (characterId: string): boolean =>
    byParticipant.get(characterId)?.presentAtNode !== false;

  /**
   * Characters engaged with a creature, in stable order. Includes off-node
   * participants: this roster drives kill attribution and reward recipients.
   */
  const engagedWith = (creatureId: string): ParticipantSnapshot[] => {
    const out: ParticipantSnapshot[] = [];
    for (const e of engagements) {
      if (e.creatureId !== creatureId) continue;
      const p = byParticipant.get(e.characterId);
      if (p) out.push(p);
    }
    return orderParticipants(out);
  };

  /** Creature a participant is engaged with (stable: creature order). */
  const targetOf = (characterId: string): CreatureSnapshot | null => {
    for (const c of creatures) {
      if (!isAliveC(c.id)) continue;
      for (const e of engagements) {
        if (e.creatureId === c.id && e.characterId === characterId) return c;
      }
    }
    return null;
  };

  const damageCreature = (
    creature: CreatureSnapshot,
    amount: number,
    sourceCharacterId: string | null,
    kind: NonNullable<CreatureMutation['lastSourceKind']>,
    nowMs: number,
  ): number => {
    if (!isAliveC(creature.id) || amount <= 0) return 0;
    const before = w.cHp.get(creature.id) ?? 0;
    const res = resolveDamage({ amount, hp: before });
    w.cHp.set(creature.id, res.hpAfter);
    w.cLastSource.set(creature.id, { characterId: sourceCharacterId, kind });
    if (res.killed) killCreature(creature, sourceCharacterId, nowMs);
    return res.applied;
  };

  function killCreature(
    creature: CreatureSnapshot,
    killerId: string | null,
    _nowMs: number,
  ): void {
    if (w.cKilled.has(creature.id)) return;
    w.cKilled.add(creature.id);
    w.cHp.set(creature.id, 0);
    purgeCreatureIds.add(creature.id);
    effectDeleteTargetIds.add(creature.id);

    // Recipients: everyone engaged, else the killer alone. Stable order.
    const engaged = engagedWith(creature.id);
    const recipientIds = engaged.length
      ? engaged.map((p) => p.id)
      : killerId
        ? [killerId]
        : [];
    kills.push({
      creatureId: creature.id,
      creatureName: creature.name,
      creatureLevel: creature.level,
      rarity: creature.rarity,
      killerCharacterId: killerId,
      recipientCharacterIds: sortIds(recipientIds),
    });
    emit('creature_killed', `${creature.name} falls.`, { creatureId: creature.id });
    // Authored death cry: a separate presentation event so the client can
    // surface it apart from the plain "falls" line.
    const deathCry = (creature.bossDeathCry ?? '').trim();
    if (deathCry) {
      emit('boss_death_cry', deathCry, { creatureId: creature.id });
    }

    const recipients = recipientIds
      .map((id) => byParticipant.get(id))
      .filter((p): p is ParticipantSnapshot => !!p);
    if (recipients.length === 0) return;

    // ── gold roll (one per kill, split evenly) ────────────────────
    const goldEntry = creature.lootTable.find((e) => e.type === 'gold') ?? null;
    let totalGold = 0;
    if (
      goldEntry &&
      rng.sample('gold_chance', creature.id) <= (goldEntry.chance || 0.5)
    ) {
      const span = Math.max(1, goldEntry.max - goldEntry.min + 1);
      totalGold =
        goldEntry.min + Math.floor(rng.sample('gold_amount', creature.id) * span);
      if (creature.isHumanoid) {
        const bestCha = Math.max(0, ...recipients.map((r) => r.attrs.cha));
        if (bestCha > 0) {
          totalGold = Math.floor(totalGold * getChaGoldMultiplier(bestCha));
        }
      }
    }
    const goldEach = Math.floor(totalGold / recipients.length);

    // ── XP / renown per recipient ────────────────────────────────
    const baseXp = getCreatureXp(creature.level, creature.rarity);
    const partyBonus = getPartyXpBonus(recipients.length);
    const isBoss = creature.rarity === 'boss';
    const renown =
      creature.rarity === 'boss'
        ? Math.floor(creature.level * 0.5)
        : creature.rarity === 'rare'
          ? Math.max(1, Math.floor(creature.level * 0.1))
          : 0;

    for (const r of recipients) {
      const penalty = r.isUncappedXp ? 1 : getXpPenalty(r.level, creature.level);
      const xp = Math.max(
        1,
        Math.floor(
          (baseXp / recipients.length) *
            penalty *
            partyBonus *
            (snapshot.config.xpBoostMultiplier || 1),
        ),
      );
      rewards.push({
        characterId: r.id,
        creatureId: creature.id,
        xp,
        gold: goldEach,
        renown,
      });
      // Reward payouts are also presentation events: the numbers travel in the
      // proposal (state) AND on their own log lines (prose), so the MUD log
      // reads the payout instead of ending at "<creature> falls."
      emit('xp_reward', `${r.name} gains ${xp} experience.`, {
        characterId: r.id,
        creatureId: creature.id,
        amount: xp,
      });
      if (goldEach > 0) {
        emit('gold_reward', `${r.name} loots ${goldEach} gold.`, {
          characterId: r.id,
          creatureId: creature.id,
          amount: goldEach,
        });
      }
      if (renown > 0) {
        emit('renown_reward', `${r.name} earns ${renown} Renown.`, {
          characterId: r.id,
          creatureId: creature.id,
          amount: renown,
        });
      }
      bonds.push({
        characterId: r.id,
        amount: bondGainForKill(creature.level, isBoss),
        creatureLevel: creature.level,
        isBoss,
      });
      if (creature.salvageMaterialKey && !creature.isHumanoid) {
        const mult = isBoss ? 4 : creature.rarity === 'rare' ? 2 : 1;
        materials.push({
          characterId: r.id,
          materialKey: creature.salvageMaterialKey,
          quantity: mult,
        });
        emit(
          'salvage_reward',
          `${r.name} salvages ${mult} ${creature.salvageMaterialKey.replace(/_/g, ' ')}.`,
          { characterId: r.id, creatureId: creature.id, amount: mult },
        );
      }
      if (rng.sample('gem_chance', creature.id, r.id) < snapshot.config.gemDropChance) {
        const gemKey = rng.pick('gem_pick', PRIMARY_GEM_KEYS, creature.id, r.id);
        if (gemKey) {
          gems.push({ characterId: r.id, gemKey });
          emit('gem_drop', `${r.name} finds a ${gemKey.replace(/_/g, ' ')}.`, {
            characterId: r.id,
            creatureId: creature.id,
          });
        }
      }

    }

    // ── loot (all three modes preserved) ─────────────────────────
    if (creature.lootMode === 'item_pool') {
      loot.push({
        creatureId: creature.id,
        creatureName: creature.name,
        creatureLevel: creature.level,
        creatureRarity: creature.rarity,
        mode: 'item_pool',
        lootTableId: null,
        itemId: null,
        dropChance: creature.dropChance,
      });
    } else if (creature.lootMode === 'salvage_only') {
      // no item loot by design
    } else if (creature.lootTableId) {
      loot.push({
        creatureId: creature.id,
        creatureName: creature.name,
        creatureLevel: creature.level,
        creatureRarity: creature.rarity,
        mode: 'legacy',
        lootTableId: creature.lootTableId,
        itemId: null,
        dropChance: creature.dropChance ?? 0.5,
      });
    } else {
      for (const entry of creature.lootTable) {
        if (entry.type === 'gold') continue;
        const s = rng.sample('loot_entry', creature.id, entry.itemId ?? entry.type);
        if (s <= (entry.chance || 0.1)) {
          loot.push({
            creatureId: creature.id,
            creatureName: creature.name,
            creatureLevel: creature.level,
            creatureRarity: creature.rarity,
            mode: 'legacy',
            lootTableId: null,
            itemId: entry.itemId,
            dropChance: 1,
          });
        }
      }
    }
  }

  const damageCharacter = (
    target: ParticipantSnapshot,
    amount: number,
    creatureId: string | null,
    nowMs: number,
  ): number => {
    if (amount <= 0 || !isAliveP(target.id)) return 0;
    // Ward first (mid-pipeline), then flat/percent mitigation, then HP.
    const ward = absorbFromShield(amount, w.shield.get(target.id) ?? 0);
    w.shield.set(target.id, ward.shieldAfter);
    let remaining = ward.remaining;
    if (target.buffs.mitigationPct > 0) {
      remaining = Math.floor(remaining * (1 - Math.min(0.9, target.buffs.mitigationPct)));
    }
    if (target.buffs.mitigationFlat > 0) {
      remaining = Math.max(0, remaining - target.buffs.mitigationFlat);
    }
    if (target.buffs.rooted) remaining = Math.max(Math.floor(remaining * 0.7), 1);
    const res = resolveDamage({ amount: remaining, hp: w.hp.get(target.id) ?? 0 });
    w.hp.set(target.id, res.hpAfter);
    if (res.killed) {
      w.shield.set(target.id, 0);
      emit('character_died', `${target.name} falls in battle.`, {
        characterId: target.id,
        creatureId,
      });
    }
    void nowMs;
    return res.applied;
  };

  /**
   * The authored Stored Power contract: while a boss channels, its paused
   * autoattack is banked as the *mitigated* damage that blow would have dealt
   * to the primary target. Crits are disabled during the channel, and no
   * dodge/block roll is taken, so a channel banks a steady expected value
   * rather than a second stream of RNG. Absorb shields are deliberately not
   * consumed here — nothing actually hit the target.
   */
  const expectedPausedAutoattack = (
    creature: CreatureSnapshot,
    target: ParticipantSnapshot,
    tick: number,
  ): number => {
    const raw = seededCreatureDamage({
      rng,
      creatureId: creature.id,
      creatureLevel: creature.level,
      creatureRarity: creature.rarity,
      creatureAttrs: creature.attrs,
      targetId: target.id,
      targetLevel: target.level,
      key: [tick, 'channel'],
    });
    let dmg = scaleCreatureDamage(raw, 'normal', false, 0);
    if (target.buffs.mitigationPct > 0) {
      dmg = Math.floor(dmg * (1 - Math.min(0.9, target.buffs.mitigationPct)));
    }
    if (target.buffs.mitigationFlat > 0) {
      dmg = Math.max(0, dmg - target.buffs.mitigationFlat);
    }
    if (target.buffs.rooted) dmg = Math.max(Math.floor(dmg * 0.7), 1);
    return Math.max(0, dmg);
  };


  const healCharacter = (target: ParticipantSnapshot, amount: number): number => {
    const res = resolveHeal({
      amount,
      hp: w.hp.get(target.id) ?? 0,
      maxHp: target.maxHp,
    });
    w.hp.set(target.id, res.hpAfter);
    return res.applied;
  };

  const restoreCp = (target: ParticipantSnapshot, amount: number): number => {
    const before = w.cp.get(target.id) ?? 0;
    const after = Math.min(target.maxCp, before + Math.max(0, Math.floor(amount)));
    w.cp.set(target.id, after);
    return after - before;
  };

  // ── C3a: per-caster persistent friendly state ───────────────────
  //
  // Every mechanic below keeps its own contract. They share this working
  // scaffolding only for bookkeeping (stack counts, once-per-tick guards,
  // intra-tick buff visibility) — never for gameplay semantics.

  /**
   * Same-node allies of a caster. The snapshot is node-scoped, so every
   * participant in it already stands on the encounter's node. `partyOnly`
   * narrows to the caster's party (the caster always included). Dead allies are
   * excluded: legacy `heal_party_member` refuses to revive the fallen.
   */
  const alliesOf = (casterId: string, partyOnly: boolean): ParticipantSnapshot[] => {
    const caster = byParticipant.get(casterId);
    if (!caster) return [];
    return participants.filter((p) => {
      if (!isAliveP(p.id) || !isPresent(p.id)) return false;
      if (p.id === caster.id) return true;
      if (!partyOnly) return true;
      return !!caster.partyId && p.partyId === caster.partyId;
    });
  };

  /** One-shot buff consumption (`stealth`, `disengage`). */
  const consumedBuffs: { characterId: string; buff: string }[] = [];
  const spentBuffs = new Set<string>();
  const buffSpent = (characterId: string, buff: string) =>
    spentBuffs.has(`${characterId}:${buff}`);
  const spendBuff = (characterId: string, buff: string) => {
    spentBuffs.add(`${characterId}:${buff}`);
    consumedBuffs.push({ characterId, buff });
  };

  /**
   * Buff state acquired *this* tick (a stance activated by an action in the
   * same tick is visible to later phases of that tick, exactly as the legacy
   * server rebuilt `member_buffs` before resolving hits).
   */
  interface BuffOverride {
    stealthMult?: number;
    nextHitBonusMult?: number;
    dodgeChance?: number;
    blockBuff?: boolean;
    blockChanceBonus?: number;
    blockAmountBonus?: number;
    blockChanceCap?: number;
    reactiveHolyDamage?: number;
    reactiveHolyDamageType?: string | null;
    absorbShield?: number;
    mitigationPct?: number;
    mitigationFlat?: number;
    critBuffBonus?: number;
    damageBuff?: boolean;
    damageBuffMult?: number;
  }
  const buffOverride = new Map<string, BuffOverride>();
  const overrideOf = (id: string): BuffOverride => {
    let o = buffOverride.get(id);
    if (!o) {
      o = {};
      buffOverride.set(id, o);
    }
    return o;
  };
  /** Participant view with this tick's acquired state merged in. */
  const withBuffs = (p: ParticipantSnapshot): ParticipantSnapshot => {
    const o = buffOverride.get(p.id);
    if (!o) return p;
    return { ...p, buffs: { ...p.buffs, ...o, blockBuff: o.blockBuff ?? p.buffs.blockBuff } };
  };
  const stealthMultOf = (p: ParticipantSnapshot): number => {
    if (buffSpent(p.id, 'stealth')) return 1;
    const o = buffOverride.get(p.id);
    const mult = o?.stealthMult ?? (p.buffs.stealth ? (p.buffs.stealthMult ?? 2) : 0);
    return mult > 1 ? mult : p.buffs.stealth ? 2 : 1;
  };
  const hasStealth = (p: ParticipantSnapshot): boolean =>
    !buffSpent(p.id, 'stealth') && (p.buffs.stealth || !!buffOverride.get(p.id)?.stealthMult);
  const nextHitMultOf = (p: ParticipantSnapshot): number => {
    if (buffSpent(p.id, 'disengage')) return 0;
    const m = buffOverride.get(p.id)?.nextHitBonusMult ?? p.buffs.nextHitBonusMult ?? 0;
    return m > 0 ? m : 0;
  };
  const reactiveHolyOf = (p: ParticipantSnapshot) => {
    const o = buffOverride.get(p.id);
    const dmg = o?.reactiveHolyDamage ?? p.buffs.reactiveHolyDamage ?? 0;
    if (!(dmg > 0)) return null;
    return {
      damage: Math.max(1, Math.floor(dmg)),
      damageType: o?.reactiveHolyDamageType ?? p.buffs.reactiveHolyDamageType ?? 'holy',
    };
  };
  /** Holy Shield retaliates at most once per (defender, attacker) per tick. */
  const holyShieldSeen = new Set<string>();

  // ── stack accounting (`stack_apply` / `stack_consume`) ───────────
  // Stacks belong to a (source, target, effect_type) triple: two players'
  // Envenom stacks never merge, exactly as in the legacy tick.
  const stackWorking = new Map<string, number>();
  const stackTriple = (effectType: string, sourceId: string, targetId: string) =>
    `${effectType}|${sourceId}|${targetId}`;
  const snapshotStackRow = (effectType: string, sourceId: string, targetId: string) =>
    effects.find(
      (e) =>
        e.effectType === effectType &&
        e.targetId === targetId &&
        e.sourceCharacterId === sourceId &&
        e.expiresAtMs > snapshot.nowMs,
    ) ?? null;
  const stacksOf = (effectType: string, sourceId: string, targetId: string): number => {
    const k = stackTriple(effectType, sourceId, targetId);
    const working = stackWorking.get(k);
    if (working !== undefined) return working;
    return snapshotStackRow(effectType, sourceId, targetId)?.stacks ?? 0;
  };

  /**
   * `stack_apply` — Envenom (weapon-hit trigger) and Orbs of Fire (pulse
   * trigger). A proc refreshes the full duration and adds exactly one stack,
   * capped by the ability's configured `max_stacks`. Ownership is per
   * source/target pair.
   */
  const runStackAppliers = (
    attacker: ParticipantSnapshot,
    creature: CreatureSnapshot,
    trigger: 'weapon_hit' | 'successful_pulse_hit',
    nowMs: number,
    t: number,
  ): void => {
    const appliers = attacker.buffs.stackAppliers;
    if (!appliers || appliers.length === 0) return;
    for (const ap of sortBy(appliers, (x) => x.abilityKey)) {
      if (ap.trigger !== trigger) continue;
      if (!isAliveC(creature.id)) return;
      const chance = Math.max(0, Math.min(1, ap.chance));
      if (
        chance < 1 &&
        rng.sample('stack_apply_chance', ap.abilityKey, attacker.id, creature.id, t) >= chance
      ) {
        continue;
      }
      // The pulse and the stack it lands are one beat: resolve the stack facts
      // first so both lines can name the same `{stacks}/{max_stacks}`, and
      // stamp one deterministic `groupId` so presentation may render them as a
      // single line without either event losing its own committed identity.
      const cap = Math.max(1, Math.floor(ap.maxStacks || 1));
      const next = Math.min(cap, stacksOf(ap.effectType, attacker.id, creature.id) + 1);
      const groupId = `pulse|${t}|${ap.abilityKey}|${attacker.id}|${creature.id}`;
      if (ap.pulseDamage > 0) {
        const sparked = damageCreature(
          creature,
          Math.max(1, Math.floor(ap.pulseDamage)),
          attacker.id,
          'stance',
          nowMs,
        );
        if (sparked > 0) {
          // Fallback prose only: the client renders the ability's authored
          // `pulse_text` from `abilityKey` + these structured facts.
          emit('stance_pulse', `${attacker.name} sears ${creature.name} for ${sparked}.`, {
            characterId: attacker.id,
            creatureId: creature.id,
            amount: sparked,
            damageType: ap.damageType,
            ...presentAbility(attacker, creature, ap.abilityKey),
            stacks: next,
            maxStacks: cap,
            effectType: ap.effectType,
            groupId,
            attemptedAmount: sparked,
            mitigatedAmount: 0,
            appliedAmount: sparked,
          });
        }
        if (!isAliveC(creature.id)) return;
      }
      stackWorking.set(stackTriple(ap.effectType, attacker.id, creature.id), next);
      const interval = ap.intervalMs > 0 ? ap.intervalMs : tickRate;
      effectUpserts.push({
        targetKind: 'creature',
        targetId: creature.id,
        effectType: ap.effectType,
        stacks: next,
        amountPerTick: Math.max(1, Math.floor(ap.dotPerTick)),
        expiresAtMs: nowMs + Math.max(tickRate, ap.durationMs),
        intervalMs: interval,
        nextTickAtMs: nowMs + interval,
        damageType: ap.damageType,
        sourceCharacterId: attacker.id,
        // The LANDED stack is a hostile periodic row on the creature. The
        // applier stance itself is the `stack_apply` row on the character —
        // tagging this row `stack_apply` would claim a character-target
        // mechanic for a creature row and be refused on rehydration.
        mechanic: 'dot_debuff',
        abilityKey: ap.abilityKey,
        maxStacks: cap,
        params: {
          maxStacks: cap,
          ...(ap.damageType ? { damageType: ap.damageType } : {}),
        },
        paramsVersion: EFFECT_PARAMS_VERSION,
      });

      emit(
        'stack_applied',
        `${attacker.name} afflicts ${creature.name} [${next}/${cap}].`,
        {
          characterId: attacker.id,
          creatureId: creature.id,
          damageType: ap.damageType,
          ...presentAbility(attacker, creature, ap.abilityKey),
          stacks: next,
          maxStacks: cap,
          effectType: ap.effectType,
          groupId,
        },
      );


    }
  };

  /**
   * Pulse of a persistent friendly state row (`aura_pulse`, `party_regen`,
   * `regen_buff`). These live in the effect table so live and catch-up
   * resolution treat them identically — the legacy client-loop versions simply
   * stopped when a tab closed.
   */
  const pulsePersistentState = (
    e: (typeof effects)[number],
    nowMs: number,
    t: number,
  ): void => {
    const ownerId = e.sourceCharacterId;
    if (!ownerId) return;
    const owner = byParticipant.get(ownerId);
    if (!owner || !isAliveP(owner.id)) return;
    const label = e.abilityKey ?? e.effectType;
    const hpPerPulse = Math.max(0, Math.floor(e.amountPerTick));
    const cpPerPulse = Math.max(0, Math.floor(e.cpPerTick ?? 0));

    if (e.mechanic === 'party_regen' || e.mechanic === 'regen_buff') {
      let healed = 0;
      let restored = 0;
      let touched = 0;
      for (const ally of alliesOf(owner.id, true)) {
        if (hpPerPulse > 0) healed += healCharacter(ally, hpPerPulse);
        if (cpPerPulse > 0) restored += restoreCp(ally, cpPerPulse);
        touched++;
      }
      if (touched > 0 && (healed > 0 || restored > 0)) {
        emit('regen_pulse', `${label} restores ${healed} HP to ${touched} ally(s).`, {
          characterId: owner.id,
          amount: healed,
        });
        if (restored > 0) {
          emit('regen_pulse_cp', `${label} restores ${restored} CP.`, {
            characterId: owner.id,
            amount: restored,
          });
        }
      }
      return;
    }

    if (e.mechanic === 'aura_pulse') {
      if (e.healsAllies && hpPerPulse > 0) {
        let healed = 0;
        for (const ally of alliesOf(owner.id, true)) healed += healCharacter(ally, hpPerPulse);
        if (healed > 0) {
          emit('aura_heal', `${label} mends ${healed} HP among the faithful.`, {
            characterId: owner.id,
            amount: healed,
          });
        }
      }
      if (e.damagesEnemies && hpPerPulse > 0) {
        for (const c of creatures) {
          if (!isAliveC(c.id)) continue;
          const roll = rng.sample('aura_pulse_damage', e.id, c.id, t);
          void roll; // magnitude is configured, the stream keeps the draw addressed
          const applied = damageCreature(c, hpPerPulse, owner.id, 'stance', nowMs);
          if (applied > 0) {
            emit('aura_damage', `${label} burns ${c.name} for ${applied}.`, {
              characterId: owner.id,
              creatureId: c.id,
              amount: applied,
              damageType: e.damageType,
            });
          }
        }
      }
    }
  };



  // ── tick loop ───────────────────────────────────────────────────

  // Mode semantics. `effects_only` is a hard capability restriction, checked at
  // every active-combat site below rather than assumed by the caller.
  const effectsOnly = snapshot.mode === 'catchup';

  for (let t = 0; t < ticks; t++) {
    const nowMs = snapshot.nowMs + t * tickRate;

    // 1. Periodic rows, stable order: DoTs/HoTs and the persistent friendly
    //    states (`aura_pulse`, `party_regen`, `regen_buff`), which pulse on
    //    their own configured cadence rather than on every tick.
    for (const e of effects) {
      if (!effectLive(e, nowMs)) {
        effectDeleteIds.add(e.id);
        continue;
      }
      const stateMech =
        e.mechanic === 'aura_pulse' || e.mechanic === 'party_regen' || e.mechanic === 'regen_buff'
          ? e.mechanic
          : null;
      if (!stateMech && (!e.isPeriodic || !(e.amountPerTick > 0))) continue;
      const interval = e.intervalMs > 0 ? e.intervalMs : tickRate;
      // `nextTickAtMs` is the absolute due time carried by
      // `active_effects.next_tick_at`. No derivation, no inference from the
      // encounter cursor: due means due.
      const dueAt = effectNextDue.get(e.id) ?? e.nextTickAtMs;
      if (dueAt > nowMs) continue;
      // Advance the schedule from the *due* time, not from `nowMs`, so a
      // delayed invocation or a multi-tick catch-up run cannot drift the
      // cadence of a periodic effect.
      effectNextDue.set(e.id, dueAt + interval);
      // Policy C: a pulse that came due while the simulation was genuinely
      // suspended never lands. Fast-forward its cadence past the resume point
      // instead of paying out a backlog of damage or healing. Expiry is still
      // authoritative — `effectLive` above proposes the removal.
      const pause = snapshot.pauseBoundary;
      if (pause && dueAt >= pause.suspendedAtMs && dueAt < pause.resumedAtMs) {
        let next = dueAt;
        while (next < pause.resumedAtMs) next += interval;
        effectNextDue.set(e.id, next);
        continue;
      }
      if (stateMech) {
        pulsePersistentState(e, nowMs, t);
        continue;
      }
      const perTick = Math.max(1, Math.floor(e.amountPerTick * Math.max(1, e.stacks)));
      if (e.targetKind === 'creature') {
        const creature = byCreature.get(e.targetId);
        if (!creature || !isAliveC(creature.id)) continue;
        const applied = damageCreature(
          creature,
          perTick,
          e.sourceCharacterId,
          'dot',
          nowMs,
        );
        if (applied > 0) {
          emit('dot_tick', `${creature.name} suffers ${applied} ${e.effectType} damage.`, {
            creatureId: creature.id,
            characterId: e.sourceCharacterId,
            amount: applied,
            damageType: e.damageType,
          });
        }
      } else {
        const target = byParticipant.get(e.targetId);
        if (!target || !isAliveP(target.id)) continue;
        const applied = damageCharacter(target, perTick, null, nowMs);
        if (applied > 0) {
          emit('dot_tick', `${target.name} suffers ${applied} ${e.effectType} damage.`, {
            characterId: target.id,
            amount: applied,
            damageType: e.damageType,
          });
        }
      }
    }

    // 2. Durable ability intents — resolved once, on the first simulated tick.
    // Effects-only never consumes a pending intent: the action stays pending
    // for the next live tick, and is neither executed nor rejected here.
    if (t === 0 && !effectsOnly) {
      for (const a of [...stanceActions, ...actions]) {
        const caster = byParticipant.get(a.characterId);
        if (!caster) continue;
        if (!isAliveP(caster.id)) {
          rejectedActions.push({ actionId: a.id, reason: 'caster_dead' });
          continue;
        }
        // A caster who walked off the node cannot act on this encounter, but
        // stays in the snapshot for attribution and rewards.
        if (!isPresent(caster.id)) {
          rejectedActions.push({ actionId: a.id, reason: 'not_present' });
          continue;
        }
        if ((w.cp.get(caster.id) ?? 0) < a.cpCost) {
          rejectedActions.push({ actionId: a.id, reason: 'insufficient_cp' });
          continue;
        }
        const ampBase = 1;
        const key = [a.id] as const;

        if (a.mechanic === 'heal') {
          const ally = a.allyId ? byParticipant.get(a.allyId) : caster;
          if (!ally) {
            rejectedActions.push({ actionId: a.id, reason: 'no_target' });
            continue;
          }
          if (!isPresent(ally.id)) {
            rejectedActions.push({ actionId: a.id, reason: 'not_present' });
            continue;
          }
          w.cp.set(caster.id, (w.cp.get(caster.id) ?? 0) - a.cpCost);
          const applied = healCharacter(ally, Math.max(0, Math.floor(a.amount)));
          consumedActionIds.push(a.id);
          emit('heal', `${caster.name} restores ${applied} HP to ${ally.name}.`, {
            characterId: ally.id,
            amount: applied,
          });
          continue;
        }

        // ── absorb_buff / mitigation_buff / offense_buff ───────────
        // Persistent friendly state. The row IS the buff: it carries the
        // authored magnitude, the mechanic-scoped params, and — for absorb —
        // the mutable unspent pool in `remaining`. The next tick rebuilds the
        // buff bag from it (see pure/effect-contract.ts).
        if (
          a.mechanic === 'absorb_buff' ||
          a.mechanic === 'mitigation_buff' ||
          a.mechanic === 'offense_buff'
        ) {
          const prm = a.params ?? {};
          w.cp.set(caster.id, (w.cp.get(caster.id) ?? 0) - a.cpCost);
          consumedActionIds.push(a.id);
          const targetId = a.allyId ?? caster.id;
          const magnitude = Math.max(0, a.amount);
          const expiresAtMs = nowMs + Math.max(tickRate, a.durationMs);

          // In-tick effect, identical to what rehydration will produce.
          const o = overrideOf(targetId);
          if (a.mechanic === 'absorb_buff') {
            const pool = Math.floor(magnitude);
            w.shield.set(targetId, Math.max(w.shield.get(targetId) ?? 0, pool));
            o.absorbShield = w.shield.get(targetId) ?? pool;
          } else if (a.mechanic === 'mitigation_buff') {
            if ((prm.mode ?? 'percent') === 'flat') {
              o.mitigationFlat = Math.max(o.mitigationFlat ?? 0, magnitude);
            } else {
              o.mitigationPct = Math.max(o.mitigationPct ?? 0, magnitude);
            }
          } else if ((prm.offenseMode ?? 'damage_mult') === 'crit_edge') {
            o.critBuffBonus = Math.max(o.critBuffBonus ?? 0, magnitude);
          } else {
            o.damageBuff = true;
            o.damageBuffMult = Math.max(o.damageBuffMult ?? 0, magnitude);
          }

          effectUpserts.push({
            targetKind: 'character',
            targetId,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs,
            intervalMs: 0,
            nextTickAtMs: expiresAtMs,
            damageType: null,
            sourceCharacterId: caster.id,
            mechanic: a.mechanic,
            abilityKey: a.abilityKey,
            magnitude,
            remaining: a.mechanic === 'absorb_buff' ? Math.floor(magnitude) : null,
            params:
              a.mechanic === 'mitigation_buff'
                ? { mode: prm.mode === 'flat' ? 'flat' : 'percent', ...(prm.taunt === true ? { taunt: true } : {}) }
                : a.mechanic === 'offense_buff'
                  ? { offenseMode: prm.offenseMode === 'crit_edge' ? 'crit_edge' : 'damage_mult' }
                  : {},
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('buff', `${caster.name} readies ${a.abilityKey}.`, {
            characterId: caster.id,
          });
          continue;
        }


        const pr = a.params ?? {};
        const payCp = () => w.cp.set(caster.id, (w.cp.get(caster.id) ?? 0) - a.cpCost);
        const stateExpiry = nowMs + Math.max(tickRate, a.durationMs);
        const stateInterval = a.intervalMs > 0 ? a.intervalMs : tickRate;

        // ── stealth_buff (Shadowstep) ──────────────────────────────
        // Ambush multiplier, consumed by the next landed hit. Legacy floor of
        // x2 applies when the configuration resolves no multiplier.
        if (a.mechanic === 'stealth_buff') {
          const mult = Math.max(1, pr.ambushMult ?? a.amount ?? 2) || 2;
          payCp();
          consumedActionIds.push(a.id);
          overrideOf(caster.id).stealthMult = mult;
          spentBuffs.delete(`${caster.id}:stealth`);
          effectUpserts.push({
            targetKind: 'character',
            targetId: caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: stateExpiry,
            intervalMs: 0,
            nextTickAtMs: stateExpiry,
            damageType: null,
            sourceCharacterId: caster.id,
            mechanic: 'stealth_buff',
            abilityKey: a.abilityKey,
            magnitude: mult,
            // One-shot ambush: the charge is spent by the next landed hit.
            remaining: 1,
            params: {},
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('buff', `${caster.name} melts into shadow (ambush x${mult.toFixed(2)}).`, {
            characterId: caster.id,
          });
          continue;
        }

        // ── block_buff (Shield Wall) ───────────────────────────────
        // Additive block chance and amount on incoming creature hits, capped.
        if (a.mechanic === 'block_buff') {
          payCp();
          consumedActionIds.push(a.id);
          const o = overrideOf(caster.id);
          o.blockBuff = true;
          if (typeof pr.blockChance === 'number') o.blockChanceBonus = pr.blockChance;
          if (typeof pr.blockAmount === 'number') o.blockAmountBonus = pr.blockAmount;
          o.blockChanceCap = pr.blockChanceCap ?? 0.95;
          effectUpserts.push({
            targetKind: 'character',
            targetId: caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: stateExpiry,
            intervalMs: 0,
            nextTickAtMs: stateExpiry,
            damageType: null,
            sourceCharacterId: caster.id,
            mechanic: 'block_buff',
            abilityKey: a.abilityKey,
            magnitude: Math.max(0, Math.min(1, pr.blockChance ?? 0)),
            params: {
              ...(typeof pr.blockAmount === 'number' ? { blockAmount: pr.blockAmount } : {}),
              blockChanceCap: pr.blockChanceCap ?? 0.95,
            },
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('buff', `${caster.name} braces behind their shield.`, {
            characterId: caster.id,
          });
          continue;
        }

        // ── evasion_buff (Cloak of Shadows / Disengage) ────────────
        // Dodge chance for its window; Disengage additionally arms a one-shot
        // outgoing multiplier consumed by the caster's next landed hit.
        if (a.mechanic === 'evasion_buff') {
          payCp();
          consumedActionIds.push(a.id);
          const dodge = Math.max(0, Math.min(1, pr.dodgeChance ?? a.amount));
          const o = overrideOf(caster.id);
          o.dodgeChance = dodge;
          effectUpserts.push({
            targetKind: 'character',
            targetId: caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: stateExpiry,
            intervalMs: 0,
            nextTickAtMs: stateExpiry,
            damageType: null,
            sourceCharacterId: caster.id,
            mechanic: 'evasion_buff',
            abilityKey: a.abilityKey,
            magnitude: dodge,
            params: { kind: 'dodge', evasionSource: pr.evasionSource ?? 'cloak' },
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          const bonusMult = pr.nextHitBonusMult ?? (pr.dodgeChance != null ? a.amount : 0);
          const windowMs = pr.nextHitWindowMs ?? 0;
          if (pr.evasionSource === 'disengage' && windowMs > 0 && bonusMult > 0) {
            o.nextHitBonusMult = bonusMult;
            spentBuffs.delete(`${caster.id}:disengage`);
            effectUpserts.push({
              targetKind: 'character',
              targetId: caster.id,
              effectType: `${a.abilityKey}_next_hit`,
              stacks: 1,
              amountPerTick: 0,
              expiresAtMs: nowMs + windowMs,
              intervalMs: 0,
              nextTickAtMs: nowMs + windowMs,
              damageType: null,
              sourceCharacterId: caster.id,
              mechanic: 'evasion_buff',
              abilityKey: a.abilityKey,
              magnitude: bonusMult,
              // One-shot window: consumed by the caster's next landed hit.
              remaining: 1,
              params: { kind: 'next_hit', evasionSource: 'disengage' },
              paramsVersion: EFFECT_PARAMS_VERSION,
            });
          }
          emit(
            'buff',
            `${caster.name} slips aside (${Math.round(dodge * 100)}% evasion).`,
            { characterId: caster.id },
          );
          continue;
        }

        // ── reactive_holy (Holy Shield) ────────────────────────────
        // Retaliation on qualifying incoming hits, once per attacker per tick.
        if (a.mechanic === 'reactive_holy') {
          payCp();
          consumedActionIds.push(a.id);
          const dmg = Math.max(1, Math.floor(pr.retaliationDamage ?? a.amount));
          const o = overrideOf(caster.id);
          o.reactiveHolyDamage = dmg;
          o.reactiveHolyDamageType = a.damageType ?? 'holy';
          effectUpserts.push({
            targetKind: 'character',
            targetId: caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: stateExpiry,
            intervalMs: 0,
            nextTickAtMs: stateExpiry,
            damageType: a.damageType,
            sourceCharacterId: caster.id,
            mechanic: 'reactive_holy',
            abilityKey: a.abilityKey,
            magnitude: dmg,
            params: { damageType: a.damageType ?? 'holy' },
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('buff', `${caster.name} raises a retaliating ward [${dmg}].`, {
            characterId: caster.id,
          });
          continue;
        }

        // ── party_regen / regen_buff / aura_pulse ──────────────────
        // Persistent pulses. Stored as effect rows so live and catch-up
        // resolution advance them identically instead of relying on a client
        // interval that dies with the tab.
        if (
          a.mechanic === 'party_regen' ||
          a.mechanic === 'regen_buff' ||
          a.mechanic === 'aura_pulse'
        ) {
          payCp();
          consumedActionIds.push(a.id);
          const hpPerTick = Math.max(
            0,
            Math.floor(a.mechanic === 'regen_buff' ? (pr.hpPerTick ?? a.amount) : a.amount),
          );
          const cpPerTick =
            a.mechanic === 'regen_buff' ? Math.max(0, Math.floor(pr.cpPerTick ?? 0)) : 0;
          // `best_of` (the legacy default for Inspire) never weakens a live
          // pulse on recast, but always extends its window.
          let mergedHp = hpPerTick;
          let mergedCp = cpPerTick;
          if (a.mechanic === 'regen_buff' && (pr.refreshPolicy ?? 'best_of') === 'best_of') {
            const live = effects.find(
              (e) =>
                e.mechanic === 'regen_buff' &&
                e.targetId === caster.id &&
                e.sourceCharacterId === caster.id &&
                e.expiresAtMs > nowMs,
            );
            if (live) {
              mergedHp = Math.max(mergedHp, Math.floor(live.amountPerTick));
              mergedCp = Math.max(mergedCp, Math.floor(live.cpPerTick ?? 0));
            }
          }
          effectUpserts.push({
            targetKind: 'character',
            targetId: caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: mergedHp,
            expiresAtMs: stateExpiry,
            intervalMs: stateInterval,
            // First pulse lands one interval after the cast, never on the
            // cast tick itself.
            nextTickAtMs: nowMs + stateInterval,
            damageType: a.damageType,
            sourceCharacterId: caster.id,
            mechanic: a.mechanic,
            abilityKey: a.abilityKey,
            cpPerTick: mergedCp,
            healsAllies: pr.healsAllies ?? a.mechanic !== 'aura_pulse',
            damagesEnemies: pr.damagesEnemies ?? a.mechanic === 'aura_pulse',
            params: {
              cpPerTick: mergedCp,
              healsAllies: pr.healsAllies ?? a.mechanic !== 'aura_pulse',
              damagesEnemies: pr.damagesEnemies ?? a.mechanic === 'aura_pulse',
            },
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('buff', `${caster.name} sustains ${a.abilityKey}.`, {
            characterId: caster.id,
            amount: mergedHp,
          });
          continue;
        }

        // ── stack_apply (Envenom / Orbs of Fire) ───────────────────
        // Registers the applier; the stacks themselves land on qualifying
        // weapon hits or pulses, never on the activation itself.
        if (a.mechanic === 'stack_apply') {
          payCp();
          consumedActionIds.push(a.id);
          effectUpserts.push({
            targetKind: 'character',
            targetId: caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: stateExpiry,
            intervalMs: 0,
            nextTickAtMs: stateExpiry,
            damageType: a.damageType,
            sourceCharacterId: caster.id,
            mechanic: 'stack_apply',
            abilityKey: a.abilityKey,
            magnitude: Math.max(0, Math.min(1, pr.procChance ?? a.amount)),
            maxStacks: Math.max(1, Math.floor(a.maxStacks)),
            params: {
              stackEffectType: pr.stackEffectType ?? a.abilityKey,
              trigger: pr.stackTrigger ?? 'weapon_hit',
              dotPerTick: Math.max(0, pr.dotPerTick ?? 0),
              durationMs: Math.max(0, Math.floor(pr.stackDurationMs ?? a.durationMs)),
              intervalMs: Math.max(250, Math.floor(stateInterval)),
              maxStacks: Math.max(1, Math.floor(a.maxStacks)),
              ...(typeof pr.pulseDamage === 'number' ? { pulseDamage: pr.pulseDamage } : {}),
              ...(a.damageType ? { damageType: a.damageType } : {}),
            },
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('buff', `${caster.name} readies ${a.abilityKey}.`, {
            characterId: caster.id,
          });
          continue;
        }

        // ── hp_transfer (Transfer Health) ──────────────────────────
        // One atomic proposal: the caster's debit and the ally's heal are
        // decided together, so the caster can never pay for a heal that does
        // not land. The caster may never breach its own HP reserve.
        if (a.mechanic === 'hp_transfer') {
          const ally = a.allyId ? byParticipant.get(a.allyId) : null;
          if (!ally || ally.id === caster.id) {
            rejectedActions.push({ actionId: a.id, reason: 'no_target' });
            continue;
          }
          if (!isPresent(ally.id)) {
            rejectedActions.push({ actionId: a.id, reason: 'not_present' });
            continue;
          }
          if (!isAliveP(ally.id)) {
            rejectedActions.push({ actionId: a.id, reason: 'target_dead' });
            continue;
          }
          const minReserve = Math.max(1, Math.floor(pr.minReserveHp ?? 1));
          const reserve = Math.max(minReserve, Math.floor(pr.reserveHp ?? minReserve));
          const casterHp = w.hp.get(caster.id) ?? 0;
          const affordable = casterHp - reserve;
          if (affordable <= 0) {
            rejectedActions.push({ actionId: a.id, reason: 'insufficient_hp' });
            continue;
          }
          const wanted = Math.max(0, Math.floor(a.amount));
          // Never debit more than the ally can actually receive.
          const receivable = Math.max(0, ally.maxHp - (w.hp.get(ally.id) ?? 0));
          const transfer = Math.min(wanted, affordable, receivable);
          if (transfer <= 0) {
            rejectedActions.push({ actionId: a.id, reason: 'insufficient_hp' });
            continue;
          }
          payCp();
          consumedActionIds.push(a.id);
          w.hp.set(caster.id, casterHp - transfer);
          const restored = healCharacter(ally, transfer);
          emit(
            'hp_transfer',
            `${caster.name} channels ${restored} HP into ${ally.name}.`,
            { characterId: ally.id, amount: restored },
          );
          continue;
        }



        const creature = a.creatureId ? byCreature.get(a.creatureId) : null;
        if (!creature) {
          rejectedActions.push({ actionId: a.id, reason: 'no_target' });
          continue;
        }
        if (!isAliveC(creature.id)) {
          rejectedActions.push({ actionId: a.id, reason: 'target_dead' });
          continue;
        }
        w.cp.set(caster.id, (w.cp.get(caster.id) ?? 0) - a.cpCost);
        consumedActionIds.push(a.id);
        w.hitters.add(caster.id);
        engagementsJoin.push({
          creatureId: creature.id,
          characterId: caster.id,
          lastActionAtMs: nowMs,
        });

        // ── multi_attack (Barrage) ─────────────────────────────────
        // One volley, `minHits..maxHits` projectiles rolled once. Each
        // projectile rolls its own to-hit and damage; a dead target is
        // re-acquired, and the volley stops when nothing is left standing.
        // Stealth / Disengage empower every projectile but are consumed once,
        // after the volley — the legacy contract.
        if (a.mechanic === 'multi_attack') {
          const minHits = Math.max(1, Math.floor(pr.minHits ?? 1));
          const maxHits = Math.max(minHits, Math.floor(pr.maxHits ?? minHits));
          const span = maxHits - minHits + 1;
          const shots =
            minHits + Math.floor(rng.sample('multi_hit_count', a.id) * span);
          const stealthMult = hasStealth(caster) ? stealthMultOf(caster) : 1;
          const nextHit = nextHitMultOf(caster);
          let current: CreatureSnapshot | null = creature;
          let landed = 0;
          let total = 0;
          for (let i = 0; i < shots; i++) {
            if (!current || !isAliveC(current.id)) {
              current =
                rng.pick(
                  'multi_hit_target',
                  creatures.filter((c) => isAliveC(c.id)),
                  a.id,
                  i,
                ) ?? null;
            }
            if (!current) break;
            const shot = seededAttackRoll({
              rng,
              attacker: caster,
              creatureId: current.id,
              creatureAC: current.ac,
              progression,
              key: [a.id, i],
              rollStream: 'multi_hit_roll',
              damageStream: 'multi_hit_damage',
            });
            if (!shot.hit) {
              emit('ability_miss', `${caster.name}'s ${a.abilityKey} goes wide.`, {
                characterId: caster.id,
                creatureId: current.id,
              });
              continue;
            }
            let dmg = Math.max(1, Math.floor(a.amount)) + shot.baseDamage;
            if (stealthMult > 1) dmg = Math.max(1, Math.floor(dmg * stealthMult));
            if (nextHit > 0) dmg = Math.floor(dmg * (1 + nextHit));
            const amp = ampPctFor(current.id, nowMs);
            if (amp > 0) dmg = Math.floor(dmg * (ampBase + amp / 100));
            const applied = damageCreature(current, dmg, caster.id, 'ability', nowMs);
            total += applied;
            landed++;
            runStackAppliers(caster, current, 'weapon_hit', nowMs, t);
            emit(
              shot.isCrit ? 'ability_crit' : 'ability_hit',
              `${caster.name}'s ${a.abilityKey} strikes ${current.name} for ${applied}.`,
              {
                characterId: caster.id,
                creatureId: current.id,
                amount: applied,
                damageType: a.damageType,
              },
            );
          }
          if (landed > 0) {
            if (stealthMult > 1) spendBuff(caster.id, 'stealth');
            if (nextHit > 0) spendBuff(caster.id, 'disengage');
          }
          emit(
            'volley',
            `${caster.name}'s ${a.abilityKey}: ${landed}/${shots} strikes for ${total}.`,
            { characterId: caster.id, amount: total },
          );
          continue;
        }

        // ── burst_damage (Grand Finale) ────────────────────────────
        // A single nuke with its own to-hit roll and an independent crit roll
        // whose edge is widened by configuration. Costs CP only.
        if (a.mechanic === 'burst_damage') {
          const shot = seededAttackRoll({
            rng,
            attacker: caster,
            creatureId: creature.id,
            creatureAC: creature.ac,
            progression,
            key: ['burst', a.id],
            rollStream: 'burst_roll',
            damageStream: 'burst_damage',
          });
          if (!shot.hit) {
            emit('ability_miss', `${caster.name}'s ${a.abilityKey} dissipates.`, {
              characterId: caster.id,
              creatureId: creature.id,
            });
            continue;
          }
          const weaponPart = a.weaponBased
            ? seededWeaponAbilityDamage({ rng, attacker: caster, progression, key })
            : 0;
          let dmg = Math.max(1, Math.floor(a.amount + weaponPart));
          const critEdge = Math.max(0, Math.min(1, pr.critEdge ?? 0));
          const isCrit =
            critEdge > 0 && rng.sample('burst_crit', a.id, creature.id) < critEdge;
          if (isCrit) dmg = Math.max(1, Math.floor(dmg * 1.5));
          const amp = ampPctFor(creature.id, nowMs);
          if (amp > 0) dmg = Math.floor(dmg * (ampBase + amp / 100));
          const applied = damageCreature(creature, dmg, caster.id, 'ability', nowMs);
          emit(
            isCrit ? 'ability_crit' : 'ability_hit',
            `${caster.name}'s ${a.abilityKey} erupts on ${creature.name} for ${applied}.`,
            {
              characterId: caster.id,
              creatureId: creature.id,
              amount: applied,
              damageType: a.damageType,
            },
          );
          continue;
        }

        // ── stack_consume (Eviscerate / Conflagrate) ───────────────
        // Damage = amount * (1 + perStackMultiplier * stacks). The stacks are
        // spent whether or not the finisher lands — the legacy contract.
        if (a.mechanic === 'stack_consume') {
          const effType = pr.stackEffectType ?? a.statusKey ?? a.abilityKey;
          const stacks = stacksOf(effType, caster.id, creature.id);
          const row = snapshotStackRow(effType, caster.id, creature.id);
          if (row) effectDeleteIds.add(row.id);
          stackWorking.set(stackTriple(effType, caster.id, creature.id), 0);

          const shot = seededAttackRoll({
            rng,
            attacker: caster,
            creatureId: creature.id,
            creatureAC: creature.ac,
            progression,
            key: ['finisher', a.id],
            rollStream: 'stack_consume_roll',
            damageStream: 'stack_consume_damage',
          });
          if (!shot.hit) {
            emit(
              'ability_miss',
              `${caster.name}'s ${a.abilityKey} misses — ${stacks} stack(s) wasted.`,
              { characterId: caster.id, creatureId: creature.id, amount: stacks },
            );
            continue;
          }
          const weaponPart = a.weaponBased
            ? seededWeaponAbilityDamage({ rng, attacker: caster, progression, key })
            : 0;
          const perStack = Math.max(0, pr.perStackMultiplier ?? 0);
          let dmg = Math.max(
            1,
            Math.floor((a.amount + weaponPart) * (1 + perStack * stacks)),
          );
          if (shot.isCrit) dmg = Math.max(1, Math.floor(dmg * 1.5));
          const amp = ampPctFor(creature.id, nowMs);
          if (amp > 0) dmg = Math.floor(dmg * (ampBase + amp / 100));
          const applied = damageCreature(creature, dmg, caster.id, 'ability', nowMs);
          emit(
            shot.isCrit ? 'ability_crit' : 'ability_hit',
            `${caster.name}'s ${a.abilityKey} consumes ${stacks} stack(s) on ${creature.name} for ${applied}.`,
            {
              characterId: caster.id,
              creatureId: creature.id,
              amount: applied,
              damageType: a.damageType,
            },
          );
          continue;
        }



        if (a.mechanic === 'control_debuff') {
          effectUpserts.push({
            targetKind: 'creature',
            targetId: creature.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: nowMs + Math.max(tickRate, a.durationMs),
            intervalMs: 0,
            nextTickAtMs: nowMs + Math.max(0, a.intervalMs > 0 ? a.intervalMs : tickRate),
            damageType: a.damageType,
            sourceCharacterId: caster.id,
            mechanic: 'control_debuff',
            abilityKey: a.abilityKey,
            params: {},
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit('debuff', `${caster.name} applies ${a.abilityKey} to ${creature.name}.`, {
            characterId: caster.id,
            creatureId: creature.id,
          });
          continue;
        }

        if (a.mechanic === 'dot_debuff') {
          const chance = Math.max(0, Math.min(100, a.statusChancePct)) / 100;
          const landed =
            chance >= 1 ||
            rng.sample('status_chance', a.id, creature.id) < chance;
          if (!landed) {
            emit('debuff_miss', `${a.abilityKey} fails to take hold on ${creature.name}.`, {
              characterId: caster.id,
              creatureId: creature.id,
            });
            continue;
          }
          const weaponPart = a.weaponBased
            ? seededWeaponAbilityDamage({ rng, attacker: caster, progression, key })
            : 0;
          const perTick = Math.max(1, Math.floor(a.amount + weaponPart));
          effectUpserts.push({
            targetKind: 'creature',
            targetId: creature.id,
            effectType: a.statusKey ?? a.abilityKey,
            stacks: 1,
            amountPerTick: perTick,
            expiresAtMs: nowMs + Math.max(tickRate, a.durationMs),
            intervalMs: a.intervalMs > 0 ? a.intervalMs : tickRate,
            nextTickAtMs: nowMs + Math.max(0, a.intervalMs > 0 ? a.intervalMs : tickRate),
            damageType: a.damageType,
            sourceCharacterId: caster.id,
            mechanic: 'dot_debuff',
            abilityKey: a.abilityKey,
            maxStacks: a.maxStacks,
            params: {
              maxStacks: Math.max(1, Math.floor(a.maxStacks)),
              ...(a.damageType ? { damageType: a.damageType } : {}),
            },
            paramsVersion: EFFECT_PARAMS_VERSION,
          });
          emit(
            'debuff',
            `${caster.name} applies ${a.statusKey ?? a.abilityKey} to ${creature.name} [${perTick}/tick].`,
            { characterId: caster.id, creatureId: creature.id, amount: perTick },
          );
          continue;
        }

        // weapon_attack / spell_attack — direct damage.
        const attack = seededAttackRoll({
          rng,
          attacker: caster,
          creatureId: creature.id,
          creatureAC: creature.ac,
          progression,
          key: ['ability', a.id],
          rollStream: 'ability_roll',
          damageStream: 'ability_damage',
        });
        if (!attack.hit) {
          emit('ability_miss', `${caster.name}'s ${a.abilityKey} misses ${creature.name}.`, {
            characterId: caster.id,
            creatureId: creature.id,
            ...presentAbility(caster, creature, a.abilityKey),
          });
          continue;
        }
        const weaponPart = a.weaponBased
          ? seededWeaponAbilityDamage({ rng, attacker: caster, progression, key })
          : 0;
        let dmg = Math.max(1, Math.floor(a.amount + weaponPart));
        if (a.mechanic === 'weapon_attack') dmg += attack.baseDamage;
        const amp = ampPctFor(creature.id, nowMs);
        if (amp > 0) dmg = Math.floor(dmg * (ampBase + amp / 100));
        const applied = damageCreature(creature, dmg, caster.id, 'ability', nowMs);
        emit(
          attack.isCrit ? 'ability_crit' : 'ability_hit',
          `${caster.name} hits ${creature.name} with ${a.abilityKey} for ${applied}.`,
          {
            characterId: caster.id,
            creatureId: creature.id,
            amount: applied,
            damageType: a.damageType,
            ...presentAbility(caster, creature, a.abilityKey, attack.isCrit),
          },
        );
      }
    }

    // 3. Autoattacks — participants in stable order, each on their target.
    //    Live only: an offscreen sweep may never swing a weapon.
    if (!effectsOnly) for (const p of participants) {
      if (!isAliveP(p.id) || !isPresent(p.id)) continue;
      const creature = targetOf(p.id);
      if (!creature) continue;
      const attack = seededAttackRoll({
        rng,
        attacker: p,
        creatureId: creature.id,
        creatureAC: creature.ac,
        progression,
        key: [t],
      });
      if (!attack.hit) {
        emit('autoattack_miss', `${p.name} misses ${creature.name}.`, {
          characterId: p.id,
          creatureId: creature.id,
          ...presentPlayer(p, creature),
        });
        continue;
      }
      let dmg = attack.baseDamage;
      // Stealth is a pure damage multiplier on a landed hit (never a to-hit
      // modifier) and is spent by that hit. Disengage's one-shot window
      // multiplies last, same as legacy.
      const stealthMult = hasStealth(p) ? stealthMultOf(p) : 1;
      if (stealthMult > 1) dmg = Math.max(1, Math.floor(dmg * stealthMult));
      if (p.buffs.damageBuff) dmg = Math.floor(dmg * 1.5);
      const nextHit = nextHitMultOf(p);
      if (nextHit > 0) dmg = Math.floor(dmg * (1 + nextHit));
      const amp = ampPctFor(creature.id, nowMs);
      if (amp > 0) dmg = Math.floor(dmg * (1 + amp / 100));
      const applied = damageCreature(creature, Math.max(1, dmg), p.id, 'autoattack', nowMs);
      if (stealthMult > 1) {
        spendBuff(p.id, 'stealth');
        emit('buff_consumed', `${p.name}'s ambush deals x${stealthMult.toFixed(2)} damage.`, {
          characterId: p.id,
          amount: applied,
        });
      }
      if (nextHit > 0) spendBuff(p.id, 'disengage');
      w.hitters.add(p.id);
      engagementsJoin.push({
        creatureId: creature.id,
        characterId: p.id,
        lastActionAtMs: nowMs,
      });
      emit(
        attack.isCrit ? 'autoattack_crit' : 'autoattack_hit',
        `${p.name} hits ${creature.name} for ${applied}.`,
        {
          characterId: p.id,
          creatureId: creature.id,
          amount: applied,
          ...presentPlayer(p, creature, attack.isCrit),
        },
      );
      // Weapon-hit stack appliers (Envenom) proc off this landed hit.
      runStackAppliers(p, creature, 'weapon_hit', nowMs, t);

      // 3b. Procs — weighted pick then chance gate, both seeded.
      const owned = procs.filter((pr) => pr.characterId === p.id);
      if (owned.length > 0 && isAliveC(creature.id)) {
        const pick = rng.weighted('proc_select', owned, (pr) => pr.weight, p.id, creature.id, t);
        if (pick && rng.sample('proc_chance', pick.id, creature.id, t) < pick.chance) {
          if (pick.kind === 'heal_pulse' || pick.kind === 'lifesteal') {
            const healed = healCharacter(p, Math.max(1, Math.floor(pick.amount)));
            emit('proc_heal', `${pick.label} restores ${healed} HP to ${p.name}.`, {
              characterId: p.id,
              amount: healed,
            });
          } else if (pick.kind === 'weaken') {
            effectUpserts.push({
              targetKind: 'creature',
              targetId: creature.id,
              effectType: 'weaken',
              stacks: 1,
              amountPerTick: 0,
              expiresAtMs: nowMs + tickRate * 5,
              intervalMs: 0,
              // Non-periodic: due time sits past its own expiry so it can
              // never be treated as a pending tick.
              nextTickAtMs: nowMs + tickRate * 5,
              damageType: null,
              sourceCharacterId: p.id,
            });
            emit('proc_debuff', `${pick.label} weakens ${creature.name}.`, {
              characterId: p.id,
              creatureId: creature.id,
            });
          } else {
            const applied2 = damageCreature(
              creature,
              Math.max(1, Math.floor(pick.amount)),
              p.id,
              'proc',
              nowMs,
            );
            emit('proc_damage', `${pick.label} burns ${creature.name} for ${applied2}.`, {
              characterId: p.id,
              creatureId: creature.id,
              amount: applied2,
              damageType: pick.damageType,
            });
          }
        }
      }
    }

    // 3c. Pulse stack appliers (Orbs of Fire) — a heartbeat trigger, not a
    //     weapon trigger: it fires once per tick per engaged target whether or
    //     not the swing landed, and never in an offscreen sweep.
    if (!effectsOnly) for (const p of participants) {
      if (!isAliveP(p.id) || !isPresent(p.id)) continue;
      const pulsers = p.buffs.stackAppliers;
      if (!pulsers || !pulsers.some((ap) => ap.trigger === 'successful_pulse_hit')) continue;
      const creature = targetOf(p.id);
      if (!creature || !isAliveC(creature.id)) continue;
      runStackAppliers(p, creature, 'successful_pulse_hit', nowMs, t);
    }


    // 4. Boss casts — resolve in-flight channels first, then start new ones.
    //
    // A cast is a two-sided contract: it is telegraphed on one tick and lands
    // on a later one. The authored contract is frozen when the channel begins
    // and read back from the in-flight cast, never re-read from the creature,
    // so a configuration edit mid-channel cannot retune a live telegraph.
    const pausedByCast = new Set<string>();

    for (const [creatureId, cast] of sortBy([...w.activeCasts.entries()], ([id]) => id)) {
      const creature = byCreature.get(creatureId);
      const gone = !creature || !isAliveC(creatureId);
      const pool = w.storedPower.get(creatureId) ?? 0;
      const basePool = creature?.storedPower ?? 0;

      // Caster gone (killed during the channel, or detached from the
      // encounter): the cast is cancelled. Killing the boss in time is the
      // counterplay, so no damage lands. Stored Power follows the fizzle rule.
      if (gone) {
        const keep = cast.consumeMode === 'preserve' || cast.consumeMode === 'ignore';
        const remaining = keep ? pool : 0;
        w.storedPower.set(creatureId, remaining);
        if (remaining !== basePool) {
          storedPowerMut.set(creatureId, {
            creatureId,
            delta: remaining - basePool,
            cap: cast.storedPowerCap,
          });
        }
        w.activeCasts.delete(creatureId);
        casts.push({
          creatureId,
          abilityKey: cast.abilityKey,
          castKey: cast.castKey,
          phase: 'fizzle',
          castEventId: cast.castEventId,
          resolvesAtMs: cast.resolvesAtMs,
          targetCharacterId: cast.targetCharacterId,
          damage: 0,
          aoeDamage: 0,
          damageType: cast.damageType,
          text: null,
          storedPowerConsumed: 0,
          lockMs: 0,
          targets: [],
          config: cast,
        });
        emit('boss_cast_fizzle', `${cast.label} collapses unfinished.`, {
          creatureId,
        });
        continue;
      }

      // Still channeling: bank the paused autoattack as Stored Power. Banking
      // is derived from a creature autoattack, so effects-only carries the
      // channel forward without banking anything.
      if (nowMs < cast.resolvesAtMs) {
        if (cast.pauseAutoattacks) pausedByCast.add(creatureId);
        if (effectsOnly) continue;
        const cap = cast.storedPowerCap;
        const primary = cast.targetCharacterId
          ? byParticipant.get(cast.targetCharacterId)
          : undefined;
        const banked = primary && isAliveP(primary.id)
          ? expectedPausedAutoattack(creature, primary, t)
          : 0;
        if (banked > 0) {
          const next = cap > 0 ? Math.min(cap, pool + banked) : pool + banked;
          if (next !== pool) {
            w.storedPower.set(creatureId, next);
            storedPowerMut.set(creatureId, {
              creatureId,
              delta: next - basePool,
              cap,
            });
            emit('boss_cast_channel', `${cast.label} gathers force [${next}].`, {
              creatureId,
              characterId: cast.targetCharacterId,
              amount: next,
            });
          }
        }
        continue;
      }

      // Due: release. Stored Power is consumed before target selection, so a
      // party that fled still drains the pool (legacy rule).
      let used = 0;
      let remaining = pool;
      switch (cast.consumeMode) {
        case 'all':
          used = pool;
          remaining = 0;
          break;
        case 'percent':
          used = Math.max(0, Math.min(pool, Math.round((pool * cast.consumePct) / 100)));
          remaining = pool - used;
          break;
        case 'fixed':
          used = Math.min(pool, Math.max(0, cast.consumeFixed));
          remaining = pool - used;
          break;
        case 'preserve':
          used = pool;
          remaining = pool;
          break;
        case 'reset':
          used = 0;
          remaining = 0;
          break;
        default:
          used = 0;
          remaining = pool;
          break;
      }
      w.storedPower.set(creatureId, remaining);
      if (remaining !== basePool) {
        storedPowerMut.set(creatureId, {
          creatureId,
          delta: remaining - basePool,
          cap: cast.storedPowerCap,
        });
      }
      w.activeCasts.delete(creatureId);

      const primaryDamage = Math.max(0, cast.baseDamage + Math.floor(used * cast.primaryShare));
      const aoeDamage = Math.max(0, cast.baseAoeDamage + Math.floor(used * cast.aoeShare));

      // Eligibility: alive, and already present when the channel began.
      // Leaving the node purges the participant row, so anyone who fled and
      // walked back in re-joined later and is not caught by this cast.
      const eligible = participants.filter(
        (p) => isAliveP(p.id) && isPresent(p.id) && p.joinedAtMs <= cast.startedAtMs,
      );

      const targets: CastTargetProposal[] = [];
      for (const p of eligible) {
        const isPrimary = p.id === cast.targetCharacterId;
        const amount = isPrimary ? primaryDamage : aoeDamage;
        if (amount <= 0) continue;
        const applied = damageCharacter(p, amount, creatureId, nowMs);
        targets.push({ characterId: p.id, damage: amount, applied, isPrimary });
        emit(
          'boss_cast_hit',
          cast.castedText ?? `${cast.label} strikes ${p.name} for ${applied}.`,
          {
            characterId: p.id,
            creatureId,
            amount: applied,
            damageType: cast.damageType,
          },
        );
      }
      if (targets.length === 0) {
        emit('boss_cast_evaded', `${cast.label} lands on empty ground.`, { creatureId });
      }

      casts.push({
        creatureId,
        abilityKey: cast.abilityKey,
        castKey: cast.castKey,
        phase: 'resolve',
        castEventId: cast.castEventId,
        resolvesAtMs: cast.resolvesAtMs,
        targetCharacterId: cast.targetCharacterId,
        damage: primaryDamage,
        aoeDamage,
        damageType: cast.damageType,
        text: cast.castedText,
        storedPowerConsumed: used,
        lockMs: targets.length > 0 ? cast.lockMs : 0,
        targets,
        config: cast,
      });
    }

    // New telegraphs are live-only: catch-up may close an already-started cast
    // but must never begin one.
    if (!effectsOnly) for (const c of creatures) {
      if (!isAliveC(c.id) || !c.bossCast) continue;
      if (w.activeCasts.has(c.id)) continue;
      const cast = c.bossCast;
      const cooldown = w.castCooldown.get(c.id) ?? 0;
      if (cooldown > 0) {
        w.castCooldown.set(c.id, cooldown - 1);
        continue;
      }
      const pool = engagedWith(c.id).filter((p) => isAliveP(p.id) && isPresent(p.id));
      let target: ParticipantSnapshot | null = null;
      if (pool.length > 0) {
        const tankPool = orderTankPool(pool.filter((p) => p.isTank));
        if (cast.targetMode === 'tank_strict' || cast.targetMode === 'tank_preferred') {
          target = rng.pick('tank_pool', tankPool, c.id, t) ?? null;
          if (!target && cast.targetMode === 'tank_preferred') {
            target = rng.pick('creature_target', pool, c.id, t) ?? null;
          }
        } else {
          target = rng.pick('creature_target', pool, c.id, t) ?? null;
        }
      }
      if (!target) {
        // Nothing to telegraph at. No cast row is created, so no orphan
        // channel can be left behind for the next tick to resolve.
        continue;
      }

      const resolvesAtMs = nowMs + Math.max(1, cast.castTicks) * tickRate;
      const frozen: ActiveCastSnapshot = {
        // The committer creates the row and stamps the real id. Within this
        // call the deterministic placeholder keeps multi-tick catch-up
        // resolution addressable.
        castEventId: `pending:${c.id}:${snapshot.tickNumber}:${t}`,
        creatureId: c.id,
        abilityKey: cast.abilityKey,
        castKey: cast.castKey,
        label: cast.label,
        startedAtMs: nowMs,
        resolvesAtMs,
        targetCharacterId: target.id,
        baseDamage: cast.damage,
        baseAoeDamage: cast.damageAoe,
        damageType: cast.damageType,
        primaryShare: cast.primaryShare,
        aoeShare: cast.aoeShare,
        consumeMode: cast.consumeMode,
        consumePct: cast.consumePct,
        consumeFixed: cast.consumeFixed,
        pauseAutoattacks: cast.channeling && cast.pauseAutoattacks,
        storedPowerCap: cast.storedPowerCap || c.storedPowerCap,
        lockMs: cast.lockMs,
        castedText: cast.castedText,
      };
      w.activeCasts.set(c.id, frozen);
      if (frozen.pauseAutoattacks) pausedByCast.add(c.id);

      casts.push({
        creatureId: c.id,
        abilityKey: cast.abilityKey,
        castKey: cast.castKey,
        phase: 'start',
        castEventId: null,
        resolvesAtMs,
        targetCharacterId: target.id,
        damage: cast.damage,
        aoeDamage: cast.damageAoe,
        damageType: cast.damageType,
        text: cast.castingText,
        storedPowerConsumed: 0,
        lockMs: cast.lockMs,
        targets: [],
        config: frozen,
      });
      w.castCooldown.set(c.id, Math.max(1, cast.cooldownTicks));
      emit(
        'boss_cast_start',
        cast.castingText ?? `${c.name} begins ${cast.label}.`,
        { creatureId: c.id, characterId: target.id },
      );
    }


    // 5. Creature counterattacks — stable creature order, seeded targeting.
    //    Live only.
    if (!effectsOnly) for (const c of creatures) {
      if (!isAliveC(c.id)) continue;
      // A channeling boss banks its autoattack instead of swinging it.
      if (pausedByCast.has(c.id)) continue;
      const pool = engagedWith(c.id).filter((p) => isAliveP(p.id) && isPresent(p.id));
      if (pool.length === 0) continue;
      const tankPool = orderTankPool(pool.filter((p) => p.isTank));
      const target =
        rng.pick('tank_pool', tankPool, c.id, t) ??
        rng.pick('creature_target', pool, c.id, t);
      if (!target) continue;
      // Defensive state acquired earlier in this same tick is visible here.
      const defender = withBuffs(target);

      if (seededDodge({ rng, defender, creatureId: c.id, key: [t] })) {
        emit('dodge', `${target.name} dodges ${c.name}.`, {
          characterId: target.id,
          creatureId: c.id,
          ...presentCreature(c, target),
        });

        continue;
      }
      const atk = seededCreatureAttack({
        rng,
        creatureId: c.id,
        creatureLevel: c.level,
        defender,
        key: [t],
      });
      if (atk.quality === 'miss') {
        emit('creature_miss', `${c.name} misses ${target.name}.`, {
          characterId: target.id,
          creatureId: c.id,
          ...presentCreature(c, target),
        });
        continue;
      }
      const raw = seededCreatureDamage({
        rng,
        creatureId: c.id,
        creatureLevel: c.level,
        creatureRarity: c.rarity,
        creatureAttrs: c.attrs,
        targetId: target.id,
        targetLevel: target.level,
        key: [t],
      });
      const attempted = scaleCreatureDamage(raw, atk.quality, atk.isCrit, atk.margin);
      let dmg = attempted;
      // One swing = one correlation group. `creatureSwing` increments per swing,
      // so two blows from the same creature on the same character in the same
      // tick never share a group.
      const groupId = `swing|${t}|${c.id}|${target.id}|${creatureSwing++}`;
      const block = seededBlock({ rng, defender, creatureId: c.id, key: [t] });
      let mitigated = 0;
      if (block.blocked) {
        mitigated = Math.min(attempted, Math.max(0, block.amount));
        dmg = Math.max(0, dmg - block.amount);
      }
      const applied = damageCharacter(target, dmg, c.id, nowMs);
      if (block.blocked) {
        emit('block', `${target.name} blocks ${c.name}'s blow. [${block.amount}]`, {
          characterId: target.id,
          creatureId: c.id,
          amount: block.amount,
          ...presentCreature(c, target),
          groupId,
          attemptedAmount: attempted,
          mitigatedAmount: mitigated,
          appliedAmount: applied,
          mitigationSource: 'block',
        });
      }
      emit(
        atk.isCrit ? 'creature_crit' : 'creature_hit',
        `${c.name} hits ${target.name} for ${applied}.`,
        {
          characterId: target.id,
          creatureId: c.id,
          amount: applied,
          ...presentCreature(c, target, atk.isCrit),
          ...(atk.isCrit ? bossCritFlavor(c, t) : {}),
          groupId,
          attemptedAmount: attempted,
          mitigatedAmount: mitigated,
          appliedAmount: applied,
        },
      );


      // ── reactive_holy (Holy Shield) ──────────────────────────────
      // Fires after a landed hit (even a partially blocked one), never on a
      // miss or a dodge, at most once per (defender, attacker) per tick, and
      // with no chance roll. Retaliation damage is never amplified by the
      // defender's own incoming-damage modifiers, and a retaliation kill is
      // credited to the defender.
      const ward = reactiveHolyOf(target);
      if (ward && isAliveC(c.id)) {
        const guardKey = `${t}|${target.id}|${c.id}`;
        if (!holyShieldSeen.has(guardKey)) {
          holyShieldSeen.add(guardKey);
          const returned = damageCreature(c, ward.damage, target.id, 'stance', nowMs);
          if (returned > 0) {
            emit('holy_shield_return', `${target.name}'s ward burns ${c.name} for ${returned}.`, {
              characterId: target.id,
              creatureId: c.id,
              amount: returned,
              damageType: ward.damageType,
            });
          }
        }
      }
    }
  }

  // ── durability: one slot per participant that landed a hit ───────
  //    Live only: effects-only lands no weapon hits and degrades nothing.
  if (!effectsOnly) for (const p of participants) {
    if (!w.hitters.has(p.id)) continue;
    const slots = [...p.weapon.equippedInventoryIds].sort();
    if (slots.length === 0) continue;
    const invId = rng.pick('durability_slot', slots, p.id);
    if (invId) durability.push({ characterId: p.id, inventoryId: invId });
  }

  // ── periodic effect schedules: persist the advanced next due time ──
  // Cadence is the ONLY thing this stage owns. When an authoritative stage
  // already proposed this effect identity in the same tick (a stack landed, a
  // duration refreshed), that proposal is amended in place so its semantic
  // values survive; a second full snapshot row would win the later identity
  // merge and silently regress stacks and expiry. When nothing proposed the
  // identity, a complete row is materialized from the snapshot so the commit
  // never receives a partial upsert.
  for (const e of effects) {
    const advanced = effectNextDue.get(e.id);
    if (advanced === undefined || effectDeleteIds.has(e.id)) continue;
    const identity = effectIdentity(e);
    const pendingAt = (() => {
      for (let i = effectUpserts.length - 1; i >= 0; i -= 1) {
        if (effectIdentity(effectUpserts[i]) === identity) return i;
      }
      return -1;
    })();
    if (pendingAt >= 0) {
      effectUpserts[pendingAt] = { ...effectUpserts[pendingAt], nextTickAtMs: advanced };
      continue;
    }
    effectUpserts.push({
      lifetime: e.lifetime,
      targetKind: e.targetKind,
      targetId: e.targetId,
      effectType: e.effectType,
      stacks: e.stacks,
      amountPerTick: e.amountPerTick,
      expiresAtMs: e.expiresAtMs,
      intervalMs: e.intervalMs,
      nextTickAtMs: advanced,
      damageType: e.damageType,
      sourceCharacterId: e.sourceCharacterId,
      // The semantic payload travels with every rewrite: `remaining` is the
      // only field the committer is allowed to change, so re-sending the row
      // without it would silently erase the pool/charge state.
      mechanic: e.mechanic ?? null,
      abilityKey: e.abilityKey,
      magnitude: e.magnitude,
      remaining: e.remaining ?? null,
      params: e.params,
      paramsVersion: e.paramsVersion,
    });
  }


  // ── absorb pools: commit the unspent shield HP for the next tick ───
  // The pool lives ONLY here. Reservation bookkeeping never stores it.
  for (const e of effects) {
    if (e.mechanic !== 'absorb_buff' || effectDeleteIds.has(e.id)) continue;
    const left = Math.max(0, Math.floor(w.shield.get(e.targetId) ?? 0));
    if (left === Math.floor(e.remaining ?? e.magnitude ?? 0) && left > 0) continue;
    if (left <= 0 && !isStance(e)) {
      // Fully consumed: the row is removed exactly once.
      effectDeleteIds.add(e.id);
      continue;
    }
    effectUpserts.push({
      // A stance-backed shield survives an emptied pool: the reservation, not
      // the pool, owns the row's existence.
      lifetime: e.lifetime,
      targetKind: 'character',
      targetId: e.targetId,
      effectType: e.effectType,
      stacks: e.stacks,
      amountPerTick: 0,
      expiresAtMs: e.expiresAtMs,
      intervalMs: e.intervalMs,
      nextTickAtMs: e.nextTickAtMs,
      damageType: null,
      sourceCharacterId: e.sourceCharacterId,
      mechanic: 'absorb_buff',
      abilityKey: e.abilityKey,
      magnitude: e.magnitude,
      remaining: left,
      params: e.params,
      paramsVersion: e.paramsVersion,
    });
  }

  // ── one-shot charges: a spent charge is spent for good ─────────────
  // `consumedBuffs` is the client's narration of the spend; the ROW is what the
  // next tick rehydrates from. Without this stage a single-charge ambush or
  // Disengage window would come back on every following tick.
  for (const spent of consumedBuffs) {
    for (const e of effects) {
      if (e.targetKind !== 'character' || e.targetId !== spent.characterId) continue;
      const isCharge =
        (spent.buff === 'stealth' && e.mechanic === 'stealth_buff') ||
        (spent.buff === 'disengage' &&
          e.mechanic === 'evasion_buff' &&
          e.params?.kind === 'next_hit');
      if (!isCharge) continue;
      effectDeleteIds.add(e.id);
    }
    // A charge granted and spent inside the same tick must not be written at all.
    for (let i = effectUpserts.length - 1; i >= 0; i--) {
      const u = effectUpserts[i];
      if (u.targetKind !== 'character' || u.targetId !== spent.characterId) continue;
      const isCharge =
        (spent.buff === 'stealth' && u.mechanic === 'stealth_buff') ||
        (spent.buff === 'disengage' &&
          u.mechanic === 'evasion_buff' &&
          (u.params as Record<string, unknown> | undefined)?.kind === 'next_hit');
      if (isCharge) effectUpserts.splice(i, 1);
    }
  }



  // ── progression: one level-up per tick, derived from the snapshot ──
  // Only the configured formulas are used; no character column is patched
  // outside the named fields of ProgressionMutation.
  const progressionMut: ProgressionMutation[] = [];
  const xpByCharacter = new Map<string, number>();
  for (const r of rewards) {
    xpByCharacter.set(r.characterId, (xpByCharacter.get(r.characterId) ?? 0) + r.xp);
  }
  for (const p of participants) {
    const gained = xpByCharacter.get(p.id) ?? 0;
    if (gained <= 0) continue;
    const eb = p.equipmentBonuses;
    const needed = getXpForLevel(p.level);
    let level = p.level;
    let xp = p.xp + gained;
    let attributeDeltas: Record<string, number> = {};
    let unspentStatPointsDelta = 0;
    let respecPointsDelta = 0;

    if (xp >= needed && p.level < 42) {
      level = p.level + 1;
      xp -= needed;
      unspentStatPointsDelta = 1;
      if (level % 3 === 0) attributeDeltas = { ...getClassLevelBonuses(p.classKey) };
      if (level === 10 || level === 20 || level === 30 || level === 40) respecPointsDelta = 1;
    }
    if (level >= 42) xp = 0;

    const levelled = level !== p.level;
    if (!levelled && xp === p.xp + gained && !(level >= 42)) continue;

    const attrWith = (key: keyof Attributes) =>
      p.attrs[key] + (attributeDeltas[key] ?? 0);
    const maxHp = levelled
      ? getEffectiveMaxHp(p.classKey, attrWith('con'), level, eb as Record<string, number>)
      : p.maxHp;
    const maxCp = levelled
      ? getEffectiveMaxCp(level, attrWith('wis'), eb as Record<string, number>)
      : p.maxCp;
    const maxMp = levelled
      ? getEffectiveMaxMp(level, attrWith('dex'), eb as Record<string, number>)
      : p.maxMp;

    progressionMut.push({
      characterId: p.id,
      levelBefore: p.level,
      levelAfter: level,
      xpAfter: xp,
      maxHpAfter: maxHp,
      maxCpAfter: maxCp,
      maxMpAfter: maxMp,
      // A level-up refills HP (legacy rule); CP/MP keep their live values,
      // clamped to the recalculated maxima.
      hpAfter: levelled ? maxHp : Math.min(w.hp.get(p.id) ?? p.hp, maxHp),
      cpAfter: Math.min(w.cp.get(p.id) ?? p.cp, maxCp),
      mpAfter: Math.min(p.mp, maxMp),
      attributeDeltas,
      unspentStatPointsDelta,
      respecPointsDelta,
    });
    if (levelled) {
      emit('level_up', `Level Up! ${p.name} is now level ${level}!`, { characterId: p.id });
      emit('stat_point', `${p.name} gained 1 stat point to allocate.`, { characterId: p.id });
      if (Object.keys(attributeDeltas).length > 0) {
        const names = Object.entries(attributeDeltas)
          .map(([k, v]) => `+${v} ${k.toUpperCase()}`)
          .join(', ');
        emit('level_bonus', `Class bonus: ${names}.`, { characterId: p.id });
      }
      if (respecPointsDelta > 0) {
        emit('respec', `${p.name} earned a respec point.`, { characterId: p.id });
      }
    }
  }

  // A creature that died this tick has its effects purged on commit, so an
  // upsert applied earlier in the same tick would be immediately erased. Drop
  // those proposals here so the committer never sees a contradictory pair.
  const liveEffectUpserts = effectUpserts.filter(
    (e) => !(e.targetKind === 'creature' && purgeCreatureIds.has(e.targetId)),
  );

  // One tick may touch the same effect twice (a stack lands and its writeback
  // rescheduled cadence, an absorb pool is refreshed and then spent). The
  // committer upserts on (source_id, target_id, effect_type), and Postgres
  // refuses a statement that hits the same conflict row twice, so the last
  // proposal for an identity wins here and the commit sees exactly one row.
  // Rows written for a switched-on stance are reservation-backed persistent
  // state, never a timed buff. Marking them here — once, by identity — keeps
  // every mechanic branch above free of stance special-casing.
  const stanceMarked: EffectUpsert[] = liveEffectUpserts.map((up) =>
    up.targetKind === 'character' && stanceByRow.has(stanceRowKey(up.targetId, up.abilityKey ?? ''))
      ? { ...up, lifetime: 'stance' as const }
      : up,
  );

  const mergedEffectUpserts: EffectUpsert[] = [];
  const upsertIndexByIdentity = new Map<string, number>();
  for (const up of stanceMarked) {
    const key = effectIdentity(up);
    const at = upsertIndexByIdentity.get(key);
    if (at === undefined) {
      upsertIndexByIdentity.set(key, mergedEffectUpserts.length);
      mergedEffectUpserts.push(up);
      continue;
    }
    // Identity fields are equal by construction; later mutable values win, and
    // a field the later proposal leaves unset keeps the earlier value so no
    // semantic column is blanked.
    const prev = mergedEffectUpserts[at];
    mergedEffectUpserts[at] = {
      ...prev,
      ...Object.fromEntries(Object.entries(up).filter(([, v]) => v !== undefined)),
    } as EffectUpsert;
  }


  // ── assemble ProposedTick (every array in a stable order) ────────
  const characterMutations: CharacterMutation[] = participants.map((p) => ({
    characterId: p.id,
    hpBefore: p.hp,
    hpAfter: w.hp.get(p.id) ?? p.hp,
    cpBefore: p.cp,
    cpAfter: w.cp.get(p.id) ?? p.cp,
    absorbShieldAfter: w.shield.get(p.id) ?? p.buffs.absorbShield,
    died: p.hp > 0 && (w.hp.get(p.id) ?? p.hp) <= 0,
  }));

  const creatureMutations: CreatureMutation[] = creatures.map((c) => {
    const src = w.cLastSource.get(c.id) ?? null;
    return {
      creatureId: c.id,
      hpBefore: c.hp,
      hpAfter: w.cHp.get(c.id) ?? c.hp,
      killed: w.cKilled.has(c.id),
      lastSourceCharacterId: src?.characterId ?? null,
      lastSourceKind: src?.kind ?? null,
    };
  });

  const allEnded =
    creatures.length > 0 && creatures.every((c) => w.cKilled.has(c.id) || c.hp <= 0);

  return {
    encounterId: snapshot.encounterId,
    tickNumber: snapshot.tickNumber,
    mode: snapshot.mode,
    ticksProcessed: ticks,
    resolvedAtMs: snapshot.nowMs + ticks * tickRate,
    rngDraws: rng.draws,
    characters: sortBy(characterMutations, (r) => r.characterId),
    creatures: sortBy(creatureMutations, (r) => r.creatureId),
    effectUpserts: sortBy(
      mergedEffectUpserts,
      (r) => `${r.targetKind}:${r.targetId}`,
      (r) => r.effectType,
    ),
    effectDeleteIds: sortIds([...effectDeleteIds]),
    effectDeleteTargetIds: sortIds([...effectDeleteTargetIds]),
    engagementsJoin: dedupeEngagements(engagementsJoin),
    engagementsPurgeCreatureIds: sortIds([...purgeCreatureIds]),
    casts: sortBy(casts, (r) => r.creatureId, (r) => r.abilityKey),
    storedPower: sortBy([...storedPowerMut.values()], (r) => r.creatureId),
    durability: sortBy(durability, (r) => r.characterId, (r) => r.inventoryId),
    kills: sortBy(kills, (r) => r.creatureId),
    rewards: sortBy(rewards, (r) => r.characterId, (r) => r.creatureId),
    progression: sortBy(progressionMut, (r) => r.characterId),
    loot: sortBy(loot, (r) => r.creatureId, (r) => r.itemId ?? r.mode),
    materials: sortBy(materials, (r) => r.characterId, (r) => r.materialKey),
    gems: sortBy(gems, (r) => r.characterId, (r) => r.gemKey),
    bonds: sortBy(bonds, (r) => r.characterId),
    // Synthetic stance intents are internal: they are neither acknowledged nor
    // rejected as client actions, because no client ever queued them.
    consumedActionIds: sortIds(consumedActionIds.filter((id) => !stanceActionIds.has(id))),
    consumedBuffs: sortBy(consumedBuffs, (c) => `${c.characterId}|${c.buff}`),
    rejectedActions: sortBy(
      rejectedActions.filter((r) => !stanceActionIds.has(r.actionId)),
      (r) => r.actionId,
    ),
    session: {
      ended: allEnded,
      nextDueAtMs: snapshot.nowMs + ticks * tickRate,
    },
    events,
  };
}

/** Latest join per (creature, character), stable order. */
function dedupeEngagements(rows: EngagementSnapshot[]): EngagementSnapshot[] {
  const map = new Map<string, EngagementSnapshot>();
  for (const r of rows) {
    const key = `${r.creatureId}:${r.characterId}`;
    const prev = map.get(key);
    if (!prev || r.lastActionAtMs > prev.lastActionAtMs) map.set(key, r);
  }
  return orderEngagements([...map.values()]);
}

/** Re-exported so callers do not import the impure formula module directly. */
export { getStatModifier };

/**
 * The set of mechanics this resolver actually branches on. The C3a
 * machine-check compares this against the live active configuration, so a
 * mechanic may only be listed once its branch exists above.
 */
export const RESOLVED_MECHANICS: ReadonlySet<ResolverMechanic> = new Set<ResolverMechanic>([
  'weapon_attack',
  'spell_attack',
  'multi_attack',
  'burst_damage',
  'stack_consume',
  'heal',
  'hp_transfer',
  'party_regen',
  'absorb_buff',
  'mitigation_buff',
  'offense_buff',
  'stealth_buff',
  'block_buff',
  'evasion_buff',
  'regen_buff',
  'reactive_holy',
  'aura_pulse',
  'stack_apply',
  'control_debuff',
  'dot_debuff',
]);
