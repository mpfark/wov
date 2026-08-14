/**
 * c2/payload.ts — builds the exact `_proposed` payload consumed by
 * `public.commit_encounter_tick_v2`.
 *
 * One camelCase key contract, validated and applied by the same names on the
 * SQL side. Anything the commit function does not name is ignored, so no
 * arbitrary JSON can reach a column.
 *
 * The builder is pure: envelope + ProposedTick in, plain JSON out. It performs
 * no clamping — bounds are the resolver's job, and an illegal value must be
 * *rejected* by the commit function rather than quietly normalised here.
 */

import { EFFECT_PARAMS_VERSION } from '../pure/effect-contract.ts';

/** `active_effects` no-expiry sentinel for stance rows (DB contract). */
const STANCE_NO_EXPIRY_MS = 9007199254740991;
import type { ProposedTick } from '../pure/types.ts';

import {
  PROPOSED_TICK_VERSION,
  type SnapshotEnvelope,
  type CharacterDeathProposal,
  type SessionPresenceProposal,
} from './contract.ts';
import { encounterDeathId } from './death-id.ts';
import { deriveCharacterDeaths } from './deaths.ts';

export interface CommitPayload {
  readonly proposedTickVersion: number;
  readonly mode: string;
  readonly [key: string]: unknown;
}

export interface CommitRequest {
  readonly _encounter_id: string;
  readonly _tick: number;
  readonly _claim_token: string;
  readonly _batch_id: string;
  readonly _snapshot_version: number;
  readonly _encounter_version: number;
  readonly _snapshot_scope: SnapshotEnvelope['scope'];
  readonly _snapshot_digest: SnapshotEnvelope['stateDigest'];
  readonly _proposed: CommitPayload;
}

/** Death occurrence id for a creature killed in this tick. */
function deathIdFor(envelope: SnapshotEnvelope, creatureId: string): string {
  return encounterDeathId(
    envelope.encounterId,
    creatureId,
    envelope.spawnSeqByCreatureId[creatureId] ?? 1,
    envelope.tickNumber,
  );
}

function spawnSeqFor(envelope: SnapshotEnvelope, creatureId: string): number {
  return envelope.spawnSeqByCreatureId[creatureId] ?? 1;
}

