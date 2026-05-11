// Sells a stack of a tradeable material (e.g. salvage) for gold using the
// unified materials helpers. Atomic: consumes the material first, then
// credits gold; refunds the material if the gold update fails.
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

    const { character_id, material_key, amount } = await req.json();
    if (!character_id || !material_key) throw new Error("Missing parameters");
    const qty = Math.floor(Number(amount));
    if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid amount");

    // Verify ownership
    const { data: char, error: charErr } = await adminClient
      .from("characters")
      .select("id, user_id, gold")
      .eq("id", character_id)
      .single();
    if (charErr || !char) throw new Error("Character not found");
    if (char.user_id !== user.id) throw new Error("Forbidden");

    // Verify the material is sellable (tradeable + has a value floor).
    const { data: mat } = await adminClient
      .from("materials")
      .select("key, name, value, tradeable")
      .eq("key", material_key)
      .single();
    if (!mat) throw new Error("Unknown material");
    if (!mat.tradeable) throw new Error(`${mat.name} is not tradeable`);

    // Vendors pay 1 gold per salvage today; future materials use the catalog value.
    const pricePer = material_key === "salvage" ? 1 : Math.max(0, mat.value || 0);
    const goldGain = pricePer * qty;
    if (goldGain <= 0) throw new Error("Material has no vendor value");

    // Atomic consume; fails loudly if the player doesn't actually own that many.
    const { error: consumeErr } = await adminClient.rpc("consume_material", {
      _character_id: character_id,
      _key: material_key,
      _delta: qty,
    });
    if (consumeErr) throw new Error(consumeErr.message);

    const newGold = (char.gold || 0) + goldGain;
    const { error: goldErr } = await adminClient
      .from("characters")
      .update({ gold: newGold })
      .eq("id", character_id);
    if (goldErr) {
      // Refund — keep the player whole if the gold write fails.
      await adminClient.rpc("add_material", {
        _character_id: character_id,
        _key: material_key,
        _delta: qty,
      });
      throw new Error(goldErr.message);
    }

    return new Response(
      JSON.stringify({
        gold_remaining: newGold,
        gold_gained: goldGain,
        amount_sold: qty,
        material_key,
        material_name: mat.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
