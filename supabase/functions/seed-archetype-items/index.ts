// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ───────── Archetype tables ───────── */

const TIER_PREFIXES: Array<{ min: number; max: number; prefix: string }> = [
  { min: 1, max: 5, prefix: "Worn" },
  { min: 6, max: 10, prefix: "Sturdy" },
  { min: 11, max: 15, prefix: "Fine" },
  { min: 16, max: 20, prefix: "Engraved" },
  { min: 21, max: 25, prefix: "Runed" },
  { min: 26, max: 30, prefix: "High" },
  { min: 31, max: 35, prefix: "Mythic" },
  { min: 36, max: 40, prefix: "Ancient" },
  { min: 41, max: 42, prefix: "Astral" },
];

type Stat = "str" | "dex" | "con" | "int" | "wis" | "cha";

const PRIMARY_ARCHETYPES: Record<Stat, string[]> = {
  str: ["Vanguard", "Iron", "Brutal", "Warborn", "Tyrant"],
  dex: ["Shadow", "Swift", "Hunter", "Ashen", "Nightstalker"],
  con: ["Warden", "Stoneguard", "Bulwark", "Bastion", "Stalwart", "Earthshaper", "Ironroot"],
  int: ["Sage", "Arcane", "Spellwoven", "Astral", "Runed"],
  wis: ["Devout", "Sanctified", "Templar", "Enlightened", "Dawnbringer"],
  cha: ["Regal", "Noble", "Bardic", "Silvertongue", "Crowned", "Majestic", "Virtuoso"],
};

const HYBRID_ARCHETYPES: Array<{ a: Stat; b: Stat; names: string[] }> = [
  { a: "str", b: "con", names: ["Warlord", "Juggernaut", "Fortress"] },
  { a: "str", b: "dex", names: ["Raider", "Blademaster", "Skirmisher"] },
  { a: "dex", b: "int", names: ["Spellblade", "Hexrunner", "Arcstrider"] },
  { a: "wis", b: "con", names: ["Guardian", "Justicar", "Oathbound"] },
  { a: "int", b: "wis", names: ["Mystic", "Oracle", "Seer"] },
  { a: "cha", b: "wis", names: ["Prophet", "Hierophant", "Luminary"] },
  { a: "cha", b: "dex", names: ["Troubadour", "Duelist", "Shadowcourt"] },
  { a: "cha", b: "str", names: ["Champion", "Sovereign", "Lionguard"] },
];

// Slot noun pools, biased per primary stat
const SLOT_NOUNS: Record<string, Partial<Record<Stat, string[]>> & { default: string[] }> = {
  head:    { str: ["Helm"], con: ["Helm"], dex: ["Hood"], int: ["Hood"], wis: ["Circlet"], cha: ["Circlet"], default: ["Helm"] },
  chest:   { str: ["Plate"], con: ["Armor", "Plate"], dex: ["Vest"], int: ["Robe"], wis: ["Robe"], cha: ["Vest"], default: ["Armor"] },
  pants:   { str: ["Greaves"], con: ["Greaves"], dex: ["Leggings"], int: ["Leggings"], wis: ["Leggings"], cha: ["Leggings"], default: ["Leggings"] },
  gloves:  { str: ["Gauntlets"], con: ["Gauntlets"], dex: ["Gloves"], int: ["Gloves"], wis: ["Gloves"], cha: ["Gloves"], default: ["Gloves"] },
  boots:   { str: ["Sabatons"], con: ["Sabatons"], dex: ["Boots"], int: ["Boots"], wis: ["Boots"], cha: ["Boots"], default: ["Boots"] },
  shoulders:{ str: ["Pauldrons"], con: ["Pauldrons"], dex: ["Spaulders"], int: ["Mantle"], wis: ["Mantle"], cha: ["Mantle"], default: ["Pauldrons"] },
  belt:    { str: ["Girdle"], con: ["Girdle"], dex: ["Belt"], int: ["Sash"], wis: ["Sash"], cha: ["Sash"], default: ["Belt"] },
  off_hand:{ con: ["Shield"], str: ["Shield"], wis: ["Idol"], int: ["Tome"], cha: ["Idol"], dex: ["Shield"], default: ["Shield"] },
};

