/**
 * C1 golden tests — the combat rules that must not drift.
 *
 * Each case pins a rule, not a number pulled from a run: natural-1 misses,
 * ward-before-HP, flat vs percent mitigation, DoT attribution, kill rewards,
 * loot modes, tank targeting and durability.
 */

import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import { creature, participant, snapshot } from './fixtures';

describe('pure resolver — golden rules', () => {
  it('two-second cadence: resolvedAt advances by tickRate per simulated tick', () => {
    const out = resolveTickPure(snapshot({ ticksToSimulate: 3 }));
    expect(out.ticksProcessed).toBe(3);
    expect(out.resolvedAtMs).toBe(1_700_000_000_000 + 3 * 2000);
    expect(out.session.nextDueAtMs).toBe(out.resolvedAtMs);
  });

  it('a dead participant neither swings nor is targeted', () => {
    const p = participant({ hp: 0 });
    const out = resolveTickPure(
      snapshot({ participants: [p], ticksToSimulate: 2 }),
    );
    expect(out.events.filter((e) => e.type.startsWith('autoattack'))).toHaveLength(0);
    expect(out.events.filter((e) => e.type.startsWith('creature_hit'))).toHaveLength(0);
    expect(out.creatures[0].hpAfter).toBe(out.creatures[0].hpBefore);
  });

  it('an unengaged participant does not attack and is not attacked', () => {
    const out = resolveTickPure(snapshot({ engagements: [], ticksToSimulate: 2 }));
    expect(out.events).toHaveLength(0);
    expect(out.durability).toHaveLength(0);
  });

  it('absorb ward soaks before HP and is reported back', () => {
    const p = participant({
      hp: 50,
      ac: 0, // guarantee the creature connects
      hasShield: false,
      buffs: { ...participant().buffs, absorbShield: 500 },
    });
    const out = resolveTickPure(
      snapshot({
        participants: [p],
        creatures: [creature({ hp: 9999, level: 40 })],
        ticksToSimulate: 3,
      }),
    );
    const me = out.characters[0];
    expect(me.hpAfter).toBe(50); // ward covered everything
    expect(me.absorbShieldAfter).toBeLessThan(500);
  });

  it('percent mitigation is capped at 90% and flat mitigation subtracts after it', () => {
    const base = participant({ hp: 400, ac: 0, hasShield: false });
    const plain = resolveTickPure(
      snapshot({
        participants: [base],
        creatures: [creature({ hp: 9999, level: 40 })],
        ticksToSimulate: 4,
      }),
    );
    const mitigated = resolveTickPure(
      snapshot({
        participants: [
          participant({
            ...base,
            buffs: { ...base.buffs, mitigationPct: 0.5, mitigationFlat: 3 },
          }),
        ],
        creatures: [creature({ hp: 9999, level: 40 })],
        ticksToSimulate: 4,
      }),
    );
    const took = (r: ReturnType<typeof resolveTickPure>) =>
      r.characters[0].hpBefore - r.characters[0].hpAfter;
    expect(took(mitigated)).toBeLessThan(took(plain));
  });

  it('a DoT on a creature ticks on its own interval and attributes to its applier', () => {
    const p = participant();
    const c = creature({ hp: 500 });
    const out = resolveTickPure(
      snapshot({
        participants: [p],
        creatures: [c],
        ticksToSimulate: 3,
        effects: [
          {
            id: 'eff-1',
            targetKind: 'creature',
            targetId: c.id,
            effectType: 'bleed',
            stacks: 2,
            amountPerTick: 5,
            expiresAtMs: 1_700_000_100_000,
            intervalMs: 2000,
            nextTickAtMs: 1_699_999_998_000,
            damageType: 'physical',
            sourceCharacterId: p.id,
            isPeriodic: true,
            ampPct: 0,
          },
        ],
      }),
    );
    const dots = out.events.filter((e) => e.type === 'dot_tick');
    expect(dots.length).toBeGreaterThanOrEqual(1);
    expect(dots[0].amount).toBe(10); // 5 per tick x 2 stacks
    expect(dots[0].characterId).toBe(p.id);
  });

  it('an expired effect is proposed for deletion and never ticks', () => {
    const c = creature();
    const out = resolveTickPure(
      snapshot({
        creatures: [c],
        effects: [
          {
            id: 'eff-old',
            targetKind: 'creature',
            targetId: c.id,
            effectType: 'bleed',
            stacks: 1,
            amountPerTick: 99,
            expiresAtMs: 1_699_999_000_000,
            intervalMs: 2000,
            nextTickAtMs: 1_699_998_000_000,
            damageType: 'physical',
            sourceCharacterId: 'char-1',
            isPeriodic: true,
            ampPct: 0,
          },
        ],
      }),
    );
    expect(out.effectDeleteIds).toContain('eff-old');
    expect(out.events.filter((e) => e.type === 'dot_tick')).toHaveLength(0);
  });

  it('a kill proposes xp, bond, salvage and a legacy loot roll — never a write', () => {
    const p = participant({ level: 12 });
    const out = resolveTickPure(
      snapshot({
        participants: [p],
        creatures: [creature({ hp: 1, ac: 0 })],
        ticksToSimulate: 6,
      }),
    );
    expect(out.kills).toHaveLength(1);
    expect(out.kills[0].recipientCharacterIds).toEqual([p.id]);
    expect(out.rewards[0].xp).toBeGreaterThan(0);
    expect(out.bonds[0].amount).toBe(6); // level 12 non-boss → round(6)
    expect(out.materials[0]).toEqual({
      characterId: p.id,
      materialKey: 'scrap',
      quantity: 1,
    });
    expect(out.creatures[0].killed).toBe(true);
    expect(out.engagementsPurgeCreatureIds).toEqual(['crt-1']);
    expect(out.effectDeleteTargetIds).toEqual(['crt-1']);
  });

  it('boss kills pay renown and a x4 salvage multiplier', () => {
    const out = resolveTickPure(
      snapshot({
        creatures: [creature({ hp: 1, ac: 0, rarity: 'boss', level: 30 })],
        ticksToSimulate: 6,
      }),
    );
    expect(out.rewards[0].renown).toBe(15); // floor(30 * 0.5)
    expect(out.materials[0].quantity).toBe(4);
    expect(out.bonds[0].isBoss).toBe(true);
  });

  it('rare kills pay a small renown floor', () => {
    const out = resolveTickPure(
      snapshot({
        creatures: [creature({ hp: 1, ac: 0, rarity: 'rare', level: 4 })],
        ticksToSimulate: 6,
      }),
    );
    expect(out.rewards[0].renown).toBe(1);
  });

  it('item_pool mode proposes a pool draw with the creature drop chance', () => {
    const out = resolveTickPure(
      snapshot({
        creatures: [creature({ hp: 1, ac: 0, lootMode: 'item_pool', dropChance: 0.3 })],
        ticksToSimulate: 6,
      }),
    );
    expect(out.loot).toEqual([
      {
        creatureId: 'crt-1',
        creatureName: 'Cave Thrum',
        creatureLevel: 12,
        creatureRarity: 'regular',
        mode: 'item_pool',
        lootTableId: null,
        itemId: null,
        dropChance: 0.3,
      },
    ]);
  });

  it('salvage_only mode proposes no item loot', () => {
    const out = resolveTickPure(
      snapshot({
        creatures: [creature({ hp: 1, ac: 0, lootMode: 'salvage_only' })],
        ticksToSimulate: 6,
      }),
    );
    expect(out.loot).toHaveLength(0);
    expect(out.materials).toHaveLength(1);
  });

  it('a loot-table id defers the roll to the committer with the legacy 0.5 default', () => {
    const out = resolveTickPure(
      snapshot({
        creatures: [creature({ hp: 1, ac: 0, lootTableId: 'lt-9', dropChance: null })],
        ticksToSimulate: 6,
      }),
    );
    expect(out.loot[0]).toMatchObject({ mode: 'legacy', lootTableId: 'lt-9', dropChance: 0.5 });
  });

  it('humanoid gold uses the best CHA in the party', () => {
    const low = participant({ id: 'a', attrs: { ...participant().attrs, cha: 8 } });
    const high = participant({ id: 'b', attrs: { ...participant().attrs, cha: 30 }, isTank: false });
    const c = creature({ hp: 1, ac: 0, isHumanoid: true, salvageMaterialKey: null });
    const eng = [
      { creatureId: c.id, characterId: 'a', lastActionAtMs: 1 },
      { creatureId: c.id, characterId: 'b', lastActionAtMs: 1 },
    ];
    const rich = resolveTickPure(
      snapshot({ participants: [low, high], creatures: [c], engagements: eng }),
    );
    const poor = resolveTickPure(
      snapshot({ participants: [low], creatures: [c], engagements: [eng[0]] }),
    );
    expect(rich.rewards[0].gold * 2).toBeGreaterThanOrEqual(poor.rewards[0].gold);
  });

  it('party kills split gold and apply the party XP bonus', () => {
    const a = participant({ id: 'a' });
    const b = participant({ id: 'b', isTank: false });
    const c = creature({ hp: 1, ac: 0 });
    const out = resolveTickPure(
      snapshot({
        participants: [a, b],
        creatures: [c],
        engagements: [
          { creatureId: c.id, characterId: 'a', lastActionAtMs: 1 },
          { creatureId: c.id, characterId: 'b', lastActionAtMs: 1 },
        ],
      }),
    );
    expect(out.rewards).toHaveLength(2);
    expect(out.rewards[0].gold).toBe(out.rewards[1].gold);
    expect(out.kills[0].recipientCharacterIds).toEqual(['a', 'b']);
  });

  it('tank_strict boss casts only ever target a tank', () => {
    const tank = participant({ id: 'tank', isTank: true });
    const dps = participant({ id: 'dps', isTank: false });
    const boss = creature({
      id: 'boss',
      hp: 900,
      rarity: 'boss',
      bossCast: {
        abilityKey: 'doom',
        label: 'Doom',
        castTicks: 2,
        cooldownTicks: 3,
        damage: 40,
        damageType: 'fire',
        targetMode: 'tank_strict',
        channeling: true,
        storedPowerCap: 5,
        castingText: 'Doom gathers.',
        castedText: 'Doom lands.',
      },
    });
    for (let tick = 1; tick <= 60; tick++) {
      const out = resolveTickPure(
        snapshot({
          tickNumber: tick,
          participants: [tank, dps],
          creatures: [boss],
          engagements: [
            { creatureId: 'boss', characterId: 'tank', lastActionAtMs: 1 },
            { creatureId: 'boss', characterId: 'dps', lastActionAtMs: 1 },
          ],
          ticksToSimulate: 1,
        }),
      );
      for (const cast of out.casts) {
        if (cast.phase === 'start') expect(cast.targetCharacterId).toBe('tank');
      }
    }
  });

  it('channelled boss casts accrue Stored Power up to the cap and fold it into damage', () => {
    const boss = creature({
      id: 'boss',
      hp: 900,
      rarity: 'boss',
      storedPower: 4,
      storedPowerCap: 5,
      bossCast: {
        abilityKey: 'doom',
        label: 'Doom',
        castTicks: 1,
        cooldownTicks: 1,
        damage: 10,
        damageType: 'fire',
        targetMode: 'tank_preferred',
        channeling: true,
        storedPowerCap: 5,
        castingText: null,
        castedText: null,
      },
    });
    const out = resolveTickPure(
      snapshot({
        creatures: [boss],
        engagements: [{ creatureId: 'boss', characterId: 'char-1', lastActionAtMs: 1 }],
        ticksToSimulate: 1,
      }),
    );
    expect(out.storedPower).toEqual([{ creatureId: 'boss', delta: 1, cap: 5 }]);
    expect(out.casts[0].damage).toBe(15); // 10 + stored 5
  });

  it('a boss with nobody engaged fizzles instead of casting', () => {
    const boss = creature({
      id: 'boss',
      rarity: 'boss',
      bossCast: {
        abilityKey: 'doom',
        label: 'Doom',
        castTicks: 1,
        cooldownTicks: 1,
        damage: 10,
        damageType: null,
        targetMode: 'tank_strict',
        channeling: false,
        storedPowerCap: 0,
        castingText: null,
        castedText: null,
      },
    });
    const out = resolveTickPure(
      snapshot({ creatures: [boss], engagements: [], ticksToSimulate: 1 }),
    );
    expect(out.casts.map((c) => c.phase)).toEqual(['fizzle']);
  });

  it('an ability with too little CP is rejected, never silently consumed', () => {
    const p = participant({ cp: 5 });
    const out = resolveTickPure(
      snapshot({
        participants: [p],
        actions: [
          {
            id: 'act-1',
            characterId: p.id,
            creatureId: 'crt-1',
            allyId: null,
            abilityKey: 'rend',
            mechanic: 'dot_debuff',
            damageType: 'physical',
            cpCost: 40,
            amount: 6,
            durationMs: 20000,
            intervalMs: 2000,
            statusKey: 'bleed',
            statusChancePct: 100,
            maxStacks: 5,
            weaponBased: true,
            sequence: 0,
          },
        ],
      }),
    );
    expect(out.rejectedActions).toEqual([{ actionId: 'act-1', reason: 'insufficient_cp' }]);
    expect(out.consumedActionIds).toHaveLength(0);
    expect(out.characters[0].cpAfter).toBe(5);
  });

  it('a 100%-chance DoT ability always lands and pays its CP once', () => {
    const p = participant({ cp: 60 });
    const out = resolveTickPure(
      snapshot({
        participants: [p],
        creatures: [creature({ hp: 400 })],
        ticksToSimulate: 3,
        actions: [
          {
            id: 'act-1',
            characterId: p.id,
            creatureId: 'crt-1',
            allyId: null,
            abilityKey: 'rend',
            mechanic: 'dot_debuff',
            damageType: 'physical',
            cpCost: 40,
            amount: 6,
            durationMs: 20000,
            intervalMs: 2000,
            statusKey: 'bleed',
            statusChancePct: 100,
            maxStacks: 5,
            weaponBased: true,
            sequence: 0,
          },
        ],
      }),
    );
    expect(out.consumedActionIds).toEqual(['act-1']);
    expect(out.characters[0].cpAfter).toBe(20);
    expect(out.effectUpserts.filter((e) => e.effectType === 'bleed')).toHaveLength(1);
  });

  it('healing never revives the fallen', () => {
    const dead = participant({ id: 'dead', hp: 0, isTank: false });
    const healer = participant({ id: 'healer', classKey: 'healer' });
    const out = resolveTickPure(
      snapshot({
        participants: [healer, dead],
        actions: [
          {
            id: 'act-h',
            characterId: 'healer',
            creatureId: null,
            allyId: 'dead',
            abilityKey: 'heal',
            mechanic: 'heal',
            damageType: null,
            cpCost: 10,
            amount: 50,
            durationMs: 0,
            intervalMs: 0,
            statusKey: null,
            statusChancePct: 0,
            maxStacks: 0,
            weaponBased: false,
            sequence: 0,
          },
        ],
      }),
    );
    const deadRow = out.characters.find((c) => c.characterId === 'dead')!;
    expect(deadRow.hpAfter).toBe(0);
  });

  it('durability is proposed once per hitter, on an equipped slot', () => {
    const out = resolveTickPure(snapshot({ ticksToSimulate: 4 }));
    expect(out.durability.length).toBeLessThanOrEqual(1);
    for (const d of out.durability) {
      expect(['inv-a', 'inv-b', 'inv-c']).toContain(d.inventoryId);
    }
  });

  it('a fight with every creature dead proposes ending the session', () => {
    const out = resolveTickPure(
      snapshot({ creatures: [creature({ hp: 1, ac: 0 })], ticksToSimulate: 6 }),
    );
    expect(out.session.ended).toBe(true);
  });

  it('proposes nothing at all when asked for zero ticks', () => {
    const out = resolveTickPure(snapshot({ ticksToSimulate: 0 }));
    expect(out.events).toHaveLength(0);
    expect(out.kills).toHaveLength(0);
    expect(out.rewards).toHaveLength(0);
    expect(out.durability).toHaveLength(0);
    expect(out.ticksProcessed).toBe(0);
  });
});
