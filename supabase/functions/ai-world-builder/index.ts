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
    const [regRes, nodeRes, creatureRes, npcRes, ltRes, lteRes, areaRes] = await Promise.all([
      supabase.from("regions").select("id, name, description, min_level, max_level").order("min_level"),
      supabase.from("nodes").select("id, name, region_id, area_id, is_inn, is_vendor, is_blacksmith, connections"),
      supabase.from("creatures").select("name, node_id, rarity, level"),
      supabase.from("npcs").select("name, node_id"),
      supabase.from("loot_tables").select("id, name"),
      supabase.from("loot_table_entries").select("loot_table_id, item_id, weight, items:item_id(name, level, rarity)"),
      supabase.from("areas").select("id, name, description, area_type, region_id"),
    ]);

    const regions = regRes.data || [];
    const nodes = nodeRes.data || [];
    const creatures = creatureRes.data || [];
    const npcs = npcRes.data || [];
    const lootTables = ltRes.data || [];
    const lootTableEntries = lteRes.data || [];
    const areas = areaRes.data || [];

    // Build loot table summary for AI context
    const lootTableSummary = lootTables.map((lt: any) => {
      const entries = lootTableEntries.filter((e: any) => e.loot_table_id === lt.id);
      if (entries.length === 0) return null;
      const levels = entries.map((e: any) => e.items?.level).filter(Boolean);
      const rarities = entries.map((e: any) => e.items?.rarity).filter(Boolean);
      const minLevel = levels.length > 0 ? Math.min(...levels) : 0;
      const maxLevel = levels.length > 0 ? Math.max(...levels) : 0;
      const uniqueRarities = [...new Set(rarities)];
      const itemNames = entries.map((e: any) => e.items?.name).filter(Boolean).slice(0, 5).join(", ");
      return `  - "${lt.name}" [id: ${lt.id}] (items lvl ${minLevel}-${maxLevel}, rarities: ${uniqueRarities.join("/")}, ${entries.length} items: ${itemNames}${entries.length > 5 ? "..." : ""})`;
    }).filter(Boolean).join("\n");

    const worldSummary = regions.map((r: any) => {
      const regionAreas = areas.filter((a: any) => a.region_id === r.id);
      const regionNodes = nodes.filter((n: any) => n.region_id === r.id);
      const areaInfo = regionAreas.map((a: any) => {
        const areaNodes = regionNodes.filter((n: any) => n.area_id === a.id);
        return `  Area: ${a.name} (${a.area_type}) — ${areaNodes.length} nodes`;
      }).join("\n");
      const unassignedNodes = regionNodes.filter((n: any) => !n.area_id);
      const unassignedInfo = unassignedNodes.length > 0
        ? `  Unassigned nodes: ${unassignedNodes.map((n: any) => n.name || "(unnamed)").join(", ")}`
        : "";
      return `- ${r.name} (Lvl ${r.min_level}-${r.max_level}):\n${areaInfo || "  No areas yet"}${unassignedInfo ? "\n" + unassignedInfo : ""}`;
    }).join("\n");

    // Build expand-specific or populate-specific context
    let expandContext = "";
    let isPopulateMode = false;
    if (populate_nodes && Array.isArray(populate_nodes) && populate_nodes.length > 0) {
      isPopulateMode = true;
      const nodeDetails = populate_nodes.map((pn: any) => {
        const nodeCreatures = creatures.filter((c: any) => c.node_id === pn.id).map((c: any) => `${c.name} (${c.rarity}, lvl ${c.level})`).join(", ");
        return `  - ${pn.name || "(unnamed)"} [id: ${pn.id}] (Region: ${pn.region_name}, Lvl ${pn.min_level}-${pn.max_level})\n    Description: ${pn.description}\n    Existing creatures: ${nodeCreatures || "none"}`;
      }).join("\n");

      expandContext = `\n\nYOU ARE POPULATING EXISTING NODES WITH CREATURES. Do NOT generate new nodes, NPCs, or areas.
TARGET NODES TO POPULATE:
${nodeDetails}

IMPORTANT RULES FOR POPULATING:
- Do NOT generate any new nodes — the "nodes" array must be empty []
- Do NOT generate any NPCs — the "npcs" array must be empty []
- Do NOT generate any areas — the "areas" array must be empty []
- Use the real node IDs (e.g. "${populate_nodes[0].id}") as the node_temp_id for creatures
- Generate 1-4 creatures per node (mix of aggressive and passive)
- Creature levels must match each node's region level range
- Do NOT duplicate existing creature names on the same node
- The "region" field should use name "Populate" with description "Populating existing nodes" min_level 1 max_level 1 (placeholder)
- Mark each creature as is_humanoid: true or false (humanoids are bandits, soldiers, cultists, mages, etc. — anything with a roughly human form)
- USE THE CREATURE STAT FORMULAS specified in the main rules section. Do NOT invent stat values.`;
    } else if (expand_region) {
      const targetRegion = regions.find((r: any) => r.id === expand_region.id);
      if (targetRegion) {
        const existingNodes = nodes.filter((n: any) => n.region_id === targetRegion.id);
        const existingAreas = areas.filter((a: any) => a.region_id === targetRegion.id);
        const nodeDetails = existingNodes.map((n: any) => {
          const flags = [n.is_inn && "inn", n.is_vendor && "vendor", n.is_blacksmith && "blacksmith"].filter(Boolean);
          const conns = (n.connections as any[] || []).map((c: any) => {
            const targetNode = existingNodes.find((en: any) => en.id === c.node_id);
            return `${c.direction} → ${targetNode?.name || c.node_id}`;
          }).join(", ");
          const nodeCreatures = creatures.filter((c: any) => c.node_id === n.id).map((c: any) => `${c.name} (${c.rarity}, lvl ${c.level})`).join(", ");
          const nodeNpcs = npcs.filter((np: any) => np.node_id === n.id).map((np: any) => np.name).join(", ");
          const nodeArea = existingAreas.find((a: any) => a.id === n.area_id);
          const areaInfo = nodeArea ? ` [Area: ${nodeArea.name} (${nodeArea.area_type})]` : "";
          return `  - ${n.name || "(unnamed)"}${flags.length ? ` (${flags.join(", ")})` : ""} [id: ${n.id}]${areaInfo}\n    Exits: ${conns || "none"}\n    Creatures: ${nodeCreatures || "none"}\n    NPCs: ${nodeNpcs || "none"}`;
        }).join("\n");

        const areaDetails = existingAreas.map((a: any) => {
          const areaNodeCount = existingNodes.filter((n: any) => n.area_id === a.id).length;
          return `  - ${a.name} (${a.area_type}) [id: ${a.id}] — ${areaNodeCount} nodes`;
        }).join("\n");

        expandContext = `\n\nYOU ARE EXPANDING AN EXISTING REGION. Do NOT generate a new region.
EXISTING REGION: ${targetRegion.name} (Lvl ${targetRegion.min_level}-${targetRegion.max_level})
Description: ${targetRegion.description}

EXISTING AREAS IN THIS REGION:
${areaDetails || "  None"}

EXISTING NODES IN THIS REGION:
${nodeDetails}

IMPORTANT RULES FOR EXPANSION:
- The "region" field in your output should match the existing region exactly (same name, description, levels)
- Generate new areas for new groups of nodes — each area defines a place type (forest, town, cave, etc.) and shared description
- You can also assign new nodes to existing areas using "existing_area:<area_id>" in the area_temp_id field
- New nodes MUST connect to at least one existing node using "existing_node_id" connections
- Use "existing:<node_id>" format in target_temp_id to reference existing nodes (e.g. "existing:abc-123")
- New nodes can also connect to other new nodes using temp_ids as usual
- Creature levels must stay within ${targetRegion.min_level}-${targetRegion.max_level}
- Do NOT duplicate existing node names or NPC names
- Mark each creature as is_humanoid: true or false
- Nodes do NOT need unique names — they inherit their area name. Only give a node a name if it's a special/notable location (inn, vendor, blacksmith, boss lair, etc.)`;
      }
    }

    // Determine if the region already has an inn
    let regionHasInn = false;
    if (expand_region) {
      const regionNodes = nodes.filter((n: any) => n.region_id === expand_region.id);
      regionHasInn = regionNodes.some((n: any) => n.is_inn);
    }

    const innInstruction = regionHasInn
      ? "This region ALREADY HAS an inn. Do NOT generate any new inn nodes (is_inn must be false for all new nodes)."
      : "This region does not have an inn yet. Generate exactly one inn node.";

    const systemPrompt = `You are a high-fantasy world builder for a text-based RPG called "Wayfarers of Edhelard". You generate regions, areas, nodes, creatures, and NPCs that fit the world's lore. Generate original names and content inspired by classic high-fantasy settings but NOT taken directly from any copyrighted works (e.g. do not use names from Tolkien, D&D, or other franchises).

WORLD STRUCTURE: Region → Area → Node
- A Region has a name, level range, and description.
- An Area groups nodes by place type (forest, town, cave, ruins, plains, mountain, swamp, desert, coast, dungeon, other). It provides a shared name and description for all its nodes.
- Nodes are individual locations within an area. They do NOT need unique names — unnamed nodes display their area name. Only give a node its own name if it's a special/notable location (inn, vendor, blacksmith, boss lair, landmark).

CURRENT WORLD STATE:
${worldSummary || "No regions exist yet."}
${expandContext}

AVAILABLE LOOT TABLES (assign these to humanoid creatures based on matching level range and rarity):
${lootTableSummary || "No loot tables exist yet."}

INN RULE: ${innInstruction}

RULES:
- Nodes must have directional connections using SHORT codes ONLY: N, S, E, W, NE, NW, SE, SW. NEVER use full words like "north" or "south".
- ALL names (region, area, node, creature, NPC) must use ONLY standard English alphabet letters (A-Z, a-z), spaces, hyphens, and apostrophes. NO accented characters, NO diacritics, NO special Unicode letters (e.g. no ë, ú, â, ñ, ö). Use plain English equivalents instead.
- Each area should have an area_type that matches its theme (forest, town, cave, ruins, plains, mountain, swamp, desert, coast, dungeon, other).
- Group nodes into areas logically: a cluster of forest nodes in one area, town nodes in another, etc.
- Creature levels must match the region's level range
- Generate 1-4 creatures per node (mix of aggressive and passive). Each region should have mostly regulars, a few rares, and at most 1 boss.
- NPC dialogue should be lore-appropriate and atmospheric
- Use temp IDs like "area_1", "node_1", "node_2" ONLY in the temp_id field and connection references — NEVER include temp IDs in the "name" field
- Node "name" should be empty string "" for most nodes (they inherit area name). Only set a name for special locations like inns, vendors, blacksmiths, boss lairs, or landmarks.
- The is_inn, is_vendor, is_blacksmith fields are SEPARATE boolean fields — do NOT put "is_vendor", "vendor", "true/false" or similar text inside the name or description
- For expanding existing regions, use "existing:<real_uuid>" in target_temp_id to connect to existing nodes
- Connections between nodes you generate should be bidirectional
- Generate 1-2 NPCs for inn/vendor/blacksmith nodes
- Create original fantasy names that evoke a sense of ancient, mythic world-building
- Mark creatures as is_humanoid: true if they have a roughly human form (bandits, soldiers, cultists, mages, knights, etc.) or false for beasts/monsters/animals
- Every node must reference an area_temp_id — either a new area temp ID or "existing_area:<uuid>" for an existing area

CREATURE STAT FORMULAS (YOU MUST USE THESE EXACTLY):
- Base stats (str, dex, con, int, wis, cha): round(10 + level * 0.7). For bosses, multiply by 2.0.
- HP: round((15 + level * 8) * rarity_multiplier). Rarity multipliers: regular=1.0, rare=1.5, boss=4.0. Set hp = max_hp.
- AC: round(10 + level * 0.6 + rarity_ac_bonus). Rarity AC bonus: regular=+2, rare=+2, boss=+6.
- respawn_seconds: regular=120, rare=300, boss=600
- Example: A level 5 regular creature: stats=round(10+5*0.7)=14 each, HP=round((15+40)*1.0)=55, AC=round(10+3+2)=15
- Example: A level 10 boss creature: stats=round(10+7)*2=34 each, HP=round((15+80)*4.0)=380, AC=round(10+6+6)=22
- IMPORTANT: Do NOT invent your own stat values. Calculate them from these formulas.

LOOT TABLE ASSIGNMENT RULES:
- Do NOT generate any items. Items are managed separately via the Item Forge.
- Instead, assign existing loot tables to humanoid creatures using the loot_table_id field.
- Pick a loot table whose item levels are within the creature's level range (±3 levels) and whose item rarities match appropriately.
- Regular creatures should get tables with common/uncommon items. Rare/boss creatures can get tables with uncommon/rare items.
- Non-humanoid creatures should have loot_table_id: null.
- If no suitable loot table exists, set loot_table_id to null. Do NOT invent loot table IDs.
- Set drop_chance between 0.1 and 0.5 (rare items lower).

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
              description: "Generate world content including region, areas, nodes, creatures, and NPCs. Assign existing loot tables to creatures — do NOT generate items.",
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
                  areas: {
                    type: "array",
                    description: "Areas group nodes by place type. Each area has a name, description, type, and temp_id.",
                    items: {
                      type: "object",
                      properties: {
                        temp_id: { type: "string", description: "Temporary ID like area_1, area_2" },
                        name: { type: "string", description: "Area name e.g. 'Darkwood Forest', 'Thornwall Village'" },
                        description: { type: "string", description: "Shared description for all nodes in this area" },
                        area_type: {
                          type: "string",
                          enum: ["forest", "town", "cave", "ruins", "plains", "mountain", "swamp", "desert", "coast", "dungeon", "other"],
                        },
                      },
                      required: ["temp_id", "name", "description", "area_type"],
                    },
                  },
                  nodes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        temp_id: { type: "string", description: "Temporary ID like node_1, node_2" },
                        name: { type: "string", description: "Optional unique name — empty string for nodes that inherit area name" },
                        description: { type: "string", description: "Optional override description — empty string to use area description" },
                        area_temp_id: { type: "string", description: "References area temp_id or 'existing_area:<uuid>' for existing areas" },
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
                      required: ["temp_id", "area_temp_id", "connections"],
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
                        loot_table_id: { type: "string", description: "ID of an existing loot table to assign. Use null if no suitable table exists or for non-humanoid creatures." },
                        drop_chance: { type: "number", description: "0.1-0.5, chance of dropping loot on kill" },
                        loot_table: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
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
                },
                required: ["region", "areas", "nodes", "creatures", "npcs"],
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
    const cleanName = (s: string) => {
      if (!s) return s;
      let cleaned = stripNonAscii(s);
      cleaned = cleaned.replace(/\s*\(?node_\d+\)?/gi, '');
      cleaned = cleaned.replace(/\s*\(?\s*is_(vendor|inn|blacksmith)\s*:?\s*(true|false)?\s*\)?/gi, '');
      cleaned = cleaned.replace(/\s*\(?\s*(vendor|inn|blacksmith)\s*:?\s*(true|false)\s*\)?/gi, '');
      cleaned = cleaned.replace(/^[\s,\-–]+|[\s,\-–]+$/g, '').trim();
      return cleaned;
    };
    if (generated.region?.name) generated.region.name = cleanName(generated.region.name);
    for (const area of (generated.areas || [])) {
      if (area.name) area.name = cleanName(area.name);
    }
    for (const node of (generated.nodes || [])) {
      if (node.name) node.name = cleanName(node.name);
    }
    for (const cr of (generated.creatures || [])) {
      if (cr.name) cr.name = cleanName(cr.name);
      // Validate loot_table_id — only allow IDs that actually exist
      if (cr.loot_table_id) {
        const validLt = lootTables.find((lt: any) => lt.id === cr.loot_table_id);
        if (!validLt) cr.loot_table_id = null;
      }
    }
    for (const npc of (generated.npcs || [])) {
      if (npc.name) npc.name = cleanName(npc.name);
    }

    // Ensure areas array exists
    if (!generated.areas) generated.areas = [];

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
