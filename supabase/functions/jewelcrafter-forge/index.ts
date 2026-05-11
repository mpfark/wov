import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gemForItem } from "../_shared/formulas/gems.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALL_SLOTS = ["ring", "amulet", "trinket"] as const;

async function getItemPool(db: any, slot: string, level: number, ownedGems: Record<string, number>) {
  const baseQuery = () => db
    .from("items")
    .select("id, name, rarity, level, stats, description, slot, hands, weapon_tag")
    .eq("item_type", "equipment")
    .eq("slot", slot)
    .eq("is_soulbound", false)
    .in("rarity", ["common", "uncommon"]);

  let { data: pool } = await baseQuery()
    .gte("level", level - 2)
    .lte("level", level + 2);

  if (!pool || pool.length === 0) {
    const { data: widerPool } = await baseQuery()
      .gte("level", level - 5)
      .lte("level", level + 5);
    pool = widerPool;
  }

  return (pool || [])
    .map((it: any) => ({ ...it, required_gem: gemForItem(it.stats, it.rarity) }))
    .filter((it: any) => it.required_gem && (ownedGems[it.required_gem] || 0) > 0);
}

async function loadOwnedGems(db: any, characterId: string): Promise<Record<string, number>> {
  const { data } = await db
    .from("character_materials")
    .select("material_key, count, materials!inner(category)")
    .eq("character_id", characterId)
    .eq("materials.category", "gem");
  const map: Record<string, number> = {};
  for (const row of data || []) {
    if ((row.count ?? 0) > 0) map[row.material_key] = row.count;
  }
  return map;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userDb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userDb.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.claims.sub as string;

    const db = createClient(supabaseUrl, serviceKey);

    const { character_id, slot, mode, item_id } = await req.json();
    if (!character_id || !slot) throw new Error("Missing character_id or slot");
    if (!ALL_SLOTS.includes(slot)) throw new Error("Invalid slot");

    const { data: char, error: charErr } = await db.from("characters").select("*").eq("id", character_id).single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    const { data: node } = await db.from("nodes").select("is_jewelcrafter").eq("id", char.current_node_id).single();
    if (!node?.is_jewelcrafter) throw new Error("You must be at a jewelcrafter to forge jewelry");

    if (mode === "browse") {
      const ownedGems = await loadOwnedGems(db, character_id);
      const pool = await getItemPool(db, slot, char.level, ownedGems);
      return new Response(JSON.stringify({ pool, owned_gems: ownedGems }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!item_id) throw new Error("No item selected");

    const salvageCost = 5 + char.level * 2;
    const goldCost = char.level * 5;

    if (char.gold < goldCost) throw new Error("Not enough gold");

    const ownedGems = await loadOwnedGems(db, character_id);
    const pool = await getItemPool(db, slot, char.level, ownedGems);
    const template = pool.find((i: any) => i.id === item_id);
    if (!template) throw new Error("Selected item is not available — you may be missing the required gem");

    const gemKey = template.required_gem as string;
    if (!gemKey || (ownedGems[gemKey] || 0) < 1) {
      throw new Error("You lack the gem required to craft this item");
    }

    // Atomic salvage + gem deduction via materials helpers.
    const { data: salvageOk } = await db.rpc('consume_material', {
      _character_id: character_id, _key: 'salvage', _delta: salvageCost,
    });
    if (!salvageOk) throw new Error("Not enough salvage");

    const { data: gemOk } = await db.rpc('consume_material', {
      _character_id: character_id, _key: gemKey, _delta: 1,
    });
    if (!gemOk) {
      await db.rpc('add_material', { _character_id: character_id, _key: 'salvage', _delta: salvageCost });
      throw new Error("You lack the gem required to craft this item");
    }

    await db.from("characters").update({
      gold: char.gold - goldCost,
    }).eq("id", character_id);

    await db.from("character_inventory").insert({
      character_id,
      item_id: template.id,
      current_durability: 100,
    });

    return new Response(JSON.stringify({
      item: template,
      gold_remaining: char.gold - goldCost,
      gem_used: gemKey,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("jewelcrafter-forge error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
