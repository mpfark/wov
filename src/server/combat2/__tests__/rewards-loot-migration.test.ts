import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20260909120000_combat2_authoritative_rewards_loot.sql', 'utf8').replaceAll('\r\n', '\n');

describe('Combat2 authoritative rewards and loot migration', () => {
  it('freezes every reward and loot decision input in node_tick_claim', () => {
    for (const token of ["'reward_config'", "'loot_items'", "'loot_table_entries'", "'loot_mode'", "'loot_table'", "'drop_chance'"]) expect(SQL).toContain(token);
    expect(SQL).toContain('FROM public.xp_boost');
    expect(SQL).toContain('FROM public.loot_pool_config');
  });

  it('fences rewards and loot to encounter, node creature, spawn and death', () => {
    expect(SQL).toContain('node_creature_id uuid NOT NULL');
    expect(SQL).toContain('UNIQUE (encounter_id,node_creature_id,spawn_seq,loot_key)');
    expect(SQL).toContain("(c->>'is_alive')::boolean=false");
    expect(SQL).toContain("-- rewards: exactly once per (creature, spawn_seq, character)");
  });

  it('uses one atomic commit and encounter-to-character lock order', () => {
    expect(SQL).toContain('ORDER BY ch.id FOR UPDATE');
    expect(SQL).toContain("d:=replace(d,'(creature_id, spawn_seq, character_id, xp_awarded, gold_awarded, is_killer)'");
    expect(SQL).toContain('INSERT INTO public.node_death_loot');
    expect(SQL).toContain('INSERT INTO public.node_ground_loot');
    expect(SQL).not.toMatch(/INSERT INTO public\.character_inventory/i);
    expect(SQL).toContain('ON CONFLICT(encounter_id,node_creature_id,spawn_seq,loot_key) DO NOTHING');
  });

  it('suppresses all persistent rewards in the Test Arena and preserves service authority', () => {
    expect(SQL).toContain("_proposed->''loot''");
    expect(SQL).toContain('TO service_role');
    expect(SQL).toContain('FROM PUBLIC,anon,authenticated');
  });
});
