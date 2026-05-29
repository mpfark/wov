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

// One archetype name per primary stat — no collisions with TIER_PREFIXES.
const PRIMARY_ARCHETYPES: Record<Stat, string> = {
  str: "Vanguard",
  dex: "Shadow",
  con: "Stoneguard",
  int: "Spellwoven",
  wis: "Sanctified",
  cha: "Crowned",
};

/**
 * 8 hybrid pairs. Each pair has 2 directional archetype names: which one is
 * used depends on which stat dominates in the item's stat block. Both variants
 * are seeded as separate items in the catalog so the forge browse list shows
 * the player a side-by-side choice once they own the matching hybrid gem.
 */
const HYBRID_ARCHETYPES: Array<{ a: Stat; b: Stat; nameA: string; nameB: string }> = [
  { a: "str", b: "con", nameA: "Warlord",     nameB: "Fortress" },
  { a: "str", b: "dex", nameA: "Blademaster", nameB: "Skirmisher" },
  { a: "dex", b: "wis", nameA: "Stalker",     nameB: "Pathfinder" },
  { a: "wis", b: "con", nameA: "Justicar",    nameB: "Oathbound" },
  { a: "int", b: "wis", nameA: "Mystic",      nameB: "Oracle" },
  { a: "cha", b: "wis", nameA: "Prophet",     nameB: "Hierophant" },
  { a: "cha", b: "dex", nameA: "Troubadour",  nameB: "Duelist" },
  { a: "cha", b: "str", nameA: "Sovereign",   nameB: "Champion" },
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
  amulet:  { str: ["Pendant"], con: ["Pendant"], dex: ["Talisman"], int: ["Amulet"], wis: ["Amulet"], cha: ["Locket"], default: ["Amulet"] },
  ring:    { str: ["Signet"], con: ["Band"], dex: ["Ring"], int: ["Ring"], wis: ["Ring"], cha: ["Signet"], default: ["Ring"] },
  trinket: { str: ["Charm"], con: ["Totem"], dex: ["Trinket"], int: ["Sigil"], wis: ["Relic"], cha: ["Token"], default: ["Trinket"] },
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
  const raw = 2 + (level - 1) * 0.3 * m * h;
  // Uncommon hybrids get +1 budget point at L30+ ("hybrid efficiency bonus").
  const hybridBonus = rarity === "uncommon" && level >= 30 ? 1 : 0;
  return Math.max(2, Math.floor(raw * t) + hybridBonus);
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
  // Primary attribute cap with late-game taper: +1 every 6 levels above L28, hard ceiling 13.
  if (level <= 28) return 4 + Math.floor(level / 4);
  if (level <= 40) return 11 + Math.floor((level - 28) / 6);
  return 13;
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
function pickPrimaryArchetype(primary: Stat): string {
  return PRIMARY_ARCHETYPES[primary];
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
  if (!secondary || secondary === primary) {
    throw new Error(`distributeUncommon requires a distinct secondary stat (got primary=${primary}, secondary=${secondary})`);
  }
  const budget = statBudget(level, "uncommon", hands);
  const stats: Record<string, number> = {};
  const primaryAmt = Math.max(1, Math.min(statCap(primary, level), Math.round(budget * 0.55)));
  const secondaryAmt = Math.max(1, Math.min(statCap(secondary, level), Math.round(budget * 0.35)));
  stats[primary] = primaryAmt;
  stats[secondary] = secondaryAmt;
  const tertiary: string = (primary === "con" || secondary === "con" || primary === "str") ? "hp" : "wis";
  // Spillover order: primary, secondary, tertiary
  spillover(stats, level, budget, [primary, secondary, tertiary]);
  // Floor: guarantee secondary stat is at least 1 (steal from primary if caps clipped it).
  if ((stats[secondary] ?? 0) < 1) {
    if ((stats[primary] ?? 0) > 1) {
      stats[primary]--;
      stats[secondary] = 1;
    } else {
      stats[secondary] = 1;
    }
  }
  return stats;
}

/* ───────── Catalog spec ───────── */

const ARMOR_SLOTS = ["head", "shoulders", "chest", "gloves", "belt", "pants", "boots", "off_hand", "amulet", "ring", "trinket"] as const;
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

    // PRIMARY archetypes — common only (uncommon tier reserved for hybrids).
    // One archetype per stat × every armor slot + every weapon variant for that stat.
    PRIMARIES.forEach((primary) => {
      const archetype = pickPrimaryArchetype(primary);

      // Armor slots
      ARMOR_SLOTS.forEach((slot) => {
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

      // Weapons (every preferred weapon for this stat)
      WEAPON_BY_STAT[primary].forEach((w) => {
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

    // HYBRID archetypes — uncommon only. Emit BOTH directional variants per
    // pair so the forge offers a side-by-side choice when the player owns the
    // matching hybrid gem.
    HYBRID_ARCHETYPES.forEach((h) => {
      const variants: Array<{ archetype: string; primary: Stat; secondary: Stat }> = [
        { archetype: h.nameA, primary: h.a, secondary: h.b },
        { archetype: h.nameB, primary: h.b, secondary: h.a },
      ];
      for (const v of variants) {
        // chest
        {
          const noun = pickSlotNoun("chest", v.primary);
          out.push({
            name: `${prefix} ${v.archetype} ${noun}`,
            description: `A ${prefix.toLowerCase()} ${v.archetype.toLowerCase()} ${noun.toLowerCase()} blending ${v.primary.toUpperCase()} and ${v.secondary.toUpperCase()}.`,
            item_type: "equipment",
            rarity: "uncommon",
            slot: "chest",
            level,
            hands: null,
            weapon_tag: null,
            stats: distributeUncommon(level, v.primary, v.secondary, 1),
            value: suggestGold(level, "uncommon"),
            max_durability: 100,
            world_drop: true,
            origin_type: "archetype_seed",
          });
        }
        // head
        {
          const noun = pickSlotNoun("head", v.primary);
          out.push({
            name: `${prefix} ${v.archetype} ${noun}`,
            description: `A ${prefix.toLowerCase()} ${v.archetype.toLowerCase()} ${noun.toLowerCase()} blending ${v.primary.toUpperCase()} and ${v.secondary.toUpperCase()}.`,
            item_type: "equipment",
            rarity: "uncommon",
            slot: "head",
            level,
            hands: null,
            weapon_tag: null,
            stats: distributeUncommon(level, v.primary, v.secondary, 1),
            value: suggestGold(level, "uncommon"),
            max_durability: 100,
            world_drop: true,
            origin_type: "archetype_seed",
          });
        }
        // weapon (use primary's first weapon)
        {
          const w = WEAPON_BY_STAT[v.primary][0];
          out.push({
            name: `${prefix} ${v.archetype} ${w.noun}`,
            description: `A ${prefix.toLowerCase()} ${v.archetype.toLowerCase()} ${w.noun.toLowerCase()} blending ${v.primary.toUpperCase()} and ${v.secondary.toUpperCase()}.`,
            item_type: "equipment",
            rarity: "uncommon",
            slot: "main_hand",
            level,
            hands: w.hands,
            weapon_tag: w.tag,
            stats: distributeUncommon(level, v.primary, v.secondary, w.hands),
            value: suggestGold(level, "uncommon"),
            max_durability: 100,
            world_drop: true,
            origin_type: "archetype_seed",
          });
        }
      }
    });
  }
  // Invariant: every uncommon must carry at least 2 attribute stats (it's a hybrid by design).
  const ATTR: Stat[] = ["str", "dex", "con", "int", "wis", "cha"];
  for (const it of out) {
    if (it.rarity !== "uncommon") continue;
    const attrCount = ATTR.filter(k => (it.stats[k] ?? 0) > 0).length;
    if (attrCount < 2) {
      throw new Error(`Uncommon item "${it.name}" has fewer than 2 attribute stats: ${JSON.stringify(it.stats)}`);
    }
  }
  return out;
}

/* ───────── Starting gear ───────── */

const CLASS_STARTERS: Record<string, { archetype: string; noun: string; tag: string; hands: 1 | 2; primary: Stat }> = {
  warrior: { archetype: "Vanguard",   noun: "Sword",  tag: "sword",  hands: 1, primary: "str" },
  rogue:   { archetype: "Shadow",     noun: "Dagger", tag: "dagger", hands: 1, primary: "dex" },
  ranger:  { archetype: "Shadow",     noun: "Bow",    tag: "bow",    hands: 2, primary: "dex" },
  wizard:  { archetype: "Spellwoven", noun: "Staff",  tag: "staff",  hands: 2, primary: "int" },
  healer:  { archetype: "Sanctified", noun: "Mace",   tag: "mace",   hands: 1, primary: "wis" },
  bard:    { archetype: "Crowned",    noun: "Wand",   tag: "wand",   hands: 1, primary: "cha" },
  templar: { archetype: "Sanctified", noun: "Mace",   tag: "mace",   hands: 1, primary: "wis" },
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
