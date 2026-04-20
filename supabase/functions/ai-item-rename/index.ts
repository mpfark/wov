import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Lyrical name detector — matches "X of Y", "the X", or compound coined words like "Dawnbreaker"
const LYRICAL_SUFFIXES = /(strike|fang|breaker|reaver|tip|forged|scale|bound|song|bane|edge|fall|piercer|render|cleaver|splitter|seeker|warden|guard|crusher|biter|slayer|caller|whisper|shroud|veil|kiss|claw|tooth|maw|heart|soul|spirit|ward)$/i;
const PROPER_NOUN_PATTERN = /\b(of|the)\b/i;

function isViolator(name: string): boolean {
  if (PROPER_NOUN_PATTERN.test(name)) return true;
  // Check each word for lyrical suffix on a coined compound (must be at least 6 chars, not a known plain noun)
  const PLAIN_NOUNS = new Set(['sword', 'blade', 'shield', 'staff', 'bow', 'axe', 'mace', 'dagger', 'helm', 'amulet', 'pendant', 'belt', 'boots', 'gloves', 'pauldrons', 'cuirass', 'gauntlets', 'greaves', 'ring', 'trinket', 'hammer', 'flail', 'maul', 'wand', 'circlet', 'buckler', 'hatchet', 'cleaver']);
  for (const word of name.split(/\s+/)) {
    const lw = word.toLowerCase();
    if (PLAIN_NOUNS.has(lw)) continue;
    if (lw.length >= 7 && LYRICAL_SUFFIXES.test(lw)) return true;
  }
  return false;
}

const NAMING_POLICY = `NAMING POLICY BY RARITY (CRITICAL — FOLLOW EXACTLY):

COMMON items — boring, generic, material-based. Format: [Tier Adjective] [Material] [Slot Noun]
- Tier adjectives by level band:
  - L1-9: omit, or use "Crude", "Worn", "Rough", "Simple"
  - L10-19: "Sturdy", "Hardened", "Reinforced"
  - L20-29: "Heavy", "Tempered", "Banded"
  - L30-42: "Masterwork", "Riveted", "Honed"
- Materials by level: Cloth → Leather → Studded Leather → Iron → Steel → Banded Steel → Reinforced Steel
- Slot nouns: Helm, Pauldrons, Cuirass, Gauntlets, Belt, Greaves, Boots, Ring, Amulet, Pendant, Trinket, Sword, Axe, Dagger, Mace, Bow, Staff, Shield
- GOOD: "Sturdy Iron Helm", "Masterwork Steel Pauldrons", "Iron Dagger", "Worn Leather Boots"
- BAD: "Helm of the Cairn Warden", "Pendant of the Astral Journey", "Whispering Skull Fragment"
- NO proper nouns. NO place names. NO factions. NO "of the X" titles. NO coined compounds (Dawnbreaker, Viperfang, Windreaver).

UNCOMMON items — slightly evocative but still generic archetypes. Format: [Quality Adjective] [Material/Style] [Slot Noun]
- Allowed quality words ONLY: Fine, Engraved, Etched, Reinforced, Plated, Banded, Polished, Runed, Gilded, Enchanted, Greater
- GOOD: "Gilded Circlet", "Runed Kite Shield", "Engraved Greatsword", "Plated Pauldrons", "Fine Longbow"
- BAD: "Aegis of Dawn", "Dawnbreaker", "Stormsplitter", "Phantom Edge", "Mantle of the Obsidian Watch"
- NO proper nouns. NO place names. NO factions. NO "of the X" titles. NO coined compounds.

NAME-STAT ALIGNMENT:
- STR-focused: Heavy, Iron, Banded, Reinforced
- DEX-focused: Light, Polished, Fine, Etched
- CON-focused: Hardened, Sturdy, Tempered, Plated
- INT-focused: Runed, Engraved, Etched
- WIS-focused: Engraved, Runed
- CHA-focused: Gilded, Polished, Fine

Slot noun must match the item's slot.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.claims.sub as string;

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run === true;

    // 1. Fetch all items, filter to common/uncommon violators
    const { data: allItems, error: itemsErr } = await supabase
      .from("items")
      .select("id, name, rarity, level, slot, stats")
      .in("rarity", ["common", "uncommon"])
      .limit(5000);

    if (itemsErr) throw itemsErr;

    const violators = (allItems || []).filter((i: any) => isViolator(i.name));
    const existingNames = new Set((allItems || []).map((i: any) => i.name.toLowerCase()));

    if (violators.length === 0) {
      return new Response(JSON.stringify({ renamed: 0, skipped: [], preview: [], message: "No violators found." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const preview: { id: string; old: string; new: string }[] = [];
    const skipped: { id: string; old: string; reason: string }[] = [];

    // 2. Process in batches of 20
    const BATCH = 20;
    for (let i = 0; i < violators.length; i += BATCH) {
      const batch = violators.slice(i, i + BATCH);

      const itemList = batch.map((it: any, idx: number) =>
        `${idx + 1}. id="${it.id}" rarity=${it.rarity} level=${it.level} slot=${it.slot || "none"} stats=${JSON.stringify(it.stats)} OLD_NAME="${it.name}"`
      ).join("\n");

      const systemPrompt = `You are renaming legacy items in "Wayfarers of Varneth" to comply with a strict naming policy. The current names violate the policy and must be replaced with boring, generic, compliant names.

