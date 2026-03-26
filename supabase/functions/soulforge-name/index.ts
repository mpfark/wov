import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), { status: 500, headers: corsHeaders });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { slot, character_name, character_class, character_race } = await req.json();

    if (!slot) {
      return new Response(JSON.stringify({ error: "Slot is required" }), { status: 400, headers: corsHeaders });
    }

    const slotLabel = slot.replace("_", " ");

    const systemPrompt = `You are a fantasy item name generator for "Wayfarers of Varneth", a high-fantasy text RPG. Generate a single creative, lore-appropriate name for a soulforged ${slotLabel} item. The name should be evocative, 1-4 words, and suitable for an endgame legendary item. Only ASCII characters allowed. Do not use generic names like "Sword of Power". Be creative and unique. The item belongs to ${character_name}, a ${character_race} ${character_class}.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate a name for a soulforged ${slotLabel} item.` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_name",
              description: "Return a suggested item name.",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The suggested item name (1-30 ASCII chars, 1-4 words)" },
                },
                required: ["name"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_name" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: corsHeaders });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: corsHeaders });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No name generated" }), { status: 500, headers: corsHeaders });
    }

    const args = JSON.parse(toolCall.function.arguments);
    let name = (args.name || "").trim().replace(/[^\x20-\x7E]/g, "").slice(0, 30);

    if (!name) {
      return new Response(JSON.stringify({ error: "Empty name generated" }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ name }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
