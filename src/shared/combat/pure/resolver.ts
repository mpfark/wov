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
 * Live vs catch-up: `snapshot.mode` is carried through the input and output so
 * the committer and the log can tell them apart, and it is the *only* thing
 * that differs — both modes run the identical simulation over the identical
 * ordering with the identical seeds, and neither mode carries its own
 * ownership semantics. Ownership belongs to the encounter claim alone.
 */

import { getStatModifier } from '../../formulas/stats';
import { DEFAULT_WEAPON_PROGRESSION } from '../../formulas/combat';
import { getCreatureXp, getXpPenalty } from '../../formulas/xp';
import { getChaGoldMultiplier } from '../../formulas/economy';
import { bondGainForKill } from '../../formulas/bond';
import { PRIMARY_GEM_KEYS } from '../../formulas/gems';
import { resolveDamage, resolveHeal, absorbFromShield } from '../resolution';
import { getPartyXpBonus } from './party-xp';
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
  BondProposal,
  CastMutation,
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
  ParticipantSnapshot,
  PresentationEvent,
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
  hitters: Set<string>;
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
    hitters: new Set<string>(),
  };

  const events: PresentationEvent[] = [];
  let seq = 0;
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
    });
  };

  const effectUpserts: EffectUpsert[] = [];
  const effectDeleteIds = new Set<string>();
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

  /** Amp percent currently applied to a creature by damage-amp statuses. */
  const ampPctFor = (creatureId: string, nowMs: number): number => {
    let pct = 0;
    for (const e of effects) {
      if (e.targetKind !== 'creature' || e.targetId !== creatureId) continue;
      if (!(e.ampPct > 0)) continue;
      if (e.expiresAtMs <= nowMs) continue;
      pct += e.ampPct;
    }
    return pct;
  };

  /** Characters engaged with a creature, in stable order. */
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
      }
      if (rng.sample('gem_chance', creature.id, r.id) < snapshot.config.gemDropChance) {
        const gemKey = rng.pick('gem_pick', PRIMARY_GEM_KEYS, creature.id, r.id);
        if (gemKey) gems.push({ characterId: r.id, gemKey });
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
        dropChance: creature.dropChance ?? -1,
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

  const healCharacter = (target: ParticipantSnapshot, amount: number): number => {
    const res = resolveHeal({
      amount,
      hp: w.hp.get(target.id) ?? 0,
      maxHp: target.maxHp,
    });
    w.hp.set(target.id, res.hpAfter);
    return res.applied;
  };

  // ── tick loop ───────────────────────────────────────────────────

  for (let t = 0; t < ticks; t++) {
    const nowMs = snapshot.nowMs + t * tickRate;

    // 1. Periodic effects (DoTs / HoTs), stable order.
    for (const e of effects) {
      if (e.expiresAtMs <= nowMs) {
        effectDeleteIds.add(e.id);
        continue;
      }
      if (!e.isPeriodic || !(e.amountPerTick > 0)) continue;
      const interval = e.intervalMs > 0 ? e.intervalMs : tickRate;
      const dueAt = e.lastTickAtMs + interval;
      if (dueAt > nowMs) continue;
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
    if (t === 0) {
      for (const a of actions) {
        const caster = byParticipant.get(a.characterId);
        if (!caster) continue;
        if (!isAliveP(caster.id)) {
          rejectedActions.push({ actionId: a.id, reason: 'caster_dead' });
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
          w.cp.set(caster.id, (w.cp.get(caster.id) ?? 0) - a.cpCost);
          const applied = healCharacter(ally, Math.max(0, Math.floor(a.amount)));
          consumedActionIds.push(a.id);
          emit('heal', `${caster.name} restores ${applied} HP to ${ally.name}.`, {
            characterId: ally.id,
            amount: applied,
          });
          continue;
        }

        if (
          a.mechanic === 'absorb_buff' ||
          a.mechanic === 'mitigation_buff' ||
          a.mechanic === 'offense_buff'
        ) {
          w.cp.set(caster.id, (w.cp.get(caster.id) ?? 0) - a.cpCost);
          consumedActionIds.push(a.id);
          effectUpserts.push({
            targetKind: 'character',
            targetId: a.allyId ?? caster.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: nowMs + Math.max(tickRate, a.durationMs),
            intervalMs: 0,
            lastTickAtMs: nowMs,
            damageType: null,
            sourceCharacterId: caster.id,
          });
          emit('buff', `${caster.name} readies ${a.abilityKey}.`, {
            characterId: caster.id,
          });
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

        if (a.mechanic === 'control_debuff') {
          effectUpserts.push({
            targetKind: 'creature',
            targetId: creature.id,
            effectType: a.abilityKey,
            stacks: 1,
            amountPerTick: 0,
            expiresAtMs: nowMs + Math.max(tickRate, a.durationMs),
            intervalMs: 0,
            lastTickAtMs: nowMs,
            damageType: a.damageType,
            sourceCharacterId: caster.id,
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
            lastTickAtMs: nowMs,
            damageType: a.damageType,
            sourceCharacterId: caster.id,
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
          },
        );
      }
    }

    // 3. Autoattacks — participants in stable order, each on their target.
    for (const p of participants) {
      if (!isAliveP(p.id)) continue;
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
        });
        continue;
      }
      let dmg = attack.baseDamage;
      if (p.buffs.stealth) dmg *= 2;
      if (p.buffs.damageBuff) dmg = Math.floor(dmg * 1.5);
      const amp = ampPctFor(creature.id, nowMs);
      if (amp > 0) dmg = Math.floor(dmg * (1 + amp / 100));
      const applied = damageCreature(creature, Math.max(1, dmg), p.id, 'autoattack', nowMs);
      w.hitters.add(p.id);
      engagementsJoin.push({
        creatureId: creature.id,
        characterId: p.id,
        lastActionAtMs: nowMs,
      });
      emit(
        attack.isCrit ? 'autoattack_crit' : 'autoattack_hit',
        `${p.name} hits ${creature.name} for ${applied}.`,
        { characterId: p.id, creatureId: creature.id, amount: applied },
      );

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
              lastTickAtMs: nowMs,
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

    // 4. Boss casts + Stored Power.
    for (const c of creatures) {
      if (!isAliveC(c.id) || !c.bossCast) continue;
      const cast = c.bossCast;
      const cooldown = w.castCooldown.get(c.id) ?? 0;
      if (cooldown > 0) {
        w.castCooldown.set(c.id, cooldown - 1);
        continue;
      }
      const pool = engagedWith(c.id).filter((p) => isAliveP(p.id));
      if (pool.length === 0) {
        casts.push({
          creatureId: c.id,
          abilityKey: cast.abilityKey,
          phase: 'fizzle',
          resolvesAtMs: nowMs,
          targetCharacterId: null,
          damage: 0,
          damageType: cast.damageType,
          text: cast.castedText,
        });
        continue;
      }
      const tankPool = orderTankPool(pool.filter((p) => p.isTank));
      let target: ParticipantSnapshot | null = null;
      if (cast.targetMode === 'tank_strict' || cast.targetMode === 'tank_preferred') {
        target = rng.pick('tank_pool', tankPool, c.id, t) ?? null;
        if (!target && cast.targetMode === 'tank_preferred') {
          target = rng.pick('creature_target', pool, c.id, t) ?? null;
        }
      } else {
        target = rng.pick('creature_target', pool, c.id, t) ?? null;
      }
      if (!target) {
        casts.push({
          creatureId: c.id,
          abilityKey: cast.abilityKey,
          phase: 'fizzle',
          resolvesAtMs: nowMs,
          targetCharacterId: null,
          damage: 0,
          damageType: cast.damageType,
          text: cast.castedText,
        });
        continue;
      }

      if (cast.channeling) {
        const cap = cast.storedPowerCap || c.storedPowerCap;
        const current = w.storedPower.get(c.id) ?? 0;
        const next = Math.min(cap, current + 1);
        w.storedPower.set(c.id, next);
        storedPowerMut.set(c.id, { creatureId: c.id, delta: next - c.storedPower, cap });
      }

      casts.push({
        creatureId: c.id,
        abilityKey: cast.abilityKey,
        phase: 'start',
        resolvesAtMs: nowMs + Math.max(1, cast.castTicks) * tickRate,
        targetCharacterId: target.id,
        damage: cast.damage + (w.storedPower.get(c.id) ?? 0),
        damageType: cast.damageType,
        text: cast.castingText,
      });
      w.castCooldown.set(c.id, Math.max(1, cast.cooldownTicks));
      emit(
        'boss_cast_start',
        cast.castingText ?? `${c.name} begins ${cast.label}.`,
        { creatureId: c.id, characterId: target.id },
      );
    }

    // 5. Creature counterattacks — stable creature order, seeded targeting.
    for (const c of creatures) {
      if (!isAliveC(c.id)) continue;
      const pool = engagedWith(c.id).filter((p) => isAliveP(p.id));
      if (pool.length === 0) continue;
      const tankPool = orderTankPool(pool.filter((p) => p.isTank));
      const target =
        rng.pick('tank_pool', tankPool, c.id, t) ??
        rng.pick('creature_target', pool, c.id, t);
      if (!target) continue;

      if (seededDodge({ rng, defender: target, creatureId: c.id, key: [t] })) {
        emit('dodge', `${target.name} dodges ${c.name}.`, {
          characterId: target.id,
          creatureId: c.id,
        });
        continue;
      }
      const atk = seededCreatureAttack({
        rng,
        creatureId: c.id,
        creatureLevel: c.level,
        defender: target,
        key: [t],
      });
      if (atk.quality === 'miss') {
        emit('creature_miss', `${c.name} misses ${target.name}.`, {
          characterId: target.id,
          creatureId: c.id,
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
      let dmg = scaleCreatureDamage(raw, atk.quality, atk.isCrit, atk.margin);
      const block = seededBlock({ rng, defender: target, creatureId: c.id, key: [t] });
      if (block.blocked) {
        dmg = Math.max(0, dmg - block.amount);
        emit('block', `${target.name} blocks ${block.amount} of ${c.name}'s blow.`, {
          characterId: target.id,
          creatureId: c.id,
          amount: block.amount,
        });
      }
      const applied = damageCharacter(target, dmg, c.id, nowMs);
      emit(
        atk.isCrit ? 'creature_crit' : 'creature_hit',
        `${c.name} hits ${target.name} for ${applied}.`,
        { characterId: target.id, creatureId: c.id, amount: applied },
      );
    }
  }

  // ── durability: one slot per participant that landed a hit ───────
  for (const p of participants) {
    if (!w.hitters.has(p.id)) continue;
    const slots = [...p.weapon.equippedInventoryIds].sort();
    if (slots.length === 0) continue;
    const invId = rng.pick('durability_slot', slots, p.id);
    if (invId) durability.push({ characterId: p.id, inventoryId: invId });
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
      effectUpserts,
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
    loot: sortBy(loot, (r) => r.creatureId, (r) => r.itemId ?? r.mode),
    materials: sortBy(materials, (r) => r.characterId, (r) => r.materialKey),
    gems: sortBy(gems, (r) => r.characterId, (r) => r.gemKey),
    bonds: sortBy(bonds, (r) => r.characterId),
    consumedActionIds: sortIds(consumedActionIds),
    rejectedActions: sortBy(rejectedActions, (r) => r.actionId),
    session: {
      ended: allEnded,
      lastTickAtMs: snapshot.nowMs + ticks * tickRate,
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
