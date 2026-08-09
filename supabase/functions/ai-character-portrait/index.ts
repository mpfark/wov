import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const RACE_LABELS: Record<string, string> = {
  human: "Human", elf: "Elf", dwarf: "Dwarf", halfling: "Halfling",
  edain: "Edain", half_elf: "Half-Elf",
};
const CLASS_LABELS: Record<string, string> = {
  warrior: "Warrior", wizard: "Wizard", ranger: "Ranger", assassin: "Assassin",
  healer: "Healer", bard: "Bard", templar: "Templar",
};

const HEIGHT_LABEL: Record<string, string> = {
  short: "short", average: "average height", tall: "tall",
};
const BODY_LABEL: Record<string, string> = {
  lean: "lean build", average: "average build",
  muscular: "muscular build", heavyset: "heavyset build",
};

const STYLE =
  "masterwork craftsmanship, fine materials and restrained ornamentation, faint magical character — no glowing runes, no gemstone encrustation, no radiant aura";
const SUFFIX =
  "Dark fantasy painterly art, dramatic chiaroscuro lighting against a deep neutral background, centered framing, no text, no watermark, no border, square 1:1 composition, character only — no extra figures, no background scenery.";

const BodySchema = z.object({
  character_id: z.string().uuid(),
  description: z.string().trim().max(500).optional().default(""),
  height: z.enum(["short", "average", "tall"]),
  body_type: z.enum(["lean", "average", "muscular", "heavyset"]),
});

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL from AI gateway");
  const contentType = m[1] || "image/png";
  const bin = atob(m[2]);
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { character_id, description, height, body_type } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: character, error: charErr } = await admin
      .from("characters")
      .select("id, user_id, name, race, class, gender, portrait_generated_at")
      .eq("id", character_id)
      .maybeSingle();
    if (charErr || !character) {
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (character.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cooldown check
    if (character.portrait_generated_at) {
      const last = new Date(character.portrait_generated_at).getTime();
      const nextAt = last + COOLDOWN_MS;
      if (Date.now() < nextAt) {
        return new Response(
          JSON.stringify({ error: "Portrait is on cooldown.", next_available_at: new Date(nextAt).toISOString() }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Equipped gear
    const { data: equipRows } = await admin
      .from("character_inventory")
      .select("equipped_slot, items:item_id ( name )")
      .eq("character_id", character_id)
      .not("equipped_slot", "is", null);

    const equipped: { slot: string; name: string }[] = (equipRows ?? [])
      .map((r: any) => ({ slot: r.equipped_slot as string, name: r.items?.name as string }))
      .filter((r) => r.slot && r.name);

    const gearLine = equipped.length
      ? equipped.map((g) => `${g.name} (${g.slot.replace("_", " ")})`).join(", ")
      : "simple traveler's clothing";

    // Races are admin-configurable, so the label and any art-direction notes
    // come from the `races` table; the map above is a fallback only.
    const { data: raceRow } = await supabase
      .from("races")
      .select("label, portrait_notes")
      .eq("race_key", character.race)
      .maybeSingle();
    const race = raceRow?.label ?? RACE_LABELS[character.race] ?? character.race;
    const raceNotes = (raceRow?.portrait_notes ?? "").trim();
    const klass = CLASS_LABELS[character.class] ?? character.class;
    const gender = (character as any).gender ?? "male";
    const desc = description.trim() || "no specific notes";

    const prompt = [
      `A single hero-shot full-body portrait of a ${gender} ${race} ${klass} named "${character.name}".`,
      `Appearance: ${desc}.`,
      ...(raceNotes ? [`Race traits: ${raceNotes}.`] : []),
      `Build: ${HEIGHT_LABEL[height]}, ${BODY_LABEL[body_type]}.`,
      `Equipped gear: ${gearLine}.`,
      `Style: ${STYLE}.`,
      SUFFIX,
    ].join(" ");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited by AI gateway. Please retry shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const dataUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl) throw new Error("AI did not return an image");
    const { bytes, contentType } = dataUrlToBytes(dataUrl);

    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const path = `${character_id}-${Date.now()}.${ext}`;
    const { error: uploadErr } = await admin.storage
      .from("character-portraits")
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: pub } = admin.storage.from("character-portraits").getPublicUrl(path);
    const publicUrl = pub.publicUrl;
    const generatedAt = new Date().toISOString();

    const { error: updErr } = await admin
      .from("characters")
      .update({
        portrait_url: publicUrl,
        portrait_metadata: { description, height, body_type, generated_at: generatedAt, equipped_snapshot: equipped },
        portrait_generated_at: generatedAt,
      })
      .eq("id", character_id);
    if (updErr) throw new Error(`Character update failed: ${updErr.message}`);

    return new Response(
      JSON.stringify({ portrait_url: publicUrl, generated_at: generatedAt, next_available_at: new Date(Date.now() + COOLDOWN_MS).toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ai-character-portrait error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
