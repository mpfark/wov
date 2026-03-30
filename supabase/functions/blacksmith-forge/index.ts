import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALL_SLOTS = ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth with user token
    const userDb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userDb.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.claims.sub as string;

    // Service role for writes
    const db = createClient(supabaseUrl, serviceKey);

    const { character_id, slot } = await req.json();
    if (!character_id || !slot) throw new Error("Missing character_id or slot");
    if (!ALL_SLOTS.includes(slot)) throw new Error("Invalid slot");

    // Verify ownership
    const { data: char, error: charErr } = await db.from("characters").select("*").eq("id", character_id).single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    // Verify at blacksmith
    const { data: node } = await db.from("nodes").select("is_blacksmith").eq("id", char.current_node_id).single();
    if (!node?.is_blacksmith) throw new Error("You must be at a blacksmith to forge items");

    // Calculate costs
    const salvageCost = 5 + char.level * 2;
    const goldCost = char.level * 5;

    if (char.salvage < salvageCost) throw new Error("Not enough salvage");
    if (char.gold < goldCost) throw new Error("Not enough gold");

    // Roll rarity: 65% common, 35% uncommon
    const rarity = Math.random() < 0.65 ? "common" : "uncommon";

    // Base filters: equipment, correct slot, not soulbound, not unique
    const baseQuery = () => db
      .from("items")
      .select("*")
      .eq("item_type", "equipment")
      .eq("slot", slot)
      .eq("is_soulbound", false)
      .neq("rarity", "unique");

    // Query items: same slot, same rarity, level within ±2
    let { data: pool } = await baseQuery()
      .eq("rarity", rarity)
      .gte("level", char.level - 2)
      .lte("level", char.level + 2);

    // Fallback: widen to ±5
    if (!pool || pool.length === 0) {
      const { data: widerPool } = await baseQuery()
        .eq("rarity", rarity)
        .gte("level", char.level - 5)
        .lte("level", char.level + 5);
      pool = widerPool;
    }

    // Fallback: any rarity for that slot within ±5 (still excluding unique/soulbound)
    if (!pool || pool.length === 0) {
      const { data: anyRarityPool } = await baseQuery()
        .gte("level", char.level - 5)
        .lte("level", char.level + 5);
      pool = anyRarityPool;
    }

    if (!pool || pool.length === 0) {
      throw new Error("The blacksmith has no suitable items for this slot and level. Ask an admin to create items in this range.");
    }

    // Pick one at random
    const template = pool[Math.floor(Math.random() * pool.length)];

    // Deduct resources
    await db.from("characters").update({
      salvage: char.salvage - salvageCost,
      gold: char.gold - goldCost,
    }).eq("id", character_id);

    // Add existing item to inventory (no cloning needed)
    await db.from("character_inventory").insert({
      character_id,
      item_id: template.id,
      current_durability: 100,
    });

    return new Response(JSON.stringify({
      item: template,
      salvage_remaining: char.salvage - salvageCost,
      gold_remaining: char.gold - goldCost,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("blacksmith-forge error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
