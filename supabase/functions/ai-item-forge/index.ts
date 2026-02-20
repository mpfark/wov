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
    else typeInstruction = "All items must be consumables (slot = null, stats provide hp or hp_regen).";

    const systemPrompt = `You are an item generator for "Wayfarers of Eldara", a text-based high-fantasy RPG.
Generate a batch of ${count} distinct, lore-consistent items for a level ${level_min}–${level_max} world.

GENERATION RULES:
- ALL item names must use ONLY standard English alphabet letters (A-Z, a-z), spaces, hyphens, and apostrophes. NO accented characters or special Unicode.
- Item type: ${typeInstruction}
- Slot: ${slotInstruction}
- Rarity: ${rarityInstruction}
- Stats focus: ${statsFocusInstruction}
- Level: pick a level between ${level_min} and ${level_max} for each item.
- Stat budget formula: floor(1 + (level - 1) * 0.3 * rarity_multiplier * hands_multiplier)
  - Rarity multipliers: common=1.0, uncommon=1.5, rare=2.0
  - hands_multiplier: 1.0 for 1h, 1.5 for 2h (hands=2, main_hand only)
- ALWAYS include at least one stat bonus per item. Never leave stats empty. Distribute the budget.
- Valid stat keys: str, dex, con, int, wis, cha, ac, hp, hp_regen
- Stat value caps: str/dex/con/int/wis/cha max (4 + floor(level/4)), ac max (2 + floor(level/10)), hp max (6 + floor(level/5)*2), hp_regen max 2
- drop_chance: 0.1–0.5 (rare items lower, consumables 0.3–0.5)
- max_durability: 50–100 common, 75–150 uncommon, 100–200 rare
- Gold value: floor(level × 2.5 × rarity_multiplier²)
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
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate exactly ${count} items for level ${level_min}–${level_max}. Ensure every item has stat bonuses.` },
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
                        value: { type: "integer" },
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

    const parsed = JSON.parse(toolCall.function.arguments);
    const items = (parsed.items || []).map((item: any) => ({
      ...item,
      // Ensure stats is never empty — fallback if AI fails
      stats: (item.stats && Object.keys(item.stats).length > 0) ? item.stats : { str: 1 },
      slot: item.item_type === "consumable" ? null : (item.slot || null),
    }));

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
