import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DIRECTION_OPPOSITES: Record<string, string> = {
  north: "south", south: "north",
  east: "west", west: "east",
  northeast: "southwest", southwest: "northeast",
  northwest: "southeast", southeast: "northwest",
  up: "down", down: "up",
  inside: "outside", outside: "inside",
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

    // Check admin role
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("maiar") && !roles.includes("valar")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { prompt } = await req.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch current world state for context
    const [regRes, nodeRes] = await Promise.all([
      supabase.from("regions").select("name, min_level, max_level").order("min_level"),
      supabase.from("nodes").select("name, region_id, is_inn, is_vendor, is_blacksmith"),
    ]);

    const regions = regRes.data || [];
    const nodes = nodeRes.data || [];

    const worldSummary = regions.map((r: any) => {
      const regionNodes = nodes.filter((n: any) => n.region_id === r.id);
      const nodeNames = regionNodes.map((n: any) => {
        const flags = [n.is_inn && "inn", n.is_vendor && "vendor", n.is_blacksmith && "blacksmith"].filter(Boolean);
        return n.name + (flags.length ? ` (${flags.join(", ")})` : "");
      }).join(", ");
      return `- ${r.name} (Lvl ${r.min_level}-${r.max_level}): ${nodeNames || "no nodes yet"}`;
    }).join("\n");

    const systemPrompt = `You are a Middle-earth world builder for a text-based RPG. You generate regions, nodes, creatures, and NPCs that fit Tolkien's lore.

CURRENT WORLD STATE:
${worldSummary || "No regions exist yet."}

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
                              target_temp_id: { type: "string" },
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
