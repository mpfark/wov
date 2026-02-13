import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Class-based stat bonuses awarded every 3 levels
const CLASS_LEVEL_BONUSES: Record<string, Record<string, number>> = {
  warrior: { str: 1, con: 1 },
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
  if (callerRole !== "maiar" && callerRole !== "valar") throw { status: 403, message: "Forbidden" };

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

    // UPDATE USER ROLE (valar only)
    if (action === "set-role" && req.method === "POST") {
      if (callerRole !== "valar") return jsonResponse({ error: "Only Valar can change roles" }, 403);
      const { user_id, role } = await req.json();
      if (!user_id || !role) throw new Error("user_id and role required");
      if (!["player", "maiar", "valar"].includes(role)) throw new Error("Invalid role");

      const { data: existing } = await adminClient.from("user_roles").select("id").eq("user_id", user_id).maybeSingle();
      if (existing) {
        await adminClient.from("user_roles").update({ role }).eq("user_id", user_id);
      } else {
        await adminClient.from("user_roles").insert({ user_id, role });
      }
      return jsonResponse({ success: true });
    }

    // BAN / UNBAN USER (valar only)
    if (action === "ban" && req.method === "POST") {
      if (callerRole !== "valar") return jsonResponse({ error: "Only Valar can ban users" }, 403);
      const { user_id, ban_duration } = await req.json();
      if (!user_id) throw new Error("user_id required");
      await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: ban_duration === "none" ? "none" : (ban_duration || "876000h"),
      });
      return jsonResponse({ success: true });
    }

    // UPDATE CHARACTER (admin edit)
    if (action === "update-character" && req.method === "POST") {
      const { character_id, updates } = await req.json();
      if (!character_id || !updates) throw new Error("character_id and updates required");
      const { error } = await adminClient.from("characters").update(updates).eq("id", character_id);
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
      let newUnspent = char.unspent_stat_points;
      let newHp = char.hp;

      // Process multiple level-ups
      let xpForNext = newLevel * 100;
      while (newXp >= xpForNext && newLevel < 100) {
        newXp -= xpForNext;
        newLevel++;
        newMaxHp += 5;
        newHp = newMaxHp; // Full heal on level up
        newUnspent += 2;
        xpForNext = newLevel * 100;
      }

      const updates: Record<string, any> = {
        xp: newXp, level: newLevel, max_hp: newMaxHp, hp: newHp, unspent_stat_points: newUnspent,
      };

      // Apply class level bonuses for each level gained
      if (newLevel > char.level) {
        const bonuses = CLASS_LEVEL_BONUSES[char.class] || {};
        const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        for (const stat of stats) {
          if (!bonuses[stat]) continue;
          // Count bonus levels: every 3rd level in range (old_level, new_level]
          let bonusCount = 0;
          for (let l = char.level + 1; l <= newLevel; l++) {
            if (l % 3 === 0) bonusCount++;
          }
          if (bonusCount > 0) {
            updates[stat] = (char as any)[stat] + bonuses[stat] * bonusCount;
          }
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
        hobbit:   { str: -1, dex: 2, con: 1, int: 0, wis: 1, cha: 1 },
        dunedain: { str: 1, dex: 0, con: 2, int: 1, wis: 1, cha: 1 },
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

      const { error } = await adminClient.from("characters").update({
        ...baseStats,
        unspent_stat_points: newUnspent,
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
