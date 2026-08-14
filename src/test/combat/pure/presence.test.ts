/**
 * Presence vs participation.
 *
 * The snapshot carries COMPLETE encounter participation (attribution, durable
 * effect sources, contributions, reward rights). `presentAtNode` is the only
 * target roster: a participant who walked off the node keeps every attribution
 * right but is not a legal target for attacks, healing, party effects or
 * telegraphed casts — and cannot act.
 *
 * Delivery/RLS grace is never used as target eligibility anywhere here.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import type { ActiveCastSnapshot, EncounterSnapshot } from '@/shared/combat/pure/types';
import { CONFIG, creature, participant, snapshot } from './fixtures';

const NOW = 1_700_000_000_000;
const TICK = 2000;

const here = participant({ id: 'char-here', name: 'Stayer', presentAtNode: true });
const gone = participant({
  id: 'char-gone', name: 'Leaver', presentAtNode: false, joinedAtMs: 900,
});

/** A creature about to die to a DoT applied by the departed player. */
const dying = creature({ id: 'crt-1', hp: 4, maxHp: 90, level: 12, isHumanoid: true });

const dotFromGone = {
  id: 'eff-dot', targetKind: 'creature' as const, targetId: dying.id,
  effectType: 'bleed', stacks: 2, amountPerTick: 5, expiresAtMs: NOW + 60_000,
  intervalMs: TICK, nextTickAtMs: NOW, damageType: 'physical',
  sourceCharacterId: gone.id, isPeriodic: true,
};

function catchupWithDot(over: Partial<EncounterSnapshot> = {}): EncounterSnapshot {
  return snapshot({
    mode: 'catchup',
    nowMs: NOW,
    participants: [gone],
    creatures: [dying],
    effects: [dotFromGone],
    engagements: [{ creatureId: dying.id, characterId: gone.id, lastActionAtMs: NOW - 5000 }],
    ...over,
  });
}

describe('off-node participants keep attribution and reward rights', () => {
  it('awards the departed DoT source exactly once for a catch-up kill', () => {
    const out = resolveTickPure(catchupWithDot());
    expect(out.creatures.find((c) => c.creatureId === dying.id)?.killed).toBe(true);
    expect(out.kills).toHaveLength(1);
    expect(out.kills[0].recipientCharacterIds).toEqual([gone.id]);
    const mine = out.rewards.filter((r) => r.characterId === gone.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].xp).toBeGreaterThan(0);
    expect(mine[0].gold).toBeGreaterThanOrEqual(0);
    expect(mine[0].renown).toBeGreaterThanOrEqual(0);
  });

  it('keeps loot and salvage anchored to the creature that died', () => {
    const out = resolveTickPure(catchupWithDot());
    for (const l of out.loot) expect(l.creatureId).toBe(dying.id);
    for (const m of out.materials) expect(m.characterId).toBe(gone.id);
  });

  it('resolves effects, death and rewards with nobody present at all', () => {
    const out = resolveTickPure(catchupWithDot({ participants: [gone] }));
    expect(out.kills).toHaveLength(1);
    expect(out.rewards.map((r) => r.characterId)).toEqual([gone.id]);
  });

  it('keeps deterministic attribution when several sources hold effects', () => {
    const snap = catchupWithDot({
      participants: [here, gone],
      creatures: [creature({ id: 'crt-1', hp: 30, maxHp: 90, level: 12 })],
      effects: [
        dotFromGone,
        { ...dotFromGone, id: 'eff-2', sourceCharacterId: here.id, amountPerTick: 9, stacks: 2 },
      ],
      engagements: [
        { creatureId: 'crt-1', characterId: gone.id, lastActionAtMs: NOW - 5000 },
        { creatureId: 'crt-1', characterId: here.id, lastActionAtMs: NOW - 5000 },
      ],
      ticksToSimulate: 3,
    });
    const a = resolveTickPure(snap);
    const b = resolveTickPure(snap);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.kills[0].recipientCharacterIds).toEqual([here.id, gone.id].sort());
    expect(a.rewards.map((r) => r.characterId).sort()).toEqual([here.id, gone.id].sort());
  });
});