${NAMING_POLICY}

You will receive a list of items. For each, return ONLY a new compliant name. Keep it ASCII-only (A-Z, a-z, spaces, hyphens, apostrophes). Do NOT keep any part of the old name. Do NOT use proper nouns. Do NOT use "of" or "the". Do NOT use coined compounds.

Return via the rename_items tool.`;

      const userMsg = `Rename these ${batch.length} items. Match each by id:\n\n${itemList}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          tools: [{
            type: "function",
            function: {
              name: "rename_items",
              description: "Provide new compliant names for legacy items",
              parameters: {
                type: "object",
                properties: {
                  renames: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        new_name: { type: "string" },
                      },
                      required: ["id", "new_name"],
                    },
                  },
                },
                required: ["renames"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "rename_items" } },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait and try again." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        throw new Error("AI gateway error");
      }

      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        for (const it of batch) skipped.push({ id: it.id, old: it.name, reason: "AI returned no tool call" });
        continue;
      }

      const parsed = JSON.parse(toolCall.function.arguments);
      const renames = parsed.renames || [];
      const renameMap = new Map(renames.map((r: any) => [r.id, r.new_name]));

      for (const it of batch) {
        const raw = renameMap.get(it.id);
        if (!raw) {
          skipped.push({ id: it.id, old: it.name, reason: "AI did not return rename" });
          continue;
        }
        const newName = String(raw).replace(/[^\x20-\x7E]/g, '').trim();

        if (!newName) { skipped.push({ id: it.id, old: it.name, reason: "Empty name" }); continue; }
        if (isViolator(newName)) { skipped.push({ id: it.id, old: it.name, reason: `Still violates policy: "${newName}"` }); continue; }
        if (existingNames.has(newName.toLowerCase()) && newName.toLowerCase() !== it.name.toLowerCase()) {
          skipped.push({ id: it.id, old: it.name, reason: `Duplicate name: "${newName}"` });
          continue;
        }

        preview.push({ id: it.id, old: it.name, new: newName });
        existingNames.delete(it.name.toLowerCase());
        existingNames.add(newName.toLowerCase());
      }
    }

    // 3. Apply if not dry run
    let renamed = 0;
    if (!dryRun) {
      for (const p of preview) {
        const { error } = await supabase.from("items").update({ name: p.new }).eq("id", p.id);
        if (error) {
          skipped.push({ id: p.id, old: p.old, reason: `DB update failed: ${error.message}` });
        } else {
          renamed++;
        }
      }
    }

    return new Response(JSON.stringify({
      dry_run: dryRun,
      total_violators: violators.length,
      renamed: dryRun ? 0 : renamed,
      proposed: preview.length,
      skipped,
      preview,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-item-rename error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