// Weapon tag preference per primary stat
const WEAPON_BY_STAT: Record<Stat, Array<{ tag: string; noun: string; hands: 1 | 2 }>> = {
  str: [{ tag: "sword", noun: "Sword", hands: 1 }, { tag: "axe", noun: "Axe", hands: 1 }, { tag: "mace", noun: "Mace", hands: 1 }],
  dex: [{ tag: "dagger", noun: "Dagger", hands: 1 }, { tag: "bow", noun: "Bow", hands: 2 }, { tag: "sword", noun: "Sword", hands: 1 }],
  con: [{ tag: "mace", noun: "Mace", hands: 1 }, { tag: "axe", noun: "Axe", hands: 1 }],
  int: [{ tag: "staff", noun: "Staff", hands: 2 }, { tag: "wand", noun: "Wand", hands: 1 }],
  wis: [{ tag: "mace", noun: "Mace", hands: 1 }, { tag: "staff", noun: "Staff", hands: 2 }],
  cha: [{ tag: "wand", noun: "Wand", hands: 1 }, { tag: "sword", noun: "Sword", hands: 1 }],
};

/* ───────── Stat budget (mirrors src/shared/formulas/items.ts) ───────── */

const RARITY_MULT: Record<string, number> = { common: 1.0, uncommon: 1.5 };

function statBudget(level: number, rarity: string, hands = 1): number {
  const m = RARITY_MULT[rarity] || 1;
  const h = hands === 2 ? 1.5 : 1;
  return Math.max(2, Math.floor(2 + (level - 1) * 0.3 * m * h));
}

/** Drip leftover budget into stat slots in priority order until budget is fully spent or all caps hit. */
function spillover(stats: Record<string, number>, level: number, budget: number, priority: string[]) {
  let used = Object.values(stats).reduce((a, b) => a + b, 0);
  let remaining = budget - used;
  if (remaining <= 0) return stats;
  let safety = 100;
  while (remaining > 0 && safety-- > 0) {
    let placed = false;
    for (const k of priority) {
      const cap = statCap(k, level);
      const cur = stats[k] || 0;
      if (cur < cap) {
        stats[k] = cur + 1;
        remaining--;
        placed = true;
        if (remaining <= 0) break;
      }
    }
    if (!placed) break; // all caps hit
  }
  return stats;
}
function statCap(key: string, level: number): number {
  if (key === "ac" || key === "hp_regen") return 2 + Math.floor(level / 10);
  if (key === "hp") return 6 + Math.floor(level / 5) * 2;
  return 4 + Math.floor(level / 4);
}
function suggestGold(level: number, rarity: string): number {
  const m = RARITY_MULT[rarity] || 1;
  return Math.round(level * 2.5 * m * m);
}

/* ───────── Helpers ───────── */

function bandPrefix(level: number): string {
  return TIER_PREFIXES.find(b => level >= b.min && level <= b.max)?.prefix ?? "Worn";
}
function pickSlotNoun(slot: string, primary: Stat): string {
  const pool = SLOT_NOUNS[slot];
  if (!pool) return "Item";
  return (pool[primary] ?? pool.default)[0];
}
function pickPrimaryArchetype(primary: Stat, idx: number): string {
  const list = PRIMARY_ARCHETYPES[primary];
  return list[idx % list.length];
}
function pickHybridArchetype(a: Stat, b: Stat, idx: number): string | null {
  const found = HYBRID_ARCHETYPES.find(h => (h.a === a && h.b === b) || (h.a === b && h.b === a));
  if (!found) return null;
  return found.names[idx % found.names.length];
}

