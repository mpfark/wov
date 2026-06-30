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

import { GEAR_TIERS, getCraftableTierForLevel, getCraftedLevelForTier } from "../_shared/formulas/items.ts";

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
    const { character_id, item_id, slot: legacySlot } = await req.json();
    if (!character_id) throw new Error("Missing character_id");
    if (!item_id && !legacySlot) throw new Error("Missing item_id");

    const { data: char, error: charErr } = await db.from("characters")
      .select("id, user_id, level, gold, current_node_id").eq("id", character_id).single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    // Resolve the chosen plain base. Common only — uncommons (Fine variants) are drop-only.
    let base: { id: string; name: string; slot: string; rarity: string; tier: number | null } | null = null;
    if (item_id) {
      const { data } = await db.from("items")
        .select("id, name, slot, origin_type, rarity, tier").eq("id", item_id).maybeSingle();
      if (!data || data.origin_type !== "plain_base") throw new Error("Not a plain base item");
      base = { id: data.id, name: data.name, slot: data.slot as string, rarity: data.rarity, tier: data.tier };
    } else {
      // Legacy callers passing slot — pick a tier-1 common base for back-compat.
      const { data } = await db.from("items")
        .select("id, name, slot, rarity, tier")
        .eq("origin_type", "plain_base").eq("slot", legacySlot).eq("rarity", "common").eq("tier", 1)
        .order("name").limit(1).maybeSingle();
      if (!data) throw new Error("No plain base defined for that slot");
      base = { id: data.id, name: data.name, slot: data.slot as string, rarity: data.rarity, tier: data.tier };
    }

    if (base.rarity !== "common") {
      throw new Error("Only common plain bases can be crafted — uncommon (Fine) gear only drops from creatures.");
    }

    const baseTier = base.tier ?? 1;
    const unlockRow = GEAR_TIERS.find(r => r.tier === baseTier);
    if (!unlockRow) throw new Error("Invalid base tier");
    if (char.level < unlockRow.unlockLevel) {
      throw new Error(`Requires level ${unlockRow.unlockLevel} to craft this tier.`);
    }
    // crafted_level = the tier's canonical item level (so weapon dies and stat
    // budget are tied to the tier, not the player's exact level).
    const craftedLevel = getCraftedLevelForTier(baseTier);

    const station = BLACKSMITH_SLOTS.has(base.slot) ? "blacksmith" : JEWELER_SLOTS.has(base.slot) ? "jeweler" : null;
    if (!station) throw new Error("Invalid slot");

    const { data: node } = await db.from("nodes")
      .select("is_blacksmith, is_jewelcrafter").eq("id", char.current_node_id).single();
    if (station === "blacksmith" && !node?.is_blacksmith) {
      throw new Error("You must be at a blacksmith to craft armor or weapons");
    }
    if (station === "jeweler" && !node?.is_jewelcrafter) {
      throw new Error("You must be at a jewelcrafter to craft jewelry");
    }

    // Cost scales with the tier's item level so higher-tier bases cost more.
    const salvageCost = 5 + craftedLevel * 2;
    const goldCost = craftedLevel * 5;
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
      crafted_level: craftedLevel,
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
      crafted_level: craftedLevel,
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
