/**
 * Fled-contributor kill attribution (run c5t20260817c regression).
 *
 * A finite player-owned effect belongs to its source after that source flees,
 * logs out, disengages or dies. `encounter_participants` is deleted on all of
 * those transitions, so the effects-only snapshot lost the source entirely and
 * the kill committed with zero rewards — the exact c5t20260817c failure.
 *
 * The fix is the attribution roster in `encounter_snapshot_v2`
 * (participants UNION character sources of live encounter effects). These tests
 * pin both halves of the contract:
 *   - source missing from the roster  -> kill with zero rewards (the defect),
 *   - source present but not at node  -> full rewards, still untargetable.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import type { EncounterSnapshot } from '@/shared/combat/pure/types';
import { creature, participant, snapshot } from './fixtures';

const NOW = 1_700_000_000_000;
const TICK = 2000;

const fled = participant({
  id: 'char-fled',
  name: 'Fledsource',
  presentAtNode: false,
  joinedAtMs: 900,
});

const dying = creature({ id: 'crt-1', hp: 4, maxHp: 90, level: 12, isHumanoid: true });

/** Rend's bleed, owned by the character that has already walked away. */
const bleed = {
  id: 'eff-bleed',
  targetKind: 'creature' as const,
  targetId: dying.id,
  effectType: 'bleed',
  stacks: 2,
  amountPerTick: 5,
  expiresAtMs: NOW + 60_000,
  intervalMs: TICK,
  nextTickAtMs: NOW,
  damageType: 'physical',
  sourceCharacterId: fled.id,
  isPeriodic: true,
  ampPct: 0,
};

/** Effects-only sweep: no engagements survive a departure. */
function effectsOnly(participants: EncounterSnapshot['participants']): EncounterSnapshot {
  return snapshot({
    mode: 'catchup',
    nowMs: NOW,
    participants,
    creatures: [dying],
    effects: [bleed],
    engagements: [],
  });
}

describe('offscreen effect kill attribution', () => {
  it('loses every reward when the effect source is absent from the roster', () => {
    const out = resolveTickPure(effectsOnly([]));

    // The creature still dies — the lethal pulse is server-owned.
    expect(out.creatures.find((c) => c.creatureId === dying.id)?.killed).toBe(true);
    // ...but nothing can be attributed, which is precisely what run
    // c5t20260817c observed: death committed, zero kill awards.
    expect(out.rewards).toHaveLength(0);
    expect(out.materials).toHaveLength(0);
    expect(out.gems).toHaveLength(0);
    expect(out.bonds).toHaveLength(0);
    expect(out.loot).toHaveLength(0);
  });

  it('awards the fled source exactly once when the roster carries it', () => {
    const out = resolveTickPure(effectsOnly([fled]));

    expect(out.kills).toHaveLength(1);
    expect(out.kills[0].killerCharacterId).toBe(fled.id);
    expect(out.kills[0].recipientCharacterIds).toEqual([fled.id]);

    const mine = out.rewards.filter((r) => r.characterId === fled.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].xp).toBeGreaterThan(0);
    expect(out.bonds.map((b) => b.characterId)).toEqual([fled.id]);
    for (const m of out.materials) expect(m.characterId).toBe(fled.id);
  });

  it('grants attribution only: the rostered absentee never acts or is touched', () => {
    const out = resolveTickPure(effectsOnly([fled]));

    // No queued actions, no autoattacks, no incoming damage, no regen writes
    // that would move the absentee's resources.
    const mutation = out.characters.find((c) => c.characterId === fled.id);
    expect(mutation?.hpAfter).toBe(mutation?.hpBefore);
    expect(mutation?.died).toBe(false);
    expect(out.durability).toHaveLength(0);
    expect(out.engagementsJoin).toHaveLength(0);
  });

  it('reports the committed death through creature state, not event text', () => {
    const out = resolveTickPure(effectsOnly([fled]));

    // The diagnostic counter reads this, because the resolver emits
    // `creature_killed` and never a `death` event type.
    expect(out.creatures.filter((c) => c.killed)).toHaveLength(1);
    expect(out.events.some((e) => e.type === 'death')).toBe(false);
    expect(out.events.some((e) => e.type === 'creature_killed')).toBe(true);
  });
});
