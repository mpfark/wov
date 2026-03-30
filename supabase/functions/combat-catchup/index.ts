/**
 * combat-catchup: Resolves pending DoT/effect damage when a player enters a node.
 * Uses the shared combat resolver for effect processing, loot, creature writes, and cleanup.
 * `active_effects` table is the sole source of truth for all DoT state.
 *
 * TIMELINE OWNERSHIP:
 * - combat-catchup owns offscreen effect resolution AND updates combat_sessions.last_tick_at
 * - combat-tick must never see a stale last_tick_at for a session that catchup already resolved
 * - If effects have null session_id, catchup falls back to updating ALL sessions at the node
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
        fn: 'combat-catchup', node_id, effects_count: 0,
        creatures_alive: creatures.length, duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: false, effects_processed: 0, creatures });
    }

    const now = Date.now();

    if (creatures.length === 0) {
      // No creatures alive — delete all effects for this node
      await db.from('active_effects').delete().eq('node_id', node_id);
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, effects_count: effects.length,
        creatures_alive: 0, duration_ms: Date.now() - t0,
      }));
      return json({ caught_up: true, effects_processed: effects.length });
    }

    const cHp: Record<string, number> = {};
    const cKilled = new Set<string>();
    for (const cr of creatures) cHp[cr.id] = cr.hp;

    // ── Resolve effects via shared resolver (bulk mode) ─────────
    const result = resolveEffectTicks(effects, cHp, cKilled, creatures, TICK_CAP, { now });

    // ── Parallel post-resolution writes ─────────────────────────
    const effectSessionIds = [...new Set(effects.map((e: any) => e.session_id).filter(Boolean))] as string[];
    const nullSessionEffects = effects.filter((e: any) => !e.session_id).length;

    // Fallback: if any effects have null session_id, also find all sessions at this node
    const { data: nodeSessions } = await db.from('combat_sessions')
      .select('id, last_tick_at')
      .eq('node_id', node_id);
    const sessionLastTickBefore: Record<string, number> = {};
    const allSessionIds = new Set(effectSessionIds);
    for (const s of (nodeSessions || [])) {
      sessionLastTickBefore[s.id] = s.last_tick_at;
      allSessionIds.add(s.id);
    }
    const finalSessionIds = [...allSessionIds];

    await Promise.all([
      writeCreatureState(db, creatures, cHp, cKilled),
      finalSessionIds.length > 0
        ? db.from('combat_sessions').update({ last_tick_at: now }).in('id', finalSessionIds)
        : Promise.resolve(),
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

    // ── Clean up orphaned combat sessions at this node ──────────
    const { count: remainingEffects } = await db.from('active_effects')
      .select('id', { count: 'exact', head: true })
      .eq('node_id', node_id);
    if ((remainingEffects || 0) === 0) {
      const { data: sessions } = await db.from('combat_sessions')
        .select('id, engaged_creature_ids')
        .eq('node_id', node_id);
      for (const sess of (sessions || [])) {
        if ((sess.engaged_creature_ids || []).length === 0) {
          await db.from('combat_sessions').delete().eq('id', sess.id);
        }
      }
    }

    // Build final creature list: alive creatures with updated HP
    const finalCreatures = creatures
      .filter(cr => !cKilled.has(cr.id))
      .map(cr => ({ ...cr, hp: cHp[cr.id] ?? cr.hp }));

    // ── Diagnostics ───────────────────────────────────────────────
    console.log(JSON.stringify({
      fn: 'combat-catchup',
      node_id,
      effects_count: effects.length,
      null_session_effects: nullSessionEffects,
      creatures_alive: finalCreatures.length,
      kills: cKilled.size,
      ticks_resolved: result.advancedEffects.length,
      effect_session_ids: effectSessionIds,
      fallback_session_ids: finalSessionIds.filter(id => !effectSessionIds.includes(id)),
      session_last_tick_before: sessionLastTickBefore,
      session_last_tick_after: now,
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
