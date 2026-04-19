import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Per-user rate limit: 20 illustrations / minute
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitMap = new Map<string, number[]>();
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const ts = (rateLimitMap.get(userId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (ts.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, ts);
    return false;
  }
  ts.push(now);
  rateLimitMap.set(userId, ts);
  return true;
}

const RARITY_STYLE: Record<string, string> = {
  common: "weathered, simple craftsmanship, plain materials",
  uncommon: "well-crafted, refined details, subtle ornamentation, hints of magical sheen",
  unique: "ornate, jeweled, glowing arcane runes, masterwork, legendary aura",
};

function buildPrompt(name: string, description: string, rarity: string, slot: string | null, itemType: string): string {
  const style = RARITY_STYLE[rarity] || RARITY_STYLE.common;
  const subject =
    itemType === "consumable"
      ? `a fantasy potion or consumable called "${name}"`
      : slot
        ? `a fantasy ${slot.replace("_", " ")} item called "${name}"`
        : `a fantasy item called "${name}"`;
  return [
    `A single hero-shot illustration of ${subject}.`,
    description ? `Lore: ${description}` : "",
    `Style: ${style}.`,
    "Dark fantasy painterly art, dramatic chiaroscuro lighting against a deep neutral background, centered framing, no text, no watermark, no border, square 1:1 composition, item only — no character, no hands.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Decode a base64 data URL like "data:image/png;base64,...." into raw bytes
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL from AI gateway");
  const contentType = m[1] || "image/png";
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
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

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    if (!checkRateLimit(userId)) {
      return new Response(
        JSON.stringify({ error: "Rate limited. Please wait before generating more illustrations." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: roleData } = await userClient.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: { role: string }) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const itemId: string | undefined = body?.item_id;
    if (!itemId || typeof itemId !== "string") {
      return new Response(JSON.stringify({ error: "item_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for storage write + items update
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: item, error: itemErr } = await admin
      .from("items")
      .select("id, name, description, rarity, slot, item_type")
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr || !item) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = buildPrompt(item.name, item.description ?? "", item.rarity, item.slot, item.item_type);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited by AI gateway. Please retry shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const dataUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl) {
      console.error("AI response missing image", JSON.stringify(aiJson).slice(0, 500));
      throw new Error("AI did not return an image");
    }
    const { bytes, contentType } = dataUrlToBytes(dataUrl);

    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const path = `${item.id}-${Date.now()}.${ext}`;
    const { error: uploadErr } = await admin.storage
      .from("item-illustrations")
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadErr) {
      console.error("Upload error", uploadErr);
      throw new Error(`Upload failed: ${uploadErr.message}`);
    }

    const { data: pub } = admin.storage.from("item-illustrations").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { error: updErr } = await admin
      .from("items")
      .update({ illustration_url: publicUrl })
      .eq("id", item.id);
    if (updErr) {
      console.error("Items update failed", updErr);
      throw new Error(`Items update failed: ${updErr.message}`);
    }

    return new Response(JSON.stringify({ illustration_url: publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ai-item-illustration error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
