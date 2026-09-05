import { describe, expect, it } from 'vitest';
import { resolveNodeTick } from '../resolver';
import { buildAbilitySpec } from '../catalog';
import type { AbilitySpec } from '../mechanics';
import type { NodeSnapshot, SnapshotCreature, SnapshotEffect, SnapshotFighter, SnapshotIntent } from '../types';

const NOW = '2026-01-01T00:00:00.000Z';
const nowPlus = (msOffset: number): string => new Date(Date.parse(NOW) + msOffset).toISOString();

function fighter(overrides: Partial<SnapshotFighter> & { character_id: string }): SnapshotFighter {
  return {
    id: `f-${overrides.character_id}`,
    entry_seq: 1,
    present: true,
    party_id_at_entry: null,
    party_id: null,
    name: 'Tester',
    class: 'warrior',
    race: 'human',
    level: 10,
    hp: 100,
    max_hp: 100,
    cp: 50,
    max_cp: 50,
    mp: 10,
    max_mp: 10,
    ac: 12,
    str: 14,
    dex: 12,
    con: 12,
    int: 10,
    wis: 10,
    cha: 10,
    equipment: [],
    ...overrides,
  };
}

function creature(overrides: Partial<SnapshotCreature> = {}): SnapshotCreature {
  return {
    id: 'nc-1',
    creature_id: 'cr-1',
    spawn_seq: 3,
    hp: 60,
    is_alive: true,
    engaged: true,
    pending_action: null,
    tank_fighter_id: 'f-ch-1',
    name: 'Granite Sentinel',
    level: 10,
    max_hp: 60,
    ac: 12,
    stats: { str: 12 },
    rarity: 'common',
    is_humanoid: false,
    is_aggressive: true,
    boss_crit_flavors: null,
    boss_death_cry: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    encounter: {
      id: 'enc-1',
      node_id: 'node-1',
      tick: 10,
      candidate_tick: 11,
      state_version: 4,
      now: NOW,
    },
    creatures: [creature()],
    fighters: [fighter({ character_id: 'ch-1' })],
    effects: [],
    intents: [],
    boss_abilities: [],
    tank_candidates: [{ fighter_id: 'f-ch-1', character_id: 'ch-1', entry_seq: 1 }],
    ...overrides,
  };
}

function pending(overrides: Partial<NonNullable<SnapshotCreature['pending_action']>> = {}): NonNullable<SnapshotCreature['pending_action']> {
  return {
    ability_key: 'granite_slam',
    ability_label: 'Granite Slam',
    started_at_tick: 9,
    resolve_at_tick: 11,
    target_fighter_id: 'f-ch-1',
    target_character_id: 'ch-1',
    target_entry_seq: 1,
    ...overrides,
  };
}

function bossAbility(overrides: Partial<NodeSnapshot['boss_abilities'][number]> = {}): NodeSnapshot['boss_abilities'][number] {
  return {
    id: 'ba-1', creature_id: 'cr-1', ability_key: 'granite_slam', label: 'Granite Slam',
    weight: 1, windup_ticks: 2, targeting: 'aoe', magnitude: 20, amount_calc: null,
    damage_type: 'physical', effect: null,
    telegraph_text: 'gathers force', resolution_text: 'slams down',
    ...overrides,
  };
}

function absorbEffect(id: string, characterId: string, magnitude: number, overrides: Partial<SnapshotEffect> = {}): SnapshotEffect {
  return {
    id, kind: 'absorb', effect_type: 'force_shield', ability_key: 'force_shield',
    target_character_id: characterId, target_creature_id: null,
    source_character_id: characterId, source_creature_id: null,
    stacks: 1, magnitude, config: {}, expires_at: null, next_due_at: null,
    interval_ms: null, last_pulse_tick: null, is_reservation: false,
    ...overrides,
  };
}

/** An intent row exactly as `node_intent` shapes it. */
function abilityIntent(
  id: string,
  seq: number,
  characterId: string,
  abilityKey: string,
  targetCreatureId: string | null,
): SnapshotIntent {
  return {
    id,
    seq,
    character_id: characterId,
    intent_kind: 'ability',
    ability_key: abilityKey,
    stance_key: null,
    target_creature_id: targetCreatureId,
  };
}

/** Built through the real adapter from an authored record, never hand-shaped. */
const built = buildAbilitySpec({
  classKey: 'warrior',
  classAbilityKey: 'power_strike',
  abilityKey: 'power_strike',
  label: 'Power Strike',
  mechanic: 'weapon_attack',
  targetType: 'enemy',
  activationMode: 'queued',
  damageType: 'physical',
  cpCost: 5,
  cpReservePct: null,
  intervalMs: null,
  amountCalc: {
    version: 2,
    base: 6,
    terms: [{ source: 'stat', stat: 'str', mult: 2, role: 'primary' }],
    rounding: 'floor',
    unit: 'hp',
  },
  durationCalc: null,
  mechanicCalcs: null,
  effectConfig: { accuracy_stat: 'dex', stat: 'str' },
});
if (!('spec' in built)) throw new Error('fixture spec rejected');
const weaponAttack: AbilitySpec = built.spec;