describe('off-node participants are not targets', () => {
  const cast: ActiveCastSnapshot = {
    castEventId: 'cast-1',
    creatureId: 'crt-boss',
    abilityKey: 'doom_beam',
    castKey: 'doom_beam',
    label: 'Doom Beam',
    startedAtMs: NOW - TICK,
    resolvesAtMs: NOW,
    targetCharacterId: gone.id,
    baseDamage: 40,
    baseAoeDamage: 20,
    damageType: 'fire',
    primaryShare: 1,
    aoeShare: 1,
    consumeMode: 'all',
    consumePct: 100,
    consumeFixed: 0,
    storedPowerCap: 5,
    pauseAutoattacks: true,
    lockMs: 3000,
    castingText: 'It gathers ruin.',
    castedText: 'The beam lands.',
    channeling: false,
  } as ActiveCastSnapshot;

  const boss = creature({ id: 'crt-boss', hp: 400, maxHp: 400, rarity: 'boss', storedPower: 3 });

  const castSnap = (present: boolean) =>
    snapshot({
      nowMs: NOW,
      participants: [participant({ ...gone, presentAtNode: present })],
      creatures: [boss],
      activeCasts: [cast],
      engagements: [{ creatureId: boss.id, characterId: gone.id, lastActionAtMs: NOW - 1000 }],
      config: CONFIG,
    });

  it('does not damage or lock a departed participant when a telegraph lands', () => {
    const out = resolveTickPure(castSnap(false));
    const resolve = out.casts.find((c) => c.phase === 'resolve');
    expect(resolve).toBeDefined();
    expect(resolve!.targets).toHaveLength(0);
    expect(resolve!.lockMs).toBe(0);
    expect(out.characters.find((c) => c.characterId === gone.id)?.hpAfter).toBe(gone.hp);
  });

  it('hits the same player once they are back on the node before resolution', () => {
    const out = resolveTickPure(castSnap(true));
    const resolve = out.casts.find((c) => c.phase === 'resolve');
    expect(resolve!.targets.map((t) => t.characterId)).toEqual([gone.id]);
    expect(resolve!.targets[0].applied).toBeGreaterThan(0);
    expect(resolve!.lockMs).toBeGreaterThan(0);
  });

  it('never lets a creature swing at, nor a departed player swing back', () => {
    const out = resolveTickPure(
      snapshot({
        nowMs: NOW,
        participants: [gone],
        creatures: [creature({ id: 'crt-1', hp: 200, maxHp: 200 })],
        engagements: [{ creatureId: 'crt-1', characterId: gone.id, lastActionAtMs: NOW - 1000 }],
        ticksToSimulate: 4,
      }),
    );
    const kinds = out.events.map((e) => e.type);
    expect(kinds.filter((k) => k.startsWith('creature_'))).toHaveLength(0);
    expect(kinds.filter((k) => k.startsWith('autoattack_'))).toHaveLength(0);
    expect(out.characters.find((c) => c.characterId === gone.id)?.hpAfter).toBe(gone.hp);
  });

  it('excludes departed party members from current-node healing', () => {
    const healer = participant({
      id: 'char-heal', name: 'Mender', classKey: 'healer', partyId: 'party-1',
      cp: 60, maxCp: 60,
    });
    const wounded = participant({
      ...gone, partyId: 'party-1', hp: 10, maxHp: 100, presentAtNode: false,
    });
    const out = resolveTickPure(
      snapshot({
        nowMs: NOW,
        participants: [healer, wounded],
        creatures: [creature({ id: 'crt-1', hp: 200, maxHp: 200 })],
        engagements: [{ creatureId: 'crt-1', characterId: healer.id, lastActionAtMs: NOW }],
        actions: [
          {
            id: 'act-1', characterId: healer.id, creatureId: null, allyId: wounded.id,
            abilityKey: 'heal', mechanic: 'heal', damageType: null, cpCost: 5,
            amount: 40, durationMs: 0, intervalMs: 0, statusKey: null,
            statusChancePct: 0, maxStacks: 1, weaponBased: false, sequence: 1,
          },
        ],
      }),
    );
    expect(out.rejectedActions).toEqual([{ actionId: 'act-1', reason: 'not_present' }]);
    expect(out.characters.find((c) => c.characterId === wounded.id)?.hpAfter).toBe(10);
  });

  it('rejects actions queued by a participant who left the node', () => {
    const out = resolveTickPure(
      snapshot({
        nowMs: NOW,
        participants: [gone],
        creatures: [creature({ id: 'crt-1', hp: 200, maxHp: 200 })],
        engagements: [{ creatureId: 'crt-1', characterId: gone.id, lastActionAtMs: NOW }],
        actions: [
          {
            id: 'act-x', characterId: gone.id, creatureId: 'crt-1', allyId: null,
            abilityKey: 'weapon_attack', mechanic: 'weapon_attack', damageType: 'physical',
            cpCost: 5, amount: 10, durationMs: 0, intervalMs: 0, statusKey: null,
            statusChancePct: 0, maxStacks: 1, weaponBased: true, sequence: 1,
          },
        ],
      }),
    );
    expect(out.rejectedActions).toEqual([{ actionId: 'act-x', reason: 'not_present' }]);
  });
});
