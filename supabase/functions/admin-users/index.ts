import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Retired reconstruction/raw grant routes fail after admin authentication,
    // before parsing their payload or accessing gameplay tables.
    if (action && ['set-level', 'reset-stats', 'grant-respec'].includes(action)) {
      return jsonResponse({ code: 'legacy_progression_operation_retired',
        error: 'This legacy progression operation is unavailable.' }, 410);
    }

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

      // Use a user-scoped client to call resetPasswordForEmail,
      // which triggers the auth email hook and actually sends the email.
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const resetClient = createClient(supabaseUrl, anonKey);
      const { error } = await resetClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${req.headers.get("origin") || supabaseUrl}/reset-password`,
      });
      if (error) throw error;
      return jsonResponse({ success: true, message: "Password reset email sent" });
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

    if (action === "update-character" && req.method === "POST") {
      const { character_id, updates } = await req.json();
      if (!character_id || !updates || typeof updates !== "object") throw new Error("character_id and updates required");

      const protectedFields = ['str','dex','con','int','wis','cha','level','xp','class','is_classless',
        'unspent_stat_points','respec_points','bhp','bhp_trained','rp_total_earned'];
      // Refuse the whole mixed payload before any update, never partially apply it.
      if (Object.keys(updates).some(field => protectedFields.includes(field))) {
        return jsonResponse({ code: 'protected_progression_edit_denied',
          error: 'Protected progression fields cannot be edited here.' }, 403);
      }

      const allowedFields = ["name", "hp", "max_hp", "gold", "ac", "current_node_id", "gender"];

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
      const { error } = await adminClient.from("character_inventory").insert({
        character_id, item_id, current_durability: 100,
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

    // GRANT XP — paused pending canonical validated admin award integration.
    if (action === "grant-xp") {
      return jsonResponse({ code: "progression_awards_paused", error: "XP awards are temporarily unavailable." }, 503);
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

    // GRANT SALVAGE
    if (action === "grant-salvage" && req.method === "POST") {
      const { character_id, amount } = await req.json();
      if (!character_id || !amount || amount < 1) throw { message: "character_id and positive amount required", status: 400 };
      const { data: newTotal, error } = await adminClient.rpc('add_material', {
        _character_id: character_id, _key: 'salvage', _delta: amount,
      });
      if (error) throw error;
      return jsonResponse({ success: true, new_total: newTotal });
    }

    // GRANT GEM
    if (action === "grant-gem" && req.method === "POST") {
      const { character_id, gem_key, amount } = await req.json();
      const GEMS = ['garnet', 'topaz', 'emerald', 'sapphire', 'pearl', 'amethyst'];
      if (!character_id || !GEMS.includes(gem_key) || !amount || amount < 1 || amount > 1000) {
        throw { message: "character_id, valid gem_key and amount (1..1000) required", status: 400 };
      }
      const { data: newTotal, error } = await adminClient.rpc('add_material', {
        _character_id: character_id, _key: gem_key, _delta: amount,
      });
      if (error) throw error;
      return jsonResponse({ success: true, new_total: newTotal });
    }


    // GRANT GOLD
    if (action === "grant-gold" && req.method === "POST") {
      const { character_id, amount } = await req.json();
      if (!character_id || !amount || amount < 1 || amount > 1000000) {
        throw { message: "character_id and amount (1..1000000) required", status: 400 };
      }
      const { data: char, error: fetchErr } = await adminClient.from("characters").select("gold").eq("id", character_id).single();
      if (fetchErr || !char) throw { message: "Character not found", status: 404 };
      const newTotal = (char.gold || 0) + amount;
      const { error } = await adminClient.from("characters").update({ gold: newTotal }).eq("id", character_id);
      if (error) throw error;
      return jsonResponse({ success: true, new_total: newTotal });
    }

    // 'set-password' action removed: admins can only trigger password reset emails
    // via the 'reset-password' action. Directly setting passwords would allow
    // account takeover (including of other admins).

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err: any) {
    const status = err.status || 500;
    return jsonResponse({ error: err.message || "Internal error" }, status);
  }
});
