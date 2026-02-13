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
    if (!roles.includes("maiar") && !roles.includes("valar")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { prompt, expand_region } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch current world state for context
    const [regRes, nodeRes, creatureRes, npcRes] = await Promise.all([
      supabase.from("regions").select("id, name, description, min_level, max_level").order("min_level"),
      supabase.from("nodes").select("id, name, region_id, is_inn, is_vendor, is_blacksmith, connections"),
      supabase.from("creatures").select("name, node_id, rarity, level"),
      supabase.from("npcs").select("name, node_id"),
    ]);

    const regions = regRes.data || [];
    const nodes = nodeRes.data || [];
    const creatures = creatureRes.data || [];
    const npcs = npcRes.data || [];

    const worldSummary = regions.map((r: any) => {
      const regionNodes = nodes.filter((n: any) => n.region_id === r.id);
      const nodeNames = regionNodes.map((n: any) => {
        const flags = [n.is_inn && "inn", n.is_vendor && "vendor", n.is_blacksmith && "blacksmith"].filter(Boolean);
        return n.name + (flags.length ? ` (${flags.join(", ")})` : "");
      }).join(", ");
      return `- ${r.name} (Lvl ${r.min_level}-${r.max_level}): ${nodeNames || "no nodes yet"}`;
    }).join("\n");

    // Build expand-specific context
    let expandContext = "";
    if (expand_region) {
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
- Do NOT duplicate existing node names or NPC names`;
      }
    }

    const systemPrompt = `You are a Middle-earth world builder for a text-based RPG. You generate regions, nodes, creatures, and NPCs that fit Tolkien's lore.

CURRENT WORLD STATE:
${worldSummary || "No regions exist yet."}
${expandContext}

RULES:
- Nodes must have directional connections (north, south, east, west, northeast, northwest, southeast, southwest, up, down, inside, outside)
- Every region should have at least one inn node for resting
- Creature levels must match the region's level range
- Creature stats use: str, dex, con, int, wis, cha (range 5-30 based on level)
- Creature rarity: "regular", "rare", or "boss" — each region should have mostly regulars, a few rares, and 1-2 bosses
- HP formula: base 10 + (level * 3) for regular, *1.5 for rare, *3 for boss
- AC formula: 8 + floor(level / 3) for regular, +2 for rare, +4 for boss
- Loot tables are arrays of {item_name, drop_chance (0-1), gold_min, gold_max}
- NPC dialogue should be lore-appropriate and atmospheric
- Use temp IDs like "node_1", "node_2" for internal references in connections
- For expanding existing regions, use "existing:<real_uuid>" in target_temp_id to connect to existing nodes
- Connections between nodes you generate should be bidirectional
- Generate 2-4 creatures per node (mix of aggressive and passive)
- Generate 1-2 NPCs for inn/vendor/blacksmith nodes

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
              description: "Generate world content including region, nodes, creatures, and NPCs",
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
                              direction: { type: "string" },
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
                        name: { type: "string" },
                        description: { type: "string" },
                        node_temp_id: { type: "string" },
                        level: { type: "integer" },
                        hp: { type: "integer" },
                        max_hp: { type: "integer" },
                        ac: { type: "integer" },
                        rarity: { type: "string", enum: ["regular", "rare", "boss"] },
                        is_aggressive: { type: "boolean" },
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
                      required: ["name", "description", "node_temp_id", "level", "hp", "max_hp", "ac", "rarity", "is_aggressive", "stats"],
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
                required: ["region", "nodes", "creatures", "npcs"],
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
