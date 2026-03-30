import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  XP_RARITY_MULTIPLIER as XP_RARITY,
  getXpPenalty as xpPenalty,
  getChaGoldMultiplier as chaGoldMult,
} from "../_shared/combat-math.ts";

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

const TICK_RATE = 2000;
const TICK_CAP = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(url, srvKey);

    const { node_id } = await req.json();
    if (!node_id) return json({ error: 'Missing node_id' }, 400);

    // Find all active combat sessions for this node
    const { data: sessions } = await db
      .from('combat_sessions')
      .select('*')
      .eq('node_id', node_id);

    if (!sessions || sessions.length === 0) {
      return json({ caught_up: false, sessions_processed: 0 });
    }

    const now = Date.now();
    let sessionsProcessed = 0;

    for (const session of sessions) {
      const sessionDots: Record<string, any> = session.dots || {};

      // Check if there are any active DoTs
      const hasActiveDots = Object.values(sessionDots).some((charDots: any) =>
        Object.keys(charDots?.bleed || {}).length > 0 ||
        Object.keys(charDots?.poison || {}).length > 0 ||
        Object.keys(charDots?.ignite || {}).length > 0
      );

      const hasEngaged = (session.engaged_creature_ids || []).length > 0;

      if (!hasActiveDots && !hasEngaged) {
        // Dead session — clean up
        await db.from('combat_sessions').delete().eq('id', session.id);
        sessionsProcessed++;
        continue;
      }

      if (!hasActiveDots) {
        // Has engaged creatures but no DoTs — nothing for catch-up to process
        continue;
      }

      // Calculate ticks
      const elapsedMs = now - session.last_tick_at;
      const ticksToProcess = Math.floor(elapsedMs / TICK_RATE);
      const ticks = Math.min(ticksToProcess, TICK_CAP);

      if (ticks === 0) continue;

      // Load creatures at this node
      const { data: creaturesRaw } = await db
        .from('creatures')
        .select('*')
        .eq('node_id', node_id)
        .eq('is_alive', true);

      const creatures = creaturesRaw || [];
      if (creatures.length === 0) {
        await db.from('combat_sessions').delete().eq('id', session.id);
        sessionsProcessed++;
        continue;
      }

      const cHp: Record<string, number> = {};
      const cKilled = new Set<string>();
      for (const cr of creatures) cHp[cr.id] = cr.hp;

      const sessionEngaged = new Set<string>(session.engaged_creature_ids || []);
      const lootQueue: { nodeId: string; lootTableId: string | null; itemId: string | null; creatureName: string; dropChance: number }[] = [];

      // Kill handler (simplified — no XP/gold since no player is present to receive it)
      const handleCreatureKill = (creature: any) => {
        cKilled.add(creature.id);
        sessionEngaged.delete(creature.id);
        // Purge all DoTs targeting this creature
        for (const [_charId, charDots] of Object.entries(sessionDots)) {
          if ((charDots as any)?.bleed?.[creature.id]) delete (charDots as any).bleed[creature.id];
          if ((charDots as any)?.poison?.[creature.id]) delete (charDots as any).poison[creature.id];
          if ((charDots as any)?.ignite?.[creature.id]) delete (charDots as any).ignite[creature.id];
        }
        // Queue loot drops
        if (creature.loot_table_id) {
          lootQueue.push({ nodeId: node_id, lootTableId: creature.loot_table_id, itemId: null, creatureName: creature.name, dropChance: creature.drop_chance ?? 0.5 });
        } else {
          const lt = (creature.loot_table || []) as any[];
          for (const entry of lt) {
            if (entry.type === 'gold') continue;
            if (Math.random() <= (entry.chance || 0.1)) {
              lootQueue.push({ nodeId: node_id, lootTableId: null, itemId: entry.item_id, creatureName: creature.name, dropChance: 1 });
            }
          }
        }
      };

      const previousLastTickAt = session.last_tick_at;

      // ── Tick loop (DoT only) ──────────────────────────────────
      for (let t = 0; t < ticks; t++) {
        const tickTime = previousLastTickAt + (t + 1) * TICK_RATE;

        for (const [_charId, charDots] of Object.entries(sessionDots)) {
          // Bleed
          if (charDots.bleed) {
            for (const [creatureId, bs] of Object.entries(charDots.bleed as Record<string, any>)) {
              if (cKilled.has(creatureId) || cHp[creatureId] === undefined || cHp[creatureId] <= 0) continue;
              const creature = creatures.find(cr => cr.id === creatureId);
              if (!creature) continue;

              if (bs.expires_at <= tickTime) {
                delete charDots.bleed[creatureId];
                continue;
              }
              if (bs.next_tick_at <= tickTime) {
                cHp[creatureId] = Math.max(cHp[creatureId] - bs.damage_per_tick, 0);
                bs.next_tick_at += TICK_RATE;
                if (cHp[creatureId] <= 0 && !cKilled.has(creatureId)) {
                  handleCreatureKill(creature);
                }
              }
            }
          }

          // Poison
          if (charDots.poison) {
            for (const [creatureId, ps] of Object.entries(charDots.poison as Record<string, any>)) {
              if (cKilled.has(creatureId) || cHp[creatureId] === undefined || cHp[creatureId] <= 0) continue;
              const creature = creatures.find(cr => cr.id === creatureId);
              if (!creature) continue;

              if (ps.expires_at <= tickTime) {
                delete charDots.poison[creatureId];
                continue;
              }
              if (ps.next_tick_at <= tickTime) {
                const totalDmg = ps.stacks * ps.damage_per_tick;
                cHp[creatureId] = Math.max(cHp[creatureId] - totalDmg, 0);
                ps.next_tick_at += TICK_RATE;
                if (cHp[creatureId] <= 0 && !cKilled.has(creatureId)) {
                  handleCreatureKill(creature);
                }
              }
            }
          }

          // Ignite
          if (charDots.ignite) {
            for (const [creatureId, is_] of Object.entries(charDots.ignite as Record<string, any>)) {
              if (cKilled.has(creatureId) || cHp[creatureId] === undefined || cHp[creatureId] <= 0) continue;
              const creature = creatures.find(cr => cr.id === creatureId);
              if (!creature) continue;

              if (is_.expires_at <= tickTime) {
                delete charDots.ignite[creatureId];
                continue;
              }
              if (is_.next_tick_at <= tickTime) {
                const totalDmg = is_.stacks * is_.damage_per_tick;
                cHp[creatureId] = Math.max(cHp[creatureId] - totalDmg, 0);
                is_.next_tick_at += TICK_RATE;
                if (cHp[creatureId] <= 0 && !cKilled.has(creatureId)) {
                  handleCreatureKill(creature);
                }
              }
            }
          }
        }
      } // end tick loop

      // ── Deterministic last_tick_at ────────────────────────────
      const newLastTickAt = previousLastTickAt + ticks * TICK_RATE;

      // ── Write creature HP / kills ─────────────────────────────
      const creaturePromises = creatures.map(cr => {
        if (cKilled.has(cr.id)) {
          return db.rpc('damage_creature', { _creature_id: cr.id, _new_hp: 0, _killed: true });
        } else if (cHp[cr.id] !== cr.hp) {
          return db.rpc('damage_creature', { _creature_id: cr.id, _new_hp: cHp[cr.id] });
        }
        return Promise.resolve();
      });
      await Promise.all(creaturePromises);

      // ── Loot drops ────────────────────────────────────────────
      for (const drop of lootQueue) {
        try {
          if (drop.lootTableId) {
            if (Math.random() > drop.dropChance) continue;
            const { data: entries } = await db.from('loot_table_entries').select('item_id, weight').eq('loot_table_id', drop.lootTableId);
            if (!entries || entries.length === 0) continue;
            const totalW = entries.reduce((s, e) => s + e.weight, 0);
            let r = Math.random() * totalW;
            let picked: string | null = null;
            for (const e of entries) { r -= e.weight; if (r <= 0) { picked = e.item_id; break; } }
            if (!picked) picked = entries[entries.length - 1].item_id;
            const { data: item } = await db.from('items').select('name, rarity').eq('id', picked).single();
            if (!item) continue;
            if (item.rarity === 'unique') {
              const { count } = await db.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', picked);
              if (count && count > 0) continue;
            }
            await db.from('node_ground_loot').insert({ node_id: drop.nodeId, item_id: picked, creature_name: drop.creatureName });
          } else if (drop.itemId) {
            const { data: item } = await db.from('items').select('name, rarity').eq('id', drop.itemId).single();
            if (!item) continue;
            if (item.rarity === 'unique') {
              const { count } = await db.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', drop.itemId);
              if (count && count > 0) continue;
            }
            await db.from('node_ground_loot').insert({ node_id: drop.nodeId, item_id: drop.itemId, creature_name: drop.creatureName });
          }
        } catch (e) {
          console.error('Catchup loot drop error:', e);
        }
      }

      // ── Update or delete session ──────────────────────────────
      const stillHasActiveDots = Object.values(sessionDots).some((charDots: any) =>
        Object.keys(charDots?.bleed || {}).length > 0 ||
        Object.keys(charDots?.poison || {}).length > 0 ||
        Object.keys(charDots?.ignite || {}).length > 0
      );
      const anyAlive = creatures.some(cr => !cKilled.has(cr.id) && cHp[cr.id] > 0);

      if (!anyAlive || (!stillHasActiveDots && sessionEngaged.size === 0)) {
        await db.from('combat_sessions').delete().eq('id', session.id);
      } else {
        await db.from('combat_sessions').update({
          last_tick_at: newLastTickAt,
          engaged_creature_ids: [...sessionEngaged],
          dots: sessionDots,
        }).eq('id', session.id);
      }

      sessionsProcessed++;
    }

    return json({ caught_up: sessionsProcessed > 0, sessions_processed: sessionsProcessed });
  } catch (err) {
    console.error('Combat catchup error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
