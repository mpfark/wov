/**
 * kill-then-continue.test.ts — pure-resolver / C2 round-trip parity for the
 * ticks that follow a kill.
 *
 * The corpse-resurrection defect lived in the gap between the resolver (which
 * only flags `killed` on the exact death tick) and the committer (which used to
 * read `killed = false` as "alive"). These tests pin the resolver half of the
 * contract and the payload the committer receives:
 *
 *   - the killing tick emits exactly one `killed: true` row, one kill and one
 *     engagement purge for that creature;
 *   - every later tick emits `killed: false` with `hpAfter = 0` for the corpse,
 *     awards nothing again, and never re-engages it;
 *   - the death occurrence id is stable for the killing tick and different for
 *     a later spawn generation.
 */

import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import { buildCommitPayload } from '@/shared/combat/c2/payload';
import { encounterDeathId } from '@/shared/combat/c2/death-id';
import { SNAPSHOT_VERSION } from '@/shared/combat/c2/contract';
import type { SnapshotEnvelope } from '@/shared/combat/c2/contract';
import type { CreatureSnapshot, EncounterSnapshot } from '@/shared/combat/pure/types';
import { creature, participant, snapshot } from '../pure/fixtures';

const ENC = 'enc-1';

function envelopeFor(snap: EncounterSnapshot): SnapshotEnvelope {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    encounterId: snap.encounterId,
    nodeId: snap.nodeId,
    tickNumber: snap.tickNumber,
    encounterVersion: 1,
    loadedAtMs: snap.nowMs,
    claim: {
      token: 'token-1',
      tick: snap.tickNumber,
      attempt: 1,
      leaseUntilMs: snap.nowMs + 5000,
      mode: snap.mode,
    },
    cursor: {
      tickNumber: snap.tickNumber - 1,
      tickAtMs: snap.nowMs - snap.tickRateMs,
      tickState: 'resolving',
      resolvingTick: snap.tickNumber,
    },
    scope: {
      participantIds: snap.participants.map((p) => p.id),
      creatureIds: snap.creatures.map((c) => c.id),
      actionIds: [],
      effectIds: [],
      inventoryIds: [],
      castIds: [],
      engagementPairs: snap.engagements.map((e) => `${e.creatureId}>${e.characterId}`),
      lootTableIds: [],
      partyIds: [],
      loadedAtMs: snap.nowMs,
    },
    stateDigest: {
      participants: 'p',
      characters: 'c',
      creatures: 'r',
      engagements: 'g',
      actions: 'a',
      effects: 'e',
      equipment: 'q',
      casts: 'k',
      storedPower: 's',
      configVersion: 'v',
    },
    spawnSeqByCreatureId: Object.fromEntries(snap.creatures.map((c) => [c.id, 1])),
    durabilityByInventoryId: {},
    dropChanceByCreatureId: Object.fromEntries(
      snap.creatures.map((c) => [c.id, { chance: 0.5, source: 'legacy_fallback' as const }]),
    ),
    storedPower: [],
    lootFallbackChance: 0.5,
  };
}

/** Advance ticks until the creature dies, returning every proposal. */
function runUntilKilled(base: EncounterSnapshot, maxTicks = 400) {
  let snap = base;
  const proposals = [];
  for (let i = 0; i < maxTicks; i++) {
    const proposed = resolveTickPure(snap);
    proposals.push({ snap, proposed });
    const killed = proposed.creatures.some((c) => c.killed);
    const nextCreatures: CreatureSnapshot[] = snap.creatures.map((c) => {
      const row = proposed.creatures.find((r) => r.creatureId === c.id);
      if (!row) return c;
      const dead = row.killed || !c.isAlive || row.hpAfter <= 0;
      return { ...c, hp: row.hpAfter, isAlive: dead ? false : c.isAlive };
    });
    const purged = new Set(proposed.engagementsPurgeCreatureIds);
    snap = {
      ...snap,
      tickNumber: snap.tickNumber + 1,
      nowMs: snap.nowMs + snap.tickRateMs,
      creatures: nextCreatures,
      participants: snap.participants.map((p) => {
        const row = proposed.characters.find((r) => r.characterId === p.id);
        return row ? { ...p, hp: Math.max(1, row.hpAfter), cp: row.cpAfter } : p;
      }),
      effects: [],
      actions: [],
      engagements: snap.engagements.filter((e) => !purged.has(e.creatureId)),
    };
    if (killed) return { proposals, after: snap };
  }
  throw new Error('creature never died');
}

