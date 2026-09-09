import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { decodeSnapshot } from '../decode';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, ProposedTick, SnapshotEffect, SnapshotEquipment, SnapshotIntent } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const records = authored.abilities;
const catalog = buildAbilityCatalog(records, authored.statuses);
const deps = { abilities: catalog.specs };
const NOW = '2026-09-04T00:00:00.000Z';
const CHARACTER = 'aaaa0000-0000-4000-8000-000000000001';
const FIGHTER = 'aaaa0000-0000-4000-8000-000000000002';
// Independently calculated from the checked-in STR/WIS diminishing_float formulas.
const PERCENT = 0.1 + Math.min(0.12, Math.sqrt(4) * 0.02); // STR 18
const FLAT = Math.round(6 + Math.min(18, Math.sqrt(4) * 1.8)); // WIS 18

function snapshot(): NodeSnapshot {
  return {
    encounter: { id: 'defense-0', node_id: 'node', tick: 0, candidate_tick: 1, state_version: 1, now: NOW, test_arena_id: null },
    fighters: [{
      id: FIGHTER, character_id: CHARACTER, entry_seq: 1, present: true,
      party_id: null, party_id_at_entry: null, name: 'Defender', class: 'warrior', race: 'human',
      level: 20, hp: 1000, max_hp: 1000, cp: 400, max_cp: 400, mp: 10, max_mp: 10,
      ac: 1, str: 18, dex: 10, con: 16, wis: 18, int: 10, cha: 10, equipment: [],
    }],
    creatures: [{
      id: 'spawn', creature_id: 'creature', spawn_seq: 1, hp: 1000, max_hp: 1000,
      is_alive: true, engaged: true, pending_action: null, tank_fighter_id: FIGHTER,
      name: 'Attacker', level: 20, ac: 12, stats: { str: 90 }, rarity: 'common',
      is_humanoid: false, is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null,
      loot_mode: 'salvage_only', loot_table_id: null, drop_chance: null, loot_table: [],
    }],
    effects: [], intents: [], boss_abilities: [], participation: [], pending_events: [],
    tank_candidates: [{ fighter_id: FIGHTER, character_id: CHARACTER, entry_seq: 1 }],
    reward_config: { xp_boost_multiplier: 1, drop_chance_regular: 0.35, drop_chance_rare: 0.6,
      drop_chance_boss: 1, equip_level_min_offset: -3, equip_level_max_offset: 0,
      common_pct: 80, uncommon_pct: 20, consumable_drop_chance: 0.15,
      consumable_level_min_offset: -5, consumable_level_max_offset: 0 },
    loot_items: [], loot_table_entries: [],
  };
}

function intent(key: string, kind: SnapshotIntent['intent_kind']): SnapshotIntent {
  return { id: 'intent', seq: 1, character_id: CHARACTER, intent_kind: kind,
    ability_key: kind === 'ability' ? key : null,
    stance_key: kind === 'ability' ? null : key, target_creature_id: null };
}

function activate(key: 'battle_cry' | 'divine_challenge') {
  const input = snapshot();
  input.fighters[0].class = key === 'battle_cry' ? 'warrior' : 'templar';
  input.intents = [intent(key, key === 'battle_cry' ? 'stance_activate' : 'ability')];
  const proposal = resolveNodeTick(input, deps);
  expect(proposal.events.filter(e => e.kind === 'action_rejected')).toEqual([]);
  return proposal;
}

// Model only persistence projection/defaults, not mitigation. Magnitude is taken
// from the actual serialized proposal unchanged, then passed through strict decode.
function persisted(proposal: ProposedTick): SnapshotEffect[] {
  const serialized: ProposedTick = JSON.parse(JSON.stringify(proposal));
  return serialized.effects_insert.map((effect, index) => ({
    id: `effect-${index}`, ability_key: null, target_character_id: null, target_creature_id: null,
    source_character_id: null, source_creature_id: null, stacks: 1, magnitude: null,
    config: {}, expires_at: null, next_due_at: null, interval_ms: null,
    last_pulse_tick: null, is_reservation: false, ...effect,
  }));
}

function next(proposal: ProposedTick): NodeSnapshot {
  const raw = snapshot();
  raw.encounter.tick = 1;
  raw.encounter.candidate_tick = 2;
  raw.encounter.now = '2026-09-04T00:00:01.000Z';
  raw.fighters[0].cp = proposal.characters.find(c => c.id === CHARACTER)?.cp ?? raw.fighters[0].cp;
  raw.effects = persisted(proposal);
  const decoded = decodeSnapshot(JSON.parse(JSON.stringify(raw)));
  if (decoded.ok === false) throw new Error(decoded.errors.join('\n'));
  return decoded.snapshot;
}

function attacks(proposal: ProposedTick) {
  return proposal.events.filter(e => e.kind === 'creature_attack');
}

