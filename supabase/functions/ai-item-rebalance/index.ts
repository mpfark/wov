import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Canonical formulas (mirror src/lib/game-data.ts)
const RARITY_MULT: Record<string, number> = { common: 1.0, uncommon: 1.5 };
const STAT_COSTS: Record<string, number> = {
  str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1,
  ac: 3, hp: 0.5, hp_regen: 2,
};
const PRIMARY_STATS = ["str", "dex", "con", "int", "wis", "cha"];

function getBudget(level: number, rarity: string, hands: number | null): number {
  const rMult = RARITY_MULT[rarity] ?? 1.0;
  const hMult = hands === 2 ? 1.5 : 1.0;
  return Math.floor(1 + (level - 1) * 0.3 * rMult * hMult);
}

function getCap(stat: string, level: number): number {
  if (PRIMARY_STATS.includes(stat)) return 4 + Math.floor(level / 4);
  if (stat === "ac") return 2 + Math.floor(level / 10);
  if (stat === "hp") return 6 + Math.floor(level / 5) * 2;
  if (stat === "hp_regen") return 2;
  return 0;
}

function calcCost(stats: Record<string, number>): number {
  let total = 0;
  for (const [k, v] of Object.entries(stats || {})) {
    total += (STAT_COSTS[k] ?? 0) * (Number(v) || 0);
  }
  return total;
}

