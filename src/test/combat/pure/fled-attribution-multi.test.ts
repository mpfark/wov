/**
 * Attribution-roster regression coverage (companion to fled-attribution.test.ts).
 *
 * The SQL roster (`public.encounter_attribution_roster`) decides WHO may appear
 * in an effects-only snapshot. These tests pin the resolver-side consequences of
 * that contract:
 *   - several fled sources stay distinct owners of their own effects,
 *   - a rostered character with no live effect and no presence earns nothing,
 *   - an effect with an unknown/missing source cannot pay another player,
 *   - live (present) reward behaviour is unchanged by roster membership.
 *
 * Prior-generation and stance exclusions are enforced in SQL before the snapshot
 * exists (stances carry lifetime = 'stance'; retired spawns fail the
 * `died_at`/`is_alive` filters), so they can never reach this layer at all.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import type { EncounterSnapshot } from '@/shared/combat/pure/types';
import { creature, participant, snapshot } from './fixtures';

const NOW = 1_700_000_000_000;
const TICK = 2000;

const fledA = participant({ id: 'char-a', name: 'Sourcea', presentAtNode: false, joinedAtMs: 900 });
const fledB = participant({ id: 'char-b', name: 'Sourceb', presentAtNode: false, joinedAtMs: 901 });
/** Historical contributor: no live effect, not present. Must earn nothing. */
const historical = participant({
  id: 'char-h',
  name: 'Historic',
  presentAtNode: false,
  joinedAtMs: 800,
});

const crtA = creature({ id: 'crt-a', hp: 4, maxHp: 90, level: 12, isHumanoid: true });
const crtB = creature({ id: 'crt-b', hp: 4, maxHp: 90, level: 12, isHumanoid: true });

function bleed(id: string, targetId: string, sourceCharacterId: string | null) {
  return {
    id,
    targetKind: 'creature' as const,
    targetId,
    effectType: 'bleed',
    stacks: 2,
    amountPerTick: 5,
    expiresAtMs: NOW + 60_000,
    intervalMs: TICK,
    nextTickAtMs: NOW,
    damageType: 'physical',
    sourceCharacterId,
    isPeriodic: true,
    ampPct: 0,
  };
}

function sweep(
  participants: EncounterSnapshot['participants'],
  creatures: EncounterSnapshot['creatures'],
  effects: EncounterSnapshot['effects'],
  mode: 'catchup' | 'live' = 'catchup',
): EncounterSnapshot {
  return snapshot({ mode, nowMs: NOW, participants, creatures, effects, engagements: [] });
}

describe('attribution roster consequences', () => {
  it('keeps multiple fled effect sources distinct', () => {
    const out = resolveTickPure(
      sweep(
        [fledA, fledB],
        [crtA, crtB],
        [bleed('eff-a', crtA.id, fledA.id), bleed('eff-b', crtB.id, fledB.id)],
      ),
    );

    expect(out.kills).toHaveLength(2);
    const byCreature = new Map(out.kills.map((k) => [k.creatureId, k]));
    expect(byCreature.get(crtA.id)?.recipientCharacterIds).toEqual([fledA.id]);
    expect(byCreature.get(crtB.id)?.recipientCharacterIds).toEqual([fledB.id]);

    // Each owner is paid exactly once, and only for its own kill.
    expect(out.rewards.filter((r) => r.characterId === fledA.id)).toHaveLength(1);
    expect(out.rewards.filter((r) => r.characterId === fledB.id)).toHaveLength(1);
    expect(out.rewards.find((r) => r.characterId === fledA.id)?.creatureId).toBe(crtA.id);
    expect(out.rewards.find((r) => r.characterId === fledB.id)?.creatureId).toBe(crtB.id);
  });

  it('never pays an unrelated historical contributor', () => {
    const out = resolveTickPure(
      sweep([fledA, historical], [crtA], [bleed('eff-a', crtA.id, fledA.id)]),
    );

    expect(out.kills[0].recipientCharacterIds).toEqual([fledA.id]);
    expect(out.rewards.some((r) => r.characterId === historical.id)).toBe(false);
    expect(out.bonds.some((b) => b.characterId === historical.id)).toBe(false);
    expect(out.materials.some((m) => m.characterId === historical.id)).toBe(false);
    expect(out.gems.some((g) => g.characterId === historical.id)).toBe(false);
  });

  it('cannot award anyone when the effect source is missing', () => {
    const out = resolveTickPure(
      sweep([fledA, historical], [crtA], [bleed('eff-orphan', crtA.id, null)]),
    );

    // Creature damage/death is server-owned; attribution is not invented.
    expect(out.rewards).toHaveLength(0);
    expect(out.bonds).toHaveLength(0);
    expect(out.loot).toHaveLength(0);
  });

  it('leaves live present-player reward behaviour unchanged', () => {
    const present = participant({ id: 'char-live', name: 'Livesrc', presentAtNode: true });
    const out = resolveTickPure(
      sweep([present], [crtA], [bleed('eff-live', crtA.id, present.id)], 'live'),
    );

    expect(out.kills).toHaveLength(1);
    expect(out.kills[0].recipientCharacterIds).toEqual([present.id]);
    expect(out.rewards.filter((r) => r.characterId === present.id)).toHaveLength(1);
  });
});