// Find a reproducible encounter seed using only the real resolver attack rolls.
function seeded(input: NodeSnapshot, predicate: (out: ProposedTick) => boolean) {
  for (let seed = 0; seed < 200; seed++) {
    input.encounter.id = `defense-${seed}`;
    const out = resolveNodeTick(input, deps);
    if (predicate(out)) return { input, out };
  }
  throw new Error('No matching deterministic attack seed');
}

describe('real authored defensive activation → proposal → decoded next tick', () => {
  it('preserves Battle Cry fraction independently of reservation and activation cost', () => {
    const spec = catalog.specs.get('warrior:battle_cry')!;
    expect(spec.amountCalc).toEqual(records.find(r => r.abilityKey === 'battle_cry')!.amountCalc);
    const out = activate('battle_cry');
    expect(out.effects_insert.find(e => e.kind === 'mitigation')).toMatchObject({
      magnitude: PERCENT, expires_at: null, config: { mitigation_mode: 'percent', shield_dr_bonus: 0.05, is_taunt: false },
    });
    expect(out.events.find(e => e.kind === 'buff_applied')?.amount).toBe(PERCENT);
    expect(out.effects_insert.find(e => e.kind === 'reservation')).toMatchObject({ magnitude: 60, config: { reserve_pct: 0.15 } });
    expect(out.characters.find(c => c.id === CHARACTER)?.cp).toBe(375);
    expect(next(out).effects.find(e => e.kind === 'mitigation')?.magnitude).toBe(PERCENT);
  });

  it.each(['battle_cry', 'divine_challenge'] as const)('%s reduces a subsequent ordinary landed hit and reconciles HP', key => {
    const { input, out } = seeded(next(activate(key)), out => attacks(out)[0]?.hitQuality === 'normal');
    const hit = attacks(out)[0];
    const baseline = attacks(resolveNodeTick({ ...input, effects: [] }, deps))[0];
    const reduction = key === 'battle_cry' ? Math.floor(baseline.amount! * PERCENT) : FLAT;
    expect(reduction).toBeGreaterThan(0);
    expect(hit.meta?.[key === 'battle_cry' ? 'percentMitigated' : 'flatMitigated']).toBe(reduction);
    expect(hit.amount).toBe(baseline.amount! - reduction);
    expect(out.characters.find(c => c.id === CHARACTER)?.hp).toBe(1000 - hit.amount!);
  });

  it('allows zero integer reduction on a small landed hit without losing the fraction', () => {
    const input = next(activate('battle_cry'));
    input.creatures[0].level = 1;
    input.creatures[0].stats = { str: 1 };
    const { out } = seeded(input, out => attacks(out)[0]?.hitQuality === 'normal');
    expect(input.effects.find(e => e.kind === 'mitigation')?.magnitude).toBe(PERCENT);
    expect(attacks(out)[0]).toMatchObject({ amount: 1, meta: { percentMitigated: 0 } });
  });

  it('does not count a miss as mitigation', () => {
    const input = next(activate('battle_cry'));
    input.fighters[0].ac = 1000;
    const { out } = seeded(input, out => attacks(out)[0]?.hitQuality === 'miss');
    expect(attacks(out)[0].amount ?? 0).toBe(0);
    expect(attacks(out)[0].meta?.percentMitigated ?? 0).toBe(0);
  });

  it('drops the generated stance and reservation, with no CP refund or subsequent protection', () => {
    const input = next(activate('battle_cry'));
    input.intents = [intent('battle_cry', 'stance_drop')];
    const dropped = resolveNodeTick(input, deps);
    expect(dropped.effects_delete.sort()).toEqual(
      input.effects.filter(effect => effect.ability_key === 'battle_cry').map(effect => effect.id).sort(),
    );
    expect(dropped.events.some(e => e.kind === 'stance_dropped')).toBe(true);
    expect(dropped.characters.find(c => c.id === CHARACTER)?.cp).toBe(375);
    input.effects = input.effects.filter(e => !dropped.effects_delete.includes(e.id));
    input.intents = [];
    const { out } = seeded(input, out => attacks(out)[0]?.hitQuality === 'normal');
    expect(attacks(out)[0].meta?.percentMitigated).toBe(0);
  });

  it('keeps Divine Challenge authored flat amount, CP cost and CON duration, then expires', () => {
    const proposal = activate('divine_challenge');
    const mitigation = proposal.effects_insert.filter(effect => effect.kind === 'mitigation');
    expect(mitigation).toHaveLength(1);
    expect(mitigation[0]).toMatchObject({ magnitude: FLAT, config: { mitigation_mode: 'flat' }, expires_at: '2026-09-04T00:00:33.000Z' });
    expect(proposal.events.find(e => e.kind === 'buff_applied')?.amount).toBe(FLAT);
    expect(proposal.characters.find(c => c.id === CHARACTER)?.cp).toBe(340);
    const input = next(proposal);
    input.encounter.now = '2026-09-04T00:00:33.000Z';
    input.encounter.candidate_tick = Number(mitigation[0].config?.expires_after_tick) + 1;
    const { out } = seeded(input, out => attacks(out)[0]?.hitQuality === 'normal');
    expect(out.effects_delete).toContain(input.effects.find(effect => effect.kind === 'mitigation')!.id);
    expect(attacks(out)[0].meta?.flatMitigated).toBe(0);
  });

  it('uses generated percentage mitigation for entry opportunities and ordinary attacks', () => {
    const input = next(activate('battle_cry'));
    input.pending_events = [{ id: 'entry', event_type: 'fighter_entered', actor_character_id: CHARACTER,
      actor_creature_id: null, target_character_id: null, target_creature_id: null,
      payload: { fighter_id: FIGHTER, entry_seq: 1 }, occurred_at: NOW }];
    const { out } = seeded(input, out => attacks(out).length === 2 && attacks(out).every(e => e.hitQuality === 'normal'));
    expect(attacks(out)[0].meta?.opportunityKind).toBe('entry');
    for (const hit of attacks(out)) expect(hit.meta?.percentMitigated).toBeGreaterThan(0);
    expect(out.characters.find(c => c.id === CHARACTER)?.hp).toBe(1000 - attacks(out).reduce((sum, e) => sum + e.amount!, 0));
    expect(out.pending_event_ids).toEqual(['entry']);
  });
});