function distributeCommon(level: number, primary: Stat, hands: number): Record<string, number> {
  const budget = statBudget(level, "common", hands);
  const stats: Record<string, number> = {};
  // 70% to primary
  const primaryAmt = Math.max(1, Math.min(statCap(primary, level), Math.round(budget * 0.7)));
  stats[primary] = primaryAmt;
  // minor stat: prefer con for melee, dex for caster
  const minor: Stat = primary === "str" || primary === "con" ? "con" : primary === "dex" ? "str" : primary === "int" || primary === "wis" ? "wis" : "dex";
  const m = minor === primary ? "con" : minor;
  // Spillover: primary, then minor
  spillover(stats, level, budget, [primary, m]);
  return stats;
}
function distributeUncommon(level: number, primary: Stat, secondary: Stat | null, hands: number): Record<string, number> {
  const budget = statBudget(level, "uncommon", hands);
  const stats: Record<string, number> = {};
  if (secondary && secondary !== primary) {
    const primaryAmt = Math.max(1, Math.min(statCap(primary, level), Math.round(budget * 0.55)));
    const secondaryAmt = Math.max(1, Math.min(statCap(secondary, level), Math.round(budget * 0.35)));
    stats[primary] = primaryAmt;
    stats[secondary] = secondaryAmt;
    const tertiary: string = (primary === "con" || secondary === "con" || primary === "str") ? "hp" : "wis";
    // Spillover order: primary, secondary, tertiary
    spillover(stats, level, budget, [primary, secondary, tertiary]);
  } else {
    return distributeCommon(level, primary, hands);
  }
  return stats;
}

/* ───────── Catalog spec ───────── */

const ARMOR_SLOTS = ["head", "chest", "pants", "gloves", "boots", "off_hand"] as const;
const PRIMARIES: Stat[] = ["str", "dex", "con", "int", "wis", "cha"];

interface SeedItem {
  name: string;
  description: string;
  item_type: "equipment";
  rarity: "common" | "uncommon";
  slot: string;
  level: number;
  hands: number | null;
  weapon_tag: string | null;
  stats: Record<string, number>;
  value: number;
  max_durability: number;
  world_drop: boolean;
  origin_type: string;
}

