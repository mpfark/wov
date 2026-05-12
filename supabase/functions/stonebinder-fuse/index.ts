// Stonebinder fuse — combine two different primary Turning Stones into the
// matching Ascended Turning Stone. Recipes are derived from item stat shape
// (not names): the single non-(hp/hp_regen) stat key on each primary forms a
// sorted pair → ascended item id.
//
// Modes:
//   { mode: "preview", character_id, stone_a_inv_id, stone_b_inv_id }
//   { mode: "fuse",    character_id, stone_a_inv_id, stone_b_inv_id }
//
// Validation rejects same-stat fusion, equipped stones, foreign-owned stones,
// and any case where the resulting ascended already exists in the world
// (character inventory, active marketplace listing, or ground loot).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRIMARY_STATS = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const SECONDARY_STATS = new Set(['hp', 'hp_regen']);

type Stats = Record<string, number>;

interface ItemRow {
  id: string;
  name: string;
  description: string;
  rarity: string;
  slot: string | null;
  item_type: string;
  stats: Stats;
  value: number;
  max_durability: number;
  level: number;
}

interface InvRow {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  item: ItemRow;
}

function primaryKeysOf(stats: Stats): string[] {
  return Object.keys(stats || {}).filter((k) => PRIMARY_STATS.has(k));
}

