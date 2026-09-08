import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20260908210000_inventory_character_authority.sql', 'utf8').replaceAll('\r\n', '\n');
const INVENTORY = readFileSync('src/features/inventory/hooks/useInventory.ts', 'utf8');
const BLACKSMITH = readFileSync('src/features/inventory/components/BlacksmithPanel.tsx', 'utf8');
const JEWELER = readFileSync('src/features/inventory/components/JewelcrafterPanel.tsx', 'utf8');

describe('inventory and character authority boundary', () => {
  it('revokes every browser privilege before restoring read-only inventory access', () => {
    expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.character_inventory FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('GRANT SELECT ON TABLE public.character_inventory TO authenticated');
    for (const policy of ['Owners can insert inventory', 'Owners can update inventory', 'Owners can delete inventory']) {
      expect(SQL).toContain(`DROP POLICY IF EXISTS "${policy}"`);
    }
  });

  it('restores exactly the six safe character update columns', () => {
    expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.characters FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('GRANT UPDATE(last_online, wimp_hp_threshold, wimp_direction, portrait_url, portrait_metadata, portrait_generated_at)');
  });

  it('keeps request ledgers private and outside realtime', () => {
    expect(SQL).toContain('ALTER TABLE public.character_inventory_action_request ENABLE ROW LEVEL SECURITY');
    expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.character_inventory_action_request FROM PUBLIC, anon, authenticated');
    expect(SQL).not.toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
  });

  it('exposes only authenticated authoritative action and repair RPCs', () => {
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.character_inventory_action(uuid,text,uuid,text,uuid) TO authenticated, service_role');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.character_repair(uuid,text,uuid,uuid) TO authenticated, service_role');
    expect(SQL).toContain('REVOKE EXECUTE ON FUNCTION public.buy_vendor_item(uuid,uuid,integer) FROM PUBLIC, anon, authenticated');
  });

  it('contains ownership, state, slot, provider, pricing, locking and replay contracts', () => {
    for (const contract of ['auth.uid()', 'owns_character', 'FOR UPDATE', 'request_id_conflict', 'movement_pending',
      'unavailable_while_in_combat', 'is_blacksmith', 'is_jewelcrafter', "i.rarity<>'unique'", 'CEIL((100-row.current_durability)']) {
      expect(SQL).toContain(contract);
    }
  });

  it('removes direct browser mutations from active inventory and repair clients', () => {
    for (const source of [INVENTORY, BLACKSMITH, JEWELER]) {
      expect(source).not.toMatch(/from\('character_inventory'\)\.\s*(?:update|delete|insert|upsert)/);
    }
    expect(BLACKSMITH).toContain("rpc('character_repair'");
    expect(JEWELER).toContain("rpc('character_repair'");
  });
});
