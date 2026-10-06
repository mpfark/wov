// Prepared ENG-PROGRESSION-001D completion pause. Undeployed.
// Re-enable only with reviewed atomic canonical crafting progression.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({ code: "crafting_paused", error: "Crafting is temporarily unavailable." }), {
    status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
