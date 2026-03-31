/**
 * combat-catchup: Sole authoritative offscreen effect reconciler.
 *
 * When a node is accessed, this function resolves all pending persistent effects
 * (poison, bleed, ignite) from timestamps, updates creature HP, cleans up expired
 * effects, and returns the already-reconciled creature state.
 *
 * OWNERSHIP:
 * - combat-catchup owns ALL offscreen persistent-effect resolution
 * - combat-tick only runs live combat while players are actively present
 * - Sessions do NOT persist offscreen — only active_effects do
 * - Any node creature-state read must reconcile effects first (no stale HP)
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

const TICK_CAP = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const t0 = Date.now();
    const url = Deno.env.get('SUPABASE_URL')!;
    const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(url, srvKey);

    const { node_id } = await req.json();
    if (!node_id) return json({ error: 'Missing node_id' }, 400);

    // Parallelize: fetch effects and creatures simultaneously
    const [{ data: effects }, { data: creaturesRaw }] = await Promise.all([
      db.from('active_effects').select('*').eq('node_id', node_id),
      db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true),
    ]);

    const creatures = creaturesRaw || [];

    if (!effects || effects.length === 0) {
      // No effects — return already-fetched creatures
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, effects_count: 0, effects_resolved: false,
        creatures_alive: creatures.length, duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: false, effects_processed: 0, creatures });
    }

    const now = Date.now();

    if (creatures.length === 0) {
      // No creatures alive — delete all effects for this node
      await db.from('active_effects').delete().eq('node_id', node_id);
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, effects_count: effects.length, effects_resolved: true,
        creatures_alive: 0, duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: true, effects_processed: effects.length });
    }

    const cHp: Record<string, number> = {};
    const cKilled = new Set<string>();
    for (const cr of creatures) cHp[cr.id] = cr.hp;

    // ── Resolve effects via shared resolver (bulk mode) ─────────
    const result = resolveEffectTicks(effects, cHp, cKilled, creatures, TICK_CAP, { now });

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

    // ── Diagnostics ───────────────────────────────────────────────
    console.log(JSON.stringify({
      fn: 'combat-catchup',
      node_id,
      effects_count: effects.length,
      effects_resolved: true,
      creatures_alive: finalCreatures.length,
      kills: cKilled.size,
      ticks_resolved: result.advancedEffects.length,
      duration_ms: Date.now() - t0,
    }));

    return json({ caught_up: true, effects_processed: effects.length, creatures: finalCreatures });
  } catch (err) {
    console.error('Combat catchup error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