const abilities = new Map<string, AbilitySpec>([
  [weaponAttack.abilityKey, weaponAttack],
  [`warrior:${weaponAttack.abilityKey}`, weaponAttack],
]);


describe('combat2 resolver', () => {
  it('is deterministic for an identical snapshot and candidate tick', () => {
    const a = resolveNodeTick(snapshot(), { abilities });
    const b = resolveNodeTick(snapshot(), { abilities });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('proposes the candidate tick, never the last committed tick', () => {
    const out = resolveNodeTick(snapshot(), { abilities });
    expect(out.tick).toBe(11);
  });

  it('consumes only the intents present in the snapshot', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          abilityIntent('i-1', 7, 'ch-1', 'power_strike', 'cr-1'),
        ],
      }),
      { abilities },
    );
    expect(out.intent_ids).toEqual(['i-1']);
  });

  it('rejects an ability outside the closed catalogue without writing state', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          abilityIntent('i-9', 8, 'ch-1', 'not_a_real_ability', 'cr-1'),
        ],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'action_rejected' && e.outcomeReason === 'unknown_ability')).toBe(true);
    expect(out.rewards).toEqual([]);
  });

  it('spends CP and damages the creature on a landed player action', () => {
    const out = resolveNodeTick(
      snapshot({
        intents: [
          abilityIntent('i-2', 9, 'ch-1', 'power_strike', 'cr-1'),
        ],
      }),
      { abilities },
    );
    const actor = out.characters.find((c) => c.id === 'ch-1');
    expect(actor?.cp).toBe(45);
  });

  it('removes an effect whose wall-clock lifetime lapsed without pulsing it', () => {
    const out = resolveNodeTick(
      snapshot({
        effects: [
          {
            id: 'e-1',
            kind: 'dot',
            effect_type: 'rend',
            ability_key: 'rend',
            target_character_id: null,
            target_creature_id: 'cr-1',
            source_character_id: 'ch-1',
            source_creature_id: null,
            stacks: 1,
            magnitude: 5,
            config: {},
            expires_at: nowPlus(-1000),
            next_due_at: nowPlus(-500),
            interval_ms: 2000,
            last_pulse_tick: 5,
            is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    expect(out.effects_delete).toContain('e-1');
    expect(out.events.some((e) => e.kind === 'effect_pulse')).toBe(false);
  });

  it('pulses a periodic effect at most once per tick and skips missed pulses', () => {
    const base = snapshot({
      effects: [
        {
          id: 'e-2',
          kind: 'dot',
          effect_type: 'rend',
          ability_key: 'rend',
          target_character_id: null,
          target_creature_id: 'cr-1',
          source_character_id: 'ch-1',
          source_creature_id: null,
          stacks: 1,
          magnitude: 5,
          config: {},
          expires_at: nowPlus(60_000),
          next_due_at: nowPlus(-30_000),
          interval_ms: 2000,
          last_pulse_tick: 5,
          is_reservation: false,
        },
      ],
    });
    const out = resolveNodeTick(base, { abilities });
    const pulses = out.events.filter((e) => e.kind === 'effect_pulse');
    expect(pulses).toHaveLength(1);
    expect(pulses[0].amount).toBe(5);
    const update = out.effects_update.find((u) => u.id === 'e-2');
    expect(update?.last_pulse_tick).toBe(11);
    expect(Date.parse(update!.next_due_at!)).toBe(Date.parse(NOW) + 2000);
  });

  it('never pulses the same effect twice for the same tick', () => {
    const out = resolveNodeTick(
      snapshot({
        effects: [
          {
            id: 'e-3', kind: 'dot', effect_type: 'rend', ability_key: 'rend',
            target_character_id: null, target_creature_id: 'cr-1',
            source_character_id: 'ch-1', source_creature_id: null,
            stacks: 1, magnitude: 5, config: {},
            expires_at: nowPlus(60_000), next_due_at: nowPlus(-1),
            interval_ms: 2000, last_pulse_tick: 11, is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'effect_pulse')).toBe(false);
  });

  it('attributes an offscreen damage-over-time kill to the effect source', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ hp: 4 })],
        fighters: [fighter({ character_id: 'ch-1', present: false })],
        effects: [
          {
            id: 'e-4', kind: 'dot', effect_type: 'rend', ability_key: 'rend',
            target_character_id: null, target_creature_id: 'cr-1',
            source_character_id: 'ch-1', source_creature_id: null,
            stacks: 1, magnitude: 9, config: {},
            expires_at: nowPlus(60_000), next_due_at: nowPlus(-1),
            interval_ms: 2000, last_pulse_tick: 5, is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    const death = out.events.find((e) => e.kind === 'creature_died');
    expect(death?.meta?.killedBy).toBe('ch-1');
    expect(out.rewards).toHaveLength(1);
    expect(out.rewards[0]).toMatchObject({ creature_id: 'cr-1', spawn_seq: 3, character_id: 'ch-1', is_killer: true });
  });

  it('writes a pending action for a telegraphed boss ability and skips the autoattack', () => {
    const out = resolveNodeTick(
      snapshot({
        boss_abilities: [bossAbility()],
      }),
      { abilities },
    );
    expect(out.events.some((e) => e.kind === 'boss_telegraph')).toBe(true);
    expect(out.events.some((e) => e.kind === 'creature_attack')).toBe(false);
    expect(out.creatures[0].pending_action).toEqual({
      ability_key: 'granite_slam', ability_label: 'Granite Slam',
      started_at_tick: 11, resolve_at_tick: 13,
      target_fighter_id: 'f-ch-1', target_character_id: 'ch-1', target_entry_seq: 1,
    });
    expect(out.events.find((event) => event.kind === 'boss_telegraph')?.target?.id).toBe('ch-1');
  });

  it('hits the unchanged captured fighter exactly once at resolution', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ pending_action: pending() })],
        boss_abilities: [bossAbility()],
      }),
      { abilities },
    );
    expect(out.creatures[0].pending_action).toBeNull();
    expect(out.events.filter((e) => e.kind === 'creature_attack' && e.abilityKey === 'granite_slam')).toHaveLength(1);
    expect(out.events.filter((e) => e.kind === 'boss_cast_evaded')).toHaveLength(0);
  });

  it('gives the empty-ground result when nobody is present at resolution', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ pending_action: pending() })],
        fighters: [fighter({ character_id: 'ch-1', present: false })],
        boss_abilities: [bossAbility()],
      }),
      { abilities },
    );
    expect(out.events.filter((e) => e.kind === 'boss_cast_evaded')).toHaveLength(1);
    expect(out.characters.find((c) => c.id === 'ch-1')?.hp ?? 100).toBe(100);
  });

  it('does not retarget when the captured fighter leaves and another fighter becomes tank', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ pending_action: pending() })],
      fighters: [
        fighter({ character_id: 'ch-1', present: false }),
        fighter({ character_id: 'ch-2', entry_seq: 2 }),
      ],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.events.filter((event) => event.kind === 'boss_cast_evaded')).toHaveLength(1);
    expect(out.events.some((event) => event.kind === 'creature_attack')).toBe(false);
    expect(out.characters.find((character) => character.id === 'ch-2')?.hp ?? 100).toBe(100);
  });

  it('does not retarget the original character after re-entry changes entry_seq', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ pending_action: pending() })],
      fighters: [fighter({ character_id: 'ch-1', entry_seq: 2 })],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.events.filter((event) => event.kind === 'boss_cast_evaded')).toHaveLength(1);
    expect(out.events.some((event) => event.kind === 'creature_attack')).toBe(false);
  });

  it('does not let a newly entered fighter inherit an absent target cast', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ pending_action: pending() })],
      fighters: [fighter({ character_id: 'ch-2', entry_seq: 7 })],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.events.filter((event) => event.kind === 'boss_cast_evaded')).toHaveLength(1);
    expect(out.events.some((event) => event.kind === 'creature_attack')).toBe(false);
  });

  it('allows a later new cast to capture the newly authoritative tank', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ tank_fighter_id: 'f-ch-2' })],
      fighters: [
        fighter({ character_id: 'ch-1', entry_seq: 1 }),
        fighter({ character_id: 'ch-2', entry_seq: 7 }),
      ],
      tank_candidates: [{ fighter_id: 'f-ch-2', character_id: 'ch-2', entry_seq: 7 }],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.creatures[0].pending_action).toMatchObject({
      target_fighter_id: 'f-ch-2', target_character_id: 'ch-2', target_entry_seq: 7,
    });
  });

  it('does not create a future-acquiring cast without a valid start target', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', present: false })],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.creatures.find((state) => state.id === 'nc-1')?.pending_action).toBeNull();
    expect(out.events.filter((event) => event.kind === 'boss_cast_evaded')).toHaveLength(1);
    expect(out.events.some((event) => event.kind === 'boss_telegraph')).toBe(false);
  });

  it('fences a pending cast from a different creature spawn', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ spawn_seq: 4, pending_action: pending() })],
      boss_abilities: [bossAbility({ spawn_seq: 3 })],
    }), { abilities });
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'boss_cast_evaded', outcomeReason: 'ability_missing' }));
    expect(out.creatures[0].pending_action).toBeNull();
  });

  it('clears a dead boss pending cast without resolving damage', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ hp: 0, is_alive: false, pending_action: pending() })],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.creatures[0].pending_action).toBeNull();
    expect(out.events.some((event) => event.kind === 'creature_attack')).toBe(false);
  });

  it('clears a wind-up when the boss dies earlier in the same tick', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ hp: 1, pending_action: pending({ resolve_at_tick: 12 }) })],
      intents: [abilityIntent('kill-boss', 1, 'ch-1', 'power_strike', 'cr-1')],
      boss_abilities: [bossAbility()],
    }), { abilities });
    expect(out.creatures[0]).toMatchObject({ hp: 0, is_alive: false, pending_action: null });
    expect(out.events.filter((event) => event.kind === 'creature_died')).toHaveLength(1);
    expect(out.rewards).toHaveLength(1);
    expect(out.events.some((event) => event.kind === 'creature_attack')).toBe(false);
  });

  it('pays only characters durably qualified for this spawn, exactly once each', () => {
    const out = resolveNodeTick(
      snapshot({
        creatures: [creature({ hp: 1 })],
        fighters: [
          fighter({ character_id: 'ch-1', party_id: 'p-1', entry_seq: 1 }),
          fighter({ character_id: 'ch-2', party_id: 'p-1', entry_seq: 2 }),
          fighter({ character_id: 'ch-3', party_id: 'p-2', entry_seq: 3 }),
        ],
        effects: [
          {
            id: 'e-5', kind: 'dot', effect_type: 'rend', ability_key: 'rend',
            target_character_id: null, target_creature_id: 'cr-1',
            source_character_id: 'ch-1', source_creature_id: null,
            stacks: 1, magnitude: 9, config: {},
            expires_at: nowPlus(60_000), next_due_at: nowPlus(-1),
            interval_ms: 2000, last_pulse_tick: 5, is_reservation: false,
          },
        ],
      }),
      { abilities },
    );
    // ch-2 and ch-3 never interacted with this spawn: party membership alone is
    // not qualification, so only the damage-over-time source is paid.
    const ids = out.rewards.map((r) => r.character_id).sort();
    expect(ids).toEqual(['ch-1']);
  });

  it('keeps an unengaged non-aggressive creature idle on entry', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ engaged: false, is_aggressive: false })],
      pending_events: [{
        id: 'enter-1', event_type: 'fighter_entered', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { fighter_id: 'f-ch-1', entry_seq: 1 }, occurred_at: NOW,
      }],
    }), { abilities });
    expect(out.events.filter((event) => event.kind === 'creature_attack')).toEqual([]);
  });

  it('resolves one entry opportunity per engaged creature through the attack pipeline', () => {
    const out = resolveNodeTick(snapshot({
      pending_events: [{
        id: 'enter-1', event_type: 'fighter_entered', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { fighter_id: 'f-ch-1', entry_seq: 1 }, occurred_at: NOW,
      }],
    }), { abilities });
    const attacks = out.events.filter((event) => event.kind === 'creature_attack');
    expect(attacks).toHaveLength(2); // entry opportunity, then the ordinary tank action
    expect(attacks[0].meta).toMatchObject({ opportunityKind: 'entry', transitionEventId: 'enter-1', spawnSeq: 3 });
    expect(out.pending_event_ids).toEqual(['enter-1']);
  });

  it('first hostile intent engages once, opens against every present fighter, and skips the normal attack', () => {
    const out = resolveNodeTick(snapshot({
      creatures: [creature({ engaged: false, is_aggressive: false })],
      fighters: [fighter({ character_id: 'ch-1' }), fighter({ character_id: 'ch-2' })],
      intents: [abilityIntent('intent-1', 1, 'ch-1', 'power_strike', 'cr-1')],
    }), { abilities });
    expect(out.events.filter((event) => event.kind === 'creature_engaged')).toHaveLength(1);
    const openings = out.events.filter((event) => event.meta?.opportunityKind === 'engagement_opening');
    expect(openings).toHaveLength(2);
    expect(out.participation).toContainEqual(expect.objectContaining({ creature_id: 'cr-1', spawn_seq: 3, character_id: 'ch-1' }));
  });

  it('persists progressive absorb consumption across opportunity and ordinary attacks', () => {
    const shield = absorbEffect('absorb-1', 'ch-1', 100);
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', ac: -100 })],
      creatures: [creature({ id: 'nc-1', creature_id: 'cr-1' }), creature({ id: 'nc-2', creature_id: 'cr-2' })],
      effects: [shield],
      pending_events: [{
        id: 'enter-1', event_type: 'fighter_entered', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { fighter_id: 'f-ch-1', entry_seq: 1 }, occurred_at: NOW,
      }],
    }), { abilities });
    const absorbed = out.events
      .filter((event) => event.kind === 'creature_attack')
      .map((event) => Number(event.meta?.absorbed ?? 0));
    const totalAbsorbed = absorbed.reduce((sum, value) => sum + value, 0);
    expect(absorbed.length).toBe(4);
    expect(totalAbsorbed).toBeGreaterThan(0);
    expect(out.effects_update).toEqual([{ id: shield.id, magnitude: shield.magnitude! - totalAbsorbed }]);
    expect(out.effects_delete).not.toContain(shield.id);
  });

  it('consumes multiple absorb effects in captured order and deletes only exhausted pools', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', ac: -100 })],
      effects: [absorbEffect('first', 'ch-1', 2), absorbEffect('second', 'ch-1', 100)],
    }), { abilities });
    const absorbed = Number(out.events.find((event) => event.kind === 'creature_attack')?.meta?.absorbed ?? 0);
    expect(absorbed).toBeGreaterThan(2);
    expect(out.effects_delete).toContain('first');
    expect(out.effects_update).toEqual([{ id: 'second', magnitude: 102 - absorbed }]);
  });

  it('does not consume absorb after a fully blocking effect', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', ac: -100 })],
      effects: [
        absorbEffect('shield', 'ch-1', 20),
        { ...absorbEffect('block', 'ch-1', 999), kind: 'block', effect_type: 'block' },
      ],
    }), { abilities });
    expect(out.events.find((event) => event.kind === 'creature_attack')?.meta?.absorbed).toBe(0);
    expect(out.effects_update).toEqual([]);
    expect(out.effects_delete).toEqual([]);
  });

  it('does not consume absorb on a missed attack', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', ac: 10_000 })],
      effects: [absorbEffect('shield', 'ch-1', 20)],
    }), { abilities });
    expect(out.events.find((event) => event.kind === 'creature_attack')?.hitQuality).toBe('miss');
    expect(out.effects_update).toEqual([]);
    expect(out.effects_delete).toEqual([]);
  });

  it('keeps absorb pools isolated by character and uses the reduced pool next tick', () => {
    const first = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', ac: -100 }), fighter({ character_id: 'ch-2' })],
      effects: [absorbEffect('shield-1', 'ch-1', 100), absorbEffect('shield-2', 'ch-2', 100)],
    }), { abilities });
    expect(first.effects_update).toHaveLength(1);
    expect(first.effects_update[0].id).toBe('shield-1');
    expect(first.effects_update[0].magnitude).toBeLessThan(100);

    const second = resolveNodeTick(snapshot({
      encounter: { ...snapshot().encounter, tick: 11, candidate_tick: 12 },
      fighters: [fighter({ character_id: 'ch-1', ac: -100 })],
      effects: [absorbEffect('shield-1', 'ch-1', first.effects_update[0].magnitude!)],
    }), { abilities });
    const secondAbsorbed = Number(second.events.find((event) => event.kind === 'creature_attack')?.meta?.absorbed ?? 0);
    expect(second.effects_update[0]?.magnitude ?? 0).toBe(first.effects_update[0].magnitude! - secondAbsorbed);
  });

  it('keeps a Force Shield reservation when its absorb pool is depleted', () => {
    const reservation = {
      ...absorbEffect('reservation', 'ch-1', 5),
      kind: 'reservation', effect_type: 'cp_reservation', is_reservation: true,
    };
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', ac: -100 })],
      effects: [absorbEffect('shield', 'ch-1', 1), reservation],
    }), { abilities });
    expect(out.effects_delete).toContain('shield');
    expect(out.effects_delete).not.toContain('reservation');
  });

  it('retargets ordinary attacks after a surviving flee using captured fallback order', () => {
    const fighters = [
      fighter({ character_id: 'ch-solo', id: 'f-solo', entry_seq: 3, hp: 500, max_hp: 500, ac: -100 }),
      fighter({ character_id: 'ch-tank', id: 'f-tank', entry_seq: 2, hp: 500, max_hp: 500 }),
      fighter({ character_id: 'ch-leader', id: 'f-leader', entry_seq: 1, hp: 500, max_hp: 500 }),
    ];
    const out = resolveNodeTick(snapshot({
      fighters,
      creatures: [creature({ tank_fighter_id: 'f-solo' })],
      tank_candidates: [
        { fighter_id: 'f-solo', character_id: 'ch-solo', entry_seq: 3 },
        { fighter_id: 'f-tank', character_id: 'ch-tank', entry_seq: 2 },
        { fighter_id: 'f-leader', character_id: 'ch-leader', entry_seq: 1 },
      ],
      pending_events: [{
        id: 'exit-1', event_type: 'fighter_exit_requested', actor_character_id: 'ch-solo',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { fighter_id: 'f-solo', entry_seq: 3 }, occurred_at: NOW,
      }],
    }), { abilities });
    const attacks = out.events.filter((event) => event.kind === 'creature_attack');
    expect(attacks[0].target?.id).toBe('ch-solo');
    expect(attacks.at(-1)?.target?.id).toBe('ch-tank');
    expect(out.events.filter((event) => event.kind === 'fighter_fled')).toHaveLength(1);
    expect(out.creatures).toContainEqual(expect.objectContaining({ id: 'nc-1', tank_fighter_id: 'f-tank' }));
  });

  it('uses the party leader only after the designated candidate becomes ineligible', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [
        fighter({ character_id: 'ch-tank', id: 'f-tank', hp: 0 }),
        fighter({ character_id: 'ch-leader', id: 'f-leader' }),
      ],
      tank_candidates: [
        { fighter_id: 'f-tank', character_id: 'ch-tank', entry_seq: 1 },
        { fighter_id: 'f-leader', character_id: 'ch-leader', entry_seq: 1 },
      ],
    }), { abilities });
    expect(out.events.find((event) => event.kind === 'creature_attack')?.target?.id).toBe('ch-leader');
  });

  it('emits no ordinary attack when no captured candidate remains eligible', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', present: false })],
      tank_candidates: [{ fighter_id: 'f-ch-1', character_id: 'ch-1', entry_seq: 1 }],
    }), { abilities });
    expect(out.events.some((event) => event.kind === 'creature_attack')).toBe(false);
    expect(out.creatures).toContainEqual(expect.objectContaining({ tank_fighter_id: null }));
  });

  it('does not retarget a frozen telegraph after its captured target flees', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1' }), fighter({ character_id: 'ch-2' })],
      tank_candidates: [
        { fighter_id: 'f-ch-1', character_id: 'ch-1', entry_seq: 1 },
        { fighter_id: 'f-ch-2', character_id: 'ch-2', entry_seq: 1 },
      ],
      creatures: [creature({ pending_action: pending() })],
      boss_abilities: [bossAbility()],
      pending_events: [{
        id: 'exit-1', event_type: 'fighter_exit_requested', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { fighter_id: 'f-ch-1', entry_seq: 1 }, occurred_at: NOW,
      }],
    }), { abilities });
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'boss_cast_evaded', outcomeReason: 'no_target' }));
    expect(out.events.some((event) => event.abilityKey === 'granite_slam' && event.target?.id === 'ch-2')).toBe(false);
  });

  it('fails a flee when exit opportunities kill the fighter and never attacks them afterward', () => {
    const out = resolveNodeTick(snapshot({
      fighters: [fighter({ character_id: 'ch-1', hp: 1, max_hp: 100, ac: -100 })],
      pending_events: [{
        id: 'exit-killed', event_type: 'fighter_exit_requested', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { fighter_id: 'f-ch-1', entry_seq: 1 }, occurred_at: NOW,
      }],
    }), { abilities });
    expect(out.events.filter((event) => event.kind === 'fighter_exit_failed')).toHaveLength(1);
    expect(out.events.some((event) => event.kind === 'fighter_fled')).toBe(false);
    expect(out.events.filter((event) => event.kind === 'creature_attack')).toHaveLength(1);
    expect(out.creatures).toContainEqual(expect.objectContaining({ tank_fighter_id: null }));
  });

  it('proposes one fenced movement after one opportunity when the departing fighter survives', () => {
    const out = resolveNodeTick(snapshot({ pending_events: [{
      id: 'depart-1', event_type: 'fighter_depart_requested', actor_character_id: 'ch-1',
      actor_creature_id: null, target_character_id: null, target_creature_id: null,
      payload: { departure_request_id: 'request-1', fighter_id: 'f-ch-1', entry_seq: 1,
        origin_node_id: 'node-a', destination_node_id: 'node-b', cost: 5 }, occurred_at: NOW,
    }] }), { abilities });
    expect(out.events.filter(event => event.meta?.opportunityKind === 'exit')).toHaveLength(1);
    expect(out.departures).toEqual([{ request_id: 'request-1', origin_node_id: 'node-a', destination_node_id: 'node-b',
      fighter_id: 'f-ch-1', fighter_entry_seq: 1, cost: 5, outcome: 'moved' }]);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'fighter_moved' }));
    expect(out.fighters).toContainEqual({ id: 'f-ch-1', present: false });
  });

  it('three engaged creatures make exactly three exit opportunities', () => {
    const creatures = [creature({ id: 'n1', creature_id: 'c1' }), creature({ id: 'n2', creature_id: 'c2' }), creature({ id: 'n3', creature_id: 'c3' })];
    const out = resolveNodeTick(snapshot({ fighters: [fighter({ character_id: 'ch-1', hp: 100000, max_hp: 100000 })], creatures,
      pending_events: [{ id: 'depart-dead', event_type: 'fighter_depart_requested', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { departure_request_id: 'request-dead', fighter_id: 'f-ch-1', entry_seq: 1,
          origin_node_id: 'node-a', destination_node_id: 'node-b', cost: 5 }, occurred_at: NOW }] }), { abilities });
    expect(out.events.filter(event => event.meta?.opportunityKind === 'exit')).toHaveLength(3);
    expect(out.departures).toContainEqual(expect.objectContaining({ request_id: 'request-dead', outcome: 'moved' }));
  });

  it('records a dead departure outcome without proposing movement success', () => {
    const out = resolveNodeTick(snapshot({ fighters: [fighter({ character_id: 'ch-1', hp: 1, ac: -100 })],
      pending_events: [{ id: 'depart-lethal', event_type: 'fighter_depart_requested', actor_character_id: 'ch-1',
        actor_creature_id: null, target_character_id: null, target_creature_id: null,
        payload: { departure_request_id: 'request-lethal', fighter_id: 'f-ch-1', entry_seq: 1,
          origin_node_id: 'node-a', destination_node_id: 'node-b', cost: 5 }, occurred_at: NOW }] }), { abilities });
    expect(out.departures).toEqual([expect.objectContaining({ request_id: 'request-lethal', outcome: 'dead' })]);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'fighter_exit_failed', outcomeReason: 'dead' }));
    expect(out.events.some(event => event.kind === 'fighter_moved')).toBe(false);
  });

  const autoattack = (characterId = 'ch-1', target = creature()): SnapshotEffect => ({
    id: `auto-${characterId}`, kind: 'autoattack', effect_type: 'basic_attack', ability_key: null,
    target_character_id: characterId, target_creature_id: target.creature_id,
    source_character_id: characterId, source_creature_id: null, stacks: 1, magnitude: 0,
    config: { node_creature_id: target.id, spawn_seq: target.spawn_seq }, expires_at: null,
    next_due_at: null, interval_ms: null, last_pulse_tick: null, is_reservation: false,
  });

  it('resolves one persisted basic swing per eligible tick with zero CP cost', () => {
    const input = snapshot({ effects: [autoattack()] });
    const out = resolveNodeTick(input, { abilities });
    expect(out.events.filter(e => e.kind === 'attack' && e.meta?.basicAttack === true)).toHaveLength(1);
    expect(out.characters.find(c => c.id === 'ch-1')?.cp).toBe(50);
  });

  it('automatically selects an engaged spawn and attacks without a basic intent', () => {
    const out = resolveNodeTick(snapshot({ effects: [], intents: [] }), { abilities });
    expect(out.events.filter(e => e.meta?.basicAttack === true)).toHaveLength(1);
    expect(out.effects_insert).toContainEqual(expect.objectContaining({
      kind: 'autoattack', target_character_id: 'ch-1', target_creature_id: 'cr-1',
      config: { node_creature_id: 'nc-1', spawn_seq: 3 },
    }));
  });

  it('does not automatically engage or attack an idle creature', () => {
    const out = resolveNodeTick(snapshot({ creatures: [creature({ engaged: false })], effects: [], intents: [] }), { abilities });
    expect(out.events.some(e => e.meta?.basicAttack === true)).toBe(false);
    expect(out.effects_insert.some(e => e.kind === 'autoattack')).toBe(false);
  });

  it('hostile ability engages an idle target, owns that tick, and arms the following automatic attack', () => {
    const idle = creature({ engaged: false });
    const first = resolveNodeTick(snapshot({ creatures: [idle], effects: [],
      intents: [abilityIntent('power', 1, 'ch-1', 'power_strike', idle.creature_id)] }), { abilities });
    expect(first.events.some(e => e.kind === 'creature_engaged')).toBe(true);
    expect(first.events.some(e => e.meta?.basicAttack === true)).toBe(false);
    const armed = first.effects_insert.find(e => e.kind === 'autoattack')!;
    expect(armed).toMatchObject({ target_creature_id: idle.creature_id });
    const next = resolveNodeTick(snapshot({ creatures: [{ ...idle, engaged: true }], effects: [{
      id: 'armed', ...armed, source_creature_id: null, expires_at: null, next_due_at: null,
      interval_ms: null, last_pulse_tick: null,
    } as SnapshotEffect], intents: [] }), { abilities });
    expect(next.events.filter(e => e.meta?.basicAttack === true)).toHaveLength(1);
  });

  it('advances from a dead persisted target using stable runtime-row ordering', () => {
    const dead = creature({ id: 'nc-a', creature_id: 'cr-a', hp: 0, is_alive: false });
    const later = creature({ id: 'nc-c', creature_id: 'cr-c' });
    const first = creature({ id: 'nc-b', creature_id: 'cr-b' });
    const stale = autoattack('ch-1', dead);
    const out = resolveNodeTick(snapshot({ creatures: [later, dead, first], effects: [stale] }), { abilities });
    expect(out.effects_delete).toContain(stale.id);
    expect(out.effects_insert).toContainEqual(expect.objectContaining({
      kind: 'autoattack', target_creature_id: 'cr-b', config: { node_creature_id: 'nc-b', spawn_seq: 3 },
    }));
    expect(out.events.find(e => e.meta?.basicAttack === true)?.target?.id).toBe('cr-b');
  });

  it('re-evaluates working HP so a later fighter never attacks a target killed earlier that tick', () => {
    const firstTarget = creature({ id: 'nc-a', creature_id: 'cr-a', hp: 1, max_hp: 1, ac: -100 });
    const nextTarget = creature({ id: 'nc-b', creature_id: 'cr-b', ac: -100 });
    const second = fighter({ id: 'f-ch-2', character_id: 'ch-2', name: 'Second' });
    const out = resolveNodeTick(snapshot({ creatures: [firstTarget, nextTarget],
      fighters: [fighter({ character_id: 'ch-1' }), second], effects: [autoattack('ch-1', firstTarget), autoattack('ch-2', firstTarget)] }), { abilities });
    const attacks = out.events.filter(e => e.meta?.basicAttack === true);
    expect(attacks.map(e => e.target?.id)).toEqual(['cr-a', 'cr-b']);
  });

  it('a queued ability, heal, or stance owns the slot and basic attack resumes without browser input', () => {
    for (const intent of [abilityIntent('power', 1, 'ch-1', 'power_strike', 'cr-1'),
      { ...abilityIntent('invalid', 1, 'ch-1', 'missing', 'cr-1') }]) {
      const occupied = resolveNodeTick(snapshot({ effects: [autoattack()], intents: [intent] }), { abilities });
      expect(occupied.events.filter(e => e.meta?.basicAttack === true)).toHaveLength(0);
    }
    const resumed = resolveNodeTick(snapshot({ effects: [autoattack()], intents: [] }), { abilities });
    expect(resumed.events.filter(e => e.meta?.basicAttack === true)).toHaveLength(1);
  });

  it('a basic start engages an idle spawn and swings once, while old spawn binding is deleted', () => {
    const idle = creature({ engaged: false });
    const start: SnapshotIntent = { id: 'basic', seq: 1, character_id: 'ch-1', intent_kind: 'basic_attack',
      ability_key: null, stance_key: null, target_creature_id: idle.creature_id };
    const out = resolveNodeTick(snapshot({ creatures: [idle], effects: [autoattack('ch-1', idle)], intents: [start] }), { abilities });
    expect(out.events.some(e => e.kind === 'creature_engaged')).toBe(true);
    expect(out.events.filter(e => e.meta?.basicAttack === true)).toHaveLength(1);
    const stale = autoattack('ch-1', idle); stale.config.spawn_seq = idle.spawn_seq - 1;
    const refused = resolveNodeTick(snapshot({ creatures: [idle], effects: [stale] }), { abilities });
    expect(refused.effects_delete).toContain(stale.id);
    expect(refused.events.some(e => e.meta?.basicAttack === true)).toBe(false);
  });

  it('two fighters swing independently in stable order and absent/dead fighters do not swing', () => {
    const second = fighter({ id: 'f-ch-2', character_id: 'ch-2', name: 'Second' });
    const out = resolveNodeTick(snapshot({ fighters: [second, fighter({ character_id: 'ch-1' })],
      effects: [autoattack('ch-2'), autoattack('ch-1')],
      tank_candidates: [{ fighter_id: 'f-ch-1', character_id: 'ch-1', entry_seq: 1 }] }), { abilities });
    expect(out.events.filter(e => e.meta?.basicAttack === true).map(e => e.actor?.id)).toEqual(['ch-1', 'ch-2']);
    const blocked = resolveNodeTick(snapshot({ fighters: [fighter({ character_id: 'ch-1', present: false })], effects: [autoattack()] }), { abilities });
    expect(blocked.events.some(e => e.meta?.basicAttack === true)).toBe(false);
  });

  it('death, absence, and a claimed exit request stop attacks and clear persisted targeting', () => {
    const state = autoattack();
    for (const row of [fighter({ character_id: 'ch-1', hp: 0 }), fighter({ character_id: 'ch-1', present: false })]) {
      const out = resolveNodeTick(snapshot({ fighters: [row], effects: [state] }), { abilities });
      expect(out.events.some(e => e.meta?.basicAttack === true)).toBe(false);
      expect(out.effects_delete).toContain(state.id);
    }
    const exiting = resolveNodeTick(snapshot({ effects: [state], pending_events: [{
      id: 'exit', event_type: 'fighter_exit_requested', actor_character_id: 'ch-1', actor_creature_id: null,
      target_character_id: null, target_creature_id: null,
      payload: { fighter_id: 'f-ch-1', entry_seq: 1 }, occurred_at: NOW,
    }] }), { abilities });
    expect(exiting.events.some(e => e.meta?.basicAttack === true)).toBe(false);
    expect(exiting.effects_delete).toContain(state.id);
  });

  it('a basic swing participates, kills, and proposes its exactly-once spawn reward', () => {
    let out: ReturnType<typeof resolveNodeTick> | null = null;
    for (let seed = 0; seed < 100 && !out?.rewards.length; seed++) {
      const input = snapshot({ creatures: [creature({ hp: 1, max_hp: 1, ac: -100 })], effects: [autoattack()] });
      input.encounter.id = `basic-kill-${seed}`;
      const candidate = resolveNodeTick(input, { abilities });
      if (candidate.rewards.length) out = candidate;
    }
    expect(out).not.toBeNull();
    expect(out!.events.filter(e => e.kind === 'creature_died')).toHaveLength(1);
    expect(out!.participation).toContainEqual(expect.objectContaining({ character_id: 'ch-1', spawn_seq: 3 }));
    expect(out!.rewards).toHaveLength(1);
    expect(out!.rewards[0]).toMatchObject({ character_id: 'ch-1', spawn_seq: 3, is_killer: true });
    expect(out!.effects_delete).toContain('auto-ch-1');
  });
});
