import { createClient } from "jsr:@supabase/supabase-js@2";

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

    // Query active effects for this node
    const { data: effects } = await db
      .from('active_effects')
      .select('*')
      .eq('node_id', node_id);

    if (!effects || effects.length === 0) {
      // No effects — still return creatures for the client
      const { data: aliveCreatures } = await db
        .from('creatures')
        .select('*')
        .eq('node_id', node_id)
        .eq('is_alive', true);
      return json({ caught_up: false, effects_processed: 0, creatures: aliveCreatures || [] });
    }

    const now = Date.now();

    // Load alive creatures at this node
    const { data: creaturesRaw } = await db
      .from('creatures')
      .select('*')
      .eq('node_id', node_id)
      .eq('is_alive', true);

    const creatures = creaturesRaw || [];
    if (creatures.length === 0) {
      // No creatures alive — delete all effects for this node
      await db.from('active_effects').delete().eq('node_id', node_id);
      return json({ caught_up: true, effects_processed: effects.length });
    }

    const cHp: Record<string, number> = {};
    const cKilled = new Set<string>();
    for (const cr of creatures) cHp[cr.id] = cr.hp;

    const expiredIds: string[] = [];
    const killedTargetIds = new Set<string>();
    const lootQueue: { nodeId: string; lootTableId: string | null; itemId: string | null; creatureName: string; dropChance: number }[] = [];

    // Process each effect independently
    for (const eff of effects) {
      if (cKilled.has(eff.target_id) || cHp[eff.target_id] === undefined) {
        expiredIds.push(eff.id);
        continue;
      }

      // Calculate ticks for this effect
      const elapsedMs = now - eff.next_tick_at;
      if (elapsedMs < 0) continue; // Not due yet

      const ticksToProcess = Math.floor(elapsedMs / eff.tick_rate_ms) + 1;
      const maxTicksByExpiry = Math.max(0, Math.floor((eff.expires_at - eff.next_tick_at) / eff.tick_rate_ms) + 1);
      const ticks = Math.min(ticksToProcess, TICK_CAP, maxTicksByExpiry);

      if (ticks <= 0) {
        if (now >= eff.expires_at) expiredIds.push(eff.id);
        continue;
      }

      // Tick loop for this effect
      for (let t = 0; t < ticks; t++) {
        const tickTime = eff.next_tick_at + t * eff.tick_rate_ms;
        if (tickTime > eff.expires_at) break;
        if (cKilled.has(eff.target_id) || cHp[eff.target_id] <= 0) break;

        const totalDmg = (eff.effect_type === 'bleed') ? eff.damage_per_tick : eff.stacks * eff.damage_per_tick;
        cHp[eff.target_id] = Math.max(cHp[eff.target_id] - totalDmg, 0);

        if (cHp[eff.target_id] <= 0 && !cKilled.has(eff.target_id)) {
          cKilled.add(eff.target_id);
          killedTargetIds.add(eff.target_id);
          const creature = creatures.find(cr => cr.id === eff.target_id);
          if (creature) {
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
          }
        }
      }

      // Update or expire the effect
      const newNextTickAt = eff.next_tick_at + ticks * eff.tick_rate_ms;
      if (newNextTickAt >= eff.expires_at || cKilled.has(eff.target_id)) {
        expiredIds.push(eff.id);
      } else {
        await db.from('active_effects').update({ next_tick_at: newNextTickAt }).eq('id', eff.id);
      }
    }

    // Write creature HP / kills
    const creaturePromises = creatures.map(cr => {
      if (cKilled.has(cr.id)) {
        return db.rpc('damage_creature', { _creature_id: cr.id, _new_hp: 0, _killed: true });
      } else if (cHp[cr.id] !== cr.hp) {
        return db.rpc('damage_creature', { _creature_id: cr.id, _new_hp: cHp[cr.id] });
      }
      return Promise.resolve();
    });
    await Promise.all(creaturePromises);

    // Delete expired/killed effects
    if (expiredIds.length > 0) {
      await db.from('active_effects').delete().in('id', expiredIds);
    }
    // Also delete any effects targeting killed creatures (from other sources)
    if (killedTargetIds.size > 0) {
      await db.from('active_effects').delete().in('target_id', [...killedTargetIds]);
    }

    // Loot drops
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

    // Clean up orphaned combat sessions at this node if no effects remain
    const { count: remainingEffects } = await db.from('active_effects')
      .select('id', { count: 'exact', head: true })
      .eq('node_id', node_id);
    if ((remainingEffects || 0) === 0) {
      // Check for sessions with no engaged creatures at this node
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

    return json({ caught_up: true, effects_processed: effects.length, creatures: finalCreatures });
  } catch (err) {
    console.error('Combat catchup error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
