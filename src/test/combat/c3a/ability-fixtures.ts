/**
 * Per-ability golden fixtures for C3a.
 *
 * Every active ability is exercised through the same shape a production tick
 * would produce: one queued `combat_actions` row whose `params` are already
 * resolved by the loader. The fixtures are deliberately fixed (no generator) so
 * the golden digests are stable.
 */
import type {
  ActionParamsSnapshot,
  ActionSnapshot,
  EncounterSnapshot,
  ResolverMechanic,
} from '@/shared/combat/pure/types';
import { creature, participant, snapshot } from '../pure/fixtures';

/** Loader-resolved params per mechanic, chosen to force the interesting path. */
export const MECHANIC_PARAMS: Partial<Record<ResolverMechanic, ActionParamsSnapshot>> = {
  multi_attack: { minHits: 2, maxHits: 4 },
  stack_consume: { perStackMultiplier: 0.25, stackEffectType: 'poison' },
  stack_apply: {
    procChance: 1,
    stackTrigger: 'weapon_hit',
    stackEffectType: 'poison',
    dotPerTick: 4,
    pulseDamage: 0,
  },
  burst_damage: { critEdge: 2 },
  hp_transfer: { reserveHp: 20, minReserveHp: 20 },
  reactive_holy: { retaliationDamage: 7 },
  block_buff: { blockChance: 0.2, blockAmount: 6, blockChanceCap: 0.75 },
  evasion_buff: { dodgeChance: 0.25, evasionSource: 'cloak' },
  stealth_buff: { ambushMult: 2.5 },
  regen_buff: { hpPerTick: 3, cpPerTick: 4, refreshPolicy: 'best_of' },
  party_regen: { hpPerTick: 5, healsAllies: true },
  aura_pulse: { healsAllies: true, damagesEnemies: true },
};

/** Abilities whose legacy behaviour differs from the mechanic default. */
const ABILITY_PARAM_OVERRIDES: Record<string, ActionParamsSnapshot> = {
  'ranger:disengage': {
    dodgeChance: 0.3,
    evasionSource: 'disengage',
    nextHitWindowMs: 6000,
    nextHitBonusMult: 1.5,
  },
  'wizard:orbs_of_fire': {
    procChance: 1,
    stackTrigger: 'successful_pulse_hit',
    stackEffectType: 'ignite',
    dotPerTick: 6,
    pulseDamage: 5,
  },
  'wizard:conflagrate': { perStackMultiplier: 0.3, stackEffectType: 'ignite' },
};

export interface AbilityRow {
  readonly classKey: string;
  readonly classAbilityKey: string;
  readonly abilityKey: string;
  readonly mechanic: ResolverMechanic;
  readonly targetType: string | null;
  readonly damageType: string | null;
}

export function abilityId(r: AbilityRow): string {
  return `${r.classKey}:${r.classAbilityKey}`;
}

/**
 * A two-hero, one-creature encounter with the ability queued for the caster.
 * The ally is present so party/ally targeting mechanics have somewhere to land,
 * and pre-existing stacks are seeded so finishers have something to consume.
 */
export function abilityEncounter(row: AbilityRow): EncounterSnapshot {
  const caster = participant({
    id: 'char-caster',
    name: 'Caster',
    classKey: row.classKey,
    hp: 70,
    maxHp: 100,
    cp: 90,
    maxCp: 100,
    isTank: true,
    joinedAtMs: 1000,
  });
  const ally = participant({
    id: 'char-ally',
    name: 'Ally',
    classKey: 'ranger',
    hp: 40,
    maxHp: 100,
    isTank: false,
    joinedAtMs: 1001,
    partyId: 'party-1',
  });
  const foe = creature({ id: 'crt-1', hp: 400, maxHp: 400 });

  const params: ActionParamsSnapshot | undefined =
    ABILITY_PARAM_OVERRIDES[abilityId(row)] ?? MECHANIC_PARAMS[row.mechanic];

  const action: ActionSnapshot = {
    id: `act-${row.classAbilityKey}`,
    characterId: caster.id,
    creatureId: row.targetType === 'enemy' ? foe.id : null,
    allyId: row.targetType === 'ally' ? ally.id : null,
    abilityKey: row.abilityKey,
    mechanic: row.mechanic,
    damageType: row.damageType ?? 'physical',
    cpCost: 10,
    amount: 20,
    durationMs: 20000,
    intervalMs: 2000,
    statusKey: row.mechanic === 'control_debuff' ? 'chilled' : 'bleed',
    statusChancePct: 100,
    maxStacks: 5,
    weaponBased: row.mechanic === 'weapon_attack' || row.mechanic === 'multi_attack',
    sequence: 0,
    params,
  };

  const stackType = params?.stackEffectType ?? 'poison';
  const seededStacks =
    row.mechanic === 'stack_consume'
      ? [
          {
            id: 'eff-stack',
            targetKind: 'creature' as const,
            targetId: foe.id,
            effectType: stackType,
            stacks: 3,
            amountPerTick: 5,
            expiresAtMs: 1_700_000_030_000,
            intervalMs: 2000,
            nextTickAtMs: 1_700_000_004_000,
            damageType: 'physical',
            sourceCharacterId: caster.id,
            isPeriodic: true,
            ampPct: 0,
            maxStacks: 5,
          },
        ]
      : [];

  return snapshot({
    participants: [caster, ally],
    creatures: [foe],
    actions: [action],
    effects: seededStacks,
    engagements: [
      { creatureId: foe.id, characterId: caster.id, lastActionAtMs: 1_699_999_999_000 },
      { creatureId: foe.id, characterId: ally.id, lastActionAtMs: 1_699_999_999_000 },
    ],
  });
}
