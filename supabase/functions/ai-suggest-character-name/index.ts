import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// 10 requests / 60s per user
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
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

const RACE_LABELS: Record<string, string> = {
  human: "Human", elf: "Elf", dwarf: "Dwarf", halfling: "Halfling",
  edain: "Edain", half_elf: "Half-Elf",
};

function sanitizeName(raw: string): string {
  // Letters only, single word, 2–12 chars, capitalized.
  const stripped = (raw || "").replace(/[^A-Za-z]/g, "").slice(0, 12);
  if (stripped.length < 2) return "";
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    if (!checkRateLimit(userId)) {
      return new Response(JSON.stringify({ error: "Too many name requests. Wait a moment and try again." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const race = typeof body.race === "string" ? body.race : "";
    const gender = body.gender === "male" || body.gender === "female" ? body.gender : "";
    const raceLabel = RACE_LABELS[race] || "adventurer";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt =
      "You generate single-word fantasy first names for characters in a high-fantasy MUD. " +
      "Output ONLY a JSON tool call. ASCII letters only, no spaces, no punctuation, 2–12 letters, evocative and lore-appropriate.";
    const userPrompt =
      `Suggest one fantasy first name for a ${gender || ""} ${raceLabel}.`.trim() +
      " Avoid common modern names. Vary your choices each call.";

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
              name: "suggest_character_name",
              description: "Return a single-word fantasy first name.",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "A single-word fantasy first name, ASCII letters only, 2-12 characters." },
                },
                required: ["name"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_character_name" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI did not return a name" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: { name?: string } = {};
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return new Response(JSON.stringify({ error: "AI returned malformed payload" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = sanitizeName(parsed.name || "");
    if (!name) {
      return new Response(JSON.stringify({ error: "AI returned an unusable name. Try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-suggest-character-name error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
