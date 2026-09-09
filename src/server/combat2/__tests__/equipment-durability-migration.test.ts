import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('supabase/migrations/20260909150000_combat2_equipment_durability.sql'), 'utf8');

describe('Combat2 equipment durability migration', () => {
  it('captures authoritative immutable equipment inputs', () => {
    for (const field of ['max_durability', 'base_stats', 'procs']) expect(sql).toContain(`'${field}'`);
  });

  it('locks character then inventory and rejects every stale equipment identity before mutation', () => {
    expect(sql.indexOf('ORDER BY ch.id FOR UPDATE')).toBeLessThan(sql.indexOf('ORDER BY ci.id FOR UPDATE'));
    for (const fence of ['fighter_id','entry_seq','item_id','equipped_slot::text=x.slot','current_durability=x.durability_before']) expect(sql).toContain(fence);
    expect(sql.indexOf("'stale_equipment'")).toBeLessThan(sql.indexOf('SET current_durability=0'));
  });

  it('preserves the installed broken-item rules atomically inside node_tick_commit', () => {
    expect(sql).toContain("rec->>'rarity'='unique'");
    expect(sql).toContain('DELETE FROM public.character_inventory');
    expect(sql).toContain('current_durability=0,equipped_slot=NULL');
    expect(sql).toContain("current_durability=(rec->>'durability_after')::int");
  });

  it('preserves Test Arena no-wear behavior', () => {
    expect(sql).toContain("jsonb_array_length(COALESCE(_proposed->'durability','[]'::jsonb))<>0");
  });
});
