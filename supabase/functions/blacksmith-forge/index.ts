import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALL_SLOTS = ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"] as const;
const RARITY_MULT: Record<string, number> = { common: 1.0, uncommon: 1.5 };
const STAT_COSTS: Record<string, number> = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, ac: 3, hp: 0.5, hp_regen: 2 };
const PRIMARY_STATS = ["str", "dex", "con", "int", "wis", "cha"];

function calcBudget(level: number, rarity: string, hands: number = 1): number {
  const mult = RARITY_MULT[rarity] || 1;
  const handsMult = hands === 2 ? 1.5 : 1;
  return Math.floor(1 + (level - 1) * 0.3 * mult * handsMult);
}

function calcStatCost(stats: Record<string, number>): number {
  return Object.entries(stats).reduce((sum, [k, v]) => sum + v * (STAT_COSTS[k] || 1), 0);
}

function getStatCap(key: string, level: number): number {
  if (key === "ac" || key === "hp_regen") return 2 + Math.floor(level / 10);
  if (key === "hp") return 6 + Math.floor(level / 5) * 2;
  return 4 + Math.floor(level / 4);
}

// Rate limiter: 3 per 60s per user
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(userId) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return true;
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

    if (!checkRateLimit(userId)) {
      return new Response(JSON.stringify({ error: "Please wait before forging again." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    // Determine hands for weapons
    const isWeapon = slot === "main_hand" || slot === "off_hand";
    const hands = (slot === "main_hand" && Math.random() < 0.3) ? 2 : 1;
    const actualSlot = slot;

    // Generate item via AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const budget = calcBudget(char.level, rarity, isWeapon ? hands : 1);

    const systemPrompt = `You are an item generator for "Wayfarers of Edhelard", a text-based high-fantasy RPG.
Generate exactly 1 piece of equipment forged by a blacksmith.

RULES:
- ALL text must be in English with ONLY ASCII characters (A-Z, a-z, spaces, hyphens, apostrophes).
- Name: a creative, lore-fitting item name. Pure name only — no prefixes or labels.
- Description: a single evocative sentence about the freshly forged item.
- Slot: ${actualSlot}
- Rarity: ${rarity}
- Level: ${char.level}
${hands === 2 ? '- This is a TWO-HANDED weapon (hands=2).' : ''}
- Stat budget: ${budget} points to distribute across at least 2 stats.
- Valid stat keys: str, dex, con, int, wis, cha, ac, hp, hp_regen
- Stat costs: primary stats cost 1, ac costs 3, hp costs 0.5, hp_regen costs 2
- Stat caps: primary = ${4 + Math.floor(char.level / 4)}, ac = ${2 + Math.floor(char.level / 10)}, hp = ${6 + Math.floor(char.level / 5) * 2}, hp_regen = ${2 + Math.floor(char.level / 10)}
- Spend ALL the budget. MUST have at least 2 different stat keys.
- The item should feel like it was crafted from salvaged beast materials.

Call the generate_item tool with the result.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Forge a ${rarity} ${actualSlot} item for level ${char.level}. Budget: ${budget} stat points. Distribute across 2+ stats.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_item",
            description: "Generate a forged item",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                stats: { type: "object", description: "Stat bonuses: str, dex, con, int, wis, cha, ac, hp, hp_regen" },
              },
              required: ["name", "description", "stats"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_item" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("AI rate limit. Try again shortly.");
      if (response.status === 402) throw new Error("AI credits exhausted.");
      throw new Error("AI generation failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return an item");

    const parsed = JSON.parse(toolCall.function.arguments);

    // Sanitize name
    let cleanName = (parsed.name || "Forged Item")
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/^(name|item|id)\s*[:=]\s*/i, '')
      .replace(/^\d+[\s.:_-]+/, '')
      .trim();
    if (!cleanName) cleanName = "Forged Item";

    let cleanDesc = (parsed.description || "A freshly forged piece of equipment.")
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
    if (!cleanDesc) cleanDesc = "A freshly forged piece of equipment.";

    // Process stats
    let stats = parsed.stats && Object.keys(parsed.stats).length > 0 ? { ...parsed.stats } : {};
    let spent = calcStatCost(stats);

    // Top up if underspent
    let attempts = 0;
    while (spent < budget && attempts < 50) {
      const pick = PRIMARY_STATS[Math.floor(Math.random() * PRIMARY_STATS.length)];
      const cap = getStatCap(pick, char.level);
      const current = stats[pick] || 0;
      if (current < cap) {
        stats[pick] = current + 1;
        spent++;
      }
      attempts++;
    }

    // Ensure 2+ stat keys
    if (Object.keys(stats).length < 2) {
      const used = Object.keys(stats);
      const avail = PRIMARY_STATS.filter(k => !used.includes(k));
      if (avail.length > 0) stats[avail[Math.floor(Math.random() * avail.length)]] = 1;
    }
    if (Object.keys(stats).length === 0) stats = { str: 1, con: 1 };

    // Calculate gold value
    const mult = RARITY_MULT[rarity] || 1;
    const autoGold = Math.round(char.level * 2.5 * mult * mult);

    // Deduct resources (service role bypasses trigger)
    await db.from("characters").update({
      salvage: char.salvage - salvageCost,
      gold: char.gold - goldCost,
    }).eq("id", character_id);

    // Insert item
    const { data: newItem, error: itemErr } = await db.from("items").insert({
      name: cleanName,
      description: cleanDesc,
      item_type: "equipment",
      rarity,
      slot: actualSlot,
      level: char.level,
      hands: isWeapon ? hands : null,
      stats,
      value: autoGold,
      max_durability: 100,
      origin_type: "blacksmith_forge",
    }).select().single();

    if (itemErr) throw new Error("Failed to create item: " + itemErr.message);

    // Add to inventory
    await db.from("character_inventory").insert({
      character_id,
      item_id: newItem.id,
      current_durability: 100,
    });

    return new Response(JSON.stringify({
      item: newItem,
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
