/**
 * Modernization Phase 1 — golden master of the current Combat2 resolver.
 * Records exact resolver output for every authored class ability across fixed
 * seeds, plus basic-attack rounds. The replacement engine must reproduce these
 * files byte for byte (documented bug fixes excepted). Regenerate only on an
 * intentional rule change: `bunx vitest run -u golden-master`.
 */
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '../catalog';
import { resolveNodeTick } from '../resolver';
import type { NodeSnapshot, SnapshotFighter } from '../types';

const authored = inventory as AuthoredAbilityInventory;
const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
const deps = { abilities: catalog.specs };
const NOW = '2026-09-09T12:00:00.000Z';
const SEEDS = ['g-a', 'g-b', 'g-c', 'g-d'];

function fighter(id: string, cls: string, cp = 200): SnapshotFighter {
  return { id: `f-${id}`, character_id: id, entry_seq: 1, present: true, party_id: null,
    party_id_at_entry: null, name: id, class: cls, race: 'human', level: 20, hp: 400, max_hp: 500,
    cp, max_cp: 200, mp: 0, max_mp: 0, ac: 14, str: 18, dex: 16, con: 16, int: 18, wis: 16, cha: 16,
    equipment: [] };
}

function snapshot(seed: string, fighters: SnapshotFighter[], intents: NodeSnapshot['intents']): NodeSnapshot {
  return {
    encounter: { id: seed, node_id: 'node', tick: 5, candidate_tick: 6, state_version: 1, now: NOW,
      tick_origin: '2026-09-09T11:59:50.000Z', test_arena_id: null },
    creatures: [{ id: 'spawn', creature_id: 'creature', spawn_seq: 1, hp: 300, is_alive: true,
      engaged: true, pending_action: null, tank_fighter_id: fighters[0].id, name: 'Golden Wolf',
      level: 20, max_hp: 300, ac: 14, stats: { str: 16 }, rarity: 'regular', is_humanoid: false,
      is_aggressive: true, boss_crit_flavors: null, boss_death_cry: null, gold_enabled: false,
      gold_min: 0, gold_max: 0, gold_chance: 0, salvage_enabled: false, item_source: 'none',
      unique_item_id: null, unique_drop_chance: null, loot_mode: 'salvage_only', loot_table_id: null,
      drop_chance: null, loot_table: [] }],
    fighters, effects: [], intents, boss_abilities: [],
    tank_candidates: fighters.map(f => ({ fighter_id: f.id, character_id: f.character_id, entry_seq: f.entry_seq })),
    reward_config: { xp_boost_multiplier: 1, drop_chance_regular: 0, drop_chance_rare: 0,
      drop_chance_boss: 0, equip_level_min_offset: -3, equip_level_max_offset: 0, common_pct: 80,
      uncommon_pct: 20, consumable_drop_chance: 0, consumable_level_min_offset: -5,
      consumable_level_max_offset: 0 },
    loot_items: [], loot_table_entries: [],
  } as NodeSnapshot;
}

const classAbilities = [...catalog.specs.entries()]
  .filter(([key]) => key.includes(':'))
  .sort(([a], [b]) => a.localeCompare(b));

describe('golden master: combat2 resolver', () => {
  it('catalog builds without new rejections', async () => {
    await expect(JSON.stringify(catalog.rejected.map(r => r), null, 2))
      .toMatchFileSnapshot('golden/catalog-rejections.json');
  });

  it.each(classAbilities)('ability %s', async (key, spec) => {
    const cls = key.split(':')[0];
    const runs = SEEDS.map(seed => {
      const target = spec.targetType === 'enemy' ? 'spawn' : null;
      const intent = { id: 'i1', seq: 1, character_id: 'hero', intent_kind: 'ability',
        ability_key: spec.abilityKey, stance_key: null, target_creature_id: target } as NodeSnapshot['intents'][number];
      return { seed, out: resolveNodeTick(snapshot(seed, [fighter('hero', cls), fighter('ally', 'healer')], [intent]), deps) };
    });
    await expect(JSON.stringify(runs, null, 2)).toMatchFileSnapshot(`golden/ability/${key.replace(':', '__')}.json`);
  });

  it('basic attack rounds, two fighters', async () => {
    const runs = SEEDS.map(seed => ({ seed,
      out: resolveNodeTick(snapshot(seed, [fighter('hero', 'warrior'), fighter('ally', 'ranger')], []), deps) }));
    await expect(JSON.stringify(runs, null, 2)).toMatchFileSnapshot('golden/basic-attack.json');
  });
});
