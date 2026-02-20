import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Class-based stat bonuses awarded every 3 levels
const CLASS_LEVEL_BONUSES: Record<string, Record<string, number>> = {
  warrior: { str: 1, dex: 1 },
  wizard:  { int: 1, wis: 1 },
  ranger:  { dex: 1, wis: 1 },
  rogue:   { dex: 1, cha: 1 },
  healer:  { wis: 1, con: 1 },
  bard:    { cha: 1, int: 1 },
};

async function verifyAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw { status: 401, message: "Unauthorized" };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims) throw { status: 401, message: "Unauthorized" };

  const userId = claimsData.claims.sub as string;
  const { data: roleData } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  const callerRole = roleData?.role;
  if (callerRole !== "steward" && callerRole !== "overlord") throw { status: 403, message: "Forbidden" };

  return { adminClient, callerRole, userId };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { adminClient, callerRole } = await verifyAdmin(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // LIST USERS
    if (action === "list" && req.method === "GET") {
      const page = parseInt(url.searchParams.get("page") || "1");
      const perPage = 50;
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (error) throw error;

      const userIds = data.users.map((u: any) => u.id);
      const [rolesRes, charsRes, profilesRes] = await Promise.all([
        adminClient.from("user_roles").select("*").in("user_id", userIds),
        adminClient.from("characters").select("*").in("user_id", userIds),
        adminClient.from("profiles").select("*").in("user_id", userIds),
      ]);

      const charIds = (charsRes.data || []).map((c: any) => c.id);
      let inventoryByChar: Record<string, any[]> = {};
      if (charIds.length > 0) {
        const { data: invData } = await adminClient
          .from("character_inventory")
          .select("*, item:items(*)")
          .in("character_id", charIds);
        if (invData) {
          for (const inv of invData) {
            if (!inventoryByChar[inv.character_id]) inventoryByChar[inv.character_id] = [];
            inventoryByChar[inv.character_id].push(inv);
          }
        }
      }

      const users = data.users.map((u: any) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        banned_until: u.banned_until,
        role: rolesRes.data?.find((r: any) => r.user_id === u.id)?.role || "player",
        profile: profilesRes.data?.find((p: any) => p.user_id === u.id),
        characters: (charsRes.data?.filter((c: any) => c.user_id === u.id) || []).map((c: any) => ({
          ...c,
          inventory: inventoryByChar[c.id] || [],
        })),
      }));

      return jsonResponse({ users, total: data.total });
    }

    // SEND PASSWORD RESET
    if (action === "reset-password" && req.method === "POST") {
      const { email } = await req.json();
      if (!email) throw new Error("Email required");
      const { error } = await adminClient.auth.admin.generateLink({ type: "recovery", email });
      if (error) throw error;
      return jsonResponse({ success: true, message: "Password reset link generated" });
    }

    // UPDATE USER ROLE (overlord only)
    if (action === "set-role" && req.method === "POST") {
      if (callerRole !== "overlord") return jsonResponse({ error: "Only Overlords can change roles" }, 403);
      const { user_id, role } = await req.json();
      if (!user_id || !role) throw new Error("user_id and role required");
      if (!["player", "steward", "overlord"].includes(role)) throw new Error("Invalid role");

      const { data: existing } = await adminClient.from("user_roles").select("id").eq("user_id", user_id).maybeSingle();
      if (existing) {
        await adminClient.from("user_roles").update({ role }).eq("user_id", user_id);
      } else {
        await adminClient.from("user_roles").insert({ user_id, role });
      }
      return jsonResponse({ success: true });
    }

    // BAN / UNBAN USER (overlord only)
    if (action === "ban" && req.method === "POST") {
      if (callerRole !== "overlord") return jsonResponse({ error: "Only Overlords can ban users" }, 403);
      const { user_id, ban_duration } = await req.json();
      if (!user_id) throw new Error("user_id required");
      await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: ban_duration === "none" ? "none" : (ban_duration || "876000h"),
      });
      return jsonResponse({ success: true });
    }

    // UPDATE CHARACTER (admin edit)
    // SET LEVEL (with proper stat/HP recalculation)
    if (action === "set-level" && req.method === "POST") {
      const { character_id, new_level } = await req.json();
      if (!character_id || !new_level || typeof new_level !== "number" || new_level < 1 || new_level > 100) {
        throw new Error("character_id and valid new_level (1-100) required");
      }

      const { data: char, error: charErr } = await adminClient.from("characters").select("*").eq("id", character_id).single();
      if (charErr || !char) throw new Error("Character not found");

      const oldLevel = char.level;
      if (new_level === oldLevel) return jsonResponse({ success: true, message: "No change" });

      // Recalculate stats from scratch: base(8) + race + class + level-up bonuses
      const RACE_STATS: Record<string, Record<string, number>> = {
        human:    { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
        elf:      { str: 0, dex: 2, con: 0, int: 1, wis: 1, cha: 0 },
        dwarf:    { str: 2, dex: 0, con: 2, int: 0, wis: 1, cha: -1 },
        halfling: { str: -1, dex: 2, con: 1, int: 0, wis: 1, cha: 1 },
        edain:    { str: 1, dex: 0, con: 2, int: 1, wis: 1, cha: 1 },
        half_elf: { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 2 },
      };
      const CLASS_STATS: Record<string, Record<string, number>> = {
        warrior: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
        wizard:  { str: 0, dex: 0, con: 0, int: 3, wis: 2, cha: 1 },
        ranger:  { str: 1, dex: 3, con: 1, int: 0, wis: 2, cha: 0 },
        rogue:   { str: 0, dex: 3, con: 0, int: 1, wis: 0, cha: 2 },
        healer:  { str: 0, dex: 0, con: 1, int: 1, wis: 3, cha: 2 },
        bard:    { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 3 },
      };
      const CLASS_BASE_HP: Record<string, number> = {
        warrior: 24, wizard: 14, ranger: 20, rogue: 16, healer: 18, bard: 16,
      };

      const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      const raceBonus = RACE_STATS[char.race] || {};
      const classBonus = CLASS_STATS[char.class] || {};
      const levelBonuses = CLASS_LEVEL_BONUSES[char.class] || {};

      // Calculate what stats SHOULD be at old level (base + automatic gains)
      // Then figure out how many manual stat points were spent
      const calcStatsAtLevel = (level: number) => {
        const stats: Record<string, number> = {};
        for (const s of statKeys) {
          let val = 8 + (raceBonus[s] || 0) + (classBonus[s] || 0);
          // +1 all stats per level (levels 2 through min(level, 29))
          val += Math.max(0, Math.min(level, 29) - 1);
          // Class bonus every 3 levels
          if (levelBonuses[s]) {
            let bonusCount = 0;
            for (let l = 1; l <= level; l++) {
              if (l % 3 === 0) bonusCount++;
            }
            val += levelBonuses[s] * bonusCount;
          }
          stats[s] = val;
        }
        return stats;
      };

      const oldBaseStats = calcStatsAtLevel(oldLevel);
      const newBaseStats = calcStatsAtLevel(new_level);

      // Preserve manually spent stat points
      const updates: Record<string, any> = { level: new_level };
      for (const s of statKeys) {
        const manualPoints = Math.max(0, (char as any)[s] - oldBaseStats[s]);
        updates[s] = newBaseStats[s] + manualPoints;
      }

      // HP: base class HP + 5 per level after 1 + con modifier
      const baseHP = CLASS_BASE_HP[char.class] || 18;
      const conMod = Math.floor((updates.con - 10) / 2);
      const newMaxHp = baseHP + conMod + (new_level - 1) * 5;
      updates.max_hp = newMaxHp;
      updates.hp = newMaxHp;
      updates.max_cp = 100 + (new_level - 1) * 3;
      updates.cp = updates.max_cp;

      // Reset XP when setting level directly
      updates.xp = 0;

      const { error } = await adminClient.from("characters").update(updates).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true, old_level: oldLevel, new_level });
    }

    if (action === "update-character" && req.method === "POST") {
      const { character_id, updates } = await req.json();
      if (!character_id || !updates || typeof updates !== "object") throw new Error("character_id and updates required");

      const allowedFields = ["name", "hp", "max_hp", "gold", "xp",
        "str", "dex", "con", "int", "wis", "cha", "ac", "current_node_id", "unspent_stat_points"];

      const filteredUpdates: Record<string, any> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (!allowedFields.includes(key)) {
          throw new Error(`Field '${key}' cannot be updated via this endpoint`);
        }
        filteredUpdates[key] = value;
      }

      // Validate string fields
      if (filteredUpdates.name !== undefined) {
        if (typeof filteredUpdates.name !== "string" || filteredUpdates.name.trim().length === 0 || filteredUpdates.name.length > 50) {
          throw new Error("Name must be a non-empty string up to 50 characters");
        }
      }

      // Validate numeric ranges
      const numericRanges: Record<string, [number, number]> = {
        hp: [0, 10000], max_hp: [1, 10000], gold: [0, 1000000], xp: [0, 1000000],
        str: [1, 999], dex: [1, 999], con: [1, 999],
        int: [1, 999], wis: [1, 999], cha: [1, 999], ac: [0, 100],
        unspent_stat_points: [0, 200],
      };
      for (const [field, [min, max]] of Object.entries(numericRanges)) {
        if (filteredUpdates[field] !== undefined) {
          const val = filteredUpdates[field];
          if (typeof val !== "number" || !Number.isInteger(val) || val < min || val > max) {
            throw new Error(`${field} must be an integer between ${min} and ${max}`);
          }
        }
      }

      // Validate current_node_id is a valid UUID if provided
      if (filteredUpdates.current_node_id !== undefined && filteredUpdates.current_node_id !== null) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof filteredUpdates.current_node_id !== "string" || !uuidRegex.test(filteredUpdates.current_node_id)) {
          throw new Error("current_node_id must be a valid UUID");
        }
      }

      if (Object.keys(filteredUpdates).length === 0) throw new Error("No valid fields to update");

      const { error } = await adminClient.from("characters").update(filteredUpdates).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // GIVE ITEM TO CHARACTER
    if (action === "give-item" && req.method === "POST") {
      const { character_id, item_id } = await req.json();
      if (!character_id || !item_id) throw new Error("character_id and item_id required");
      const { data: item } = await adminClient.from("items").select("max_durability").eq("id", item_id).single();
      const durability = item?.max_durability ?? 100;
      const { error } = await adminClient.from("character_inventory").insert({
        character_id, item_id, current_durability: durability,
      });
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // TELEPORT CHARACTER
    if (action === "teleport" && req.method === "POST") {
      const { character_id, node_id } = await req.json();
      if (!character_id || !node_id) throw new Error("character_id and node_id required");
      // Validate node exists
      const { data: node, error: nodeErr } = await adminClient.from("nodes").select("id").eq("id", node_id).maybeSingle();
      if (nodeErr || !node) throw new Error("Node not found");
      const { error } = await adminClient.from("characters").update({ current_node_id: node_id }).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // GRANT XP
    if (action === "grant-xp" && req.method === "POST") {
      const { character_id, amount } = await req.json();
      if (!character_id || !amount || amount <= 0) throw new Error("character_id and positive amount required");
      
      // Fetch character
      const { data: char, error: charErr } = await adminClient.from("characters").select("*").eq("id", character_id).single();
      if (charErr || !char) throw new Error("Character not found");

      let newXp = char.xp + amount;
      let newLevel = char.level;
      let newMaxHp = char.max_hp;
      let newHp = char.hp;

      // Track stat increases during level-ups
      const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      const statIncreases: Record<string, number> = {};
      for (const s of statKeys) statIncreases[s] = 0;

      // Process multiple level-ups
      let xpForNext = newLevel * 100;
      while (newXp >= xpForNext && newLevel < 100) {
        newXp -= xpForNext;
        newLevel++;
        newMaxHp += 5;
        newHp = newMaxHp; // Full heal on level up

        // +1 all stats only before level 30
        if (newLevel < 30) {
          for (const s of statKeys) statIncreases[s]++;
        }

        // Class bonus every 3 levels (uncapped)
        if (newLevel % 3 === 0) {
          const bonuses = CLASS_LEVEL_BONUSES[char.class] || {};
          for (const s of statKeys) {
            if (bonuses[s]) statIncreases[s] += bonuses[s];
          }
        }

        xpForNext = newLevel * 100;
      }

      const updates: Record<string, any> = {
        xp: newXp, level: newLevel, max_hp: newMaxHp, hp: newHp,
        max_cp: 100 + (newLevel - 1) * 3, cp: 100 + (newLevel - 1) * 3,
      };

      // Apply accumulated stat increases
      for (const stat of statKeys) {
        if (statIncreases[stat] > 0) {
          updates[stat] = (char as any)[stat] + statIncreases[stat];
        }
      }

      const { error } = await adminClient.from("characters").update(updates).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true, levels_gained: newLevel - char.level });
    }

    // REVIVE CHARACTER
    if (action === "revive" && req.method === "POST") {
      const { character_id } = await req.json();
      if (!character_id) throw new Error("character_id required");
      const { data: char } = await adminClient.from("characters").select("max_hp").eq("id", character_id).single();
      if (!char) throw new Error("Character not found");
      const { error } = await adminClient.from("characters").update({ hp: char.max_hp }).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // REMOVE ITEM
    if (action === "remove-item" && req.method === "POST") {
      const { inventory_id } = await req.json();
      if (!inventory_id) throw new Error("inventory_id required");
      const { error } = await adminClient.from("character_inventory").delete().eq("id", inventory_id);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // RESET STATS
    if (action === "reset-stats" && req.method === "POST") {
      const { character_id } = await req.json();
      if (!character_id) throw new Error("character_id required");
      
      const { data: char } = await adminClient.from("characters").select("*").eq("id", character_id).single();
      if (!char) throw new Error("Character not found");

      // Calculate base stats: 8 base + race + class bonuses
      const RACE_STATS: Record<string, Record<string, number>> = {
        human:    { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
        elf:      { str: 0, dex: 2, con: 0, int: 1, wis: 1, cha: 0 },
        dwarf:    { str: 2, dex: 0, con: 2, int: 0, wis: 1, cha: -1 },
      halfling: { str: -1, dex: 2, con: 1, int: 0, wis: 1, cha: 1 },
      edain:    { str: 1, dex: 0, con: 2, int: 1, wis: 1, cha: 1 },
        half_elf: { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 2 },
      };
      const CLASS_STATS: Record<string, Record<string, number>> = {
        warrior: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
        wizard:  { str: 0, dex: 0, con: 0, int: 3, wis: 2, cha: 1 },
        ranger:  { str: 1, dex: 3, con: 1, int: 0, wis: 2, cha: 0 },
        rogue:   { str: 0, dex: 3, con: 0, int: 1, wis: 0, cha: 2 },
        healer:  { str: 0, dex: 0, con: 1, int: 1, wis: 3, cha: 2 },
        bard:    { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 3 },
      };

      const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      const raceBonus = RACE_STATS[char.race] || {};
      const classBonus = CLASS_STATS[char.class] || {};
      const levelBonuses = CLASS_LEVEL_BONUSES[char.class] || {};

      const baseStats: Record<string, number> = {};
      let totalSpentPoints = 0;

      for (const stat of statKeys) {
        let base = 8 + (raceBonus[stat] || 0) + (classBonus[stat] || 0);
        // Add class level bonuses (every 3 levels)
        if (levelBonuses[stat]) {
          let bonusCount = 0;
          for (let l = 1; l <= char.level; l++) {
            if (l % 3 === 0) bonusCount++;
          }
          base += levelBonuses[stat] * bonusCount;
        }
        totalSpentPoints += (char as any)[stat] - base;
        baseStats[stat] = base;
      }

      // Total unspent = current unspent + spent points (refunded)
      const newUnspent = char.unspent_stat_points + Math.max(totalSpentPoints, 0);

      const newMaxCp = 100 + (char.level - 1) * 3;
      const { error } = await adminClient.from("characters").update({
        ...baseStats,
        unspent_stat_points: newUnspent,
        max_cp: newMaxCp,
        cp: newMaxCp,
      }).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true, refunded_points: Math.max(totalSpentPoints, 0) });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err: any) {
    const status = err.status || 500;
    return jsonResponse({ error: err.message || "Internal error" }, status);
  }
});
