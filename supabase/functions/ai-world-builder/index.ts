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
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { prompt, expand_region, populate_nodes } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch current world state for context
    const [regRes, nodeRes, creatureRes, npcRes, itemRes] = await Promise.all([
      supabase.from("regions").select("id, name, description, min_level, max_level").order("min_level"),
      supabase.from("nodes").select("id, name, region_id, is_inn, is_vendor, is_blacksmith, connections"),
      supabase.from("creatures").select("name, node_id, rarity, level"),
      supabase.from("npcs").select("name, node_id"),
      supabase.from("items").select("name, item_type, rarity, level").limit(200),
    ]);

    const regions = regRes.data || [];
    const nodes = nodeRes.data || [];
    const creatures = creatureRes.data || [];
    const npcs = npcRes.data || [];
    const existingItems = itemRes.data || [];

    const worldSummary = regions.map((r: any) => {
      const regionNodes = nodes.filter((n: any) => n.region_id === r.id);
      const nodeNames = regionNodes.map((n: any) => {
        const flags = [n.is_inn && "inn", n.is_vendor && "vendor", n.is_blacksmith && "blacksmith"].filter(Boolean);
        return n.name + (flags.length ? ` (${flags.join(", ")})` : "");
      }).join(", ");
      return `- ${r.name} (Lvl ${r.min_level}-${r.max_level}): ${nodeNames || "no nodes yet"}`;
    }).join("\n");

    const existingItemNames = existingItems.map((i: any) => i.name).join(", ");

    // Build expand-specific or populate-specific context
    let expandContext = "";
    let isPopulateMode = false;
    if (populate_nodes && Array.isArray(populate_nodes) && populate_nodes.length > 0) {
      isPopulateMode = true;
      const nodeDetails = populate_nodes.map((pn: any) => {
        const nodeCreatures = creatures.filter((c: any) => c.node_id === pn.id).map((c: any) => `${c.name} (${c.rarity}, lvl ${c.level})`).join(", ");
        return `  - ${pn.name} [id: ${pn.id}] (Region: ${pn.region_name}, Lvl ${pn.min_level}-${pn.max_level})\n    Description: ${pn.description}\n    Existing creatures: ${nodeCreatures || "none"}`;
      }).join("\n");

      expandContext = `\n\nYOU ARE POPULATING EXISTING NODES WITH CREATURES. Do NOT generate new nodes or NPCs.
TARGET NODES TO POPULATE:
${nodeDetails}

IMPORTANT RULES FOR POPULATING:
- Do NOT generate any new nodes — the "nodes" array must be empty []
- Do NOT generate any NPCs — the "npcs" array must be empty []
- Use the real node IDs (e.g. "${populate_nodes[0].id}") as the node_temp_id for creatures
- Generate 2-4 creatures per node (mix of aggressive and passive)
- Creature levels must match each node's region level range
- Do NOT duplicate existing creature names on the same node
- The "region" field should use name "Populate" with description "Populating existing nodes" min_level 1 max_level 1 (placeholder)
- Mark each creature as is_humanoid: true or false (humanoids are bandits, soldiers, cultists, mages, etc. — anything with a roughly human form)
- For humanoid creatures, generate 1-2 items each in the "items" array. Non-humanoids should NOT have items.`;
    } else if (expand_region) {
      const targetRegion = regions.find((r: any) => r.id === expand_region.id);
      if (targetRegion) {
        const existingNodes = nodes.filter((n: any) => n.region_id === targetRegion.id);
        const nodeDetails = existingNodes.map((n: any) => {
          const flags = [n.is_inn && "inn", n.is_vendor && "vendor", n.is_blacksmith && "blacksmith"].filter(Boolean);
          const conns = (n.connections as any[] || []).map((c: any) => {
            const targetNode = existingNodes.find((en: any) => en.id === c.node_id);
            return `${c.direction} → ${targetNode?.name || c.node_id}`;
          }).join(", ");
          const nodeCreatures = creatures.filter((c: any) => c.node_id === n.id).map((c: any) => `${c.name} (${c.rarity}, lvl ${c.level})`).join(", ");
          const nodeNpcs = npcs.filter((np: any) => np.node_id === n.id).map((np: any) => np.name).join(", ");
          return `  - ${n.name}${flags.length ? ` (${flags.join(", ")})` : ""} [id: ${n.id}]\n    Exits: ${conns || "none"}\n    Creatures: ${nodeCreatures || "none"}\n    NPCs: ${nodeNpcs || "none"}`;
        }).join("\n");

        expandContext = `\n\nYOU ARE EXPANDING AN EXISTING REGION. Do NOT generate a new region.
EXISTING REGION: ${targetRegion.name} (Lvl ${targetRegion.min_level}-${targetRegion.max_level})
Description: ${targetRegion.description}

EXISTING NODES IN THIS REGION:
${nodeDetails}

IMPORTANT RULES FOR EXPANSION:
- The "region" field in your output should match the existing region exactly (same name, description, levels)
- New nodes MUST connect to at least one existing node using "existing_node_id" connections
- Use "existing:<node_id>" format in target_temp_id to reference existing nodes (e.g. "existing:abc-123")
- New nodes can also connect to other new nodes using temp_ids as usual
- Creature levels must stay within ${targetRegion.min_level}-${targetRegion.max_level}
- Do NOT duplicate existing node names or NPC names
- Mark each creature as is_humanoid: true or false
- For humanoid creatures, generate 1-2 items each in the "items" array. Non-humanoids should NOT have items.`;
      }
    }

    const systemPrompt = `You are a high-fantasy world builder for a text-based RPG called "Wayfarers of Eldara". You generate regions, nodes, creatures, and NPCs that fit the world's lore. Generate original names and content inspired by classic high-fantasy settings but NOT taken directly from any copyrighted works (e.g. do not use names from Tolkien, D&D, or other franchises).

CURRENT WORLD STATE:
${worldSummary || "No regions exist yet."}
${expandContext}

EXISTING ITEMS (avoid duplicating these names): ${existingItemNames || "none"}

RULES:
- Nodes must have directional connections using SHORT codes ONLY: N, S, E, W, NE, NW, SE, SW. NEVER use full words like "north" or "south".
- ALL names (region, node, creature, NPC, item) must use ONLY standard English alphabet letters (A-Z, a-z), spaces, hyphens, and apostrophes. NO accented characters, NO diacritics, NO special Unicode letters (e.g. no ë, ú, â, ñ, ö). Use plain English equivalents instead.
- Every region should have at least one inn node for resting
- Creature levels must match the region's level range
- Creature stats use: str, dex, con, int, wis, cha (range 5-30 based on level)
- Creature rarity: "regular", "rare", or "boss" — each region should have mostly regulars, a few rares, and 1-2 bosses
- HP formula: base 10 + (level * 3) for regular, *1.5 for rare, *3 for boss
- AC formula: 8 + floor(level / 3) for regular, +2 for rare, +4 for boss
- Loot tables are arrays of {item_name, drop_chance (0-1), gold_min, gold_max}
- NPC dialogue should be lore-appropriate and atmospheric
- Use temp IDs like "node_1", "node_2" ONLY in the temp_id field and connection references — NEVER include temp IDs in the "name" field
- Node "name" must be a clean, lore-appropriate place name only (e.g. "Thornwood Clearing", "Rivermist Bridge"). NEVER append temp IDs, booleans, field names, or any metadata to node names.
- The is_inn, is_vendor, is_blacksmith fields are SEPARATE boolean fields — do NOT put "is_vendor", "vendor", "true/false" or similar text inside the name or description
- For expanding existing regions, use "existing:<real_uuid>" in target_temp_id to connect to existing nodes
- Connections between nodes you generate should be bidirectional
- Generate 2-4 creatures per node (mix of aggressive and passive)
- Generate 1-2 NPCs for inn/vendor/blacksmith nodes
- Create original fantasy names that evoke a sense of ancient, mythic world-building
- Mark creatures as is_humanoid: true if they have a roughly human form (bandits, soldiers, cultists, mages, knights, etc.) or false for beasts/monsters/animals

ITEM GENERATION RULES:
- Only humanoid creatures (is_humanoid: true) can carry items
- Generate 1-2 items per humanoid creature, max
- Only generate "equipment" or "consumable" item types — NO trash loot
- Item temp_ids should be like "item_1", "item_2", etc.
- creature_temp_ids links which creatures carry this item (use creature temp_ids or real node IDs for populate mode creatures)
- drop_chance should be between 0.1 and 0.5
- Item stats follow a budget: floor(level * 0.3 * rarity_multiplier * hands_multiplier)
  - Rarity multipliers: common=1.0, uncommon=1.5, rare=2.0, unique=3.0
  - hands_multiplier: 1.0 for one-handed, 1.5 for two-handed (hands=2)
- Valid equipment slots: main_hand, off_hand, head, chest, gloves, belt, pants, ring, trinket, boots, amulet, shoulders
- Consumables should have slot: null and stats with hp (restore amount) or hp_regen
- Valid stat keys for equipment: str, dex, con, int, wis, cha, ac, hp, hp_regen
- Max durability: always 100 (fixed for all items)
- Gold value suggestion: floor(level * 2.5 * rarity_multiplier^2)
- Item rarity should be "common" or "uncommon" for regular creatures, up to "rare" for rare/boss creatures. Never generate "unique" items.
- Do NOT duplicate existing item names

Call the generate_world tool with the structured output.`;

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
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_world",
              description: "Generate world content including region, nodes, creatures, NPCs, and items",
              parameters: {
                type: "object",
                properties: {
                  region: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      min_level: { type: "integer" },
                      max_level: { type: "integer" },
                    },
                    required: ["name", "description", "min_level", "max_level"],
                  },
                  nodes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        temp_id: { type: "string", description: "Temporary ID like node_1, node_2" },
                        name: { type: "string" },
                        description: { type: "string" },
                        is_inn: { type: "boolean" },
                        is_vendor: { type: "boolean" },
                        is_blacksmith: { type: "boolean" },
                        connections: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              target_temp_id: { type: "string", description: "Use temp_id for new nodes or 'existing:<uuid>' for existing nodes" },
                              direction: { type: "string", enum: ["N", "S", "E", "W", "NE", "NW", "SE", "SW"] },
                            },
                            required: ["target_temp_id", "direction"],
                          },
                        },
                      },
                      required: ["temp_id", "name", "description", "connections"],
                    },
                  },
                  creatures: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        temp_id: { type: "string", description: "Temporary ID like creature_1, creature_2" },
                        name: { type: "string" },
                        description: { type: "string" },
                        node_temp_id: { type: "string" },
                        level: { type: "integer" },
                        hp: { type: "integer" },
                        max_hp: { type: "integer" },
                        ac: { type: "integer" },
                        rarity: { type: "string", enum: ["regular", "rare", "boss"] },
                        is_aggressive: { type: "boolean" },
                        is_humanoid: { type: "boolean", description: "true for human-like creatures (bandits, mages, soldiers), false for beasts/monsters" },
                        respawn_seconds: { type: "integer" },
                        stats: {
                          type: "object",
                          properties: {
                            str: { type: "integer" }, dex: { type: "integer" },
                            con: { type: "integer" }, int: { type: "integer" },
                            wis: { type: "integer" }, cha: { type: "integer" },
                          },
                        },
                        loot_table: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              item_name: { type: "string" },
                              drop_chance: { type: "number" },
                              gold_min: { type: "integer" },
                              gold_max: { type: "integer" },
                            },
                          },
                        },
                      },
                      required: ["temp_id", "name", "description", "node_temp_id", "level", "hp", "max_hp", "ac", "rarity", "is_aggressive", "is_humanoid", "stats"],
                    },
                  },
                  npcs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        dialogue: { type: "string" },
                        node_temp_id: { type: "string" },
                      },
                      required: ["name", "description", "dialogue", "node_temp_id"],
                    },
                  },
                  items: {
                    type: "array",
                    description: "Items carried by humanoid creatures. Only equipment and consumable types.",
                    items: {
                      type: "object",
                      properties: {
                        temp_id: { type: "string", description: "Temporary ID like item_1, item_2" },
                        name: { type: "string" },
                        description: { type: "string" },
                        item_type: { type: "string", enum: ["equipment", "consumable"] },
                        rarity: { type: "string", enum: ["common", "uncommon", "rare"] },
                        slot: { type: "string", enum: ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"], description: "null for consumables" },
                        level: { type: "integer" },
                        hands: { type: "integer", description: "1 or 2 for weapons, null for non-weapons" },
                        stats: {
                          type: "object",
                          description: "Stat bonuses: str, dex, con, int, wis, cha, ac, hp, hp_regen",
                        },
                        value: { type: "integer", description: "Gold value" },
                        max_durability: { type: "integer" },
                        creature_temp_ids: {
                          type: "array",
                          items: { type: "string" },
                          description: "Which creatures carry this item (use creature temp_ids)",
                        },
                        drop_chance: { type: "number", description: "Drop chance 0.1-0.5" },
                      },
                      required: ["temp_id", "name", "description", "item_type", "rarity", "level", "stats", "value", "max_durability", "creature_temp_ids", "drop_chance"],
                    },
                  },
                },
                required: ["region", "nodes", "creatures", "npcs", "items"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_world" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI did not return structured output" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const generated = JSON.parse(toolCall.function.arguments);

    // Sanitize: strip non-ASCII from all name fields
    const stripNonAscii = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
    // Also strip leaked temp IDs, boolean flags, and metadata from names
    const cleanName = (s: string) => {
      let cleaned = stripNonAscii(s);
      cleaned = cleaned.replace(/\s*\(?node_\d+\)?/gi, '');
      cleaned = cleaned.replace(/\s*\(?\s*is_(vendor|inn|blacksmith)\s*:?\s*(true|false)?\s*\)?/gi, '');
      cleaned = cleaned.replace(/\s*\(?\s*(vendor|inn|blacksmith)\s*:?\s*(true|false)\s*\)?/gi, '');
      cleaned = cleaned.replace(/^[\s,\-–]+|[\s,\-–]+$/g, '').trim();
      return cleaned;
    };
    if (generated.region?.name) generated.region.name = cleanName(generated.region.name);
    for (const node of (generated.nodes || [])) {
      if (node.name) node.name = cleanName(node.name);
    }
    for (const cr of (generated.creatures || [])) {
      if (cr.name) cr.name = cleanName(cr.name);
    }
    for (const npc of (generated.npcs || [])) {
      if (npc.name) npc.name = cleanName(npc.name);
    }
    for (const item of (generated.items || [])) {
      if (item.name) item.name = cleanName(item.name);
    }

    // Ensure items array exists
    if (!generated.items) generated.items = [];

    return new Response(JSON.stringify(generated), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-world-builder error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
