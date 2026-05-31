// deno-lint-ignore-file no-explicit-any
/**
 * rebuild-archetype-stats — One-shot rewrite of every existing common/uncommon
 * equipment row in `items` so old loot matches the new squish-v2 budget and
 * 3-stat distribution (70/20/10 common, 50/30/20 uncommon).
 *
 * Algorithm per row:
 *   1. Read level, rarity, hands, current stats.
 *   2. Infer primary stat = highest existing attribute stat.
 *      For uncommons, infer secondary = second-highest distinct attribute.
 *      If no second exists, parse the item name against HYBRID_ARCHETYPES.
 *   3. Recompute budget + distribute via the new 3-stat helpers.
 *   4. Write back stats + refreshed value.
 *
 * Distribution helpers are duplicated from `seed-archetype-items` per the
 * project's formula-mirroring convention. Keep them in sync.
 *
 * Scope: rarity IN ('common','uncommon') AND item_type = 'equipment'.
 * Uniques, soulforged, consumables, and quest items are untouched.
 *
 * Steward/overlord gated. Idempotent — re-running produces the same output.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Stat = "str" | "dex" | "con" | "int" | "wis" | "cha";
const ATTRS: Stat[] = ["str", "dex", "con", "int", "wis", "cha"];

/* ───────── Formula mirrors (seed-archetype-items canonical) ───────── */

const RARITY_MULT: Record<string, number> = { common: 1.0, uncommon: 1.5 };

function handsMultiplier(rarity: string, hands: number): number {
  if (hands !== 2) return 1.0;
  return rarity === "unique" ? 1.35 : 1.5;
}
function levelTaper(level: number): number {
  if (level <= 30) return 1.0;
  if (level <= 35) return 0.90;
  if (level <= 40) return 0.80;
  return 0.72;
}
function statBudget(level: number, rarity: string, hands = 1): number {
  const m = RARITY_MULT[rarity] || 1;
  const h = handsMultiplier(rarity, hands);
  const t = levelTaper(level);
  const raw = 2 + (level - 1) * 0.24 * m * h;
  const hybridBonus = rarity === "uncommon" && level >= 30 ? 1 : 0;
  return Math.max(2, Math.floor(raw * t) + hybridBonus);
}
function statCap(key: string, level: number): number {
  if (key === "ac" || key === "hp_regen") return 2 + Math.floor(level / 10);
  if (key === "hp") return 6 + Math.floor(level / 5) * 2;
  if (level <= 28) return 4 + Math.floor(level / 4);
  if (level <= 40) return 11 + Math.floor((level - 28) / 6);
  return 13;
}
function suggestGold(level: number, rarity: string): number {
  const m = RARITY_MULT[rarity] || 1;
  return Math.round(level * 2.5 * m * m);
}

function spillover(stats: Record<string, number>, level: number, budget: number, priority: string[]) {
  const STAT_COSTS: Record<string, number> = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, ac: 3, hp: 0.5, hp_regen: 2 };
  const cost = () => Object.entries(stats).reduce((s, [k, v]) => s + v * (STAT_COSTS[k] || 1), 0);
  let safety = 200;
  while (cost() < budget && safety-- > 0) {
    let placed = false;
    for (const k of priority) {
      const cap = statCap(k, level);
      const cur = stats[k] || 0;
      if (cur < cap) {
        stats[k] = cur + 1;
        placed = true;
        if (cost() >= budget) break;
      }
    }
    if (!placed) break;
  }
  return stats;
}

/* ── 3-attribute distributions (squish v3, 2026-05) — mirror of seed-archetype-items ── */

const COMMON_TRIPLE: Record<Stat, [Stat, Stat]> = {
  str: ["con", "dex"],
  dex: ["str", "wis"],
  con: ["str", "wis"],
  int: ["wis", "cha"],
  wis: ["con", "int"],
  cha: ["wis", "dex"],
};

const UNCOMMON_TERTIARY: Array<{ pair: [Stat, Stat]; tertiary: Stat }> = [
  { pair: ["str", "con"], tertiary: "dex" },
  { pair: ["str", "dex"], tertiary: "con" },
  { pair: ["dex", "wis"], tertiary: "con" },
  { pair: ["wis", "con"], tertiary: "int" },
  { pair: ["int", "wis"], tertiary: "cha" },
  { pair: ["cha", "wis"], tertiary: "int" },
  { pair: ["cha", "dex"], tertiary: "wis" },
  { pair: ["cha", "str"], tertiary: "wis" },
];