function buildCatalog(): SeedItem[] {
  const out: SeedItem[] = [];
  for (const band of TIER_PREFIXES) {
    const level = band.min;
    const prefix = band.prefix;

    // PRIMARY archetypes — common only (uncommon tier reserved for hybrids)
    PRIMARIES.forEach((primary, pi) => {
      // Armor slots
      ARMOR_SLOTS.forEach((slot, si) => {
        const archetype = pickPrimaryArchetype(primary, pi + si);
        const noun = pickSlotNoun(slot, primary);
        const name = `${prefix} ${archetype} ${noun}`;
        const stats = distributeCommon(level, primary, 1);
        out.push({
          name,
          description: `A ${prefix.toLowerCase()} ${archetype.toLowerCase()} ${noun.toLowerCase()} suited for the ${primary.toUpperCase()} path.`,
          item_type: "equipment",
          rarity: "common",
          slot,
          level,
          hands: null,
          weapon_tag: slot === "off_hand" && noun === "Shield" ? "shield" : null,
          stats,
          value: suggestGold(level, "common"),
          max_durability: 100,
          world_drop: true,
          origin_type: "archetype_seed",
        });
      });

      // Weapons (one per archetype's preferred weapon list)
      WEAPON_BY_STAT[primary].forEach((w, wi) => {
        const archetype = pickPrimaryArchetype(primary, pi + wi);
        const name = `${prefix} ${archetype} ${w.noun}`;
        const stats = distributeCommon(level, primary, w.hands);
        out.push({
          name,
          description: `A ${prefix.toLowerCase()} ${archetype.toLowerCase()} ${w.noun.toLowerCase()} favored on the ${primary.toUpperCase()} path.`,
          item_type: "equipment",
          rarity: "common",
          slot: "main_hand",
          level,
          hands: w.hands,
          weapon_tag: w.tag,
          stats,
          value: suggestGold(level, "common"),
          max_durability: 100,
          world_drop: true,
          origin_type: "archetype_seed",
        });
      });
    });

    // HYBRID archetypes — uncommon only, key slots
    HYBRID_ARCHETYPES.forEach((h, hi) => {
      const archetype = h.names[hi % h.names.length];
      // chest
      {
        const noun = pickSlotNoun("chest", h.a);
        out.push({
          name: `${prefix} ${archetype} ${noun}`,
          description: `A ${prefix.toLowerCase()} ${archetype.toLowerCase()} ${noun.toLowerCase()} blending ${h.a.toUpperCase()} and ${h.b.toUpperCase()}.`,
          item_type: "equipment",
          rarity: "uncommon",
          slot: "chest",
          level,
          hands: null,
          weapon_tag: null,
          stats: distributeUncommon(level, h.a, h.b, 1),
          value: suggestGold(level, "uncommon"),
          max_durability: 100,
          world_drop: true,
          origin_type: "archetype_seed",
        });
      }
      // head
      {
        const noun = pickSlotNoun("head", h.a);
        out.push({
          name: `${prefix} ${archetype} ${noun}`,
          description: `A ${prefix.toLowerCase()} ${archetype.toLowerCase()} ${noun.toLowerCase()} blending ${h.a.toUpperCase()} and ${h.b.toUpperCase()}.`,
          item_type: "equipment",
          rarity: "uncommon",
          slot: "head",
          level,
          hands: null,
          weapon_tag: null,
          stats: distributeUncommon(level, h.a, h.b, 1),
          value: suggestGold(level, "uncommon"),
          max_durability: 100,
          world_drop: true,
          origin_type: "archetype_seed",
        });
      }
      // weapon (use primary's first weapon)
      {
        const w = WEAPON_BY_STAT[h.a][0];
        out.push({
          name: `${prefix} ${archetype} ${w.noun}`,
          description: `A ${prefix.toLowerCase()} ${archetype.toLowerCase()} ${w.noun.toLowerCase()} blending ${h.a.toUpperCase()} and ${h.b.toUpperCase()}.`,
          item_type: "equipment",
          rarity: "uncommon",
          slot: "main_hand",
          level,
          hands: w.hands,
          weapon_tag: w.tag,
          stats: distributeUncommon(level, h.a, h.b, w.hands),
          value: suggestGold(level, "uncommon"),
          max_durability: 100,
          world_drop: true,
          origin_type: "archetype_seed",
        });
      }
    });
  }
  return out;
}

/* ───────── Starting gear ───────── */

const CLASS_STARTERS: Record<string, { archetype: string; noun: string; tag: string; hands: 1 | 2; primary: Stat }> = {
  warrior: { archetype: "Vanguard", noun: "Sword", tag: "sword", hands: 1, primary: "str" },
  rogue:   { archetype: "Shadow",   noun: "Dagger", tag: "dagger", hands: 1, primary: "dex" },
  ranger:  { archetype: "Hunter",   noun: "Bow", tag: "bow", hands: 2, primary: "dex" },
  wizard:  { archetype: "Sage",     noun: "Staff", tag: "staff", hands: 2, primary: "int" },
  healer:  { archetype: "Devout",   noun: "Mace", tag: "mace", hands: 1, primary: "wis" },
  bard:    { archetype: "Bardic",   noun: "Wand", tag: "wand", hands: 1, primary: "cha" },
  templar: { archetype: "Templar",  noun: "Mace", tag: "mace", hands: 1, primary: "wis" },
};

