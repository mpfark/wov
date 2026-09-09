import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, SnapshotEffect } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
const deps = { abilities: catalog.specs };
const NOW = '2026-09-09T12:00:00.000Z';

function effect(patch: Partial<SnapshotEffect>): SnapshotEffect {
  return { id: 'effect', kind: 'dot', effect_type: 'scorched', ability_key: 'fireball',
    target_character_id: null, target_creature_id: 'creature', source_character_id: 'caster',
    source_creature_id: null, stacks: 1, magnitude: 3,
    config: { node_creature_id: 'spawn', spawn_seq: 4, source_fighter_id: 'fighter',
      source_entry_seq: 7, activated_at_tick: 0, expires_after_tick: 3,
      interval_ticks: 1, next_pulse_tick: 1 },
    expires_at: '2026-09-09T12:00:06.000Z', next_due_at: '2026-09-09T12:00:02.000Z',
    interval_ms: 2000, last_pulse_tick: null, is_reservation: false, ...patch };
}

function snapshot(abilityKey = 'frostbolt', classKey = 'wizard'): NodeSnapshot {
  return {
    encounter: { id: `status-${abilityKey}`, node_id: 'node', tick: 0, candidate_tick: 1,
      state_version: 1, now: NOW, tick_origin: '2026-09-09T11:59:58.000Z', test_arena_id: null },
    fighters: [{ id: 'fighter', character_id: 'caster', entry_seq: 7, present: true,
      party_id: null, party_id_at_entry: null, name: 'Caster', class: classKey, race: 'human',
      level: 20, hp: 500, max_hp: 500, cp: 200, max_cp: 200, mp: 0, max_mp: 0,
      ac: 100, str: 18, dex: 18, con: 18, int: 20, wis: 18, cha: 18, equipment: [] }],
    creatures: [{ id: 'spawn', creature_id: 'creature', spawn_seq: 4, hp: 1000, max_hp: 1000,
      is_alive: true, engaged: true, pending_action: null, tank_fighter_id: 'fighter', name: 'Target',
      level: 1, ac: 1, stats: { str: 1 }, rarity: 'common', is_humanoid: false,
      is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null }],
    effects: [], intents: [{ id: 'intent', seq: 1, character_id: 'caster', intent_kind: 'ability',
      ability_key: abilityKey, stance_key: null, target_creature_id: 'creature' }],
    boss_abilities: [], boss_configurations: [], participation: [], pending_events: [],
    tank_candidates: [{ fighter_id: 'fighter', character_id: 'caster', entry_seq: 7 }],
  };
}

function landed(input: NodeSnapshot) {
  return resolveNodeTick(input, deps).events.find(row => row.kind === 'attack' && row.hitQuality !== 'miss');
}

