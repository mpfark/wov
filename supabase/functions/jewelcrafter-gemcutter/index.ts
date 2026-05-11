import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  GEM_CATALOG,
  PRIMARY_GEM_KEYS,
  HYBRID_GEM_KEYS,
  hybridRecipe,
  GEM_SALVAGE_COST_PRIMARY,
  type GemKey,
} from "../_shared/formulas/gems.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getMaterialCount(db: any, characterId: string, key: string): Promise<number> {
  const { data } = await db
    .from("character_materials")
    .select("count")
    .eq("character_id", characterId)
    .eq("material_key", key)
    .maybeSingle();
  return data?.count ?? 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userDb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userDb.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const db = createClient(supabaseUrl, serviceKey);

    const { character_id, mode, gem_key } = await req.json();
    if (!character_id || !mode) throw new Error("Missing character_id or mode");

    const { data: char, error: charErr } = await db
      .from("characters")
      .select("id, user_id, current_node_id")
      .eq("id", character_id)
      .single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== userId) throw new Error("Not authorized");

    const { data: node } = await db
      .from("nodes")
      .select("is_jewelcrafter")
      .eq("id", char.current_node_id)
      .single();
    if (!node?.is_jewelcrafter) throw new Error("You must be at a jewelcrafter to cut gems");

    if (mode === "trade_gem") {
      if (!gem_key || !PRIMARY_GEM_KEYS.includes(gem_key as GemKey)) {
        throw new Error("Pick a valid primary gem");
      }
      const cost = GEM_SALVAGE_COST_PRIMARY;

      const { data: salvageOk } = await db.rpc('consume_material', {
        _character_id: character_id, _key: 'salvage', _delta: cost,
      });
      if (!salvageOk) throw new Error("Not enough salvage");

      const { data: newCount } = await db.rpc('add_material', {
        _character_id: character_id, _key: gem_key, _delta: 1,
      });

      const { data: charAfter } = await db
        .from("characters").select("salvage").eq("id", character_id).single();

      return new Response(
        JSON.stringify({
          gem_key,
          gem_name: GEM_CATALOG[gem_key as GemKey].name,
          new_count: newCount,
          salvage_remaining: charAfter?.salvage ?? 0,
          salvage_spent: cost,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "combine_gem") {
      if (!gem_key || !HYBRID_GEM_KEYS.includes(gem_key as GemKey)) {
        throw new Error("Pick a valid hybrid gem");
      }
      const recipe = hybridRecipe(gem_key as GemKey);
      if (!recipe) throw new Error("Unknown hybrid recipe");
      const [a, b] = recipe;

      const { data: okA } = await db.rpc('consume_material', {
        _character_id: character_id, _key: a, _delta: 1,
      });
      if (!okA) {
        throw new Error(`Requires 1 ${GEM_CATALOG[a].name} and 1 ${GEM_CATALOG[b].name}`);
      }

      const { data: okB } = await db.rpc('consume_material', {
        _character_id: character_id, _key: b, _delta: 1,
      });
      if (!okB) {
        // Refund the first gem.
        await db.rpc('add_material', { _character_id: character_id, _key: a, _delta: 1 });
        throw new Error(`Requires 1 ${GEM_CATALOG[a].name} and 1 ${GEM_CATALOG[b].name}`);
      }

      const { data: newHybrid } = await db.rpc('add_material', {
        _character_id: character_id, _key: gem_key, _delta: 1,
      });

      return new Response(
        JSON.stringify({
          gem_key,
          gem_name: GEM_CATALOG[gem_key as GemKey].name,
          new_count: newHybrid,
          consumed: [
            { gem_key: a, name: GEM_CATALOG[a].name },
            { gem_key: b, name: GEM_CATALOG[b].name },
          ],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unknown mode: ${mode}`);
  } catch (e: any) {
    console.error("jewelcrafter-gemcutter error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