export function buildCommitPayload(
  envelope: SnapshotEnvelope,
  proposed: ProposedTick,
  session: SessionPresenceProposal,
  deathsOverride?: readonly CharacterDeathProposal[],
): CommitPayload {
  const killByCreature = new Map(proposed.kills.map((k) => [k.creatureId, k]));
  const deaths = deathsOverride ?? deriveCharacterDeaths(proposed);

  // Each durability proposal is one point of wear on that item, matching the
  // legacy per-hit rule. The "after" value is computed from the snapshotted
  // current durability, never read live at commit time.
  const wearCount = new Map<string, number>();
  for (const d of proposed.durability) {
    wearCount.set(d.inventoryId, (wearCount.get(d.inventoryId) ?? 0) + 1);
  }

  return {
    proposedTickVersion: PROPOSED_TICK_VERSION,
    mode: proposed.mode,
    tickNumber: proposed.tickNumber,
    ticksProcessed: proposed.ticksProcessed,
    rngDraws: proposed.rngDraws,

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
      spawnSeq: spawnSeqFor(envelope, c.creatureId),
      hpBefore: c.hpBefore,
      hpAfter: c.hpAfter,
      killed: c.killed,
      creatureName: killByCreature.get(c.creatureId)?.creatureName ?? null,
    })),

    deaths: deaths.map((d) => ({ ...d })),
    kills: proposed.kills.map((k) => ({
      ...k,
      deathId: deathIdFor(envelope, k.creatureId),
      spawnSeq: spawnSeqFor(envelope, k.creatureId),
    })),

    rewards: proposed.rewards.map((r) => ({
      characterId: r.characterId,
      creatureId: r.creatureId,
      spawnSeq: spawnSeqFor(envelope, r.creatureId),
      deathId: deathIdFor(envelope, r.creatureId),
      xp: r.xp,
      gold: r.gold,
      renown: r.renown,
    })),

    materials: proposed.materials.map((m, index) => {
      const creatureId = proposed.kills[0]?.creatureId ?? null;
      return {
        characterId: m.characterId,
        materialKey: m.materialKey,
        quantity: m.quantity,
        creatureId,
        spawnSeq: creatureId ? spawnSeqFor(envelope, creatureId) : 1,
        deathId: creatureId ? deathIdFor(envelope, creatureId) : null,
        ordinal: index,
      };
    }),

    gems: proposed.gems.map((g) => {
      const creatureId = proposed.kills[0]?.creatureId ?? null;
      return {
        characterId: g.characterId,
        gemKey: g.gemKey,
        creatureId,
        spawnSeq: creatureId ? spawnSeqFor(envelope, creatureId) : 1,
        deathId: creatureId ? deathIdFor(envelope, creatureId) : null,
      };
    }),

    bonds: proposed.bonds.map((b) => {
      const creatureId = proposed.kills[0]?.creatureId ?? null;
      return {
        characterId: b.characterId,
        creatureLevel: b.creatureLevel,
        isBoss: b.isBoss,
        creatureId,
        spawnSeq: creatureId ? spawnSeqFor(envelope, creatureId) : 1,
        deathId: creatureId ? deathIdFor(envelope, creatureId) : null,
      };
    }),

    loot: proposed.loot.map((l) => ({
      deathId: deathIdFor(envelope, l.creatureId),
      creatureId: l.creatureId,
      spawnSeq: spawnSeqFor(envelope, l.creatureId),
      creatureName: l.creatureName,
      mode: l.mode,
      lootTableId: l.lootTableId,
      itemId: l.itemId,
      // Resolved before simulation. Never null, never -1, no implicit fallback.
      dropChance:
        l.dropChance ??
        envelope.dropChanceByCreatureId[l.creatureId]?.chance ??
        envelope.lootFallbackChance,
    })),

    // The FULL semantic row travels to the committer. Dropping any of these
    // fields would rewrite a persisted effect without its identity, which the
    // deployed `validate_active_effect` trigger refuses outright (immutable
    // field may not change) and which would silently erase absorb pools and
    // one-shot charges.
    effectUpserts: proposed.effectUpserts.map((e) => ({
      lifetime: e.lifetime ?? 'timed',
      // Stance rows carry the no-expiry sentinel the database contract
      // requires: their lifetime is owned by the CP reservation, not by a clock.
      expiresAtMs: e.lifetime === 'stance' ? STANCE_NO_EXPIRY_MS : e.expiresAtMs,
      targetId: e.targetId,
      sourceId: e.sourceCharacterId ?? e.targetId,
      effectType: e.effectType,
      stacks: e.stacks,
      amountPerTick: e.amountPerTick,
      intervalMs: e.intervalMs,
      nextTickAtMs: e.nextTickAtMs,
      sourceAbilityKey: e.abilityKey ?? e.effectType,
      damageType: e.damageType ?? null,
      mechanic: e.mechanic ?? null,
      magnitude: e.magnitude ?? null,
      remaining: e.remaining ?? null,
      params: e.params ?? {},
      paramsVersion: e.paramsVersion ?? EFFECT_PARAMS_VERSION,
    })),

    effectDeleteIds: [...proposed.effectDeleteIds],
    effectDeleteTargetIds: [...proposed.effectDeleteTargetIds],

    engagementsJoin: proposed.engagementsJoin.map((e) => ({
      creatureId: e.creatureId,
      characterId: e.characterId,
    })),
    engagementsPurgeCreatureIds: [...proposed.engagementsPurgeCreatureIds],

    durability: proposed.durability.map((d) => {
      const current = envelope.durabilityByInventoryId[d.inventoryId] ?? 0;
      const wear = wearCount.get(d.inventoryId) ?? 1;
      return {
        characterId: d.characterId,
        inventoryId: d.inventoryId,
        durabilityAfter: Math.max(0, current - wear),
      };
    }),

    // The cast row is the durable half of a telegraph: `config` is the frozen
    // authored contract the resolver reads back on the tick the cast lands, so
    // an edit mid-channel cannot retune a live telegraph. The snake_case keys
    // alongside it are what the client telegraph UI already reads.
    casts: proposed.casts.map((c) => ({
      creatureId: c.creatureId,
      abilityKey: c.abilityKey,
      castKey: c.castKey,
      phase: c.phase,
      resolvesAtMs: c.resolvesAtMs,
      // Durable identity of the in-flight channel. Resolve/fizzle addresses the
      // exact row the resolver read, so a second channel on the same creature
      // can never be closed by the wrong mutation. Casts that start and land in
      // the same commit carry the resolver placeholder and are matched by
      // creature instead.
      castEventId: c.castEventId ?? null,
      payload: {
        label: c.config?.label ?? c.castKey ?? c.abilityKey,
        cast_ms: c.config ? Math.max(0, c.config.resolvesAtMs - c.config.startedAtMs) : 0,
        amount: c.damage,
        aoe_amount: c.aoeDamage,
        damage_type: c.damageType,
        lock_ms: c.lockMs,
        stored_power: {
          cap: c.config?.storedPowerCap ?? 0,
          consumed: c.storedPowerConsumed,
        },
        targetCharacterId: c.targetCharacterId,
        damage: c.damage,
        damageType: c.damageType,
        text: c.text,
        targets: c.targets.map((t) => ({
          characterId: t.characterId,
          damage: t.damage,
          applied: t.applied,
          isPrimary: t.isPrimary,
        })),
        config: c.config,
      },
    })),


    storedPower: proposed.storedPower.map((s) => {
      const resolved = envelope.storedPower.find((p) => p.creatureId === s.creatureId);
      const current = resolved?.current ?? 0;
      const cap = s.cap > 0 ? s.cap : (resolved?.cap ?? 0);
      const next = current + s.delta;
      return {
        creatureId: s.creatureId,
        currentAfter: cap > 0 ? Math.min(next, cap) : next,
        cap,
      };
    }),

    progression: proposed.progression.map((p) => ({ ...p })),

    contributions: proposed.characters.map((c) => ({
      characterId: c.characterId,
      damageDealt: 0,
      healingDone: 0,
    })),

    actionTerminal: [
      ...proposed.consumedActionIds.map((id) => ({ id, status: 'consumed', reason: null })),
      ...proposed.rejectedActions.map((r) => ({
        id: r.actionId,
        status: 'rejected',
        reason: r.reason,
      })),
    ],

    session: { ...session },
    events: proposed.events.map((e) => ({ ...e })),
  };
}

export function buildCommitRequest(
  envelope: SnapshotEnvelope,
  proposed: ProposedTick,
  session: SessionPresenceProposal,
  batchId: string,
): CommitRequest {
  return {
    _encounter_id: envelope.encounterId,
    _tick: envelope.tickNumber,
    _claim_token: envelope.claim.token,
    _batch_id: batchId,
    _snapshot_version: envelope.snapshotVersion,
    _encounter_version: envelope.encounterVersion,
    _snapshot_scope: envelope.scope,
    _snapshot_digest: envelope.stateDigest,
    _proposed: buildCommitPayload(envelope, proposed, session),
  };
}
