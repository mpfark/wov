/**
 * combat-catchup — thin shell over the C3 shared orchestration (catchup role).
 *
 * INTERNAL ENDPOINT. Ordinary clients may not resolve authoritative ticks here.
 * The only accepted callers are internal ones presenting a service-role
 * credential (the service-role key, or any JWT whose `role` claim is
 * `service_role`) — i.e. the scheduler / world-wake path and internal harnesses.
 * `verify_jwt` stays false so an internal caller may present the service-role
 * key directly; the check below is the real gate and it fails closed.
 *
 * Scope is still server-derived: the caller names a character, the character's
 * OWNER is read from the database, and `public.catchup_scope_check` decides the
 * single node this invocation may sweep. Neither role nor mode is ever accepted
 * from the request body.
 *
 * No simulation, no mutation, no legacy fallback lives here. Refusals return no
 * events at all.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";
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

/** Internal callers only: a verified `service_role` credential, nothing else. */
async function internalCaller(
  authHeader: string | null,
  url: string,
  anonKey: string,
  srvKey: string,
): Promise<'internal' | 'not_internal' | 'anonymous'> {
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return 'anonymous';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return 'anonymous';
  if (token === srvKey) return 'internal';
  try {
    const c = createClient(url, anonKey);
    const { data, error } = await c.auth.getClaims(token);
    if (error || !data?.claims) return 'anonymous';
    return data.claims.role === 'service_role' ? 'internal' : 'not_internal';
  } catch {
    return 'anonymous';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db = createClient(url, srvKey);

  try {
    const caller = await internalCaller(req.headers.get('Authorization'), url, anonKey, srvKey);
    if (caller === 'anonymous') {
      return fail('unauthorized', 'missing or invalid credential', 401);
    }
    if (caller !== 'internal') {
      return fail('forbidden', 'combat-catchup is an internal service-role endpoint', 403);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail('invalid_request', 'body is not valid JSON', 400);
    }

    const requestedNode = typeof body?.node_id === 'string' && UUID_RE.test(body.node_id)
      ? body.node_id
      : null;
    const characterId = typeof body?.character_id === 'string' && UUID_RE.test(body.character_id)
      ? body.character_id
      : null;
    if (!characterId) {
      return fail('invalid_request', 'character_id is required', 400);
    }

    // The owner is read from the database, never from the request.
    const { data: charRow, error: charErr } = await db
      .from('characters')
      .select('user_id')
      .eq('id', characterId)
      .maybeSingle();
    if (charErr) return fail('internal', 'character lookup failed', 200);
    if (!charRow?.user_id) return fail('invalid_request', 'unknown character', 400);

    const { data: scope, error: scopeErr } = await db.rpc('catchup_scope_check', {
      _user_id: charRow.user_id,
      _character_id: characterId,
      _node_id: requestedNode,
    });
    if (scopeErr) return fail('internal', 'scope check failed', 200);
    const verdict = typeof scope === 'string' ? scope : 'out_of_scope';
    if (!verdict.startsWith('ok:')) {
      return fail('forbidden', verdict, 403);
    }
    const nodeId = verdict.slice(3);

    // `role` is hard-coded: a caller can never ask for live authority.
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