function dominantStat(stats: Record<string, number>): string | null {
  let best: string | null = null;
  let bestVal = 0;
  for (const k of PRIMARY_STATS) {
    const v = Number(stats?.[k] || 0);
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

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

    // Fetch common/uncommon equipment
    const { data: allItems, error: itemsErr } = await supabase
      .from("items")
      .select("id, name, rarity, level, slot, stats, hands, item_type")
      .in("rarity", ["common", "uncommon"])
      .eq("item_type", "equipment")
      .limit(5000);
    if (itemsErr) throw itemsErr;

    // Find mismatches
    const mismatches = (allItems || []).filter((it: any) => {
      const budget = getBudget(it.level, it.rarity, it.hands);
      const cost = calcCost(it.stats || {});
      return cost !== budget;
    });

    if (mismatches.length === 0) {
      return new Response(JSON.stringify({ total_mismatches: 0, rebalanced: 0, proposed: 0, skipped: [], preview: [], message: "All items within budget." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const preview: { id: string; name: string; old_stats: any; new_stats: any; budget: number }[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];

    const BATCH = 15;
    for (let i = 0; i < mismatches.length; i += BATCH) {
      const batch = mismatches.slice(i, i + BATCH);

      const itemList = batch.map((it: any, idx: number) => {
        const budget = getBudget(it.level, it.rarity, it.hands);
        const cost = calcCost(it.stats || {});
        const dom = dominantStat(it.stats || {}) || "none";
        const caps = PRIMARY_STATS.concat(["ac", "hp", "hp_regen"])
          .map(s => `${s}_max=${getCap(s, it.level)}`).join(" ");
        return `${idx + 1}. id="${it.id}" name="${it.name}" rarity=${it.rarity} level=${it.level} hands=${it.hands || 1} slot=${it.slot} budget=${budget} current_cost=${cost} dominant=${dom} current_stats=${JSON.stringify(it.stats)} caps: ${caps}`;
      }).join("\n");

      const systemPrompt = `You are rebalancing equipment stats in "Wayfarers of Varneth" so each item spends EXACTLY its stat budget.

STAT COSTS (points): str/dex/con/int/wis/cha=1, ac=3, hp=0.5, hp_regen=2
PER-STAT CAPS (per item): primary stats (str/dex/con/int/wis/cha)=4+floor(level/4), ac=2+floor(level/10), hp=6+floor(level/5)*2, hp_regen=2
RULES:
- New stats MUST sum to EXACTLY the budget (in cost points). Not less, not more.
- Preserve the dominant stat focus. If dominant is "dex", the new stats must still have dex as the primary (highest non-utility) stat.
- Equipment must have at least 2 different stats.
- No stat may exceed its cap.
- hp must be an even number (since it costs 0.5 per point, use only even hp values to avoid fractional spend).
- Do not introduce stats unrelated to the item's role (e.g., don't put cha on a warrior weapon).
- Return integer values only.

You will receive equipment items. For each, return the new stats object via the rebalance_items tool.`;

      const userMsg = `Rebalance these ${batch.length} items so each spends EXACTLY budget points:\n\n${itemList}`;

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
              name: "rebalance_items",
              description: "Provide rebalanced stat objects for items",
              parameters: {
                type: "object",
                properties: {
                  rebalances: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        stats: {
                          type: "object",
                          properties: {
                            str: { type: "integer" },
                            dex: { type: "integer" },
                            con: { type: "integer" },
                            int: { type: "integer" },
                            wis: { type: "integer" },
                            cha: { type: "integer" },
                            ac: { type: "integer" },
                            hp: { type: "integer" },
                            hp_regen: { type: "integer" },
                          },
                          additionalProperties: false,
                        },
                      },
                      required: ["id", "stats"],
                    },
                  },
                },
                required: ["rebalances"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "rebalance_items" } },
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
        for (const it of batch) skipped.push({ id: it.id, name: it.name, reason: "AI returned no tool call" });
        continue;
      }

      const parsed = JSON.parse(toolCall.function.arguments);
      const rebalances = parsed.rebalances || [];
      const map = new Map(rebalances.map((r: any) => [r.id, r.stats]));

      for (const it of batch) {
        const newStatsRaw = map.get(it.id) as Record<string, number> | undefined;
        if (!newStatsRaw) {
          skipped.push({ id: it.id, name: it.name, reason: "AI did not return stats" });
          continue;
        }

        // Strip zero/empty values
        const newStats: Record<string, number> = {};
        for (const [k, v] of Object.entries(newStatsRaw)) {
          const n = Math.floor(Number(v) || 0);
          if (n > 0) newStats[k] = n;
        }

        const budget = getBudget(it.level, it.rarity, it.hands);
        const newCost = calcCost(newStats);

        // Validate
        if (newCost !== budget) {
          skipped.push({ id: it.id, name: it.name, reason: `Cost ${newCost} != budget ${budget}` });
          continue;
        }
        if (Object.keys(newStats).length < 2) {
          skipped.push({ id: it.id, name: it.name, reason: "Fewer than 2 stats" });
          continue;
        }
        let capViolation = false;
        for (const [k, v] of Object.entries(newStats)) {
          if (v > getCap(k, it.level)) {
            skipped.push({ id: it.id, name: it.name, reason: `${k}=${v} exceeds cap ${getCap(k, it.level)}` });
            capViolation = true;
            break;
          }
        }
        if (capViolation) continue;

        // Dominant stat check
        const oldDom = dominantStat(it.stats || {});
        const newDom = dominantStat(newStats);
        if (oldDom && newDom && oldDom !== newDom) {
          skipped.push({ id: it.id, name: it.name, reason: `Dominant changed: ${oldDom}→${newDom}` });
          continue;
        }

        preview.push({ id: it.id, name: it.name, old_stats: it.stats, new_stats: newStats, budget });
      }
    }

    let rebalanced = 0;
    if (!dryRun) {
      for (const p of preview) {
        const { error } = await supabase.from("items").update({ stats: p.new_stats }).eq("id", p.id);
        if (error) {
          skipped.push({ id: p.id, name: p.name, reason: `DB update failed: ${error.message}` });
        } else {
          rebalanced++;
        }
      }
    }

    return new Response(JSON.stringify({
      dry_run: dryRun,
      total_mismatches: mismatches.length,
      rebalanced: dryRun ? 0 : rebalanced,
      proposed: preview.length,
      skipped,
      preview,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-item-rebalance error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
