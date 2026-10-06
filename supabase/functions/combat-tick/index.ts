/** Retired Combat1 endpoint: CORS preflight and build-stamped HTTP 410 only. */
import { corsHeaders } from "../_shared/http.ts";
import { EDGE_COMBAT_BUILD_ID, stampCombatBuild } from "../_shared/combat/build-identity.ts";

console.log('[combat-tick] boot', { serverBuild: EDGE_COMBAT_BUILD_ID });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify(stampCombatBuild({ ok: false, kind: 'legacy_retired' })), {
    status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
