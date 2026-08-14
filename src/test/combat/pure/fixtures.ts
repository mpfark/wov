/**
 * Snapshot fixtures for the pure resolver tests.
 *
 * Deliberately plain data with a seeded pseudo-random *generator* (not used
 * inside the resolver) so parity runs can sweep thousands of encounters.
 */

import type {
  ActionSnapshot,
  CreatureSnapshot,
  EffectSnapshot,
  EncounterSnapshot,
  EngagementSnapshot,
  ParticipantSnapshot,
  ProcSnapshot,
  ResolverConfig,
} from '@/shared/combat/pure/types';

/** Test-only deterministic generator (mulberry32). Never used by the resolver. */
export function makeGen(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CONFIG: ResolverConfig = {
  xpBoostMultiplier: 1,
  gemDropChance: 0.1,
  weaponProgression: { tier1_level: 11, tier2_level: 21, tier3_level: 31 },
  statusDefs: [
    { key: 'bleed', isPeriodic: true, ampPct: 0, maxStacks: 5 },
    { key: 'chilled', isPeriodic: false, ampPct: 10, maxStacks: 1 },
  ],
};

export function participant(
  over: Partial<ParticipantSnapshot> = {},
): ParticipantSnapshot {
  return {
    id: 'char-1',
    name: 'Aldric',
    level: 12,
    classKey: 'warrior',
    hp: 80,
    maxHp: 80,
    cp: 60,
    maxCp: 60,
    mp: 40,
    maxMp: 40,
    xp: 0,
    unspentStatPoints: 0,
    respecPoints: 0,
    equipmentBonuses: {},
    attrs: { str: 16, dex: 14, con: 15, int: 10, wis: 11, cha: 12 },
    ac: 14,
    hasShield: true,
    weapon: {
      tag: 'sword',
      hands: 1,
      itemLevel: 12,
      rarity: 'uncommon',
      equippedInventoryIds: ['inv-a', 'inv-b', 'inv-c'],
    },
    buffs: {
      stealth: false,
      damageBuff: false,
      mitigationPct: 0,
      mitigationFlat: 0,
      absorbShield: 0,
      dodgeChance: 0,
      critBuffBonus: 0,
      blockBuff: false,
      rooted: false,
    },
    partyId: null,
    isTank: true,
    joinedAtMs: 1000,
    isUncappedXp: true,
    ...over,
  };
}

export function creature(over: Partial<CreatureSnapshot> = {}): CreatureSnapshot {
  return {
    id: 'crt-1',
    name: 'Cave Thrum',
    level: 12,
    rarity: 'regular',
    hp: 90,
    maxHp: 90,
    ac: 13,
    attrs: { str: 14, dex: 12, con: 14, int: 6, wis: 8, cha: 6 },
    isAlive: true,
    isHumanoid: false,
    lootMode: 'legacy_table',
    lootTableId: null,
    dropChance: null,
    lootTable: [
      { type: 'gold', itemId: null, chance: 0.6, min: 5, max: 20 },
      { type: 'item', itemId: 'item-1', chance: 0.25, min: 0, max: 0 },
    ],
    salvageMaterialKey: 'scrap',
    bossCast: null,
    storedPower: 0,
    storedPowerCap: 5,
    castCooldownTicks: 0,
    ...over,
  };
}

export function snapshot(over: Partial<EncounterSnapshot> = {}): EncounterSnapshot {
  const p = participant();
  const c = creature();
  return {
    mode: 'live',
    encounterId: 'enc-1',
    nodeId: 'node-1',
    tickNumber: 42,
    ticksToSimulate: 1,
    tickRateMs: 2000,
    nowMs: 1_700_000_000_000,
    participants: [p],
    creatures: [c],
    effects: [],
    actions: [],
    engagements: [{ creatureId: c.id, characterId: p.id, lastActionAtMs: 1_699_999_000_000 }],
    activeCasts: [],
    procs: [],
    config: CONFIG,
    ...over,
  };
}

/** A randomized-but-generated encounter for parity sweeps. */
export function randomSnapshot(seed: number): EncounterSnapshot {
  const g = makeGen(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(g() * items.length)];
  const int = (min: number, max: number) => min + Math.floor(g() * (max - min + 1));

  const memberCount = int(1, 4);
  const participants: ParticipantSnapshot[] = Array.from({ length: memberCount }, (_, i) =>
    participant({
      id: `char-${i}`,
      name: `Hero${i}`,
      level: int(1, 42),
      classKey: pick(['warrior', 'wizard', 'ranger', 'assassin', 'healer', 'bard', 'templar']),
      hp: int(10, 200),
      maxHp: 200,
      cp: int(0, 100),
      maxCp: 100,
      attrs: {
        str: int(6, 30),
        dex: int(6, 30),
        con: int(6, 30),
        int: int(6, 30),
        wis: int(6, 30),
        cha: int(6, 30),
      },
      ac: int(8, 26),
      hasShield: g() < 0.5,
      isTank: i === 0,
      joinedAtMs: 1000 + i,
      isUncappedXp: g() < 0.9,
      weapon: {
        tag: pick(['sword', 'axe', 'mace', 'dagger', 'bow', 'staff', 'wand', null]),
        hands: g() < 0.4 ? 2 : 1,
        itemLevel: int(1, 42),
        rarity: pick(['common', 'uncommon', 'unique', 'soulforged']),
        equippedInventoryIds: [`inv-${i}-a`, `inv-${i}-b`],
      },
      buffs: {
        stealth: g() < 0.1,
        damageBuff: g() < 0.15,
        mitigationPct: g() < 0.2 ? 0.15 : 0,
        mitigationFlat: g() < 0.2 ? int(1, 6) : 0,
        absorbShield: g() < 0.3 ? int(5, 60) : 0,
        dodgeChance: g() < 0.15 ? 0.25 : 0,
        critBuffBonus: g() < 0.2 ? 1 : 0,
        blockBuff: g() < 0.2,
        rooted: g() < 0.1,
      },
    }),
  );

  const creatureCount = int(1, 3);
  const creatures: CreatureSnapshot[] = Array.from({ length: creatureCount }, (_, i) => {
    const rarity = pick(['regular', 'rare', 'boss'] as const);
    return creature({
      id: `crt-${i}`,
      name: `Beast${i}`,
      level: int(1, 45),
      rarity,
      hp: int(1, 400),
      maxHp: 400,
      ac: int(8, 26),
      isHumanoid: g() < 0.4,
      lootMode: pick(['legacy_table', 'item_pool', 'salvage_only'] as const),
      lootTableId: g() < 0.3 ? `lt-${i}` : null,
      dropChance: g() < 0.5 ? Number(g().toFixed(2)) : null,
      salvageMaterialKey: g() < 0.8 ? 'scrap' : null,
      storedPower: int(0, 4),
      castCooldownTicks: int(0, 2),
      bossCast:
        rarity === 'boss' && g() < 0.8
          ? {
              abilityKey: 'doom_beam',
              castKey: 'doom_beam',
              label: 'Doom Beam',
              castTicks: int(1, 3),
              cooldownTicks: int(2, 5),
              damage: int(10, 60),
              damageAoe: int(0, 20),
              damageType: 'fire',
              targetMode: pick(['tank_strict', 'tank_preferred', 'random_alive'] as const),
              channeling: g() < 0.5,
              storedPowerCap: 5,
              primaryShare: 1,
              aoeShare: Number(g().toFixed(2)),
              consumeMode: pick(['all', 'percent', 'fixed', 'preserve', 'reset', 'ignore'] as const),
              consumePct: int(10, 100),
              consumeFixed: int(0, 5),
              pauseAutoattacks: g() < 0.7,
              lockMs: pick([0, 1500, 3000]),
              castingText: 'The beast gathers ruin.',
              castedText: 'The beam lands.',
            }
          : null,
    });
  });

  const engagements: EngagementSnapshot[] = [];
  for (const p of participants) {
    for (const c of creatures) {
      if (g() < 0.8) {
        engagements.push({ creatureId: c.id, characterId: p.id, lastActionAtMs: 1000 });
      }
    }
  }

  const effects: EffectSnapshot[] = [];
  for (const c of creatures) {
    if (g() < 0.5) {
      effects.push({
        id: `eff-c-${c.id}`,
        targetKind: 'creature',
        targetId: c.id,
        effectType: pick(['bleed', 'poison', 'ignite']),
        stacks: int(1, 5),
        amountPerTick: int(1, 12),
        expiresAtMs: 1_700_000_000_000 + int(0, 20000),
        intervalMs: 2000,
        nextTickAtMs: 1_699_999_998_000,
        damageType: 'physical',
        sourceCharacterId: participants[0].id,
        isPeriodic: true,
        ampPct: 0,
      });
    }
    if (g() < 0.25) {
      effects.push({
        id: `eff-amp-${c.id}`,
        targetKind: 'creature',
        targetId: c.id,
        effectType: 'chilled',
        stacks: 1,
        amountPerTick: 0,
        expiresAtMs: 1_700_000_000_000 + 10000,
        intervalMs: 0,
        nextTickAtMs: 1_699_999_998_000,
        damageType: null,
        sourceCharacterId: participants[0].id,
        isPeriodic: false,
        ampPct: 10,
      });
    }
  }

  const actions: ActionSnapshot[] = [];
  for (const p of participants) {
    if (g() < 0.6) {
      const mechanic = pick([
        'weapon_attack',
        'spell_attack',
        'heal',
        'dot_debuff',
        'absorb_buff',
        'mitigation_buff',
        'offense_buff',
        'control_debuff',
      ] as const);
      actions.push({
        id: `act-${p.id}`,
        characterId: p.id,
        creatureId: creatures[int(0, creatures.length - 1)].id,
        allyId: g() < 0.3 ? participants[0].id : null,
        abilityKey: 'test_ability',
        mechanic,
        damageType: 'physical',
        cpCost: int(0, 40),
        amount: int(1, 40),
        durationMs: int(2000, 30000),
        intervalMs: 2000,
        statusKey: 'bleed',
        statusChancePct: int(0, 100),
        maxStacks: 5,
        weaponBased: g() < 0.5,
        sequence: actions.length,
      });
    }
  }

  const procs: ProcSnapshot[] = [];
  for (const p of participants) {
    if (g() < 0.35) {
      procs.push({
        id: `proc-${p.id}`,
        characterId: p.id,
        kind: pick(['lifesteal', 'elemental', 'weaken', 'heal_pulse'] as const),
        chance: Number(g().toFixed(2)),
        amount: int(1, 25),
        weight: int(1, 5),
        damageType: 'fire',
        label: 'Emberbrand',
      });
    }
  }

  // Some encounters start mid-telegraph, so the randomized suites exercise the
  // channel and release halves of a cast, not just the start.
  const activeCasts = creatures
    .filter((c) => c.bossCast && g() < 0.4)
    .map((c) => {
      const cast = c.bossCast!;
      const due = g() < 0.5;
      return {
        castEventId: `cast-${c.id}`,
        creatureId: c.id,
        abilityKey: cast.abilityKey,
        castKey: cast.castKey,
        label: cast.label,
        startedAtMs: 1_699_999_990_000,
        resolvesAtMs: due ? 1_699_999_999_000 : 1_700_000_010_000,
        targetCharacterId: participants.length > 0 ? participants[0].id : null,
        baseDamage: cast.damage,
        baseAoeDamage: cast.damageAoe,
        damageType: cast.damageType,
        primaryShare: cast.primaryShare,
        aoeShare: cast.aoeShare,
        consumeMode: cast.consumeMode,
        consumePct: cast.consumePct,
        consumeFixed: cast.consumeFixed,
        pauseAutoattacks: cast.pauseAutoattacks,
        storedPowerCap: cast.storedPowerCap,
        lockMs: cast.lockMs,
        castedText: cast.castedText,
      };
    });

  return {
    mode: g() < 0.5 ? 'live' : 'catchup',
    encounterId: `enc-${seed}`,
    nodeId: 'node-1',
    tickNumber: int(1, 100000),
    ticksToSimulate: int(1, 4),
    tickRateMs: 2000,
    nowMs: 1_700_000_000_000,
    participants,
    creatures,
    effects,
    actions,
    engagements,
    activeCasts,
    procs,
    config: CONFIG,
  };
}
