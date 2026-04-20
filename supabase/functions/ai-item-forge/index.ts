import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALL_SLOTS = ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"] as const;

// In-memory rate limiter: max 10 requests per 60 seconds per user
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
    const userId = claimsData.claims.sub;

    if (!checkRateLimit(userId as string)) {
      return new Response(JSON.stringify({ error: "Rate limited. Please wait before making more requests." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleData || []).map((r: any) => r.role);
    if (!roles.includes("steward") && !roles.includes("overlord")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const {
      prompt,
      count: rawCount,
      level_min = 1,
      level_max = 10,
      item_type = "random",       // "equipment" | "consumable" | "random"
      slot = "random",            // specific slot | "random" | "any_weapon" | "any_armor"
      rarity = "random",          // "common" | "uncommon" | "random"
      stats_focus = "random",     // "random" | "offensive" | "defensive" | "utility"
    } = body;
    const count = Math.min(Math.max(1, parseInt(rawCount) || 5), 20);

    // Fetch existing item names to avoid duplicates
    const { data: existingItems } = await supabase.from("items").select("name").limit(5000);
    const existingItemNames = (existingItems || []).map((i: any) => i.name).join(", ");

    // Build slot constraint
    const weaponSlots = ["main_hand", "off_hand"];
    const armorSlots = ["head", "chest", "gloves", "belt", "pants", "boots", "shoulders"];
    const accessorySlots = ["ring", "trinket", "amulet"];

    let slotInstruction = "";
    if (slot === "random") {
      slotInstruction = "Choose slots freely across all equipment types for variety.";
    } else if (slot === "any_weapon") {
      slotInstruction = `Slots must be one of: ${weaponSlots.join(", ")}.`;
    } else if (slot === "any_armor") {
      slotInstruction = `Slots must be one of: ${armorSlots.join(", ")}.`;
    } else if (slot === "any_accessory") {
      slotInstruction = `Slots must be one of: ${accessorySlots.join(", ")}.`;
    } else if (slot !== "random") {
      slotInstruction = `All items must use slot: ${slot}.`;
    }

    // Build stats focus instruction
    let statsFocusInstruction = "";
    if (stats_focus === "offensive") statsFocusInstruction = "Focus stats on: str, dex, int — offensive power.";
    else if (stats_focus === "defensive") statsFocusInstruction = "Focus stats on: con, ac, hp, hp_regen — survivability.";
    else if (stats_focus === "utility") statsFocusInstruction = "Focus stats on: wis, cha, int — utility and support.";
    else statsFocusInstruction = "Mix stat types freely for variety across the batch.";

    // Build rarity instruction
    let rarityInstruction = "";
    if (rarity === "random") rarityInstruction = "Vary rarity freely: mostly common, some uncommon.";
    else rarityInstruction = `All items must have rarity: ${rarity}.`;

    // Build item type instruction
    let typeInstruction = "";
    if (item_type === "random") typeInstruction = "Mix equipment and consumables, leaning toward equipment.";
    else if (item_type === "equipment") typeInstruction = "All items must be equipment (no consumables).";
    else typeInstruction = "All items must be consumables (slot = null, stats can ONLY use hp and hp_regen, budget is 3x normal, no stat caps).";

    const systemPrompt = `You are an item generator for "Wayfarers of Varneth", a text-based high-fantasy RPG.
Generate a batch of ${count} distinct, lore-consistent items for a level ${level_min}–${level_max} world.

NAMING & DESCRIPTION RULES:
- ALL item names and descriptions must be written ENTIRELY in English using ONLY standard ASCII letters (A-Z, a-z), spaces, hyphens, and apostrophes.
- Do NOT include metadata, IDs, labels, or prefixes in name or description fields.
- Descriptions must be a single evocative English sentence. Never leave description empty.
- Names must be UNIQUE — do NOT generate items with names from this list: ${existingItemNames || "none"}

NAMING POLICY BY RARITY (CRITICAL — FOLLOW EXACTLY):

COMMON items — boring, generic, material-based. Format: [Tier Adjective] [Material] [Slot Noun]
- Tier adjectives by level band (use to hint at strength, NOT for flavor):
  - L1-9: omit, or use "Crude", "Worn", "Rough", "Simple"
  - L10-19: "Sturdy", "Hardened", "Reinforced"
  - L20-29: "Heavy", "Tempered", "Banded"
  - L30-42: "Masterwork", "Riveted", "Honed"
- Materials by level: Cloth → Leather → Studded Leather → Iron → Steel → Banded Steel → Reinforced Steel
- Slot nouns: Helm, Pauldrons, Cuirass, Gauntlets, Belt, Greaves, Boots, Ring, Amulet, Pendant, Trinket, Sword, Axe, Dagger, Mace, Bow, Staff, Shield, etc.
- GOOD examples: "Sturdy Iron Helm", "Masterwork Steel Pauldrons", "Heavy Bone Amulet", "Iron Dagger", "Worn Leather Boots", "Tempered Steel Sword"
- BAD examples (NEVER for common): "Helm of the Cairn Warden", "Pendant of the Astral Journey", "Whispering Skull Fragment", "Heart of the Ancient Forest"
- NO proper nouns. NO place names. NO factions. NO "of the X" titles.

UNCOMMON items — slightly evocative but still generic archetypes. Format: [Quality Adjective] [Material/Style] [Slot Noun]
- Allowed quality words ONLY: Fine, Engraved, Etched, Reinforced, Plated, Banded, Polished, Runed, Gilded, Enchanted, Greater
- GOOD examples: "Gilded Circlet", "Runed Kite Shield", "Engraved Greatsword", "Etched Dagger", "Plated Pauldrons", "Fine Longbow"
- BAD examples (NEVER for uncommon — these belong to UNIQUE tier only): "Aegis of Dawn", "Dawnbreaker", "Stormsplitter", "Phantom Edge", "Mantle of the Obsidian Watch"
- NO proper nouns. NO place names. NO factions. NO "of the X" titles.

THEMATIC CONSISTENCY (apply WITHIN the naming policy above):
- Item names MUST match their stats. A "Heavy" item leans STR/CON, a "Runed" item leans INT/WIS, a "Gilded" item leans CHA.
- Material/quality hints by stat focus (incorporate into the boring/generic format above):
  - STR-focused: Heavy, Iron, Banded, Reinforced
  - DEX-focused: Light, Polished, Fine, Etched
  - CON-focused: Hardened, Sturdy, Tempered, Plated
  - INT-focused: Runed, Engraved, Etched
  - WIS-focused: Engraved, Runed
  - CHA-focused: Gilded, Polished, Fine
- Weapon slot nouns: swords = Sword/Blade/Greatsword, axes = Axe/Greataxe/Hatchet, staves = Staff, etc.
- Armor slot nouns must match the slot: shoulders = Pauldrons/Spaulders, belt = Belt/Girdle, chest = Cuirass/Hauberk, etc.

ITEM TYPE: ${typeInstruction}
SLOT: ${slotInstruction}
RARITY: ${rarityInstruction}
STATS FOCUS: ${statsFocusInstruction}

STAT BUDGET FORMULA:
- Equipment budget = floor(1 + (level - 1) × 0.3 × rarity_multiplier × hands_multiplier)
- Consumable budget = equipment_budget × 3
- Rarity multipliers: common=1.0, uncommon=1.5
- Hands multiplier: 1.0 for 1-handed, 1.5 for 2-handed (hands=2, main_hand only)
- Level: pick a level between ${level_min} and ${level_max} for each item.

STAT DISTRIBUTION RULES:
- Equipment items MUST have AT LEAST 2 different stat keys. Items with only 1 stat will be REJECTED.
- Distribute the FULL budget across multiple stats. Never leave budget unspent.
- The PRIMARY stat (matching the item's theme) should get ~40-50% of the budget. Secondary stats get the rest.
- Example for budget=2: {"str":1,"con":1}. Budget=4: {"str":2,"dex":1,"con":1}. Budget=6: {"str":2,"dex":2,"wis":1,"hp":2}.
- Even for budget=1, split across 2 stats like {"str":1,"dex":1} (going slightly over is fine).

STAT KEYS & COSTS:
- Valid equipment stats: str(1pt), dex(1pt), con(1pt), int(1pt), wis(1pt), cha(1pt), ac(3pts), hp(0.5pts), hp_regen(2pts)
- Valid consumable stats: hp, hp_regen ONLY (no other stats, no caps)

STAT CAPS (equipment only):
- Primary stats (str/dex/con/int/wis/cha): max = 4 + floor(level/4)
- AC: max = 2 + floor(level/10)
- HP: max = 6 + floor(level/5) × 2
- HP Regen: max = 2

OTHER FIELDS:
- drop_chance: 0.1–0.5 (uncommon items lower, consumables 0.3–0.5)
- weapon_tag: For main_hand/off_hand only, set to one of: sword, axe, mace, dagger, bow, staff, wand, shield. Choose based on item name. Non-weapon slots: omit.
- max_durability: always 100
- Gold value: set to 0, will be auto-calculated
- Slot for consumables: null
- Ensure variety in the batch: don't repeat the same slot/stat combo.

${prompt ? `FLAVOR CONTEXT: ${prompt}` : ""}

Call the generate_items tool with the structured output.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
          { role: "user", content: `Generate exactly ${count} items for level ${level_min}–${level_max}. IMPORTANT: Calculate the stat budget for each item using the formula and spend ALL of it across multiple stats. A level 10 uncommon item has budget floor(1+9*0.3*1.5)=5, so its stats should total ~5 points spread across 2-3 keys. Never leave budget unspent.` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_items",
              description: "Generate a batch of items for a loot table",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        item_type: { type: "string", enum: ["equipment", "consumable"] },
                        rarity: { type: "string", enum: ["common", "uncommon"] },
                        slot: {
                          type: "string",
                          enum: ["main_hand", "off_hand", "head", "chest", "gloves", "belt", "pants", "ring", "trinket", "boots", "amulet", "shoulders"],
                          description: "null for consumables",
                        },
                        level: { type: "integer" },
                        hands: { type: "integer", description: "1 or 2 for main_hand weapons, null otherwise" },
                        weapon_tag: { type: "string", enum: ["sword", "axe", "mace", "dagger", "bow", "staff", "wand", "shield"], description: "Weapon type tag for main_hand/off_hand items. null for non-weapon slots." },
                        stats: {
                          type: "object",
                          description: "Must not be empty. Stat bonuses using valid keys: str, dex, con, int, wis, cha, ac, hp, hp_regen",
                        },
                        value: { type: "integer", description: "Set to 0, will be auto-calculated" },
                        max_durability: { type: "integer" },
                        drop_chance: { type: "number", description: "0.1 to 0.5" },
                      },
                      required: ["name", "description", "item_type", "rarity", "level", "stats", "value", "max_durability", "drop_chance"],
                    },
                  },
                },
                required: ["items"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_items" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment before trying again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds to your workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call in AI response");
    }

    const RARITY_MULT: Record<string, number> = { common: 1.0, uncommon: 1.5, unique: 3.0 };
    const STAT_COSTS: Record<string, number> = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1, ac: 3, hp: 0.5, hp_regen: 2 };
    const PRIMARY_STATS = ["str", "dex", "con", "int", "wis", "cha"];

    function calcBudget(level: number, rarity: string, hands: number = 1): number {
      const mult = RARITY_MULT[rarity] || 1;
      const handsMult = hands === 2 ? 1.5 : 1;
      return Math.floor(1 + (level - 1) * 0.3 * mult * handsMult);
    }

    function calcStatCost(stats: Record<string, number>): number {
      return Object.entries(stats).reduce((sum, [k, v]) => sum + v * (STAT_COSTS[k] || 1), 0);
    }

    function getStatCap(key: string, level: number): number {
      if (key === "ac" || key === "hp_regen") return 2 + Math.floor(level / 10);
      if (key === "hp") return 6 + Math.floor(level / 5) * 2;
      return 4 + Math.floor(level / 4);
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const items = (parsed.items || []).map((item: any) => {
      const mult = RARITY_MULT[item.rarity] || 1;
      const autoGold = Math.round((item.level || 1) * 2.5 * mult * mult);

      // Sanitize name: strip non-ASCII, remove prefixes like "name:", trim
      let cleanName = (item.name || "Unnamed Item")
        .replace(/[^\x20-\x7E]/g, '')        // strip non-ASCII
        .replace(/^(name|item|id)\s*[:=]\s*/i, '') // strip "name:" prefixes
        .replace(/^\d+[\s.:_-]+/, '')          // strip leading IDs like "3: " or "item_3 "
        .trim();
      if (!cleanName) cleanName = "Unnamed Item";

      // Sanitize description
      let cleanDesc = (item.description || "A mysterious item.")
        .replace(/[^\x20-\x7E]/g, '')
        .trim();
      if (!cleanDesc) cleanDesc = "A mysterious item.";

      let stats = (item.stats && Object.keys(item.stats).length > 0) ? { ...item.stats } : {};

      if (item.item_type === "equipment") {
        const budget = calcBudget(item.level || 1, item.rarity, item.hands || 1);
        let spent = calcStatCost(stats);

        // If AI underspent the budget, top up with random stats
        let attempts = 0;
        while (spent < budget && attempts < 50) {
          const pick = PRIMARY_STATS[Math.floor(Math.random() * PRIMARY_STATS.length)];
          const cap = getStatCap(pick, item.level || 1);
          const current = stats[pick] || 0;
          if (current < cap) {
            stats[pick] = current + 1;
            spent++;
          }
          attempts++;
        }

        // Ensure at least 2 different stats
        if (Object.keys(stats).length < 2) {
          const usedKeys = Object.keys(stats);
          const available = PRIMARY_STATS.filter(k => !usedKeys.includes(k));
          if (available.length > 0) {
            const pick = available[Math.floor(Math.random() * available.length)];
            stats[pick] = 1;
          }
        }

        // If still empty
        if (Object.keys(stats).length === 0) stats = { str: 1, con: 1 };
      } else {
        // Consumable fallback
        if (Object.keys(stats).length === 0) stats = { hp: 3 };
      }

      const isWeaponSlot = item.slot === 'main_hand' || item.slot === 'off_hand';
      const VALID_TAGS = ['sword', 'axe', 'mace', 'dagger', 'bow', 'staff', 'wand', 'shield'];
      let weaponTag = isWeaponSlot && item.weapon_tag && VALID_TAGS.includes(item.weapon_tag) ? item.weapon_tag : null;
      // Auto-infer weapon_tag from name if AI didn't set it
      if (isWeaponSlot && !weaponTag) {
        const ln = cleanName.toLowerCase();
        if (ln.includes('sword') || ln.includes('blade') || ln.includes('saber') || ln.includes('rapier')) weaponTag = 'sword';
        else if (ln.includes('axe') || ln.includes('hatchet') || ln.includes('cleaver')) weaponTag = 'axe';
        else if (ln.includes('mace') || ln.includes('hammer') || ln.includes('flail') || ln.includes('maul')) weaponTag = 'mace';
        else if (ln.includes('dagger') || ln.includes('knife') || ln.includes('shiv') || ln.includes('stiletto')) weaponTag = 'dagger';
        else if (ln.includes('bow') || ln.includes('longbow') || ln.includes('shortbow')) weaponTag = 'bow';
        else if (ln.includes('staff') || ln.includes('stave') || ln.includes('rod')) weaponTag = 'staff';
        else if (ln.includes('wand') || ln.includes('scepter') || ln.includes('focus')) weaponTag = 'wand';
        else if (ln.includes('shield') || ln.includes('buckler') || ln.includes('bulwark')) weaponTag = 'shield';
        else weaponTag = 'sword'; // default for weapons
      }

      return {
        ...item,
        name: cleanName,
        description: cleanDesc,
        stats,
        slot: item.item_type === "consumable" ? null : (item.slot || null),
        value: autoGold,
        weapon_tag: weaponTag,
      };
    });

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-item-forge error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
