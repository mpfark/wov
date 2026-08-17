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

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Internal callers only.
 *
 * Three accepted proofs, in order of cost:
 *  1. the token IS this deployment's own service-role key;
 *  2. the token's SHA-256 matches the internal dispatcher credential stored in
 *     the database vault (server-side comparison, the secret never leaves the
 *     database and the token is never logged);
 *  3. the token is a JWT whose verified `role` claim is `service_role`.
 *
 * (2) exists because the dispatcher's vault credential is a legacy signing-key
 * JWT: `auth.getClaims` cannot verify it against the current JWKS, so the
 * dispatcher was rejected with 401 before the handler ever ran.
 */
async function internalCaller(
  authHeader: string | null,
  url: string,
  anonKey: string,
  srvKey: string,
  db: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
): Promise<'internal' | 'not_internal' | 'anonymous'> {
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return 'anonymous';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return 'anonymous';
  if (token === srvKey) return 'internal';
  try {
    const { data, error } = await db.rpc('effects_dispatch_token_check', {
      _token_sha256: await sha256Hex(token),
    });
    if (!error && data === true) return 'internal';
  } catch (e) {
    console.error('[combat-catchup] dispatcher credential check failed', e);
  }
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
    const caller = await internalCaller(req.headers.get('Authorization'), url, anonKey, srvKey, db);
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

    // ── Internal effects-only scope (encounter_id + node_id, no character) ──
    // The database dispatcher owns this path. It re-validates the scope at
    // request time, so a stale or superseded dispatch resolves nothing, and it
    // records the outcome so the lease is released the moment we finish.
    if (body?.scope === 'encounter') {
      const encounterId = typeof body?.encounter_id === 'string' && UUID_RE.test(body.encounter_id)
        ? body.encounter_id
        : null;
      const dispatchId = typeof body?.dispatch_id === 'string' && UUID_RE.test(body.dispatch_id)
        ? body.dispatch_id
        : null;
      if (!encounterId || !requestedNode || !dispatchId) {
        return fail('invalid_request', 'encounter scope requires encounter_id, node_id and dispatch_id', 400);
      }
      const startedAt = Date.now();
      const record = async (
        outcome: string,
        reason: string | null,
        ticks = 0,
        effects = 0,
        deaths = 0,
      ) => {
        try {
          await db.rpc('record_effects_catchup_result', {
            _dispatch_id: dispatchId,
            _encounter_id: encounterId,
            _outcome: outcome,
            _reason: reason,
            _ticks: ticks,
            _effects: effects,
            _deaths: deaths,
            _duration_ms: Date.now() - startedAt,
          });
        } catch (e) {
          console.error('[combat-catchup] result recording failed', e);
        }
      };

      const { data: scopeCheck, error: scopeCheckErr } = await db.rpc('effects_scope_revalidate', {
        _encounter_id: encounterId,
        _node_id: requestedNode,
        _due_at_ms: typeof body?.due_at_ms === 'number' ? body.due_at_ms : null,
      });
      if (scopeCheckErr) {
        await record('internal', 'revalidate failed');
        return fail('internal', 'scope revalidation failed', 200);
      }
      const scopeVerdict = typeof scopeCheck === 'string' ? scopeCheck : 'out_of_scope';
      if (!scopeVerdict.startsWith('ok')) {
        await record('refused', scopeVerdict);
        return json({ ok: false, kind: 'no_work', reason: scopeVerdict });
      }

      const internalResult = await orchestrateCombatResolution(
        {
          role: 'catchup',
          nodeId: requestedNode,
          encounterId,
          scopeGranted: scopeVerdict === 'ok:granted',
        },
        {
          db,
          nowMs: Date.now(),
          catalog: await buildAbilityCatalog(db),
          refreshCatalog: () => buildAbilityCatalog(db, true),
          newBatchId: () => crypto.randomUUID(),
          caller: 'combat-catchup:effects',
          log: (message, detail) => console.log(message, detail ?? ''),
        },
      );

      if (internalResult.ok) {
        // Counters come from the committed proposal (orchestration result), not
        // from grepping `events` for a `death` type — the resolver emits
        // `creature_killed`, so the old filter always reported deaths = 0.
        await record(
          'ok',
          null,
          internalResult.ticksProcessed,
          internalResult.events.length,
          internalResult.creatureDeaths,
        );
        console.log('[combat-catchup] effects tick committed', {
          encounterId,
          ticks: internalResult.ticksProcessed,
          creatureDeaths: internalResult.creatureDeaths,
          characterDeaths: internalResult.characterDeaths,
          rewarded: internalResult.rewardedCharacterIds,
        });
      } else {
        await record(internalResult.kind ?? 'internal', internalResult.reason ?? null);
      }

      return json(internalResult);
    }

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
