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
    const { adminClient, callerRole, userId } = await verifyAdmin(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Retired reconstruction/raw grant routes fail after admin authentication,
    // before parsing their payload or accessing gameplay tables.
    if (action && ['set-level', 'reset-stats', 'grant-respec'].includes(action)) {
      return jsonResponse({ code: 'legacy_progression_operation_retired',
        error: 'This legacy progression operation is unavailable.' }, 410);
    }

    if (action && ['revive','teleport','give-item','remove-item','grant-gold','grant-salvage','grant-gem'].includes(action)) {
      return jsonResponse({ code: 'legacy_character_operation_retired', error: 'This legacy character administration operation is unavailable pending replacement authority.' }, 410);
    }

    if (action === 'award-respec-token' && req.method === 'POST') {
      const body = await req.json();
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!body || Object.keys(body).some(k => !['character_id','request_id','amount','reason'].includes(k))
        || !uuid.test(body.character_id) || !uuid.test(body.request_id) || !Number.isInteger(body.amount)
        || body.amount < 1 || body.amount > (callerRole === 'steward' ? 1 : 5)
        || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) {
        return jsonResponse({ error: 'Valid target, request UUID, capped integer amount and reason required' }, 400);
      }
      const { data, error } = await adminClient.rpc('admin_respec_award', {
        _actor: userId, _character: body.character_id, _request: body.request_id, _amount: body.amount, _reason: body.reason.trim(),
      });
      if (error) throw error;
      return jsonResponse(data, data?.kind === 'refused' ? 409 : 200);
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

      if (Object.keys(updates).some(field => !['name','gender'].includes(field))) {
        return jsonResponse({ code: 'character_edit_field_denied', error: 'Only name and gender can be edited here.' }, 403);
      }
      const filteredUpdates = { ...updates };
      // Validate string fields
      if (filteredUpdates.name !== undefined) {
        if (typeof filteredUpdates.name !== "string" || filteredUpdates.name.trim().length === 0 || filteredUpdates.name.length > 50) {
          throw new Error("Name must be a non-empty string up to 50 characters");
        }
      }

      if (filteredUpdates.gender !== undefined && !['male','female'].includes(filteredUpdates.gender)) {
        return jsonResponse({ error: 'Gender must be male or female' }, 400);
      }
      if (Object.keys(filteredUpdates).length === 0) throw new Error("No valid fields to update");

      const { data: target, error: targetError } = await adminClient.from('characters')
        .select('id, deleted_at').eq('id', character_id).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return jsonResponse({ error: 'Character not found' }, 404);
      if (target.deleted_at) return jsonResponse({ error: 'Deleted characters cannot be edited' }, 409);
      const { data: changed, error } = await adminClient.from('characters').update(filteredUpdates)
        .eq('id', character_id).is('deleted_at', null).select('id').maybeSingle();
      if (error) throw error;
      if (!changed) return jsonResponse({ error: 'Character no longer available for editing' }, 409);
      return jsonResponse({ success: true });
    }

    // GRANT XP — paused pending canonical validated admin award integration.
    if (action === "grant-xp") {
      return jsonResponse({ code: "progression_awards_paused", error: "XP awards are temporarily unavailable." }, 503);
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