describe('Combat2 authored status application', () => {
  it('freezes every referenced status into the catalogue and rejects a missing definition', () => {
    expect(catalog.rejected).toEqual([]);
    expect(catalog.specs.get('fireball')?.appliedStatus).toMatchObject({
      key: 'scorched', classification: 'dot', chancePct: 25,
    });
    expect(catalog.specs.get('frostbolt')?.appliedStatus).toMatchObject({
      key: 'chilled', classification: 'damage_amp', chancePct: 100,
    });
    const withoutChilled = authored.statuses.filter(row => row.key !== 'chilled');
    expect(buildAbilityCatalog(authored.abilities, withoutChilled).rejected)
      .toContainEqual(expect.objectContaining({ abilityKey: 'frostbolt', reason: 'missing_status_definition' }));
  });

  it('rejects a legacy optional on-hit payload instead of accepting a silent partial mechanic', () => {
    const fireball = authored.abilities.find(row => row.abilityKey === 'fireball')!;
    expect(buildAbilityCatalog([{ ...fireball, onHitEffect: { effect: 'bleed', chance_pct: 20 } }], authored.statuses).rejected)
      .toContainEqual(expect.objectContaining({ reason: 'unsupported_on_hit_effect' }));
  });

  it('applies guaranteed Chilled only after a landed Frostbolt, with a three-tick spawn fence', () => {
    const input = snapshot();
    const out = resolveNodeTick(input, deps);
    expect(landed(input)).toBeDefined();
    expect(out.effects_insert).toContainEqual(expect.objectContaining({ kind: 'amplification',
      effect_type: 'chilled', target_creature_id: 'creature',
      config: expect.objectContaining({ node_creature_id: 'spawn', spawn_seq: 4,
        damage_taken_pct: 10, expires_after_tick: 4 }) }));
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'status_applied',
      abilityKey: 'frostbolt', meta: expect.objectContaining({ status: 'chilled', chancePct: 100 }) }));
  });

  it('uses a deterministic 25% Scorched roll and never applies it on a miss', () => {
    let proc: NodeSnapshot | null = null;
    let noProc: NodeSnapshot | null = null;
    for (let i = 0; i < 200 && (!proc || !noProc); i++) {
      const input = snapshot('fireball');
      input.encounter.id = `fireball-chance-${i}`;
      const out = resolveNodeTick(input, deps);
      const hit = out.events.find(row => row.kind === 'attack');
      const applied = out.effects_insert.some(row => row.effect_type === 'scorched');
      if (hit?.hitQuality !== 'miss' && applied) proc = input;
      if (hit?.hitQuality !== 'miss' && !applied) noProc = input;
      if (hit?.hitQuality === 'miss') expect(applied).toBe(false);
    }
    expect(proc).not.toBeNull();
    expect(noProc).not.toBeNull();
    expect(resolveNodeTick(proc!, deps)).toEqual(resolveNodeTick(proc!, deps));
    expect(resolveNodeTick(proc!, deps).effects_insert).toContainEqual(expect.objectContaining({
      kind: 'dot', effect_type: 'scorched', stacks: 1, magnitude: 3, interval_ms: 2000,
      config: expect.objectContaining({ max_stacks: 3, node_creature_id: 'spawn', spawn_seq: 4 }),
    }));
    expect(resolveNodeTick(noProc!, deps).events).toContainEqual(expect.objectContaining({
      kind: 'status_missed', abilityKey: 'fireball', meta: expect.objectContaining({ chancePct: 25 }),
    }));
  });

  it('applies Chilled to ability, weapon, DoT and proc damage without stacking duplicate sources', () => {
    const chilled = effect({ id: 'chilled-a', kind: 'amplification', effect_type: 'chilled',
      ability_key: 'frostbolt', magnitude: 0, interval_ms: null, next_due_at: null,
      config: { node_creature_id: 'spawn', spawn_seq: 4, damage_taken_pct: 10,
        eligible_sources: ['weapon', 'ability', 'stance', 'dot', 'proc'],
        activated_at_tick: 0, expires_after_tick: 3, interval_ticks: 1, next_pulse_tick: 1 } });
    const duplicate = effect({ ...chilled, id: 'chilled-b', source_character_id: 'other' });
    const direct = snapshot('fireball');
    const baseline = landed(direct)!;
    direct.effects = [chilled, duplicate];
    const amplified = landed(direct)!;
    expect(amplified.amount).toBe(Math.floor(baseline.amount! * 1.1));

    const pulse = snapshot();
    pulse.intents = [];
    pulse.effects = [effect({ magnitude: 10 }), chilled];
    const out = resolveNodeTick(pulse, deps);
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'effect_pulse', amount: 11 }));
  });

  it('stacks and refreshes Rend at its authored cap and lets a fenced DoT continue offscreen', () => {
    const input = snapshot('rend', 'warrior');
    input.effects = [effect({ id: 'rend-old', effect_type: 'bleed', ability_key: 'rend',
      stacks: 5, magnitude: 8, expires_at: '2026-09-09T12:00:02.000Z',
      config: { node_creature_id: 'spawn', spawn_seq: 4, source_fighter_id: 'fighter',
        source_entry_seq: 7, max_stacks: 5, activated_at_tick: 0, expires_after_tick: 1,
        interval_ticks: 1, next_pulse_tick: 1 } })];
    const refreshed = resolveNodeTick(input, deps);
    expect(refreshed.effects_delete).toContain('rend-old');
    expect(refreshed.effects_insert).toContainEqual(expect.objectContaining({
      effect_type: 'bleed', stacks: 5, config: expect.objectContaining({ max_stacks: 5 }) }));

    const offscreen = snapshot();
    offscreen.intents = [];
    offscreen.fighters[0].present = false;
    offscreen.effects = [effect({ id: 'offscreen', magnitude: 10 })];
    expect(resolveNodeTick(offscreen, deps).events).toContainEqual(expect.objectContaining({
      kind: 'effect_pulse', amount: 10,
    }));
  });

  it('invalidates a status whose creature generation fence is stale', () => {
    const input = snapshot();
    input.intents = [];
    input.effects = [effect({ id: 'stale', config: { node_creature_id: 'spawn', spawn_seq: 3,
      activated_at_tick: 0, expires_after_tick: 3, interval_ticks: 1, next_pulse_tick: 1 } })];
    const out = resolveNodeTick(input, deps);
    expect(out.effects_delete).toContain('stale');
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'effect_invalidated',
      meta: expect.objectContaining({ reason: 'stale_spawn' }) }));
    expect(out.events.some(row => row.kind === 'effect_pulse')).toBe(false);
  });

  it('consumes Sunder Armor magnitude as spawn-fenced AC reduction', () => {
    const castInput = snapshot('sunder_armor', 'warrior');
    const cast = resolveNodeTick(castInput, deps);
    const sunder = cast.effects_insert.find(row => row.ability_key === 'sunder_armor')!;
    expect(sunder).toMatchObject({ kind: 'control',
      config: expect.objectContaining({ control_mode: 'ac_reduction', node_creature_id: 'spawn', spawn_seq: 4 }) });
    let proof: { plain: ReturnType<typeof resolveNodeTick>; reduced: ReturnType<typeof resolveNodeTick> } | null = null;
    for (let i = 0; i < 200 && !proof; i++) {
      const attack = snapshot('power_strike', 'warrior');
      attack.encounter = { ...attack.encounter, id: `sunder-proof-${i}`, tick: 1, candidate_tick: 2, state_version: 2 };
      attack.creatures[0].ac = 25;
      const withEffect = structuredClone(attack);
      withEffect.effects = [effect({ ...sunder, id: 'sunder-effect' })];
      const plain = resolveNodeTick(attack, deps);
      const reduced = resolveNodeTick(withEffect, deps);
      const plainHit = plain.events.find(row => row.kind === 'attack');
      const reducedHit = reduced.events.find(row => row.kind === 'attack');
      if (plainHit && reducedHit && (reducedHit.amount ?? 0) > (plainHit.amount ?? 0)) proof = { plain, reduced };
    }
    expect(proof).not.toBeNull();
  });
});