function pickUncommonTertiary(primary: Stat, secondary: Stat): Stat {
  for (const { pair, tertiary } of UNCOMMON_TERTIARY) {
    if ((pair[0] === primary && pair[1] === secondary) || (pair[0] === secondary && pair[1] === primary)) {
      return tertiary;
    }
  }
  return ATTRS.find((a) => a !== primary && a !== secondary) ?? "wis";
}

function rebalance(parts: number[], budget: number): number[] {
  const out = parts.slice();
  while (out.reduce((a, b) => a + b, 0) > budget) {
    let idx = -1, max = 1;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > max) { max = out[i]; idx = i; }
    }
    if (idx === -1) break;
    out[idx]--;
  }
  return out;
}

function distributeCommon(level: number, primary: Stat, hands: number): Record<string, number> {
  const budget = statBudget(level, "common", hands);
  const [secondary, tertiary] = COMMON_TRIPLE[primary];
  const stats: Record<string, number> = {};
  if (budget < 2) { stats[primary] = 1; return stats; }
  if (budget < 3) {
    stats[primary] = Math.max(1, Math.min(statCap(primary, level), budget - 1));
    stats[secondary] = 1;
    return stats;
  }
  let pPts = Math.max(1, Math.round(budget * 0.7));
  let sPts = Math.max(1, Math.round(budget * 0.2));
  let tPts = Math.max(1, budget - pPts - sPts);
  [pPts, sPts, tPts] = rebalance([pPts, sPts, tPts], budget);
  stats[primary] = Math.min(statCap(primary, level), pPts);
  stats[secondary] = Math.min(statCap(secondary, level), sPts);
  stats[tertiary] = Math.min(statCap(tertiary, level), tPts);
  spillover(stats, level, budget, [primary, secondary, tertiary]);
  for (const k of [secondary, tertiary] as Stat[]) {
    if ((stats[k] ?? 0) < 1) {
      if ((stats[primary] ?? 0) > 1) { stats[primary]--; stats[k] = 1; } else { stats[k] = 1; }
    }
  }
  return stats;
}

function distributeUncommon(level: number, primary: Stat, secondary: Stat, hands: number): Record<string, number> {
  const budget = statBudget(level, "uncommon", hands);
  const tertiary = pickUncommonTertiary(primary, secondary);
  const stats: Record<string, number> = {};
  if (budget < 3) {
    stats[primary] = Math.max(1, Math.min(statCap(primary, level), Math.round(budget * 0.6)));
    stats[secondary] = Math.max(1, Math.min(statCap(secondary, level), Math.round(budget * 0.4)));
    spillover(stats, level, budget, [primary, secondary]);
    if ((stats[secondary] ?? 0) < 1) {
      if ((stats[primary] ?? 0) > 1) { stats[primary]--; stats[secondary] = 1; } else { stats[secondary] = 1; }
    }
    return stats;
  }
  let pPts = Math.max(1, Math.round(budget * 0.5));
  let sPts = Math.max(1, Math.round(budget * 0.3));
  let tPts = Math.max(1, budget - pPts - sPts);
  [pPts, sPts, tPts] = rebalance([pPts, sPts, tPts], budget);
  stats[primary] = Math.min(statCap(primary, level), pPts);
  stats[secondary] = Math.min(statCap(secondary, level), sPts);
  stats[tertiary] = Math.min(statCap(tertiary, level), tPts);
  spillover(stats, level, budget, [primary, secondary, tertiary]);
  for (const k of [secondary, tertiary] as Stat[]) {
    if ((stats[k] ?? 0) < 1) {
      if ((stats[primary] ?? 0) > 1) { stats[primary]--; stats[k] = 1; } else { stats[k] = 1; }
    }
  }
  return stats;
}

/* ───────── Hybrid archetype name → stat pair (uncommon fallback) ───────── */

const HYBRID_BY_NAME: Record<string, { primary: Stat; secondary: Stat }> = {
  Warlord:     { primary: "str", secondary: "con" },
  Fortress:    { primary: "con", secondary: "str" },
  Blademaster: { primary: "str", secondary: "dex" },
  Skirmisher:  { primary: "dex", secondary: "str" },
  Stalker:     { primary: "dex", secondary: "wis" },
  Pathfinder:  { primary: "wis", secondary: "dex" },
  Justicar:    { primary: "wis", secondary: "con" },
  Oathbound:   { primary: "con", secondary: "wis" },
  Mystic:      { primary: "int", secondary: "wis" },
  Oracle:      { primary: "wis", secondary: "int" },
  Prophet:     { primary: "cha", secondary: "wis" },
  Hierophant:  { primary: "wis", secondary: "cha" },
  Troubadour:  { primary: "cha", secondary: "dex" },
  Duelist:     { primary: "dex", secondary: "cha" },
  Sovereign:   { primary: "cha", secondary: "str" },
  Champion:    { primary: "str", secondary: "cha" },
};

