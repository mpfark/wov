/**
 * combat-catchup: Authoritative offscreen effect reconciler.
 *
 * Resolves all pending persistent effects (poison, bleed, ignite) from timestamps,
 * updates creature HP, cleans up expired effects, and returns fully reconciled creature state.
 *
 * OWNERSHIP:
 * - combat-catchup owns ALL offscreen persistent-effect resolution
 * - combat-tick only runs live combat while players are actively present
 * - Sessions do NOT persist offscreen — only active_effects do
 * - Any node creature-state read must reconcile effects first (no stale HP)
 *
 * WAKE-UP POLICY:
 * - Clients may request reconciliation for current, adjacent (if effects exist), or party leader nodes
 * - Clients send only { node_id } — no damage, timing, or tick data
 * - Server recalculates everything from stored effect data
 * - Best-effort per-isolate throttle skips reprocessing if recently reconciled (optimization only)
 * - Correctness relies on idempotent reconciliation + client-side 10s throttle
 *
 * PARTIAL RESOLUTION:
 * - A 3s wall-clock safety limit exists as emergency fallback only
 * - If triggered, returns { partial: true } so clients can retry
 * - Under normal gameplay this should never fire — logged aggressively as a warning
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  resolveEffectTicks,
  processLootDrops,
  writeCreatureState,
  cleanupEffects,
} from "../_shared/combat-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Defensive safeguard only — correctness comes from resolving all elapsed time.
// Under normal gameplay (2s tick, minutes away), real tick counts are ~150-300.
// 1000 is a safety cap for pathological data, NOT a design limit.
const TICK_CAP = 1000;

// Wall-clock emergency limit (ms). If processing exceeds this, write partial results
// and return partial: true so the client can retry. Should never fire in normal play.
const WALL_CLOCK_LIMIT_MS = 3000;

// Best-effort per-isolate throttle (optimization only, not a correctness guarantee).
// May be evicted on cold starts or isolate recycling.
const recentReconcileMap = new Map<string, number>();
const THROTTLE_MS = 10_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const t0 = Date.now();
    const url = Deno.env.get('SUPABASE_URL')!;
    const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(url, srvKey);

    const { node_id, force, reason } = await req.json();
    if (!node_id) return json({ error: 'Missing node_id' }, 400);

    // Best-effort throttle: skip effect reprocessing if recently reconciled.
    // Always return fresh creature data (never stale cache).
    // Skip throttle when force=true (node-entry).
    const lastReconcile = recentReconcileMap.get(node_id);
    const throttled = !force && lastReconcile && (Date.now() - lastReconcile < THROTTLE_MS);

    if (throttled) {
      const { data: creatures } = await db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true);
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, throttled: true, creatures_alive: (creatures || []).length,
        duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: false, effects_processed: 0, creatures: creatures || [], partial: false });
    }

    // Parallelize: fetch effects and creatures simultaneously
    const [{ data: effects }, { data: creaturesRaw }] = await Promise.all([
      db.from('active_effects').select('*').eq('node_id', node_id),
      db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true),
    ]);

    const creatures = creaturesRaw || [];

    if (!effects || effects.length === 0) {
      recentReconcileMap.set(node_id, Date.now());
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, effects_count: 0, effects_resolved: false,
        creatures_alive: creatures.length, duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: false, effects_processed: 0, creatures, partial: false });
    }

    const now = Date.now();

    if (creatures.length === 0) {
      // No creatures alive — delete all effects for this node
      await db.from('active_effects').delete().eq('node_id', node_id);
      recentReconcileMap.set(node_id, Date.now());
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, effects_count: effects.length, effects_resolved: true,
        creatures_alive: 0, duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: true, effects_processed: effects.length, partial: false });
    }

    const cHp: Record<string, number> = {};
    const cKilled = new Set<string>();
    for (const cr of creatures) cHp[cr.id] = cr.hp;

    // ── Resolve effects via shared resolver (bulk mode) ─────────
    const result = resolveEffectTicks(effects, cHp, cKilled, creatures, TICK_CAP, { now });

    // Check wall-clock safety limit after resolution
    const resolveElapsed = Date.now() - t0;
    const isPartial = resolveElapsed > WALL_CLOCK_LIMIT_MS;

    if (isPartial) {
      console.warn(JSON.stringify({
        fn: 'combat-catchup', node_id, partial_resolution: true,
        elapsed_ms: resolveElapsed, effects_count: effects.length,
        ticks_completed: result.advancedEffects.length, kills: cKilled.size,
      }));
    }

    // ── Write creature state + cleanup effects in parallel ──────
    await Promise.all([
      writeCreatureState(db, creatures, cHp, cKilled),
      cleanupEffects(db, result.expiredIds, cKilled),
    ]);

    // ── Update advanced effects' next_tick_at (parallel) ────────
    if (result.advancedEffects.length > 0) {
      await Promise.all(
        result.advancedEffects.map(eff =>
          db.from('active_effects').update({ next_tick_at: eff.next_tick_at }).eq('id', eff.id)
        )
      );
    }

    // ── Loot drops (shared resolver) ────────────────────────────
    await processLootDrops(db, result.lootQueue);

    // Build final creature list: alive creatures with updated HP
    const finalCreatures = creatures
      .filter(cr => !cKilled.has(cr.id))
      .map(cr => ({ ...cr, hp: cHp[cr.id] ?? cr.hp }));

    recentReconcileMap.set(node_id, Date.now());

    // ── Diagnostics ───────────────────────────────────────────────
    console.log(JSON.stringify({
      fn: 'combat-catchup',
      node_id,
      effects_count: effects.length,
      effects_resolved: true,
      creatures_alive: finalCreatures.length,
      kills: cKilled.size,
      ticks_resolved: result.advancedEffects.length,
      partial: isPartial,
      duration_ms: Date.now() - t0,
    }));

    return json({ caught_up: true, effects_processed: effects.length, creatures: finalCreatures, partial: isPartial });
  } catch (err) {
    console.error('Combat catchup error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
