// Atomic sale RPC; only explicit post-replay SQL refusals prove this UUID has not committed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { character_id, material_key, amount, request_id } = await req.json();
    if (!character_id || !material_key || !request_id) throw new Error("Missing parameters");
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 2147483647) throw new Error("Invalid amount");
    const { data, error } = await adminClient.rpc("material_sale_internal", {
      _actor: user.id, _character_id: character_id, _key: material_key,
      _amount: amount, _request_id: request_id,
    });
    if (error) {
      const definitive = error.code === 'P0001' && [
        'material_not_tradeable', 'sale_gold_bounds', 'insufficient_materials',
        'material_consume_refused', 'material_consume_drift', 'sale_credit_failed', 'sale_receipt_failed',
      ].includes(error.message);
      // These occur only after the SQL replay lookup found no prior committed receipt.
      return new Response(JSON.stringify({ error: error.message, request_id,
        sale_outcome: definitive ? 'not_committed' : 'uncertain' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!data || data.error || !Number.isInteger(data.gold_remaining)) throw new Error("Sale refused");
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
