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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.claims.sub;

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const {
      prompt,
      count = 5,
      level_min = 1,
      level_max = 10,
      item_type = "random",       // "equipment" | "consumable" | "random"
      slot = "random",            // specific slot | "random" | "any_weapon" | "any_armor"
      rarity = "random",          // "common" | "uncommon" | "rare" | "random"
      stats_focus = "random",     // "random" | "offensive" | "defensive" | "utility"
    } = body;

    // Fetch existing item names to avoid duplicates
    const { data: existingItems } = await supabase.from("items").select("name").limit(500);
    const existingItemNames = (existingItems || []).map((i: any) => i.name).join(", ");

    // Build slot constraint
    const weaponSlots = ["main_hand", "off_hand"];
    const armorSlots = ["head", "chest", "gloves", "belt", "pants", "boots", "shoulders"];
    const accessorySlots = ["ring", "trinket", "amulet"];

    let slotInstruction = "";
    if (slot === "random") {
      slotInstruction = "Choose slots freely across all equipment types for variety.";
    } else if (slot === "any_weapon") {
      slotInstruction = `Slots must be one of: ${weaponSlots.join(", ")}.`;
    } else if (slot === "any_armor") {
      slotInstruction = `Slots must be one of: ${armorSlots.join(", ")}.`;
    } else if (slot === "any_accessory") {
      slotInstruction = `Slots must be one of: ${accessorySlots.join(", ")}.`;
    } else if (slot !== "random") {
      slotInstruction = `All items must use slot: ${slot}.`;
    }

    // Build stats focus instruction
    let statsFocusInstruction = "";
    if (stats_focus === "offensive") statsFocusInstruction = "Focus stats on: str, dex, int — offensive power.";
    else if (stats_focus === "defensive") statsFocusInstruction = "Focus stats on: con, ac, hp, hp_regen — survivability.";
    else if (stats_focus === "utility") statsFocusInstruction = "Focus stats on: wis, cha, int — utility and support.";
    else statsFocusInstruction = "Mix stat types freely for variety across the batch.";

    // Build rarity instruction
    let rarityInstruction = "";
    if (rarity === "random") rarityInstruction = "Vary rarity freely: mostly common, some uncommon, occasional rare.";
    else rarityInstruction = `All items must have rarity: ${rarity}.`;

    // Build item type instruction
    let typeInstruction = "";
    if (item_type === "random") typeInstruction = "Mix equipment and consumables, leaning toward equipment.";
    else if (item_type === "equipment") typeInstruction = "All items must be equipment (no consumables).";
    else typeInstruction = "All items must be consumables (slot = null, stats can ONLY use hp and hp_regen, budget is 3x normal, no stat caps).";

    const systemPrompt = `You are an item generator for "Wayfarers of Eldara", a text-based high-fantasy RPG.
Generate a batch of ${count} distinct, lore-consistent items for a level ${level_min}–${level_max} world.

GENERATION RULES:
- ALL item names and descriptions must be written ENTIRELY in English. NO non-English words, NO accented/Unicode characters (ä, ö, ü, é, å, etc.). Use ONLY standard ASCII letters (A-Z, a-z), spaces, hyphens, and apostrophes.
- Do NOT include any metadata, IDs, labels, or prefixes in the name or description fields. Names should be pure item names like "Iron Longsword" — never "name: Iron Longsword" or "平衡 Iron Longsword" or "item_3: Iron Longsword".
- Descriptions must be a single evocative English sentence describing the item. Never leave description empty.
- Item type: ${typeInstruction}
- Slot: ${slotInstruction}
- Rarity: ${rarityInstruction}
- Stats focus: ${statsFocusInstruction}
- Level: pick a level between ${level_min} and ${level_max} for each item.
- Stat budget formula: floor(1 + (level - 1) * 0.3 * rarity_multiplier * hands_multiplier)
  - For consumables: budget is 3x the normal formula
  - Rarity multipliers: common=1.0, uncommon=1.5, rare=2.0
  - hands_multiplier: 1.0 for 1h, 1.5 for 2h (hands=2, main_hand only)
- ABSOLUTE RULE: Equipment items MUST have AT LEAST 2 different stat keys. Items with only 1 stat will be REJECTED.
- Distribute the full budget across multiple stats. Example for budget=2: {"str":1,"con":1}. Example for budget=4: {"str":2,"dex":1,"con":1}. Example for budget=6: {"str":2,"dex":2,"wis":1,"hp":2}.
- Valid stat keys for equipment: str, dex, con, int, wis, cha, ac, hp, hp_regen
- Valid stat keys for consumables: hp, hp_regen ONLY (no other stats allowed, no caps)
- Even for budget=1 items, split across 2 stats like {"str":1,"dex":1} (going slightly over budget is fine for variety).
- Stat value caps (equipment only): str/dex/con/int/wis/cha max (4 + floor(level/4)), ac max (2 + floor(level/10)), hp max (6 + floor(level/5)*2), hp_regen max 2
- drop_chance: 0.1–0.5 (rare items lower, consumables 0.3–0.5)
- max_durability: always 100 (fixed for all items)
- Gold value: DO NOT set this, it will be auto-calculated.
- Do NOT generate items with names from this list: ${existingItemNames || "none"}
- Generate items with creative, lore-fitting names and evocative 1-sentence descriptions.
- Ensure variety within the batch: don't repeat the same slot/stat combo.

${prompt ? `FLAVOR CONTEXT: ${prompt}` : ""}

Call the generate_items tool with the structured output.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
          { role: "user", content: `Generate exactly ${count} items for level ${level_min}–${level_max}. IMPORTANT: Calculate the stat budget for each item using the formula and spend ALL of it across multiple stats. A level 10 uncommon item has budget floor(1+9*0.3*1.5)=5, so its stats should total ~5 points spread across 2-3 keys. A level 14 rare item has budget floor(1+13*0.3*2)=8, so spread 8 points across 3-4 keys. Never leave budget unspent.` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_items",
              description: "Generate a batch of items for a loot table",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        item_type: { type: "string", enum: ["equipment", "consumable"] },
                        rarity: { type: "string", enum: ["common", "uncommon", "rare"] },
                        slot: {
                          type: "string",
                          enum: ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"],
                          description: "null for consumables",
                        },
                        level: { type: "integer" },
                        hands: { type: "integer", description: "1 or 2 for main_hand weapons, null otherwise" },
                        stats: {
                          type: "object",
                          description: "Must not be empty. Stat bonuses using valid keys: str, dex, con, int, wis, cha, ac, hp, hp_regen",
                        },
                        value: { type: "integer", description: "Set to 0, will be auto-calculated" },
                        max_durability: { type: "integer" },
                        drop_chance: { type: "number", description: "0.1 to 0.5" },
                      },
                      required: ["name", "description", "item_type", "rarity", "level", "stats", "value", "max_durability", "drop_chance"],
                    },
                  },
                },
                required: ["items"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_items" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment before trying again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds to your workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call in AI response");
    }

    const RARITY_MULT: Record<string, number> = { common: 1.0, uncommon: 1.5, rare: 2.0, unique: 3.0 };
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

    const parsed = JSON.parse(toolCall.function.arguments);
    const items = (parsed.items || []).map((item: any) => {
      const mult = RARITY_MULT[item.rarity] || 1;
      const autoGold = Math.round((item.level || 1) * 2.5 * mult * mult);

      // Sanitize name: strip non-ASCII, remove prefixes like "name:", trim
      let cleanName = (item.name || "Unnamed Item")
        .replace(/[^\x20-\x7E]/g, '')        // strip non-ASCII
        .replace(/^(name|item|id)\s*[:=]\s*/i, '') // strip "name:" prefixes
        .replace(/^\d+[\s.:_-]+/, '')          // strip leading IDs like "3: " or "item_3 "
        .trim();
      if (!cleanName) cleanName = "Unnamed Item";

      // Sanitize description
      let cleanDesc = (item.description || "A mysterious item.")
        .replace(/[^\x20-\x7E]/g, '')
        .trim();
      if (!cleanDesc) cleanDesc = "A mysterious item.";

      let stats = (item.stats && Object.keys(item.stats).length > 0) ? { ...item.stats } : {};

      if (item.item_type === "equipment") {
        const budget = calcBudget(item.level || 1, item.rarity, item.hands || 1);
        let spent = calcStatCost(stats);

        // If AI underspent the budget, top up with random stats
        let attempts = 0;
        while (spent < budget && attempts < 50) {
          const pick = PRIMARY_STATS[Math.floor(Math.random() * PRIMARY_STATS.length)];
          const cap = getStatCap(pick, level);
          const current = stats[pick] || 0;
          if (current < cap) {
            stats[pick] = current + 1;
            spent++;
          }
          attempts++;
        }

        // Ensure at least 2 different stats
        if (Object.keys(stats).length < 2) {
          const usedKeys = Object.keys(stats);
          const available = PRIMARY_STATS.filter(k => !usedKeys.includes(k));
          if (available.length > 0) {
            const pick = available[Math.floor(Math.random() * available.length)];
            stats[pick] = 1;
          }
        }

        // If still empty
        if (Object.keys(stats).length === 0) stats = { str: 1, con: 1 };
      } else {
        // Consumable fallback
        if (Object.keys(stats).length === 0) stats = { hp: 3 };
      }

      return {
        ...item,
        name: cleanName,
        description: cleanDesc,
        stats,
        slot: item.item_type === "consumable" ? null : (item.slot || null),
        value: autoGold,
      };
    });

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-item-forge error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
