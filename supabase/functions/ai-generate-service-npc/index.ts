import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple in-memory rate limit per user
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const ts = (rateLimitMap.get(userId) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (ts.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, ts);
    return false;
  }
  ts.push(now);
  rateLimitMap.set(userId, ts);
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    if (!checkRateLimit(userId)) {
      return new Response(JSON.stringify({ error: "Rate limited. Please wait before generating more." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Steward/overlord gate
    const { data: roleData } = await userClient.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const nodeId: string | undefined = body.node_id;
    const overwrite: boolean = !!body.overwrite;
    if (!nodeId || typeof nodeId !== "string") {
      return new Response(JSON.stringify({ error: "node_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Optional explicit role override from caller
    const requestedRole: string | undefined = body.service_role;

    // Fetch node + area + region context
    const { data: node, error: nodeErr } = await admin
      .from("nodes")
      .select("id, name, description, is_vendor, is_blacksmith, is_trainer, area_id, region_id")
      .eq("id", nodeId)
      .single();
    if (nodeErr || !node) {
      return new Response(JSON.stringify({ error: "Node not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!node.is_vendor && !node.is_blacksmith && !node.is_trainer) {
      return new Response(JSON.stringify({ error: "Node is not a vendor, blacksmith, or trainer" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let serviceRole: "vendor" | "blacksmith" | "trainer";
    if (requestedRole === "vendor" && node.is_vendor) serviceRole = "vendor";
    else if (requestedRole === "blacksmith" && node.is_blacksmith) serviceRole = "blacksmith";
    else if (requestedRole === "trainer" && node.is_trainer) serviceRole = "trainer";
    else if (node.is_trainer) serviceRole = "trainer";
    else if (node.is_blacksmith) serviceRole = "blacksmith";
    else serviceRole = "vendor";

    const roleLabel =
      serviceRole === "vendor" ? "shopkeeper / merchant"
      : serviceRole === "blacksmith" ? "blacksmith / smith"
      : "renown trainer / master-at-arms (a hardened mentor who trains heroes' core attributes for Renown)";

    const [areaRes, regionRes] = await Promise.all([
      node.area_id
        ? admin.from("areas").select("name, description, area_type, flavor_text").eq("id", node.area_id).maybeSingle()
        : Promise.resolve({ data: null }),
      node.region_id
        ? admin.from("regions").select("name, description").eq("id", node.region_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const area: any = areaRes.data || null;
    const region: any = regionRes.data || null;

    // If a service NPC already exists for this role at this node and overwrite=false, abort.
    const { data: existing } = await admin
      .from("npcs")
      .select("id, name, service_role")
      .eq("node_id", nodeId);
    const existingService = (existing || []).find((n: any) => n.service_role === serviceRole);
    if (existingService && !overwrite) {
      return new Response(JSON.stringify({
        error: "A service NPC already exists for this node. Pass overwrite=true to replace.",
        existing_npc: existingService,
      }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a fantasy NPC generator for "Wayfarers of Varneth", a high-fantasy text RPG with a parchment / dark-fantasy tone.

Generate a single ${roleLabel} that fits the location. Output strictly JSON with three fields:
- name: 2-5 words, evocative, ASCII only, in the spirit of the location (e.g. "Hilda the Salt-Tongued", "Old Brann Iron-Hand", "Mira of the Dust-Road"). NOT generic ("The Vendor"). NO honorifics like "Sir/Lady" unless the area earns it.
- description: 1 short sentence (max ~120 chars) describing appearance and demeanor. ASCII only. No quotes inside.
- dialogue: 1 short greeting line, first-person, in-character, ASCII only, max ~140 chars. End with appropriate punctuation. Do NOT promise specific items or prices.

The NPC is a permanent fixture of the location; their tone should match the place. Avoid clichés. Be specific and grounded.`;

    const userPrompt = JSON.stringify({
      node_name: node.name || "(unnamed node)",
      node_description: node.description || "",
      area_name: area?.name || null,
      area_type: area?.area_type || null,
      area_description: area?.description || null,
      area_flavor: area?.flavor_text || null,
      region_name: region?.name || null,
      region_description: region?.description || null,
      service_role: serviceRole,
    });

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate the ${roleLabel} for this location:\n\n${userPrompt}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_service_npc",
            description: "Return the generated NPC.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 2, maxLength: 60 },
                description: { type: "string", minLength: 5, maxLength: 200 },
                dialogue: { type: "string", minLength: 5, maxLength: 220 },
              },
              required: ["name", "description", "dialogue"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_service_npc" } },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit. Please wait before retrying." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds to your Lovable AI workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", aiRes.status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("No tool call returned", JSON.stringify(aiJson).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI did not return a valid NPC" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: { name?: string; description?: string; dialogue?: string };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return new Response(JSON.stringify({ error: "AI returned invalid JSON" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sanitize = (s: string) => (s || "").replace(/[^\x20-\x7E\n]/g, "").trim();
    const npcName = sanitize(parsed.name || "").slice(0, 60);
    const npcDesc = sanitize(parsed.description || "").slice(0, 200);
    const npcDialogue = sanitize(parsed.dialogue || "").slice(0, 220);
    if (!npcName || !npcDialogue) {
      return new Response(JSON.stringify({ error: "AI produced an empty NPC" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If overwriting, delete the prior service NPC for this role at this node.
    if (existingService && overwrite) {
      await admin.from("npcs").delete().eq("id", existingService.id);
    }

    const { data: inserted, error: insErr } = await admin
      .from("npcs")
      .insert({
        node_id: nodeId,
        name: npcName,
        description: npcDesc,
        dialogue: npcDialogue,
        service_role: serviceRole,
      })
      .select("*")
      .single();

    if (insErr) {
      console.error("npc insert error", insErr);
      return new Response(JSON.stringify({ error: "Failed to insert NPC" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ npc: inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-generate-service-npc error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
