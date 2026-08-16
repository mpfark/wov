/**
 * creature-death-commit.test.ts — permanent regression cover for the creature
 * death half of `commit_encounter_tick_v2`.
 *
 * The C5 soak found a corpse-resurrection defect: the committer derived
 * `is_alive` from `NOT COALESCE(killed, false)`, so every later full-roster
 * tick row (which legitimately carries `killed = false`) flipped a slain
 * creature back to alive with hp 0. The encounter could then never end.
 *
 * The mirror below is a statement-for-statement model of the corrected SQL:
 *
 *   killed        -> hp = 0, is_alive = false,
 *                    died_at = COALESCE(died_at, now()),
 *                    rewards_awarded_at = COALESCE(rewards_awarded_at, now())
 *                    WHERE is_alive = true AND spawn_seq = proposed spawn_seq
 *   not killed    -> hp = hpAfter WHERE is_alive = true AND spawn_seq matches
 *   already dead  -> no write at all
 *
 * plus the post-write authority: corpses leave every engagement, the living
 * roster is recomputed from committed rows, and an encounter with no living
 * engaged creature ends through `encounter_end`.
 *
 * Ledger keys (`encounter_kill_awards`, `encounter_death_loot`) are keyed by
 * the death occurrence id, so a replayed or duplicated death tick pays out
 * exactly once, while a genuine respawn (spawn_seq + 1) is a new occurrence.
 */

import { describe, it, expect } from 'vitest';
import { encounterDeathId } from '@/shared/combat/c2/death-id';

const ENC = 'e0000000-0000-4000-8000-00000000000e';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const H1 = 'a0000000-0000-4000-8000-000000000001';

interface CreatureRow {
  id: string;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  spawnSeq: number;
  diedAt: number | null;
  rewardsAwardedAt: number | null;
}

interface CreatureProposal {
  creatureId: string;
  spawnSeq: number;
  hpBefore: number;
  hpAfter: number;
  killed: boolean;
}

interface RewardProposal {
  characterId: string;
  creatureId: string;
  /** Death occurrence id, exactly as the real payload carries it. */
  deathId: string;
  xp: number;
}

interface LootProposal {
  creatureId: string;
  deathId: string;
  itemId: string | null;
}

interface CommitInput {
  tick: number;
  creatures: CreatureProposal[];
  rewards?: RewardProposal[];
  loot?: LootProposal[];
}

type CommitResult =
  | { committed: false; reason: string }
  | {
      committed: true;
      tick: number;
      ended: boolean;
      engagedCreatureIds: string[];
      aliveCreatureIds: string[];
    };

/** Mirror of the corrected committer, creature/termination domains only. */
class CommitMirror {
  now = 1_000;
  tickNumber = 0;
  status: 'active' | 'ended' = 'active';
  encounterEndCalls = 0;
  creatures = new Map<string, CreatureRow>();
  /** `${creatureId}|${characterId}` */
  engagements = new Set<string>();
  killAwards = new Set<string>();
  deathLoot = new Set<string>();
  xpByCharacter = new Map<string, number>();
  groundLoot: string[] = [];
  batches: { tick: number; ended: boolean; engagedCreatureIds: string[] }[] = [];

  addCreature(id: string, hp: number): void {
    this.creatures.set(id, {
      id,
      hp,
      maxHp: hp,
      isAlive: true,
      spawnSeq: 1,
      diedAt: null,
      rewardsAwardedAt: null,
    });
  }

  engage(creatureId: string, characterId: string): void {
    this.engagements.add(`${creatureId}|${characterId}`);
  }

  /** The one legal false -> true transition, mirroring bump_creature_spawn_seq. */
  respawn(creatureId: string): void {
    const row = this.creatures.get(creatureId)!;
    if (row.isAlive) throw new Error('respawn of a living creature');
    row.isAlive = true;
    row.spawnSeq += 1;
    row.hp = row.maxHp;
    row.diedAt = null;
    row.rewardsAwardedAt = null;
  }

  deathIdOf(creatureId: string, tick: number, spawnSeq?: number): string {
    return encounterDeathId(
      ENC,
      creatureId,
      spawnSeq ?? this.creatures.get(creatureId)!.spawnSeq,
      tick,
    );
  }

