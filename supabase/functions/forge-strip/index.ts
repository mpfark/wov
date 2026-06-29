/**
 * forge-strip — clear all applied gems from an item for a salvage + gold cost.
 *
 * Gems are NOT refunded (per design). Use this when you want to re-customize
 * an item with different attributes.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { effectiveItemLevel } from "../_shared/formulas/items.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BLACKSMITH_SLOTS = new Set(["main_hand", "off_hand", "head", "chest", "gloves", "pants"]);
const JEWELER_SLOTS = new Set(["ring", "trinket"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userDb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userDb.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const db = createClient(supabaseUrl, serviceKey);
    const { character_id, inventory_id } = await req.json();
    if (!character_id || !inventory_id) throw new Error("Missing character_id or inventory_id");

    const { data: char, error: charErr } = await db.from("characters")
      .select("id, user_id, gold, current_node_id").eq("id", character_id).single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    const { data: inv, error: invErr } = await db.from("character_inventory")
      .select("id, character_id, applied_gems, crafted_level, item:items(slot, rarity, level, is_soulbound)")
      .eq("id", inventory_id).single();
    if (invErr || !inv) throw new Error("Item not found");
    if (inv.character_id !== character_id) throw new Error("Not your item");

    const it = inv.item as any;
    if (it.is_soulbound) throw new Error("Soulbound items cannot be modified");
    if (it.rarity === "unique" || it.rarity === "soulforged") {
      throw new Error("Unique and soulforged items cannot be stripped");
    }

    const slot = it.slot as string;
    const station = BLACKSMITH_SLOTS.has(slot) ? "blacksmith" : JEWELER_SLOTS.has(slot) ? "jeweler" : null;
    if (!station) throw new Error("Slot not upgradeable");

    const { data: node } = await db.from("nodes")
      .select("is_blacksmith, is_jewelcrafter").eq("id", char.current_node_id).single();
    if (station === "blacksmith" && !node?.is_blacksmith) {
      throw new Error("You must be at a blacksmith to strip this item");
    }
    if (station === "jeweler" && !node?.is_jewelcrafter) {
      throw new Error("You must be at a jewelcrafter to strip this item");
    }

    const level = effectiveItemLevel(it.level, inv.crafted_level);
    const goldCost = level * 10;
    const salvageCost = level * 3;
    if (char.gold < goldCost) throw new Error("Not enough gold");

    const { data: salvageOk } = await db.rpc("consume_material", {
      _character_id: character_id, _key: "salvage", _delta: salvageCost,
    });
    if (!salvageOk) throw new Error("Not enough salvage");

    await db.from("characters").update({ gold: char.gold - goldCost }).eq("id", character_id);
    await db.from("character_inventory").update({ applied_gems: {} }).eq("id", inventory_id);

    return new Response(JSON.stringify({
      inventory_id,
      gold_remaining: char.gold - goldCost,
      salvage_spent: salvageCost,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("forge-strip error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
