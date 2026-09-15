import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20260915190000_combat2_authoritative_reward_model.sql', 'utf8');

describe('ADM-025A unique item identity migration', () => {
  it('fails closed before mutation on duplicate copies and unique vendor stock', () => {
    expect(SQL.indexOf('vendor_inventory contains unique catalogue items')).toBeLessThan(SQL.indexOf('CREATE TABLE public.unique_item_instance'));
    expect(SQL).toContain("HAVING count(*)>1");
    expect(SQL).toContain('duplicate or ambiguous unique physical copies');
  });

  it('models only real holding surfaces and gives one instance per catalogue item', () => {
    expect(SQL).toContain('item_id uuid NOT NULL UNIQUE');
    expect(SQL).toContain("location_kind IN ('inventory','ground','marketplace','transit')");
    for (const table of ['character_inventory', 'node_ground_loot', 'marketplace_listings']) {
      expect(SQL).toContain(`ALTER TABLE public.${table} ADD COLUMN unique_instance_id uuid UNIQUE`);
    }
    expect(SQL).not.toMatch(/ALTER TABLE public\.vendor_inventory ADD COLUMN unique_instance_id/);
  });

  it('preserves identity through delete-first transfers and releases true destruction', () => {
    expect(SQL).toContain("SET location_kind='transit'");
    expect(SQL).toContain("DELETE FROM public.unique_item_instance WHERE id=OLD.unique_instance_id AND location_kind='transit'");
    expect(SQL).toContain('VALUES(p_character_id,l.item_id,l.current_durability,iid)');
    expect(SQL.indexOf("SET status='sold'")).toBeLessThan(SQL.indexOf('VALUES(p_character_id,l.item_id,l.current_durability,iid)'));
  });

  it('uses one deterministic lock order and prevents browser access to the registry', () => {
    expect(SQL).toContain("pg_advisory_xact_lock(hashtextextended('unique-item:'||NEW.item_id::text,0))");
    expect(SQL).toContain('ALTER TABLE public.unique_item_instance ENABLE ROW LEVEL SECURITY');
    expect(SQL).toContain('REVOKE ALL ON TABLE public.unique_item_instance FROM PUBLIC,anon,authenticated');
    expect(SQL).not.toContain('supabase_realtime ADD TABLE public.unique_item_instance');
  });

  it('keeps Combat2 creation disabled and blocks vendor minting', () => {
    expect(SQL).toContain('vendor_inventory_reject_unique');
    expect(SQL).toContain('unique items are not valid vendor stock');
    expect(SQL).not.toContain('unique_candidate');
    expect(SQL).not.toContain('node_tick_commit');
  });
});
