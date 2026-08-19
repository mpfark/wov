/**
 * Boss crit flavor + death cry, end to end through the committed-batch path.
 *
 * Proves the three hops that were missing:
 *  1. the resolver picks an authored crit flavor and carries it as
 *     presentation metadata (no simulation influence),
 *  2. the batch projection survives the strict decoder, and
 *  3. the client renders it as MUD-style prose in BOTH display modes — with
 *     numbers, and in flavor-only ("F") mode where the [N] suffix is stripped.
 */

import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import { projectBatchFromProposal } from '@/shared/combat/c3/decode-batch';
import { batchToTickResponse } from '@/features/combat/utils/encounter-batch';
import {
  buildAttackLogEvent,
  stripFlavorNumber,
} from '@/features/combat/utils/combat-text';
import { creature, participant, snapshot } from './pure/fixtures';

const FLAVORS = [
  {
    name: 'Ashen Maw',
    text: '{creature} unhinges its jaw and pours ash over {target}',
    weight: 1,
    damageType: 'fire',
  },
];

const boss = creature({
  id: 'crt-boss',
  name: 'Emberjaw',
  rarity: 'boss',
  hp: 99999,
  maxHp: 99999,
  level: 40,
  attrs: { str: 30, dex: 30, con: 20, int: 10, wis: 10, cha: 10 },
  bossCritFlavors: FLAVORS,
  bossDeathCry: 'Emberjaw howls as its fires gutter out.',
});

/** Sweep tick numbers until the boss lands a crit (crit is a real roll). */
function findCrit() {
  for (let tick = 1; tick < 400; tick++) {
    const out = resolveTickPure(
      snapshot({
        tickNumber: tick,
        participants: [participant({ hp: 100000, maxHp: 100000, ac: 0, hasShield: false })],
        creatures: [boss],
        engagements: [{ creatureId: 'crt-boss', characterId: 'char-1', lastActionAtMs: 1000 }],
        ticksToSimulate: 4,
      }),
    );
    const crit = out.events.find((e) => e.type === 'creature_crit');
    if (crit) return { out, crit };
  }
  throw new Error('no boss crit produced');
}

describe('boss crit flavor + death cry', () => {
  it('resolver carries the authored crit flavor as presentation metadata', () => {
    const { crit } = findCrit();
    expect(crit.bossFlavorName).toBe('Ashen Maw');
    expect(crit.bossFlavorText).toBe(FLAVORS[0].text);
    expect(crit.damageType).toBe('fire');
    expect(crit.amount).toBeGreaterThan(0);
  });

  it('the same pick is reproduced when the tick is resolved again', () => {
    const { out } = findCrit();
    const again = resolveTickPure(
      snapshot({
        tickNumber: out.tickNumber,
        participants: [participant({ hp: 100000, maxHp: 100000, ac: 0, hasShield: false })],
        creatures: [boss],
        engagements: [{ creatureId: 'crt-boss', characterId: 'char-1', lastActionAtMs: 1000 }],
        ticksToSimulate: 4,
      }),
    );
    expect(again.events.map((e) => [e.type, e.bossFlavorText])).toEqual(
      out.events.map((e) => [e.type, e.bossFlavorText]),
    );
  });

  it('renders as themed prose with numbers, and flavor-only in F mode', () => {
    const { out, crit } = findCrit();
    // Round-trip through the delivery projection + strict decoder.
    const projected = projectBatchFromProposal(out, 'batch-1', { 'crt-boss': 1 });
    const payload = JSON.parse(
      JSON.stringify({
        v: projected.envelopeVersion,
        tick: projected.tick,
        batch_id: projected.batchId,
        mode: projected.mode,
        ticks_processed: projected.ticksProcessed,
        events: projected.events,
        characters: projected.characters,
        creatures: projected.creatures,
        deaths: projected.deaths,
        kills: projected.kills,
        rewards: projected.rewards,
        progression: projected.progression,
        consumedBuffs: projected.consumedBuffs,
        rejectedActions: projected.rejectedActions,
        consumedActionIds: projected.consumedActionIds,
        effectUpserts: projected.effectUpserts,
        effectDeleteTargetIds: projected.effectDeleteTargetIds,
        casts: projected.casts,
        storedPower: projected.storedPower,
        session: projected.session,
      }),
    );
    const applied = batchToTickResponse({
      batch_id: 'batch-1',
      encounter_id: out.encounterId,
      tick_number: out.tickNumber,
      payload,
    });
    expect(applied).not.toBeNull();
    const ev = applied!.events.find((e: any) => e.type === 'creature_crit') as any;
    expect(ev.boss_flavor).toEqual({
      name: 'Ashen Maw',
      text: FLAVORS[0].text,
      damage_type: 'fire',
    });

    const log = buildAttackLogEvent(ev, 'char-1');
    expect(log).not.toBeNull();
    expect(log!.crit).toBe(true);
    // Numbers mode: themed line + canonical [N] suffix.
    expect(log!.message).toContain('Emberjaw unhinges its jaw and pours ash over you');
    expect(log!.message).toContain(`[${crit.amount}]`);
    // F (flavor-only) mode: same prose, no raw number.
    const flavorOnly = stripFlavorNumber(log!.message);
    expect(flavorOnly).toContain('pours ash over you');
    expect(flavorOnly).not.toMatch(/\[\d+\]/);
  });

  it('emits the authored death cry exactly once when the boss dies', () => {
    const out = resolveTickPure(
      snapshot({
        participants: [participant({ level: 40, attrs: { str: 40, dex: 40, con: 20, int: 10, wis: 10, cha: 10 } })],
        creatures: [creature({ ...boss, hp: 1, maxHp: 99999 })],
        engagements: [{ creatureId: 'crt-boss', characterId: 'char-1', lastActionAtMs: 1000 }],
        ticksToSimulate: 6,
      }),
    );
    const cries = out.events.filter((e) => e.type === 'boss_death_cry');
    expect(cries).toHaveLength(1);
    expect(cries[0].message).toBe('Emberjaw howls as its fires gutter out.');
    expect(cries[0].creatureId).toBe('crt-boss');
  });
});
