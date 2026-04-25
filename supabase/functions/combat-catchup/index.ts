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
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveEffectTicks,
  processLootDrops,
  writeCreatureState,
  cleanupEffects,
} from "../_shared/combat-resolver.ts";
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const db = createClient(url, srvKey);

    // ── Authentication ────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const userDb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userDb.auth.getClaims(
      authHeader.replace('Bearer ', '')
    );
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const { node_id, force, reason, snapshot_only } = await req.json();
    if (!node_id) return json({ error: 'Missing node_id' }, 400);

    // ── Node proximity check ──────────────────────────────────────
    // Caller must have a character at, or adjacent to, the requested node.
    const { data: callerChars } = await db
      .from('characters')
      .select('id, current_node_id')
      .eq('user_id', userId);

    if (!callerChars || callerChars.length === 0) {
      return json({ error: 'No characters found' }, 403);
    }

    const callerNodeIds = new Set(
      callerChars.map((c: any) => c.current_node_id).filter(Boolean)
    );

    let authorized = callerNodeIds.has(node_id);

    if (!authorized) {
      // Check adjacency in both directions:
      // 1. Target node's connections contain a caller node
      // 2. Any caller node's connections contain the target node
      const nodeIdsToCheck = [node_id, ...callerNodeIds];
      const { data: nodesData } = await db
        .from('nodes')
        .select('id, connections')
        .in('id', nodeIdsToCheck);

      if (nodesData) {
        const extractConnIds = (conns: any) =>
          (conns as any[] || []).map((c: any) =>
            typeof c === 'string' ? c : c.id ?? c.node_id
          ).filter(Boolean);

        for (const n of nodesData) {
          const connIds = extractConnIds(n.connections);
          if (n.id === node_id) {
            // Target node connects to one of caller's nodes
            for (const nid of callerNodeIds) {
              if (connIds.includes(nid)) { authorized = true; break; }
            }
          } else {
            // Caller's node connects to target node
            if (connIds.includes(node_id)) { authorized = true; }
          }
          if (authorized) break;
        }
      }
    }

    if (!authorized) {
      // Return empty result instead of 403 — this is a benign race from
      // adjacent-node prefetch / offscreen wakeup after character moved away.
      return json({ creatures: [], skipped: 'not_adjacent' });
    }

    // Snapshot-only mode: return raw effects + creatures without resolving
    if (snapshot_only) {
      const [{ data: effects }, { data: creatures }] = await Promise.all([
        db.from('active_effects').select('target_id, effect_type, damage_per_tick, stacks, next_tick_at, expires_at, tick_rate_ms').eq('node_id', node_id),
        db.from('creatures').select('id, hp, max_hp').eq('node_id', node_id).eq('is_alive', true),
      ]);
      return json({ effects: effects || [], creatures: creatures || [] });
    }

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

    // Parallelize: fetch effects, creatures, and reset stale sessions simultaneously
    const now = Date.now();
    const [{ data: effects }, { data: creaturesRaw }] = await Promise.all([
      db.from('active_effects').select('*').eq('node_id', node_id),
      db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true),
      // Reset last_tick_at on any stale combat sessions for this node.
      // This prevents combat-tick from processing a backlog of elapsed ticks
      // when a player re-enters and starts a new combat loop.
      db.from('combat_sessions').update({ last_tick_at: now }).eq('node_id', node_id),
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

    // `now` already declared above (before parallel fetch)

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

    // Log post-expiry effects for diagnostics
    const postExpiryCount = effects.filter(e => now > e.expires_at).length;
    if (postExpiryCount > 0) {
      console.log(JSON.stringify({
        fn: 'combat-catchup', node_id, post_expiry_effects: postExpiryCount,
        total_effects: effects.length, note: 'processing effects past expires_at',
      }));
    }

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
    const lootEvents = await processLootDrops(db, result.lootQueue);

    // ── Award rewards for offscreen kills ────────────────────────
    // IDEMPOTENCY: atomically claim the right to award rewards on each killed
    // creature by setting `rewards_awarded_at` only if it is NULL. Any retry of
    // combat-catchup (e.g. on 503 cold-starts) will see the marker set and
    // skip awarding/broadcasting for that creature. The marker is cleared by
    // `respawn_creatures()` so future kills award normally.
    const claimedKills = new Set<string>();
    if (cKilled.size > 0) {
      const { data: claimed } = await db
        .from('creatures')
        .update({ rewards_awarded_at: new Date().toISOString() })
        .in('id', Array.from(cKilled))
        .is('rewards_awarded_at', null)
        .select('id');
      for (const row of (claimed || [])) claimedKills.add((row as any).id);

      if (claimedKills.size < cKilled.size) {
        console.log(JSON.stringify({
          fn: 'combat-catchup', node_id, idempotency_skipped: cKilled.size - claimedKills.size,
          note: 'rewards already awarded by prior catchup invocation',
        }));
      }
    }

    const killRewards: any[] = [];
    if (claimedKills.size > 0) {
      // Collect unique source character IDs from effects that targeted claimed kills
      const sourceCharIds = new Set<string>();
      for (const eff of effects) {
        if (claimedKills.has(eff.target_id) && eff.source_id) {
          sourceCharIds.add(eff.source_id);
        }
      }

      if (sourceCharIds.size > 0) {
        // Fetch source characters, party memberships, and XP boost in parallel
        const [{ data: sourceChars }, { data: partyMembers }, { data: xpB }] = await Promise.all([
          db.from('characters').select('id, name, level, cha, user_id').in('id', Array.from(sourceCharIds)),
          db.from('party_members').select('character_id, party_id, character:characters(id, name, level, cha)').in('character_id', Array.from(sourceCharIds)).eq('status', 'accepted'),
          db.from('xp_boost').select('multiplier, expires_at').limit(1).single(),
        ]);

        const xpMult = (xpB?.expires_at && new Date(xpB.expires_at) > new Date()) ? Number(xpB.multiplier) : 1;

        // Build party grouping: source_id → { partyId, members[] }
        const partyGroupMap = new Map<string, { partyId: string; members: { id: string; name: string; level: number; cha: number }[] }>();
        if (partyMembers && partyMembers.length > 0) {
          const partyIds = [...new Set(partyMembers.map(pm => pm.party_id))];
          const { data: allPartyMembers } = await db
            .from('party_members')
            .select('character_id, party_id, character:characters(id, name, level, cha)')
            .in('party_id', partyIds)
            .eq('status', 'accepted');

          for (const pm of (partyMembers || [])) {
            const partyId = pm.party_id;
            const groupMembers = (allPartyMembers || [])
              .filter(apm => apm.party_id === partyId)
              .map(apm => {
                const c = apm.character as any;
                return { id: apm.character_id, name: c?.name ?? '', level: c?.level ?? 1, cha: c?.cha ?? 10 };
              });
            partyGroupMap.set(pm.character_id, { partyId, members: groupMembers });
          }
        }

        for (const creatureId of claimedKills) {
          const creature = creatures.find(cr => cr.id === creatureId);
          if (!creature) continue;

          // Find which source character(s) had effects on this creature
          const crSourceIds = new Set<string>();
          for (const eff of effects) {
            if (eff.target_id === creatureId && eff.source_id) {
              crSourceIds.add(eff.source_id);
            }
          }

          // Use the first source character for CHA gold calc
          const primarySourceId = crSourceIds.values().next().value;
          if (!primarySourceId) continue;

          // Determine reward recipients (party or solo) and party_id (if any)
          const partyGroup = partyGroupMap.get(primarySourceId);
          const recipients: { id: string; name: string; level: number; cha: number }[] = partyGroup
            ? partyGroup.members
            : (sourceChars || []).filter(c => c.id === primarySourceId).map(c => ({ id: c.id, name: (c as any).name ?? '', level: c.level, cha: c.cha }));
          const partyIdForCreature = partyGroup?.partyId ?? null;

          if (recipients.length === 0) continue;

          const primaryChar = recipients.find(r => r.id === primarySourceId) || recipients[0];

          // Calculate rewards (same formula as combat-tick)
          const baseXp = Math.floor(creature.level * 10 * (XP_RARITY[creature.rarity] || 1));
          const lt = (creature.loot_table || []) as any[];
          const goldEntry = lt.find((e: any) => e.type === 'gold');
          let totalGold = 0;
          if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
            totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
            if (creature.is_humanoid) {
              totalGold = Math.floor(totalGold * chaGoldMult(primaryChar.cha));
            }
          }
          const splitCount = recipients.length;
          const goldEach = Math.floor(totalGold / splitCount);

          // Salvage for non-humanoid
          let salvageEach = 0;
          if (!creature.is_humanoid) {
            const baseSalvage = 1 + Math.floor(creature.level / 5);
            const rarityMult = creature.rarity === 'boss' ? 4 : creature.rarity === 'rare' ? 2 : 1;
            salvageEach = Math.floor((baseSalvage * rarityMult) / splitCount);
          }

          // BHP for boss kills
          let bhpEach = 0;
          if (creature.rarity === 'boss') {
            const bhpReward = Math.floor(creature.level * 0.5);
            bhpEach = Math.floor(bhpReward / splitCount);
          }

          // Award each recipient
          for (const recipient of recipients) {
            const uncapped = recipient.level < 42;
            const penalty = xpPenalty(recipient.level, creature.level);
            const xpEach = uncapped ? Math.floor(Math.floor(baseXp * penalty * xpMult) / splitCount) : 0;

            await db.rpc('award_party_member', {
              _character_id: recipient.id,
              _xp: xpEach,
              _gold: goldEach,
              _salvage: salvageEach,
            });

            // Award BHP separately (runs as service role so trigger bypass works)
            if (bhpEach > 0) {
              const { data: charRow } = await db.from('characters').select('bhp').eq('id', recipient.id).single();
              const currentBhp = charRow?.bhp ?? 0;
              await db.from('characters').update({ bhp: currentBhp + bhpEach }).eq('id', recipient.id);
            }
          }

          const primaryUncapped = primaryChar.level < 42;
          const xpForDisplay = primaryUncapped ? Math.floor(Math.floor(baseXp * xpPenalty(primaryChar.level, creature.level) * xpMult) / splitCount) : 0;

          // ── Boss death cry (admin-authored) ──
          let bossDeathCryText: string | null = null;
          if (creature.rarity === 'boss' && typeof creature.boss_death_cry === 'string' && creature.boss_death_cry.trim().length > 0) {
            bossDeathCryText = creature.boss_death_cry.trim().replace(/%a/g, primaryChar.name || 'a hero');
          }

          // ── Broadcast to party (so party-mates at other nodes get the message + UI refresh) ──
          if (partyIdForCreature && recipients.length > 1) {
            try {
              const partyChannel = db.channel(`party-broadcast-${partyIdForCreature}`);
              const xpPart = primaryUncapped ? `+${xpForDisplay} XP` : 'Your power transcends experience.';
              const goldPart = goldEach > 0 ? `, +${goldEach} gold` : '';
              const salvagePart = salvageEach > 0 ? `, +${salvageEach} salvage` : '';
              const bhpPart = bhpEach > 0 ? `, +${bhpEach} 🏋️ BHP` : '';
              const summary = `☠️ ${creature.name} has been slain by DoT! ${xpPart}${goldPart}${salvagePart}${bhpPart}.`;

              // Combat log line for non-source party-mates
              await partyChannel.send({
                type: 'broadcast',
                event: 'party_combat_msg',
                payload: {
                  id: `${creatureId}:catchup`,
                  message: summary,
                  node_id: null,
                  character_name: primaryChar.name || null,
                },
              });

              // Per-recipient party_reward to trigger UI refetch on each non-source member
              for (const recipient of recipients) {
                if (recipient.id === primarySourceId) continue;
                const recipUncapped = recipient.level < 42;
                const recipXp = recipUncapped ? Math.floor(Math.floor(baseXp * xpPenalty(recipient.level, creature.level) * xpMult) / splitCount) : 0;
                await partyChannel.send({
                  type: 'broadcast',
                  event: 'party_reward',
                  payload: {
                    character_id: recipient.id,
                    xp: recipXp,
                    gold: goldEach,
                    source: 'catchup',
                  },
                });
              }
            } catch (broadcastErr) {
              console.error('[combat-catchup] party broadcast failed', broadcastErr);
            }
          }

          // ── World-global broadcast for boss death cry ──
          if (bossDeathCryText) {
            try {
              const worldChannel = db.channel('world-global');
              await worldChannel.send({
                type: 'broadcast',
                event: 'world',
                payload: {
                  kind: 'boss_death',
                  icon: '🌫️',
                  text: bossDeathCryText,
                  actor: primaryChar.name || undefined,
                  nonce: `${creatureId}:catchup`,
                },
              });
            } catch (broadcastErr) {
              console.error('[combat-catchup] world-global broadcast failed', broadcastErr);
            }
          }

          killRewards.push({
            creature_name: creature.name,
            creature_level: creature.level,
            creature_rarity: creature.rarity,
            xp_each: xpForDisplay,
            gold_each: goldEach,
            salvage_each: salvageEach,
            bhp_each: bhpEach,
            split_count: splitCount,
            primary_level: primaryChar.level,
            source_character_name: primaryChar.name || null,
            boss_death_cry_text: bossDeathCryText,
          });
        }
      }
    }

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
      creatures_killed: cKilled.size,
      kills: cKilled.size,
      rewards_awarded: killRewards.length,
      ticks_resolved: result.advancedEffects.length,
      partial: isPartial,
      duration_ms: Date.now() - t0,
      ...(reason ? { wake_up_source: reason } : {}),
    }));

    return json({ caught_up: true, effects_processed: effects.length, creatures: finalCreatures, partial: isPartial, kill_rewards: killRewards, loot_events: lootEvents });
  } catch (err) {
    console.error('Combat catchup error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