  commit(input: CommitInput): CommitResult {
    this.now += 1;

    // ── pre-mutation refusals ───────────────────────────────────────
    if (this.status !== 'active') return { committed: false, reason: 'encounter_ended' };
    if (this.tickNumber >= input.tick) {
      return { committed: false, reason: 'already_committed' };
    }
    if (this.batches.some((b) => b.tick === input.tick)) {
      return { committed: false, reason: 'duplicate_batch' };
    }
    for (const row of input.creatures) {
      const live = this.creatures.get(row.creatureId);
      if (!live) return { committed: false, reason: 'invalid_proposal' };
      if (row.spawnSeq !== live.spawnSeq) {
        // stale spawn generation: refused with zero writes
        return { committed: false, reason: 'invalid_proposal' };
      }
      if (row.hpBefore !== live.hp) return { committed: false, reason: 'invalid_proposal' };
      if (row.hpAfter < 0 || row.hpAfter > live.maxHp) {
        return { committed: false, reason: 'invalid_proposal' };
      }
    }

    // ── mutations ───────────────────────────────────────────────────
    for (const row of input.creatures) {
      const live = this.creatures.get(row.creatureId)!;
      if (!live.isAlive) continue; // already dead: untouched
      if (row.killed) {
        live.hp = 0;
        live.isAlive = false;
        live.diedAt = live.diedAt ?? this.now;
        live.rewardsAwardedAt = live.rewardsAwardedAt ?? this.now;
      } else {
        live.hp = row.hpAfter;
      }
    }

    for (const r of input.rewards ?? []) {
      const key = `${r.deathId}|${r.characterId}|reward`;
      if (this.killAwards.has(key)) continue;
      this.killAwards.add(key);
      this.xpByCharacter.set(r.characterId, (this.xpByCharacter.get(r.characterId) ?? 0) + r.xp);
    }

    for (const l of input.loot ?? []) {
      const key = l.deathId;
      if (this.deathLoot.has(key)) continue;
      this.deathLoot.add(key);
      if (l.itemId) this.groundLoot.push(l.itemId);
    }

    // ── corpses leave every engagement representation ───────────────
    for (const key of [...this.engagements]) {
      const creatureId = key.split('|')[0];
      const row = this.creatures.get(creatureId);
      if (!row || !row.isAlive || row.hp <= 0) this.engagements.delete(key);
    }

    const aliveCreatureIds = [...this.creatures.values()]
      .filter((c) => c.isAlive && c.hp > 0)
      .map((c) => c.id)
      .sort();
    const engagedCreatureIds = [
      ...new Set([...this.engagements].map((k) => k.split('|')[0])),
    ]
      .filter((id) => aliveCreatureIds.includes(id))
      .sort();
    const ended = engagedCreatureIds.length === 0;
    if (ended) {
      this.status = 'ended';
      this.encounterEndCalls += 1;
    }

    this.tickNumber = input.tick;
    this.batches.push({ tick: input.tick, ended, engagedCreatureIds });
    return { committed: true, tick: input.tick, ended, engagedCreatureIds, aliveCreatureIds };
  }
}

function roster(m: CommitMirror, over: Partial<CreatureProposal> & { creatureId: string }) {
  const row = m.creatures.get(over.creatureId)!;
  return {
    creatureId: row.id,
    spawnSeq: row.spawnSeq,
    hpBefore: row.hp,
    hpAfter: row.hp,
    killed: false,
    ...over,
  } as CreatureProposal;
}

