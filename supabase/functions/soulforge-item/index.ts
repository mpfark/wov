import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_SLOTS = [
  "head","amulet","shoulders","chest","gloves","belt","pants","ring","trinket","main_hand","off_hand","boots",
];
const STAT_KEYS = ["str","dex","con","int","wis","cha","ac","hp","hp_regen","potion_slots"];
const STAT_COSTS: Record<string, number> = {
  str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, ac: 3, hp: 0.5, hp_regen: 2, potion_slots: 1,
};

function getStatBudget(hands: number): number {
  const mult = 1.5; // uncommon
  const handsMult = hands === 2 ? 1.5 : 1;
  return Math.floor(1 + 41 * 0.3 * mult * handsMult);
}

function getStatCap(key: string): number {
  if (key === "potion_slots") return 4;
  if (key === "ac" || key === "hp_regen") return 2 + Math.floor(42 / 10);
  if (key === "hp") return 6 + Math.floor(42 / 5) * 2;
  return 4 + Math.floor(42 / 4);
}

function calcCost(stats: Record<string, number>): number {
  let total = 0;
  for (const [k, v] of Object.entries(stats)) {
    total += v * (STAT_COSTS[k] || 1);
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { character_id, name, slot, hands, stats } = await req.json();

    // Validate inputs
    if (!character_id || !name || !slot || !stats) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: corsHeaders });
    }

    // Validate name: 1-30 ASCII printable chars
    if (typeof name !== "string" || name.length < 1 || name.length > 30 || !/^[\x20-\x7E]+$/.test(name)) {
      return new Response(JSON.stringify({ error: "Invalid name (1-30 ASCII characters)" }), { status: 400, headers: corsHeaders });
    }

    if (!VALID_SLOTS.includes(slot)) {
      return new Response(JSON.stringify({ error: "Invalid slot" }), { status: 400, headers: corsHeaders });
    }

    const effectiveHands = slot === "main_hand" ? (hands === 2 ? 2 : 1) : (slot === "off_hand" ? 1 : null);

    // Validate stats
    const cleanStats: Record<string, number> = {};
    for (const [k, v] of Object.entries(stats)) {
      if (!STAT_KEYS.includes(k)) continue;
      const val = Math.floor(Number(v));
      if (val <= 0) continue;
      if (val > getStatCap(k)) {
        return new Response(JSON.stringify({ error: `${k} exceeds cap of ${getStatCap(k)}` }), { status: 400, headers: corsHeaders });
      }
      cleanStats[k] = val;
    }

    if (Object.keys(cleanStats).length < 2) {
      return new Response(JSON.stringify({ error: "Item must have at least 2 stats" }), { status: 400, headers: corsHeaders });
    }

    const budget = getStatBudget(effectiveHands || 1);
    const cost = calcCost(cleanStats);
    if (cost > budget) {
      return new Response(JSON.stringify({ error: `Stats exceed budget (${cost}/${budget})` }), { status: 400, headers: corsHeaders });
    }

    // Use service role for DB operations
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify character ownership & eligibility
    const { data: char, error: charErr } = await admin
      .from("characters")
      .select("id, user_id, level, soulforged_item_created")
      .eq("id", character_id)
      .single();

    if (charErr || !char) {
      return new Response(JSON.stringify({ error: "Character not found" }), { status: 404, headers: corsHeaders });
    }
    if (char.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not your character" }), { status: 403, headers: corsHeaders });
    }
    if (char.level < 42) {
      return new Response(JSON.stringify({ error: "Must be level 42" }), { status: 403, headers: corsHeaders });
    }
    if (char.soulforged_item_created) {
      return new Response(JSON.stringify({ error: "Already forged" }), { status: 403, headers: corsHeaders });
    }

    // Calculate value
    const value = Math.floor(42 * 2.5 * (1.5 * 1.5));

    // Insert item
    const { data: item, error: itemErr } = await admin
      .from("items")
      .insert({
        name: name.trim(),
        description: `Soulforged by ${char.id}`,
        item_type: "equipment",
        slot,
        rarity: "uncommon",
        level: 42,
        hands: effectiveHands,
        stats: cleanStats,
        value,
        max_durability: 100,
        is_soulbound: true,
      })
      .select("*")
      .single();

    if (itemErr || !item) {
      return new Response(JSON.stringify({ error: "Failed to create item" }), { status: 500, headers: corsHeaders });
    }

    // Insert into inventory
    const { error: invErr } = await admin
      .from("character_inventory")
      .insert({
        character_id,
        item_id: item.id,
        current_durability: 100,
      });

    if (invErr) {
      // Rollback item
      await admin.from("items").delete().eq("id", item.id);
      return new Response(JSON.stringify({ error: "Failed to add to inventory" }), { status: 500, headers: corsHeaders });
    }

    // Mark character as having forged
    await admin
      .from("characters")
      .update({ soulforged_item_created: true })
      .eq("id", character_id);

    return new Response(JSON.stringify({ item }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