describe('Shield Wall authored equipment and block-chance contract', () => {
  const offhand = (weapon_tag: string, inventory_id: string): SnapshotEquipment => ({
    slot: 'off_hand', weapon_tag, inventory_id, item_id: `${inventory_id}-item`, character_id: CHARACTER,
    durability: 100, max_durability: 100, applied_gems: {}, stat_override: null, base_stats: {},
    crafted_level: null, item_present: true, item_type: 'equipment', hands: 1, item_level: 1,
    rarity: 'common', procs: [],
  });
  const shield = offhand('shield', 'shield-inventory');
  const tome = offhand('tome', 'tome-inventory');

  function shieldWallActivation(equipment: SnapshotEquipment[]) {
    const input = snapshot();
    input.fighters[0].class = 'templar';
    input.fighters[0].equipment = equipment;
    input.intents = [intent('shield_wall', 'stance_activate')];
    return resolveNodeTick(input, deps);
  }

  it('requires the authored off-hand shield tag rather than any off-hand item', () => {
    expect(shieldWallActivation([tome]).events).toContainEqual(expect.objectContaining({
      kind: 'action_rejected', abilityKey: 'shield_wall', outcomeReason: 'requires_shield',
    }));
    expect(shieldWallActivation([shield]).events.some(event => event.kind === 'action_rejected')).toBe(false);
  });

  it('applies block only when the deterministic authored chance succeeds', () => {
    const input = snapshot();
    input.fighters[0].equipment = [shield];
    input.effects = [{
      id: 'shield-wall', kind: 'block', effect_type: 'block', ability_key: 'shield_wall',
      target_character_id: CHARACTER, target_creature_id: null, source_character_id: CHARACTER,
      source_creature_id: null, stacks: 1, magnitude: 9, config: { block_chance: 0 },
      expires_at: null, next_due_at: null, interval_ms: null, last_pulse_tick: null, is_reservation: false,
    }];
    const noBlock = seeded(input, out => attacks(out)[0]?.hitQuality === 'normal').out;
    expect(attacks(noBlock)[0].meta).toMatchObject({ blocked: 0 });
    expect(attacks(noBlock)[0].meta?.blockAbilityKey).toBeUndefined();

    input.effects[0].config = { block_chance: 0.95 };
    const blocked = seeded(input, out => attacks(out)[0]?.hitQuality === 'normal'
      && Number(attacks(out)[0].meta?.blocked ?? 0) > 0).out;
    expect(attacks(blocked)[0].meta).toMatchObject({ blocked: 9, blockAbilityKey: 'shield_wall' });
  });

  it('does not block after the shield is no longer equipped', () => {
    const input = snapshot();
    input.fighters[0].equipment = [tome];
    input.effects = [{
      id: 'shield-wall', kind: 'block', effect_type: 'block', ability_key: 'shield_wall',
      target_character_id: CHARACTER, target_creature_id: null, source_character_id: CHARACTER,
      source_creature_id: null, stacks: 1, magnitude: 9, config: { block_chance: 0.95 },
      expires_at: null, next_due_at: null, interval_ms: null, last_pulse_tick: null, is_reservation: false,
    }];
    const out = seeded(input, proposal => attacks(proposal)[0]?.hitQuality === 'normal').out;
    expect(attacks(out)[0].meta).toMatchObject({ blocked: 0 });
    expect(attacks(out)[0].meta?.blockAbilityKey).toBeUndefined();
  });
});