describe('kill then continue ticking (resolver / C2 parity)', () => {
  const hero = participant({ hp: 400, maxHp: 400, level: 30 });
  const target = creature({ hp: 30, maxHp: 30, level: 5, ac: 5 });
  const base = snapshot({
    encounterId: ENC,
    participants: [hero],
    creatures: [target],
    engagements: [{ creatureId: target.id, characterId: hero.id, lastActionAtMs: 0 }],
    tickNumber: 1,
  });

  it('flags the kill exactly once and purges the engagement', () => {
    const { proposals } = runUntilKilled(base);
    const killTicks = proposals.filter((p) => p.proposed.creatures.some((c) => c.killed));
    expect(killTicks).toHaveLength(1);
    const kill = killTicks[0].proposed;
    expect(kill.kills.map((k) => k.creatureId)).toEqual([target.id]);
    expect(kill.creatures.find((c) => c.creatureId === target.id)).toMatchObject({
      killed: true,
      hpAfter: 0,
    });
    expect(kill.engagementsPurgeCreatureIds).toContain(target.id);
    expect(kill.session.ended).toBe(true);
  });

  it('emits killed = false with hpAfter 0 and no rewards on following ticks', () => {
    const { after } = runUntilKilled(base);
    // Two more ticks resolved against the corpse roster.
    let snap = after;
    for (let i = 0; i < 2; i++) {
      const proposed = resolveTickPure(snap);
      const row = proposed.creatures.find((c) => c.creatureId === target.id);
      expect(row).toMatchObject({ killed: false, hpAfter: 0 });
      expect(proposed.kills).toHaveLength(0);
      expect(proposed.rewards).toHaveLength(0);
      expect(proposed.loot).toHaveLength(0);
      expect(proposed.engagementsJoin.some((e) => e.creatureId === target.id)).toBe(false);
      expect(proposed.session.ended).toBe(true);

      const payload = buildCommitPayload(envelopeFor(snap), proposed, {
        sessionId: null,
        ended: proposed.session.ended,
        engagedCreatureIds: [],
      });
      // The payload never asks the committer to make the creature alive: it
      // simply reports the roster row with killed = false.
      expect((payload.creatures as any[])[0]).toMatchObject({
        creatureId: target.id,
        killed: false,
        hpAfter: 0,
        spawnSeq: 1,
      });
      expect(payload.kills).toEqual([]);
      expect(payload.rewards).toEqual([]);
      expect(payload.loot).toEqual([]);

      snap = { ...snap, tickNumber: snap.tickNumber + 1, nowMs: snap.nowMs + snap.tickRateMs };
    }
  });

  it('keeps the death occurrence id stable per spawn generation', () => {
    const { proposals } = runUntilKilled(base);
    const killEntry = proposals.find((p) => p.proposed.creatures.some((c) => c.killed))!;
    const env = envelopeFor(killEntry.snap);
    const payload = buildCommitPayload(env, killEntry.proposed, {
      sessionId: null,
      ended: true,
      engagedCreatureIds: [],
    });
    const expected = encounterDeathId(ENC, target.id, 1, killEntry.snap.tickNumber);
    expect((payload.kills as any[])[0].deathId).toBe(expected);
    // Same tick, next spawn generation -> a different occurrence.
    expect(encounterDeathId(ENC, target.id, 2, killEntry.snap.tickNumber)).not.toBe(expected);
  });

  it('continues against survivors when only one of two creatures dies', () => {
    const a = creature({ id: 'crt-a', hp: 20, maxHp: 20, level: 3, ac: 5 });
    const b = creature({ id: 'crt-b', hp: 500, maxHp: 500, level: 20, ac: 25 });
    const snap = snapshot({
      encounterId: ENC,
      participants: [hero],
      creatures: [a, b],
      engagements: [
        { creatureId: a.id, characterId: hero.id, lastActionAtMs: 0 },
        { creatureId: b.id, characterId: hero.id, lastActionAtMs: 0 },
      ],
      tickNumber: 1,
    });
    const { proposals, after } = runUntilKilled(snap, 4000);
    const kill = proposals.at(-1)!.proposed;
    const deadId = kill.creatures.find((c) => c.killed)!.creatureId;
    const survivorId = deadId === a.id ? b.id : a.id;
    expect(kill.session.ended).toBe(false);
    expect(after.creatures.find((c) => c.id === survivorId)!.isAlive).toBe(true);
    const next = resolveTickPure(after);
    expect(next.creatures.find((c) => c.creatureId === deadId)).toMatchObject({
      killed: false,
      hpAfter: 0,
    });
    expect(next.kills).toHaveLength(0);
    expect(next.session.ended).toBe(false);
  });
});
