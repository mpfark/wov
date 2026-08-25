/**
 * combat-tick — thin shell over the C3 shared orchestration (live role).
 *
 * This function contains NO simulation and NO mutation. It only:
 *   1. answers CORS preflight,
 *   2. verifies the caller's JWT and that the character belongs to them,
 *   3. validates the request body,
 *   4. invokes `orchestrateCombatResolution` with role `live`,
 *   5. returns the committed batch (or a refusal carrying no events).
 *
 * Every legacy execution path (roster loads, dice, damage math, direct writes,
 * broadcast of uncommitted results) has been removed — not disabled. The pure
 * resolver decides outcomes and `commit_encounter_tick_v2` is the only writer.
 *
 * Maintenance: the orchestration reads `combat_config.combat_mode` first and
 * fails closed; the handler simply forwards that refusal.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json as rawJson, verifyUserIdFromJwt } from "../_shared/http.ts";
import { EDGE_COMBAT_BUILD_ID, stampCombatBuild } from "../_shared/combat/build-identity.ts";
import { orchestrateCombatResolution } from "../_shared/combat/c3/orchestration.ts";
import { buildAbilityCatalog } from "../_shared/combat/c3-catalog.ts";
import { COMBAT_MAINTENANCE_MESSAGE } from "../_shared/combat/maintenance.ts";

/** Every response leaves through here, so none can omit the build identity. */
function json(data: unknown) {
  return rawJson(stampCombatBuild(data));
}

function badRequest(reason: string) {
  return new Response(JSON.stringify(stampCombatBuild({ ok: false, kind: 'invalid_request', reason })), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function unauthorized(reason: string) {
  return new Response(JSON.stringify(stampCombatBuild({ ok: false, kind: 'unauthorized', reason })), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

console.log('[combat-tick] boot', { serverBuild: EDGE_COMBAT_BUILD_ID });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db = createClient(url, srvKey);

  try {
    const userId = await verifyUserIdFromJwt(req.headers.get('Authorization'), url, anonKey);
    if (!userId) return unauthorized('invalid or missing token');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest('body is not valid JSON');
    }

    const characterId = typeof body?.character_id === 'string' ? body.character_id : null;
    if (!characterId || !UUID_RE.test(characterId)) {
      return badRequest('character_id is required and must be a uuid');
    }

    const creatureIds: string[] = Array.isArray(body?.engaged_creature_ids)
      ? body.engaged_creature_ids.filter((v: unknown) => typeof v === 'string' && UUID_RE.test(v))
      : [];

    // Ownership: a caller may only drive their own character's encounter.
    const { data: owned, error: ownErr } = await db
      .from('characters')
      .select('id')
      .eq('id', characterId)
      .eq('user_id', userId)
      .maybeSingle();
    if (ownErr) return json({ ok: false, kind: 'internal', reason: 'ownership check failed' });
    if (!owned) return unauthorized('character does not belong to caller');

    const result = await orchestrateCombatResolution(
      { role: 'live', characterId, creatureIds },
      {
        db,
        nowMs: Date.now(),
        catalog: await buildAbilityCatalog(db),
        refreshCatalog: () => buildAbilityCatalog(db, true),
        newBatchId: () => crypto.randomUUID(),
        caller: 'combat-tick',
        log: (message, detail) => console.log(message, detail ?? ''),
      },
    );

    if (!result.ok && result.kind === 'maintenance') {
      return json({ ok: false, kind: 'maintenance', reason: COMBAT_MAINTENANCE_MESSAGE });
    }
    return json(result);
  } catch (e) {
    console.error('[combat-tick] unhandled', e);
    return json({ ok: false, kind: 'internal', reason: e instanceof Error ? e.message : String(e) });
  }
});
