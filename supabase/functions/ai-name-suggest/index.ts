import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory rate limiter: max 15 requests per 60 seconds per user
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
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

    if (!checkRateLimit(userId as string)) {
      return new Response(JSON.stringify({ error: "Rate limited. Please wait before making more requests." }), { status: 429, headers: corsHeaders });
    }

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { type, context } = body;

    if (!type || !context) {
      return new Response(JSON.stringify({ error: "type and context are required" }), { status: 400, headers: corsHeaders });
    }

    let systemPrompt = `You are a fantasy world-building assistant for a text-based RPG. Generate evocative, lore-appropriate names and descriptions. Keep names concise (1-4 words). Keep descriptions atmospheric and under 200 characters. Do NOT use non-ASCII characters or Unicode symbols. Respond ONLY with the JSON tool call.`;

    let userPrompt = "";

    if (type === "region") {
      userPrompt = `Generate a name and description for a new region.
Level range: ${context.min_level}-${context.max_level}.
Existing regions: ${context.existing_regions || "none"}.
${context.prompt ? `Theme/style hint: ${context.prompt}` : ""}`;
    } else if (type === "area") {
      userPrompt = `Generate a name and description for a new area.
Area type: ${context.area_type}.
Region: ${context.region_name || "unknown"} (levels ${context.min_level || "?"}-${context.max_level || "?"}).
Existing areas in this region: ${context.existing_areas || "none"}.
${context.prompt ? `Theme/style hint: ${context.prompt}` : ""}`;
    } else if (type === "node") {
      userPrompt = `Generate a name and description for a specific location (node) within an area.
Area: ${context.area_name || "unknown"} (${context.area_type || "unknown"} type).
Region: ${context.region_name || "unknown"}.
Node flags: ${[context.is_vendor && "vendor", context.is_inn && "inn", context.is_blacksmith && "blacksmith", context.is_teleport && "teleport"].filter(Boolean).join(", ") || "none"}.
Nearby locations: ${context.nearby_nodes || "none"}.
${context.prompt ? `Theme/style hint: ${context.prompt}` : ""}`;
    } else {
      return new Response(JSON.stringify({ error: "Invalid type. Use: region, area, node" }), { status: 400, headers: corsHeaders });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers: corsHeaders });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_name",
              description: "Return a suggested name and description for the game element.",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "A concise fantasy name (1-4 words)" },
                  description: { type: "string", description: "An atmospheric description under 200 characters" },
                },
                required: ["name", "description"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_name" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: corsHeaders });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: corsHeaders });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: corsHeaders });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI did not return a suggestion" }), { status: 500, headers: corsHeaders });
    }

    const suggestion = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(suggestion), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-name-suggest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
