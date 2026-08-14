/**
 * combat-catchup — thin shell over the C3 shared orchestration (catchup role).
 *
 * Identical pipeline to `combat-tick`; only the role differs. The role decides
 * which claim modes are acceptable (`effects_only`), which is what makes live
 * and catch-up mutually exclusive for one encounter: the claim is the single
 * point of authority and a catch-up sweep never creates an encounter.
 *
 * No simulation, no mutation, no legacy fallback lives here. Refusals return no
 * events at all.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, verifyUserIdFromJwt } from "../_shared/http.ts";
import { orchestrateCombatResolution } from "../_shared/combat/c3/orchestration.ts";
import { buildAbilityCatalog } from "../_shared/combat/c3-catalog.ts";
import { COMBAT_MAINTENANCE_MESSAGE } from "../_shared/combat/maintenance.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(kind: string, reason: string, status: number) {
  return new Response(JSON.stringify({ ok: false, kind, reason }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db = createClient(url, srvKey);

  try {
    const userId = await verifyUserIdFromJwt(req.headers.get('Authorization'), url, anonKey);
    if (!userId) return fail('unauthorized', 'invalid or missing token', 401);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail('invalid_request', 'body is not valid JSON', 400);
    }

    // Scope is server-derived. The caller may name a node, but it is only
    // honoured when `public.catchup_scope_check` places it inside the scope of
    // a character the caller actually owns (own node, a directly connected
    // node, or a node where the character still sources an active effect).
    // Neither a role nor a mode is ever accepted from the request body.
    const requestedNode = typeof body?.node_id === 'string' && UUID_RE.test(body.node_id)
      ? body.node_id
      : null;
    const characterId = typeof body?.character_id === 'string' && UUID_RE.test(body.character_id)
      ? body.character_id
      : null;
    if (!characterId) {
      return fail('invalid_request', 'character_id is required', 400);
    }

    const { data: scope, error: scopeErr } = await db.rpc('catchup_scope_check', {
      _user_id: userId,
      _character_id: characterId,
      _node_id: requestedNode,
    });
    if (scopeErr) return fail('internal', 'scope check failed', 200);
    const verdict = typeof scope === 'string' ? scope : 'out_of_scope';
    if (verdict === 'not_owned') {
      return fail('unauthorized', 'character does not belong to caller', 401);
    }
    if (!verdict.startsWith('ok:')) {
      return fail('forbidden', verdict, 403);
    }
    const nodeId = verdict.slice(3);

    const result = await orchestrateCombatResolution(
      { role: 'catchup', nodeId, characterId },
      {
        db,
        nowMs: Date.now(),
        catalog: await buildAbilityCatalog(db),
        refreshCatalog: () => buildAbilityCatalog(db, true),
        newBatchId: () => crypto.randomUUID(),
        caller: 'combat-catchup',
        log: (message, detail) => console.log(message, detail ?? ''),
      },
    );

    if (!result.ok && result.kind === 'maintenance') {
      return json({ ok: false, kind: 'maintenance', reason: COMBAT_MAINTENANCE_MESSAGE });
    }
    return json(result);
  } catch (e) {
    console.error('[combat-catchup] unhandled', e);
    return json({ ok: false, kind: 'internal', reason: e instanceof Error ? e.message : String(e) });
  }
});