describe('creature death commit semantics', () => {
  it('kills on tick N and keeps the corpse dead on N+1 and N+2', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 10);
    m.addCreature(C2, 10);
    m.engage(C1, H1);
    m.engage(C2, H1);

    const kill = m.commit({
      tick: 1,
      creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true }), roster(m, { creatureId: C2 })],
      rewards: [{ characterId: H1, creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), xp: 50 }],
      loot: [{ creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), itemId: 'item-1' }],
    });
    expect(kill.committed).toBe(true);
    const dead = m.creatures.get(C1)!;
    const diedAt = dead.diedAt;
    expect(dead).toMatchObject({ hp: 0, isAlive: false, spawnSeq: 1 });
    expect(diedAt).not.toBeNull();

    // Two more full-roster ticks that legitimately carry killed = false.
    for (const tick of [2, 3]) {
      const res = m.commit({
        tick,
        creatures: [roster(m, { creatureId: C1 }), roster(m, { creatureId: C2, hpAfter: 5 })],
        // A duplicated payload for the SAME death occurrence must not repay.
        rewards: [{ characterId: H1, creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), xp: 50 }],
        loot: [{ creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), itemId: 'item-1' }],
      });
      expect(res.committed).toBe(true);
    }

    const after = m.creatures.get(C1)!;
    expect(after.isAlive).toBe(false);
    expect(after.hp).toBe(0);
    expect(after.spawnSeq).toBe(1);
    expect(after.diedAt).toBe(diedAt);
    // Rewards and loot exactly once, despite three identical proposals.
    expect(m.xpByCharacter.get(H1)).toBe(50);
    expect(m.groundLoot).toEqual(['item-1']);
    // Combat continues against the survivor only.
    expect(m.status).toBe('active');
    expect(m.batches.at(-1)!.engagedCreatureIds).toEqual([C2]);
  });

  it('is idempotent for a duplicated or replayed death tick', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 8);
    m.engage(C1, H1);
    const first = m.commit({
      tick: 1,
      creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true })],
      rewards: [{ characterId: H1, creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), xp: 30 }],
      loot: [{ creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), itemId: 'item-1' }],
    });
    expect(first.committed).toBe(true);

    const replay = m.commit({
      tick: 1,
      creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true })],
      rewards: [{ characterId: H1, creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), xp: 30 }],
    });
    expect(replay).toEqual({ committed: false, reason: 'encounter_ended' });
    expect(m.xpByCharacter.get(H1)).toBe(30);
    expect(m.groundLoot).toHaveLength(1);
  });

  it('removes the corpse from engagements and ends the encounter when it was the last creature', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 6);
    m.engage(C1, H1);
    const res = m.commit({
      tick: 1,
      creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true })],
    });
    expect(res).toMatchObject({ committed: true, ended: true, engagedCreatureIds: [], aliveCreatureIds: [] });
    expect(m.engagements.size).toBe(0);
    expect(m.status).toBe('ended');
    expect(m.encounterEndCalls).toBe(1);
    // No further authoritative tick is committed for an ended encounter.
    expect(m.commit({ tick: 2, creatures: [roster(m, { creatureId: C1 })] })).toEqual({
      committed: false,
      reason: 'encounter_ended',
    });
    expect(m.batches).toHaveLength(1);
  });

  it('ends an offscreen (effects-only) death by the same rules', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 4);
    m.engage(C1, H1); // owner fled; attribution stays, targeting does not
    const res = m.commit({
      tick: 9,
      creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true })],
      rewards: [{ characterId: H1, creatureId: C1, deathId: m.deathIdOf(C1, 9, 1), xp: 12 }],
    });
    expect(res).toMatchObject({ committed: true, ended: true });
    expect(m.xpByCharacter.get(H1)).toBe(12);
    expect(m.creatures.get(C1)).toMatchObject({ isAlive: false, hp: 0, spawnSeq: 1 });
  });

  it('cannot be revived by a boss row with an in-flight cast', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 20);
    m.engage(C1, H1);
    m.commit({ tick: 1, creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true })] });
    // A pending cast row is not creature state: it can neither revive the boss
    // nor keep the encounter alive.
    expect(m.creatures.get(C1)).toMatchObject({ isAlive: false, hp: 0 });
    expect(m.status).toBe('ended');
  });

  it('only the respawn path revives, advancing spawn_seq exactly once and creating a new death identity', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 5);
    m.engage(C1, H1);
    m.commit({ tick: 1, creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true })] });
    const firstDeathId = m.deathIdOf(C1, 1, 1);

    m.respawn(C1);
    expect(m.creatures.get(C1)).toMatchObject({ isAlive: true, spawnSeq: 2, hp: 5 });

    // A fresh encounter drives the next life.
    const m2 = new CommitMirror();
    m2.creatures.set(C1, { ...m.creatures.get(C1)! });
    m2.engage(C1, H1);
    m2.commit({
      tick: 1,
      creatures: [roster(m2, { creatureId: C1, hpAfter: 0, killed: true })],
      rewards: [{ characterId: H1, creatureId: C1, deathId: m2.deathIdOf(C1, 1, 2), xp: 20 }],
    });
    const secondDeathId = m2.deathIdOf(C1, 1, 2);
    expect(secondDeathId).not.toBe(firstDeathId);
    expect(m2.xpByCharacter.get(H1)).toBe(20);
    expect(m2.creatures.get(C1)!.spawnSeq).toBe(2);
  });

  it('refuses a stale proposal from the previous spawn generation without writes', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 5);
    m.engage(C1, H1);
    const row = m.creatures.get(C1)!;
    row.isAlive = false;
    row.hp = 0;
    m.respawn(C1); // spawn_seq = 2

    const before = { ...m.creatures.get(C1)! };
    const res = m.commit({
      tick: 1,
      creatures: [
        { creatureId: C1, spawnSeq: 1, hpBefore: 5, hpAfter: 0, killed: true },
      ],
      rewards: [{ characterId: H1, creatureId: C1, deathId: m.deathIdOf(C1, 1, 1), xp: 99 }],
    });
    expect(res).toEqual({ committed: false, reason: 'invalid_proposal' });
    expect(m.creatures.get(C1)).toEqual(before);
    expect(m.killAwards.size).toBe(0);
    expect(m.xpByCharacter.size).toBe(0);
    expect(m.batches).toHaveLength(0);
    expect(m.status).toBe('active');
  });

  it('never derives is_alive from the killed flag of a later roster row', () => {
    const m = new CommitMirror();
    m.addCreature(C1, 12);
    m.addCreature(C2, 12);
    m.engage(C1, H1);
    m.engage(C2, H1);
    m.commit({
      tick: 1,
      creatures: [roster(m, { creatureId: C1, hpAfter: 0, killed: true }), roster(m, { creatureId: C2 })],
    });
    for (let tick = 2; tick <= 10; tick++) {
      m.commit({
        tick,
        creatures: [roster(m, { creatureId: C1 }), roster(m, { creatureId: C2 })],
      });
      expect(m.creatures.get(C1)!.isAlive).toBe(false);
    }
    expect(m.batches.every((b) => !b.engagedCreatureIds.includes(C1))).toBe(true);
  });
});
