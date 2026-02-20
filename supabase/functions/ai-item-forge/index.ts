import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { prompt, creature_ids } = await req.json();
    if (!creature_ids || !Array.isArray(creature_ids) || creature_ids.length === 0) {
      return new Response(JSON.stringify({ error: "creature_ids array is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch selected creatures with their region info
    const { data: creatures, error: crErr } = await supabase
      .from("creatures")
      .select("id, name, description, level, rarity, is_humanoid, is_aggressive, loot_table_id, node_id")
      .in("id", creature_ids);

    if (crErr || !creatures?.length) {
      return new Response(JSON.stringify({ error: "Failed to fetch creatures" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch nodes to get region context
    const nodeIds = [...new Set(creatures.map((c: any) => c.node_id).filter(Boolean))];
    const { data: nodes } = await supabase.from("nodes").select("id, name, region_id").in("id", nodeIds);
    const { data: regions } = await supabase.from("regions").select("id, name, min_level, max_level");

    const nodeMap = new Map((nodes || []).map((n: any) => [n.id, n]));
    const regionMap = new Map((regions || []).map((r: any) => [r.id, r]));

    const creatureDetails = creatures.map((c: any) => {
      const node = nodeMap.get(c.node_id);
      const region = node ? regionMap.get(node.region_id) : null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        level: c.level,
        rarity: c.rarity,
        is_humanoid: c.is_humanoid,
        node_name: node?.name || "Unknown",
        region_name: region?.name || "Unknown",
        region_min_level: region?.min_level || 1,
        region_max_level: region?.max_level || 10,
      };
    });

    // Fetch existing item names to avoid duplicates
    const { data: existingItems } = await supabase.from("items").select("name").limit(500);
    const existingItemNames = (existingItems || []).map((i: any) => i.name).join(", ");

    const creatureList = creatureDetails.map((c: any) => {
      const budget = Math.floor(1 + (c.level - 1) * 0.3);
      return `- ${c.name} [id: ${c.id}] (${c.rarity}, level ${c.level}, ${c.is_humanoid ? "humanoid" : "non-humanoid"}, region: ${c.region_name} Lv${c.region_min_level}-${c.region_max_level}, node: ${c.node_name}) — stat budget ~${budget}`;
    }).join("\n");

    const systemPrompt = `You are an item generator for "Wayfarers of Eldara", a text-based high-fantasy RPG. Your job is to generate level-appropriate, lore-consistent items for the given creatures.

CREATURES TO EQUIP:
${creatureList}

EXISTING ITEMS (avoid duplicating these names): ${existingItemNames || "none"}

RULES:
- ALL item names must use ONLY standard English alphabet letters (A-Z, a-z), spaces, hyphens, and apostrophes. NO accented characters or special Unicode.
- Only generate items for humanoid creatures (is_humanoid: true). Non-humanoid creatures must not receive items.
- Generate 1–3 items per humanoid creature: 1 for regular, 1–2 for rare, 2–3 for boss.
- Only generate "equipment" or "consumable" types. NO trash loot.
- Rarity caps: regular creatures → common/uncommon; rare/boss → uncommon/rare. NEVER generate unique items.
- drop_chance: 0.1–0.5 (lower for better items)
- Stat budget formula: floor(1 + (level - 1) * 0.3 * rarity_multiplier * hands_multiplier)
  - Rarity multipliers: common=1.0, uncommon=1.5, rare=2.0
  - hands_multiplier: 1.0 for 1h, 1.5 for 2h (hands=2)
- Valid equipment slots: main_hand, off_hand, head, chest, gloves, belt, pants, ring, trinket, boots, amulet, shoulders
- Valid stat keys: str, dex, con, int, wis, cha, ac, hp, hp_regen
- Consumables: slot = null, stats with hp (restore amount) or hp_regen
- max_durability: 50–100 common, 75–150 uncommon, 100–200 rare
- Gold value: floor(level × 2.5 × rarity_multiplier²)
- Do NOT duplicate existing item names
- creature_id must be the REAL UUID of the creature (given in the list above)
- Items should be thematically appropriate to the creature (a bandit might drop a worn dagger, a cultist a ritual staff, a soldier chainmail, etc.)

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
          { role: "user", content: `Generate items for the ${creatureDetails.length} listed creatures. Focus on thematic variety and level-appropriate stats.` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_items",
              description: "Generate items for humanoid creatures",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        creature_id: { type: "string", description: "Real UUID of the creature this item belongs to" },
                        name: { type: "string" },
                        description: { type: "string" },
                        item_type: { type: "string", enum: ["equipment", "consumable"] },
                        rarity: { type: "string", enum: ["common", "uncommon", "rare"] },
                        slot: {
                          type: "string",
                          enum: ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"],
                          description: "null for consumables"
                        },
                        level: { type: "integer" },
                        hands: { type: "integer", description: "1 or 2 for weapons, null for others" },
                        stats: {
                          type: "object",
                          description: "Stat bonuses: str, dex, con, int, wis, cha, ac, hp, hp_regen",
                        },
                        value: { type: "integer" },
                        max_durability: { type: "integer" },
                        drop_chance: { type: "number", description: "0.1 to 0.5" },
                      },
                      required: ["creature_id", "name", "description", "item_type", "rarity", "level", "stats", "value", "max_durability", "drop_chance"],
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
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds to your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const items = parsed.items || [];

    // Attach creature context to each item for preview
    const itemsWithContext = items.map((item: any) => {
      const creature = creatureDetails.find((c: any) => c.id === item.creature_id);
      return {
        ...item,
        creature_name: creature?.name || "Unknown",
        creature_rarity: creature?.rarity || "regular",
        creature_level: creature?.level || 1,
      };
    });

    return new Response(JSON.stringify({ items: itemsWithContext }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-item-forge error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