const PRIMARY_BY_NAME: Record<string, Stat> = {
  Vanguard: "str", Iron: "str", Brutal: "str", Warborn: "str", Tyrant: "str",
  Shadow: "dex", Swift: "dex", Hunter: "dex", Ashen: "dex", Nightstalker: "dex",
  Stoneguard: "con", Warden: "con", Bulwark: "con", Bastion: "con", Stalwart: "con", Earthshaper: "con", Ironroot: "con",
  Spellwoven: "int", Sage: "int", Arcane: "int", Astral: "int", Runed: "int",
  Sanctified: "wis", Devout: "wis", Templar: "wis", Enlightened: "wis", Dawnbringer: "wis",
  Crowned: "cha", Regal: "cha", Noble: "cha", Bardic: "cha", Silvertongue: "cha", Majestic: "cha", Virtuoso: "cha",
};

function inferFromName(name: string): { primary?: Stat; secondary?: Stat; isHybrid?: boolean } {
  const tokens = name.split(/\s+/);
  for (const tok of tokens) {
    if (tok in HYBRID_BY_NAME) {
      const h = HYBRID_BY_NAME[tok];
      return { primary: h.primary, secondary: h.secondary, isHybrid: true };
    }
    if (tok in PRIMARY_BY_NAME) {
      return { primary: PRIMARY_BY_NAME[tok], isHybrid: false };
    }
  }
  return {};
}

/* ───────── Per-row rewrite ───────── */

function inferPrimarySecondary(item: any): { primary: Stat; secondary?: Stat } | null {
  // Name-only inference. Old logic that fell back to the highest existing stat
  // is intentionally gone — it let pre-squish INT spillover masquerade as the
  // "real" primary on wis archetypes (e.g. Sanctified → INT-dominant rewrites).
  const nameInfo = inferFromName(item.name || "");
  if (item.rarity === "uncommon") {
    if (!nameInfo.primary || !nameInfo.secondary) return null;
    return { primary: nameInfo.primary, secondary: nameInfo.secondary };
  }
  if (!nameInfo.primary) return null;
  return { primary: nameInfo.primary };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
    if (cerr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claims.claims.sub as string;
    const { data: roleData } = await userClient.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden — steward or overlord only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // Page through every common/uncommon equipment row.
    const PAGE = 200;
    let offset = 0;
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    const samples: Array<{ id: string; name: string; before: any; after: any }> = [];
    const unmatched: Array<{ id: string; name: string; level: number; rarity: string }> = [];

    while (true) {
      const { data: rows, error: selErr } = await admin
        .from("items")
        .select("id, name, level, rarity, hands, stats, item_type")
        .eq("item_type", "equipment")
        .in("rarity", ["common", "uncommon"])
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (selErr) throw selErr;
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        processed++;
        const inferred = inferPrimarySecondary(row);
        if (!inferred) {
          unmatched.push({ id: row.id, name: row.name, level: row.level || 1, rarity: row.rarity });
          skipped++;
          continue;
        }
        const hands = row.hands ?? 1;
        let newStats: Record<string, number>;
        try {
          if (row.rarity === "uncommon") {
            if (!inferred.secondary || inferred.secondary === inferred.primary) {
              skipped++;
              continue;
            }
            newStats = distributeUncommon(row.level || 1, inferred.primary, inferred.secondary, hands);
          } else {
            newStats = distributeCommon(row.level || 1, inferred.primary, hands);
          }
        } catch (e) {
          console.error(`rewrite failed for ${row.id} (${row.name}):`, e);
          skipped++;
          continue;
        }

        if (samples.length < 10) {
          samples.push({ id: row.id, name: row.name, before: row.stats, after: newStats });
        }

        if (dryRun) {
          updated++;
          continue;
        }

        const newValue = suggestGold(row.level || 1, row.rarity);
        const { error: updErr } = await admin
          .from("items")
          .update({ stats: newStats, value: newValue })
          .eq("id", row.id);
        if (updErr) {
          console.error(`update failed for ${row.id}:`, updErr);
          skipped++;
          continue;
        }
        updated++;
      }

      if (rows.length < PAGE) break;
      offset += PAGE;
    }

    return new Response(
      JSON.stringify({ ok: true, dry_run: dryRun, processed, updated, skipped, unmatched_count: unmatched.length, unmatched: unmatched.slice(0, 50), samples }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("rebuild-archetype-stats error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
