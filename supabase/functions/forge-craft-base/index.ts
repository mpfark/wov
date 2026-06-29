/**
 * forge-craft-base — craft a plain base item at the blacksmith or jeweler.
 *
 * Plain bases have no stats; players add stats by applying gems via
 * forge-apply-gem. Each instance gets a `crafted_level` snapshot so its
 * stat budget is fixed at craft time (per the "switching to a higher base
 * starts over" rule).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { character_id, slot } = await req.json();
    if (!character_id || !slot) throw new Error("Missing character_id or slot");

    const { data: char, error: charErr } = await db.from("characters")
      .select("id, user_id, level, gold, current_node_id").eq("id", character_id).single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    const station = BLACKSMITH_SLOTS.has(slot) ? "blacksmith" : JEWELER_SLOTS.has(slot) ? "jeweler" : null;
    if (!station) throw new Error("Invalid slot");

    const { data: node } = await db.from("nodes")
      .select("is_blacksmith, is_jewelcrafter").eq("id", char.current_node_id).single();
    if (station === "blacksmith" && !node?.is_blacksmith) {
      throw new Error("You must be at a blacksmith to craft armor or weapons");
    }
    if (station === "jeweler" && !node?.is_jewelcrafter) {
      throw new Error("You must be at a jewelcrafter to craft jewelry");
    }

    // Find the plain base for this slot.
    const { data: base } = await db.from("items")
      .select("id, name").eq("origin_type", "plain_base").eq("slot", slot).maybeSingle();
    if (!base) throw new Error("No plain base defined for that slot");

    const salvageCost = 5 + char.level * 2;
    const goldCost = char.level * 5;
    if (char.gold < goldCost) throw new Error("Not enough gold");

    const { data: salvageOk } = await db.rpc("consume_material", {
      _character_id: character_id, _key: "salvage", _delta: salvageCost,
    });
    if (!salvageOk) throw new Error("Not enough salvage");

    await db.from("characters").update({ gold: char.gold - goldCost }).eq("id", character_id);

    const { data: inserted, error: insErr } = await db.from("character_inventory").insert({
      character_id,
      item_id: base.id,
      current_durability: 100,
      applied_gems: {},
      stat_override: {},
      crafted_level: char.level,
    }).select("id").single();
    if (insErr) {
      // Refund on failure.
      await db.rpc("add_material", { _character_id: character_id, _key: "salvage", _delta: salvageCost });
      await db.from("characters").update({ gold: char.gold }).eq("id", character_id);
      throw insErr;
    }

    return new Response(JSON.stringify({
      inventory_id: inserted.id,
      base_name: base.name,
      crafted_level: char.level,
      gold_remaining: char.gold - goldCost,
      salvage_spent: salvageCost,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("forge-craft-base error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