function isPrimaryTurningStone(item: ItemRow): boolean {
  if (!item) return false;
  if (item.rarity !== 'unique') return false;
  if (item.slot !== 'trinket') return false;
  if (item.item_type !== 'equipment') return false;
  if (!/^Turning Stone of /i.test(item.name)) return false;
  if (/^Ascended/i.test(item.name)) return false;
  // Stat shape: exactly one primary stat key (hp/hp_regen are filler).
  const keys = Object.keys(item.stats || {}).filter((k) => !SECONDARY_STATS.has(k));
  if (keys.length !== 1) return false;
  return PRIMARY_STATS.has(keys[0]);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('+');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401);
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const user = userRes?.user;
    if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return jsonResponse({ error: 'Invalid body' }, 400);

    const { mode, character_id, stone_a_inv_id, stone_b_inv_id } = body as {
      mode?: string;
      character_id?: string;
      stone_a_inv_id?: string;
      stone_b_inv_id?: string;
    };

    if (mode !== 'preview' && mode !== 'fuse') {
      return jsonResponse({ error: 'mode must be "preview" or "fuse"' }, 400);
    }
    if (!character_id || !stone_a_inv_id || !stone_b_inv_id) {
      return jsonResponse({ error: 'Missing character_id or stone ids' }, 400);
    }
    if (stone_a_inv_id === stone_b_inv_id) {
      return jsonResponse({ error: 'Choose two different stones.' }, 400);
    }

    // Verify character ownership
    const { data: charRow, error: charErr } = await supabase
      .from('characters')
      .select('id, user_id, name')
      .eq('id', character_id)
      .maybeSingle();
    if (charErr) return jsonResponse({ error: charErr.message }, 500);
    if (!charRow || charRow.user_id !== user.id) {
      return jsonResponse({ error: 'Character not found.' }, 403);
    }

    // Load both inventory rows + their item data
    const { data: invRows, error: invErr } = await supabase
      .from('character_inventory')
      .select('id, character_id, item_id, equipped_slot, current_durability, item:items(id, name, description, rarity, slot, item_type, stats, value, max_durability, level)')
      .in('id', [stone_a_inv_id, stone_b_inv_id]);
    if (invErr) return jsonResponse({ error: invErr.message }, 500);
    if (!invRows || invRows.length !== 2) {
      return jsonResponse({ error: 'One or both stones could not be found in your inventory.' }, 400);
    }

    const a = invRows.find((r) => r.id === stone_a_inv_id) as unknown as InvRow | undefined;
    const b = invRows.find((r) => r.id === stone_b_inv_id) as unknown as InvRow | undefined;
    if (!a || !b) return jsonResponse({ error: 'Stones not found.' }, 400);

    if (a.character_id !== character_id || b.character_id !== character_id) {
      return jsonResponse({ error: 'Those stones do not belong to this character.' }, 403);
    }
    if (a.equipped_slot || b.equipped_slot) {
      return jsonResponse({ error: 'Unequip both stones before binding.' }, 400);
    }
    if (!isPrimaryTurningStone(a.item) || !isPrimaryTurningStone(b.item)) {
      return jsonResponse({ error: 'Only primary Turning Stones can be bound.' }, 400);
    }

    const [aStat] = primaryKeysOf(a.item.stats);
    const [bStat] = primaryKeysOf(b.item.stats);
    if (aStat === bStat) {
      return jsonResponse({ error: 'The two stones must carry different essences.' }, 400);
    }

    // Build ascended recipe map keyed by sorted stat-pair → ascended item.
    const { data: ascendeds, error: ascErr } = await supabase
      .from('items')
      .select('id, name, description, rarity, slot, item_type, stats, value, max_durability, level')
      .ilike('name', 'Ascended Turning Stone of %')
      .eq('rarity', 'unique')
      .eq('slot', 'trinket');
    if (ascErr) return jsonResponse({ error: ascErr.message }, 500);

    const recipeMap = new Map<string, ItemRow>();
    for (const row of (ascendeds ?? []) as unknown as ItemRow[]) {
      const keys = primaryKeysOf(row.stats);
      if (keys.length !== 2) continue; // skip malformed rows
      recipeMap.set(pairKey(keys[0], keys[1]), row);
    }

    const ascended = recipeMap.get(pairKey(aStat, bStat));
    if (!ascended) {
      return jsonResponse({ error: 'No ascended stone matches that essence pair.' }, 400);
    }

    // World-uniqueness check: the ascended item must not exist anywhere else.
    const [invHit, marketHit, groundHit] = await Promise.all([
      supabase.from('character_inventory').select('id', { head: true, count: 'exact' }).eq('item_id', ascended.id),
      supabase.from('marketplace_listings').select('id', { head: true, count: 'exact' }).eq('item_id', ascended.id).eq('status', 'active'),
      supabase.from('node_ground_loot').select('id', { head: true, count: 'exact' }).eq('item_id', ascended.id),
    ]);
    const exists =
      (invHit.count ?? 0) > 0 ||
      (marketHit.count ?? 0) > 0 ||
      (groundHit.count ?? 0) > 0;
    if (exists) {
      return jsonResponse({ error: 'That ascended stone already exists in the world.' }, 409);
    }

    if (mode === 'preview') {
      return jsonResponse({ item: ascended, consumed: [a.item, b.item] });
    }

    // === fuse ===
    // Re-check the inventory rows are still present and unequipped at write time.
    const { error: delErr } = await supabase
      .from('character_inventory')
      .delete()
      .in('id', [a.id, b.id])
      .is('equipped_slot', null);
    if (delErr) return jsonResponse({ error: delErr.message }, 500);

    const { data: inserted, error: insErr } = await supabase
      .from('character_inventory')
      .insert({
        character_id,
        item_id: ascended.id,
        equipped_slot: null,
        current_durability: ascended.max_durability ?? 100,
      })
      .select('id')
      .maybeSingle();
    if (insErr) {
      return jsonResponse({ error: insErr.message }, 500);
    }

    // Activity log (deterministic ritual flavor)
    await supabase.rpc('log_activity', {
      _character_id: character_id,
      _event_type: 'blacksmith',
      _message: `⚜ The Stonebinder binds ${a.item.name} and ${b.item.name} into ${ascended.name}.`,
      _metadata: {
        consumed: [a.item.id, b.item.id],
        produced: ascended.id,
        consumed_inv: [a.id, b.id],
        produced_inv: inserted?.id ?? null,
      },
    });

    return jsonResponse({
      item: ascended,
      consumed: [a.item, b.item],
      new_inventory_id: inserted?.id ?? null,
    });
  } catch (e: any) {
    console.error('stonebinder-fuse error', e);
    return jsonResponse({ error: e?.message ?? 'Unknown error' }, 500);
  }
});
