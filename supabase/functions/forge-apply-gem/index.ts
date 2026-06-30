/**
 * forge-apply-gem — apply 1 primary gem to a player-owned item.
 *
 * Each gem grants +1 to its single attribute on this specific inventory
 * instance (stored in character_inventory.applied_gems). Enforces:
 *   • Player is at the correct workstation for the item's slot.
 *   • Item is eligible — only plain bases or already-stripped instances
 *     (i.e. those with applied_gems set or stat_override set). Soulbound /
 *     unique / soulforged items are NOT upgradeable.
 *   • Per-stat cap and per-item stat budget from formulas/items.ts.
 *   • Player owns the gem and can pay the salvage + gold cost.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  effectiveItemStats,
  effectiveItemLevel,
  calculateItemStatCost,
  getItemStatBudget,
  getEffectiveStatCap,
} from "../_shared/formulas/items.ts";
import {
  PRIMARY_GEM_KEYS, attrForGem, GEM_CATALOG, type GemKey,
} from "../_shared/formulas/gems.ts";

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
    const { character_id, inventory_id, gem_key } = await req.json();
    if (!character_id || !inventory_id || !gem_key) {
      throw new Error("Missing character_id, inventory_id, or gem_key");
    }
    if (!PRIMARY_GEM_KEYS.includes(gem_key as GemKey)) {
      throw new Error("Only primary gems can be applied");
    }

    const { data: char, error: charErr } = await db.from("characters")
      .select("id, user_id, level, gold, current_node_id").eq("id", character_id).single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    const { data: inv, error: invErr } = await db.from("character_inventory")
      .select("id, character_id, applied_gems, stat_override, crafted_level, item:items(id, slot, stats, rarity, level, is_soulbound)")
      .eq("id", inventory_id).single();
    if (invErr || !inv) throw new Error("Item not found");
    if (inv.character_id !== character_id) throw new Error("Not your item");

    const it = inv.item as any;
    if (!it?.slot) throw new Error("Item has no slot");

    // Eligibility: skip uniques / soulforged / soulbound; allow common,
    // uncommon, and plain bases (whose stat_override is set during craft).
    if (it.is_soulbound) throw new Error("Soulbound items cannot be modified");
    if (it.rarity === "unique" || it.rarity === "soulforged") {
      throw new Error("Unique and soulforged items cannot be upgraded with gems");
    }

    const slot = it.slot as string;
    const station = BLACKSMITH_SLOTS.has(slot) ? "blacksmith" : JEWELER_SLOTS.has(slot) ? "jeweler" : null;
    if (!station) throw new Error("Slot not upgradeable");

    const { data: node } = await db.from("nodes")
      .select("is_blacksmith, is_jewelcrafter").eq("id", char.current_node_id).single();
    if (station === "blacksmith" && !node?.is_blacksmith) {
      throw new Error("You must be at a blacksmith to upgrade armor or weapons");
    }
    if (station === "jeweler" && !node?.is_jewelcrafter) {
      throw new Error("You must be at a jewelcrafter to upgrade jewelry");
    }

    const gemKey = gem_key as GemKey;
    const attr = attrForGem(gemKey);
    const appliedGems: Record<string, number> = { ...(inv.applied_gems || {}) };

    // Effective stats AFTER this would-be application.
    const baseStats = inv.stat_override ?? it.stats ?? {};
    const after = effectiveItemStats({
      baseStats,
      statOverride: inv.stat_override,
      appliedGems: { ...appliedGems, [gemKey]: (appliedGems[gemKey] || 0) + 1 },
    });
    const level = effectiveItemLevel(it.level, inv.crafted_level);

    // Total budget (computed first so per-stat cap can use it).
    const budget = getItemStatBudget(level, it.rarity || "common", 1, "equipment");
    // Per-stat cap: min(level cap, 60% of budget) for primary attributes.
    const cap = getEffectiveStatCap(attr, level, budget, "equipment");
    if ((after[attr] || 0) > cap) {
      throw new Error(`${attr.toUpperCase()} is at this item's per-stat cap (${cap})`);
    }
    const cost = calculateItemStatCost(after);
    if (cost > budget) {
      throw new Error(`No room left — this item's stat budget is full (${budget} pts)`);
    }

    // Cost: 1 gem + (2 + level) salvage + level*2 gold.
    const salvageCost = 2 + level;
    const goldCost = level * 2;
    if (char.gold < goldCost) throw new Error("Not enough gold");

    const { data: gemOk } = await db.rpc("consume_material", {
      _character_id: character_id, _key: gemKey, _delta: 1,
    });
    if (!gemOk) throw new Error(`You don't own a ${GEM_CATALOG[gemKey].name}`);

    const { data: salvageOk } = await db.rpc("consume_material", {
      _character_id: character_id, _key: "salvage", _delta: salvageCost,
    });
    if (!salvageOk) {
      await db.rpc("add_material", { _character_id: character_id, _key: gemKey, _delta: 1 });
      throw new Error("Not enough salvage");
    }

    appliedGems[gemKey] = (appliedGems[gemKey] || 0) + 1;
    await db.from("characters").update({ gold: char.gold - goldCost }).eq("id", character_id);
    await db.from("character_inventory").update({ applied_gems: appliedGems }).eq("id", inventory_id);

    return new Response(JSON.stringify({
      inventory_id,
      applied_gems: appliedGems,
      effective_stats: after,
      level,
      budget_used: cost,
      budget_max: budget,
      gold_remaining: char.gold - goldCost,
      salvage_spent: salvageCost,
      gem_used: gemKey,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("forge-apply-gem error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
