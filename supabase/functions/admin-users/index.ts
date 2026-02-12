import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is maiar or valar
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: claimsData.claims.sub as string };

    // Check role
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const callerRole = roleData?.role;
    if (callerRole !== "maiar" && callerRole !== "valar") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // LIST USERS
    if (action === "list" && req.method === "GET") {
      const page = parseInt(url.searchParams.get("page") || "1");
      const perPage = 50;
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) throw error;

      // Get roles and characters for these users
      const userIds = data.users.map((u: any) => u.id);

      const [rolesRes, charsRes, profilesRes] = await Promise.all([
        adminClient.from("user_roles").select("*").in("user_id", userIds),
        adminClient.from("characters").select("*").in("user_id", userIds),
        adminClient.from("profiles").select("*").in("user_id", userIds),
      ]);

      // Fetch inventory for all characters
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

      return new Response(JSON.stringify({ users, total: data.total }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEND PASSWORD RESET
    if (action === "reset-password" && req.method === "POST") {
      const { email } = await req.json();
      if (!email) throw new Error("Email required");

      // Use the admin API to generate a recovery link
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, message: "Password reset link generated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE USER ROLE (valar only)
    if (action === "set-role" && req.method === "POST") {
      if (callerRole !== "valar") {
        return new Response(JSON.stringify({ error: "Only Valar can change roles" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { user_id, role } = await req.json();
      if (!user_id || !role) throw new Error("user_id and role required");
      if (!["player", "maiar", "valar"].includes(role)) throw new Error("Invalid role");

      // Upsert role
      const { data: existing } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (existing) {
        await adminClient.from("user_roles").update({ role }).eq("user_id", user_id);
      } else {
        await adminClient.from("user_roles").insert({ user_id, role });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // BAN / UNBAN USER (valar only)
    if (action === "ban" && req.method === "POST") {
      if (callerRole !== "valar") {
        return new Response(JSON.stringify({ error: "Only Valar can ban users" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { user_id, ban_duration } = await req.json();
      if (!user_id) throw new Error("user_id required");

      if (ban_duration === "none") {
        await adminClient.auth.admin.updateUserById(user_id, { ban_duration: "none" });
      } else {
        await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: ban_duration || "876000h", // ~100 years = permanent
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE CHARACTER (admin edit)
    if (action === "update-character" && req.method === "POST") {
      const { character_id, updates } = await req.json();
      if (!character_id || !updates) throw new Error("character_id and updates required");

      const { error } = await adminClient
        .from("characters")
        .update(updates)
        .eq("id", character_id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