/* ───────── Handler ───────── */

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
    if (!roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden — overlord only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Service role for cascading delete + bulk insert
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { dry_run = false, purge = true } = body;

    const catalog = buildCatalog();
    if (dry_run) {
      return new Response(JSON.stringify({ planned: catalog.length, sample: catalog.slice(0, 10) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let purged = 0;
    if (purge) {
      // Find target ids: common/uncommon items not from creature/node origins
      const { data: targets } = await admin.from("items")
        .select("id")
        .in("rarity", ["common", "uncommon"])
        .or("origin_type.is.null,origin_type.eq.archetype_seed,origin_type.eq.blacksmith_forge");
      const ids = (targets || []).map((t: any) => t.id);
      purged = ids.length;
      if (ids.length > 0) {
        // Cascade clean in batches of 500 to keep `IN` lists tidy
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
        for (const c of chunks) {
          await admin.from("character_inventory").delete().in("item_id", c);
          await admin.from("vendor_inventory").delete().in("item_id", c);
          await admin.from("marketplace_listings").delete().in("item_id", c);
          await admin.from("node_ground_loot").delete().in("item_id", c);
          await admin.from("loot_table_entries").delete().in("item_id", c);
          await admin.from("class_starting_gear").delete().in("item_id", c);
          await admin.from("universal_starting_gear").delete().in("item_id", c);
          await admin.from("items").delete().in("id", c);
        }
      }
    }

    // Insert catalog in chunks; idempotent by name (skip existing)
    const names = catalog.map(c => c.name);
    const existingMap = new Map<string, string>();
    for (let i = 0; i < names.length; i += 500) {
      const slice = names.slice(i, i + 500);
      const { data: ex } = await admin.from("items").select("id,name").in("name", slice);
      (ex || []).forEach((r: any) => existingMap.set(r.name, r.id));
    }
    const toInsert = catalog.filter(c => !existingMap.has(c.name));

    let inserted = 0;
    const insertedByName = new Map<string, string>();
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { data, error } = await admin.from("items").insert(chunk as any).select("id,name");
      if (error) {
        console.error("insert chunk failed", error);
        continue;
      }
      (data || []).forEach((r: any) => insertedByName.set(r.name, r.id));
      inserted += data?.length ?? 0;
    }
    // Combine inserted + already-existing maps
    insertedByName.forEach((v, k) => existingMap.set(k, v));

    // Starting gear backfill (universal + class)
    // Universal: Worn Leather Vest? we have "Worn Vanguard Vest" etc. Use generic chest from CON archetype "Stoneguard Armor" L3.
    // To keep simple, pick "Worn Stoneguard Armor" (chest), "Worn Stoneguard Boots", "Worn Stoneguard Gloves".
    const universalNames = ["Worn Stoneguard Armor", "Worn Stoneguard Boots", "Worn Stoneguard Gloves"];
    const universalSlots: Record<string, string> = {
      "Worn Stoneguard Armor": "chest",
      "Worn Stoneguard Boots": "boots",
      "Worn Stoneguard Gloves": "gloves",
    };
    let starterCount = 0;
    for (const n of universalNames) {
      const id = existingMap.get(n);
      if (!id) continue;
      // skip if already present
      const { data: dupe } = await admin.from("universal_starting_gear").select("id").eq("item_id", id).maybeSingle();
      if (dupe) continue;
      const { error } = await admin.from("universal_starting_gear").insert({ item_id: id, equipped_slot: universalSlots[n] });
      if (!error) starterCount++;
    }
    // Class starters
    for (const [klass, spec] of Object.entries(CLASS_STARTERS)) {
      const name = `Worn ${spec.archetype} ${spec.noun}`;
      const id = existingMap.get(name);
      if (!id) continue;
      const { data: dupe } = await admin.from("class_starting_gear").select("id").eq("class", klass as any).eq("item_id", id).maybeSingle();
      if (dupe) continue;
      const { error } = await admin.from("class_starting_gear").insert({ class: klass as any, item_id: id });
      if (!error) starterCount++;
    }

    return new Response(JSON.stringify({
      ok: true,
      purged,
      planned: catalog.length,
      inserted,
      already_existed: catalog.length - inserted,
      starting_gear_attached: starterCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("seed-archetype-items error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
