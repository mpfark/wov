// ─────────────────────────────────────────────────────────────────
// combat-tick: server-authoritative combat simulation tick.
//
// Combat is server-authoritative.
// Client input (target ids, queued ability, client_cp) is advisory only and
// re-validated here. Never trust client-provided CP/HP for writes.
//
// DO NOT mutate reserved_buffs inside combat-tick.
// Stance state is owned exclusively by activate_stance / drop_stance RPCs.
// combat-tick must treat reserved_buffs as read-only — the only exception is
// the on-death wipe below (annotated inline).
// ─────────────────────────────────────────────────────────────────
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCreatureKill } from "../_shared/kill-resolver.ts";
import { loadClassRegistry } from "../_shared/load-class-registry.ts";
import {
  loadAbilityCalcs, buildServerCalcInputs, authorizeQueuedAbility,
  preflightAbilityConfig, getAbilityResolverMode,
} from "../_shared/load-ability-calcs.ts";
import { ABILITY_CONFIG_FAILURE_TEXT } from "../_shared/combat/ability-magnitude.ts";
// Every ability magnitude funnels through resolveMagnitude — configuration is
// the sole source (checkpoint 7); a missing or invalid calc is an actionable
// failure, never silent legacy math. Telemetry is aggregated in-isolate; only
// failures produce audit rows.
import {
  resolveMagnitude, resolveMagnitudeEx, drainAbilityCalcAuditRows, getAbilityCalcCounters,
} from "../_shared/ability-telemetry.ts";
import {
  resolveEffectTicks,
  processLootDrops,
  writeCreatureState,
  cleanupEffects,
  type LootQueueEntry,
} from "../_shared/combat-resolver.ts";
import { formatProcMessage, renderFlavor } from "../_shared/proc-log-format.ts";
import { normalizeDamageType } from "../_shared/combat/damage-types.ts";
import { buildCastHitEvent } from "../_shared/combat/cast-events.ts";
import { absorbFromShield, resolveDamage, resolveHeal } from "../_shared/combat/resolution.ts";
import { selectPrimaryTarget } from "../_shared/combat/targeting.ts";
import { applyStackingEffect } from "../_shared/combat/status.ts";
import { sumReservedCp, getAvailableCp } from "../_shared/cp/cp-math.ts";
import {
  getStatModifier as sm,
  rollD20,
  rollDamage as rollDmg,
} from "../_shared/formulas/stats.ts";
import {
  getIntHitBonus as intHitBonus,
  getDexCritBonus as dexCritBonus,
  getWisAntiCrit as wisAntiCrit,
  getStrDamageFloor as strDmgFloor,
  getCreatureDamageDie as creatureDmgDie,
  getCreatureLevelGapMultiplier as creatureLevelGapMult,
  calculateAC as calcAC,
  getWeaponDieForItem,
  getHitQuality,
  HIT_QUALITY_MULT,
  CREATURE_CRIT_MULT,
  GLANCING_WEAK_CAP,
  getCreatureAttackBonus as creatureAtkBonus,
  getShieldBlockChance,
  getShieldBlockAmount,
  getShieldWallChanceBonus,
  getShieldWallAmountBonus,
  type HitQuality,
} from "../_shared/formulas/combat.ts";
import {
  CLASS_LEVEL_BONUSES as CLASS_LVL_BONUS,
  CLASS_LABELS,
  isOffhandWeapon,
  OFFHAND_DAMAGE_MULT,
  SHIELD_AC_BONUS,
  SHIELD_ANTI_CRIT_BONUS,
  isShield,
  getClassCritRange,
  getWeaponAffinityBonus as weaponAffinity,
} from "../_shared/formulas/classes.ts";
import {
  getMaxCp as calcMaxCp,
  getMaxMp as calcMaxMp,
  getMaxHp as calcMaxHp,
} from "../_shared/formulas/resources.ts";
import { getXpForLevel as xpForLevel } from "../_shared/formulas/xp.ts";
import { getEffectiveCombatMod } from "../_shared/formulas/effective.ts";
import { bondMultiplier } from "../_shared/formulas/bond.ts";
import { effectiveItemStats } from "../_shared/formulas/items.ts";

// ── Boss crit flavor selection (weighted random) ────────────────
function pickBossFlavor(raw: any): { name: string; text: string; emoji: string; damage_type?: string } | null {
  const flavors = (Array.isArray(raw) ? raw : [])
    .filter((f: any) => typeof f.text === 'string' && f.text.trim().length > 0)
    .map((f: any) => ({
      name: ((f.name as string) || '').trim(),
      text: (f.text as string).trim(),
      emoji: ((f.emoji as string) || '').trim(),
      weight: Number.isFinite(f.weight) && (f.weight as number) > 0 ? (f.weight as number) : 1,
      damage_type: ((f.damage_type as string) || '').trim() || undefined,
    }));
  if (flavors.length === 0) return null;
  const totalWeight = flavors.reduce((s: number, f: any) => s + f.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const f of flavors) {
    roll -= f.weight;
    if (roll <= 0) return { name: f.name, text: f.text, emoji: f.emoji, damage_type: f.damage_type };
  }
  const last = flavors[flavors.length - 1];
  return { name: last.name, text: last.text, emoji: last.emoji, damage_type: last.damage_type };
}
// ── Proc-on-hit resolver ────────────────────────────────────
function resolveProcs(
  procs: { type: string; chance: number; value: number; emoji: string; text: string }[],
  attackerName: string,
  attackerId: string,
  targetName: string,
  targetId: string,
  mHp: Record<string, number>,
  cHp: Record<string, number>,
  maxHp: number,
  events: any[],
  cKilled: Set<string>,
) {
  for (const proc of procs) {
    if (Math.random() >= proc.chance) continue;
    const message = formatProcMessage(proc, attackerName, targetName);
    switch (proc.type) {
      case 'lifesteal':
      case 'heal_pulse': {
        mHp[attackerId] = resolveHeal({ amount: proc.value, hp: mHp[attackerId], maxHp }).hpAfter;
        events.push({ type: 'proc', message, character_id: attackerId });
        break;
      }
      case 'burst_damage': {
        if (cKilled.has(targetId)) break;
        cHp[targetId] = resolveDamage({ amount: proc.value, hp: cHp[targetId] }).hpAfter;
        events.push({ type: 'proc', message, character_id: attackerId });
        break;
      }
      default: {
        events.push({ type: 'proc', message, character_id: attackerId });
      }
    }
  }
}

// ── Buff-on-trigger resolver (item_buff:* effects) ─────────────
// Procs whose `type` starts with `buff_` apply a self-buff to the wearer
// via an `active_effects` row of effect_type `item_buff:<sub>` where
// <sub> ∈ ac | dr | str | dex | con | int | wis | cha.
// "Ignore while active": if the wearer already has the same sub-effect
// running, the proc no-ops.
function resolveBuffProcs(
  procs: any[],
  wearerId: string,
  wearerName: string,
  trigger: 'on_hit' | 'on_taken',
  activeEffects: any[],
  memberBuffActive: Record<string, Set<string>>,
  events: any[],
  combatNodeId: string,
  nowMs: number,
) {
  if (!Array.isArray(procs) || procs.length === 0) return;
  for (const p of procs) {
    if (!p?.type || typeof p.type !== 'string' || !p.type.startsWith('buff_')) continue;
    const procTrigger = (p.trigger === 'on_taken' ? 'on_taken' : 'on_hit');
    if (procTrigger !== trigger) continue;
    if (Math.random() >= (p.chance ?? 0)) continue;

    let sub: string | null = null;
    if (p.type === 'buff_ac') sub = 'ac';
    else if (p.type === 'buff_resist') sub = 'dr';
    else if (p.type === 'buff_attribute') {
      const a = String(p.attribute || '').toLowerCase();
      if (['str','dex','con','int','wis','cha'].includes(a)) sub = a;
    }
    if (!sub) continue;

    const effectType = `item_buff:${sub}`;
    const active = (memberBuffActive[wearerId] ??= new Set());
    if (active.has(effectType)) continue; // ignore while active

    const durSec = Math.max(5, Math.min(600, Math.round(p.duration_sec || 30)));
    const magnitude = sub === 'dr'
      ? Math.max(1, Math.min(95, Math.round((p.value || 0) * 100)))
      : Math.max(1, Math.round(p.value || 0));

    activeEffects.push({
      id: crypto.randomUUID(),
      node_id: combatNodeId,
      target_id: wearerId,
      source_id: wearerId,
      session_id: null,
      effect_type: effectType,
      stacks: magnitude,
      damage_per_tick: 0,
      next_tick_at: nowMs + durSec * 1000,
      expires_at: nowMs + durSec * 1000,
      tick_rate_ms: 2000,
    });
    active.add(effectType);

    const suffix = sub === 'dr'
      ? `${magnitude}% DR, ${durSec}s`
      : sub === 'ac'
        ? `+${magnitude} AC, ${durSec}s`
        : `+${magnitude} ${sub.toUpperCase()}, ${durSec}s`;
    const interpolated = String(p.text || 'is empowered')
      .replace(/%a/g, wearerName)
      .replace(/%v/g, String(magnitude));
    events.push({
      type: 'buff_proc',
      message: `${p.emoji || '✨'} ${wearerName} — ${interpolated} (${suffix})`,
      character_id: wearerId,
    });
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Basic autoattacks use weapon dice + STR (see resolveAttackRoll).
// Class abilities (Barrage, Eviscerate, Conflagrate) use ability-specific
// stat-scaling formulas defined inline in their handlers below — they do
// NOT share the autoattack weapon-die path. Per-class crit range and
// autoattack flavor come from the configurable class registry (`classes`
// table, loaded per invocation via loadClassRegistry).

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// JWT verification helper. Uses Supabase's getClaims() which validates the
// signature locally against cached JWKS — no per-tick GoTrue round-trip, so
// it avoids the 401-stall issue that previously motivated unsafe base64
// payload decoding. Returns null on any verification failure.
async function verifyUserIdFromJwt(
  authHeader: string | null,
  url: string,
  anonKey: string,
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const userDb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data, error } = await userDb.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub as string;
  } catch {
    return null;
  }
}

const TICK_RATE = 2000;
const TICK_CAP = 3; // Defensive safeguard — sessions end on node change, so large backlogs should not occur

// ── Main handler ─────────────────────────────────────────────────

/**
 * Arcane Surge is a global damage-pipeline rule (not a per-ability rider), so
 * its multiplier is resolved from its own configured ability row rather than a
 * hardcoded helper. `fallbackValue: 1` is a neutral constant, never a formula —
 * a missing calc leaves damage untouched and reports an actionable failure.
 */
function surgeMult(
  classKey: string, level: number, intStat: number,
  characterId?: string | null, nodeId?: string | null,
): number {
  return resolveMagnitude({
    classKey, abilityKey: 'arcane_surge', kind: 'amount',
    inputs: buildServerCalcInputs(level, { int: intStat }),
    fallbackValue: 1, characterId, nodeId,
  });
}

Deno.serve(async (req) => {
  const _requestT0 = Date.now();
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const db = createClient(url, srvKey);
    await loadClassRegistry(db);
    await loadAbilityCalcs(db);

    // Auth — verify JWT signature locally via getClaims (cached JWKS, no
    // network hop). Trusting the unsigned `sub` claim would let an attacker
    // forge a token for any user and act as them via the service-role client.
    const authHeader = req.headers.get('Authorization');
    const userId = await verifyUserIdFromJwt(authHeader, url, anonKey);
    if (!userId) throw new Error('Unauthorized');

    const {
      party_id, character_id, node_id, member_buffs,
      engaged_creature_ids, pending_abilities: rawPendingAbilities,
      // New: client can request session creation
      action,
      // Client-side CP for freshness sync (solo only)
      client_cp,
    } = await req.json();

    if (!node_id) throw new Error('Missing node_id');
    if (!party_id && !character_id) throw new Error('Missing party_id or character_id');
    const buffs: Record<string, any> = member_buffs || {};
    const engagedIds: string[] = engaged_creature_ids || [];
    const pendingAbilities: any[] = rawPendingAbilities || [];

    // Server-authoritative time
    const now = Date.now();

    let members: { id: string; c: any }[];
    let tankId: string | null = null;
    let tankAtNode = false;
    let sessionKey: { character_id?: string; party_id?: string } = {};
    // All party members regardless of node — used to grant XP-grace to
    // members who just left the combat node milliseconds before a kill.
    const partyAllMap = new Map<string, any>();

    if (party_id) {
      const { data: party } = await db.from('parties').select('id, leader_id, tank_id').eq('id', party_id).single();
      if (!party) throw new Error('Party not found');
      const { data: userChars } = await db.from('characters').select('id').eq('user_id', userId);
      if (!userChars?.some(c => c.id === party.leader_id)) throw new Error('Not the party leader');

      const { data: membersRaw } = await db
        .from('party_members')
        .select('character_id, character:characters(*)')
        .eq('party_id', party_id)
        .eq('status', 'accepted');

      for (const m of (membersRaw || [])) {
        partyAllMap.set(m.character_id, m.character as any);
      }

      members = (membersRaw || [])
        .filter(m => {
          const ch = m.character as any;
          return ch?.current_node_id === node_id && ch?.hp > 0;
        })
        .map(m => ({ id: m.character_id, c: m.character as any }));

      tankId = party.tank_id || party.leader_id;
      tankAtNode = members.some(m => m.id === tankId);
      sessionKey = { party_id };
    } else {
      const { data: char } = await db.from('characters').select('*').eq('id', character_id).single();
      if (!char || char.user_id !== userId) throw new Error('Not authorized');
      if (char.hp <= 0) {
        // Solo character is dead — clean up any lingering session so the client
        // stops polling and doesn't re-apply stale HP=0 after respawn.
        await db.from('combat_sessions').delete().eq('character_id', character_id);
        return json({ events: [], creature_states: [], member_states: [], session_ended: true, ticks_processed: 0 });
      }
      members = [{ id: character_id, c: char }];
      sessionKey = { character_id };
    }


    // ── Load or create combat session ────────────────────────────
    let session: any = null;
    const sessionQuery = party_id
      ? db.from('combat_sessions').select('*').eq('party_id', party_id).single()
      : db.from('combat_sessions').select('*').eq('character_id', character_id).single();
    const { data: existingSession } = await sessionQuery;

    // Session termination rule: no alive members at node → delete session and return
    if (members.length === 0) {
      if (existingSession) {
        await db.from('combat_sessions').delete().eq('id', existingSession.id);
        console.log(JSON.stringify({ fn: 'combat-tick', session_deleted_reason: 'no_members_at_node', session_id: existingSession.id }));
      }
      return json({ events: [], creature_states: [], member_states: [], session_ended: true, ticks_processed: 0 });
    }

    let sessionJustCreated = false;
    if (existingSession) {
      session = existingSession;
    }

    // ── Stale session: player moved to a different node ──────────
    if (session && session.node_id !== node_id) {
      await db.from('combat_sessions').delete().eq('id', session.id);
      console.log(JSON.stringify({ fn: 'combat-tick', session_deleted_reason: 'node_changed', session_id: session.id, old_node: session.node_id, new_node: node_id }));
      session = null; // fall through to creation below
    }

    // ── Stale session: abandoned combat left an old last_tick_at behind ──
    // If the session hasn't been touched for well over a tick (e.g. player
    // closed the tab / disconnected / died without cleanup) and the client
    // is now re-engaging, delete the row so the recreation branch below
    // starts fresh with last_tick_at = now - TICK_RATE. Without this, the
    // first request of the new fight would compress up to TICK_CAP ticks of
    // catchup into a single response — the "stall then 3-tick burst" bug.
    const STALE_SESSION_MS = 4 * TICK_RATE; // 8s: longer than normal net gaps, shorter than any real abandonment
    if (
      session &&
      (now - session.last_tick_at) > STALE_SESSION_MS &&
      engagedIds.length > 0
    ) {
      const prevEngaged = (session.engaged_creature_ids || []).length;
      const staleMs = now - session.last_tick_at;
      await db.from('combat_sessions').delete().eq('id', session.id);
      console.log(JSON.stringify({ fn: 'combat-tick', session_deleted_reason: 'stale_reuse', session_id: session.id, stale_ms: staleMs, prev_engaged: prevEngaged }));
      session = null;
    }

    if (!session && (action === 'start' || engagedIds.length > 0 || pendingAbilities.length > 0)) {
      // Create new session — set last_tick_at to one tick ago so the first request
      // immediately processes one combat round instead of returning ticks_processed=0.
      const insertData: any = {
        node_id,
        last_tick_at: now - TICK_RATE,
        tick_rate_ms: TICK_RATE,
        engaged_creature_ids: engagedIds,
        member_buffs: {},
        ...sessionKey,
      };
      const { data: newSession } = await db.from('combat_sessions').insert(insertData).select().single();
      session = newSession;
      sessionJustCreated = true;
    }

    if (!session) {
      // No session and nothing to start — return idle state
      const { data: creaturesRaw } = await db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true);
      const creature_states = (creaturesRaw || []).map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      return json({ events: [], creature_states, member_states: [], ticks_processed: 0 });
    }

    // ── Update session with latest engaged creatures from client ──
    const sessionEngaged = new Set<string>(session.engaged_creature_ids || []);
    for (const id of engagedIds) sessionEngaged.add(id);

    // ── Calculate ticks to process ──────────────────────────────
    const elapsedMs = now - session.last_tick_at;
    const ticksToProcess = Math.floor(elapsedMs / TICK_RATE);
    const ticks = Math.min(ticksToProcess, TICK_CAP);

    if (ticks === 0 && pendingAbilities.length === 0) {
      // Not enough time has passed for a tick — parallelize the two idle-path reads
      const [creaturesIdleRes, effectsIdleRes] = await Promise.all([
        db.from('creatures').select('*').eq('node_id', session.node_id).eq('is_alive', true),
        db.from('active_effects').select('source_id, target_id, effect_type, stacks, damage_per_tick, expires_at, next_tick_at, tick_rate_ms').eq('node_id', session.node_id),
      ]);
      const creature_states = (creaturesIdleRes.data || []).map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      return json({ events: [], creature_states, member_states: [], ticks_processed: 0, active_effects: (effectsIdleRes.data || []) });
    }

    // ── XP-grace pool: members who just left this node still get rewards ──
    // (Mobile players in particular often move/lock the screen seconds before
    // a kill resolves — without this grace they would silently lose XP/loot.)
    const KILL_GRACE_MS = 3000;
    const recentMap: Record<string, { last_at_node_ms: number }> =
      ((session?.recent_member_ids as any) || {}) as Record<string, { last_at_node_ms: number }>;
    const atNodeIds = new Set(members.map(m => m.id));
    const gracedExtras: { id: string; c: any }[] = [];
    if (party_id) {
      for (const [cid, ch] of partyAllMap.entries()) {
        if (atNodeIds.has(cid)) continue;
        if (!ch || (ch.hp ?? 0) <= 0) continue;
        const ts = recentMap[cid]?.last_at_node_ms || 0;
        if (now - ts <= KILL_GRACE_MS) gracedExtras.push({ id: cid, c: ch });
      }
    } else {
      // Solo grace: the leader (== the only member) may have stepped off the
      // node within KILL_GRACE_MS. `recent_member_ids` is written for solo
      // sessions too, so we can rehydrate the departing character and still
      // pay out XP/RP/salvage for a kill that lands within the grace window.
      for (const cid of Object.keys(recentMap)) {
        if (atNodeIds.has(cid)) continue;
        const ts = recentMap[cid]?.last_at_node_ms || 0;
        if (now - ts > KILL_GRACE_MS) continue;
        const { data: ch } = await db
          .from('characters')
          .select('*')
          .eq('id', cid)
          .maybeSingle();
        if (!ch || (ch.hp ?? 0) <= 0) continue;
        gracedExtras.push({ id: cid, c: ch });
      }
    }
    // Recipients eligible for kill rewards = active combatants + recently-departed
    const killRecipients: { id: string; c: any }[] = [...members, ...gracedExtras];

    // ── Parallel fetch: equipment, creatures, effects, xp_boost ──
    // Include graced members in equipment/bond fetches so their stat bonuses
    // (e.g. CHA for gold/Renown rolls) are accounted for at reward time.
    const charIds = killRecipients.map(m => m.id);
    const combatNodeId = session.node_id;
    const [equipRes, creaturesRes, effectsRes, xpRes, weaponCfgRes, bondsRes] = await Promise.all([
      db.from('character_inventory')
        .select('character_id, equipped_slot, applied_gems, stat_override, crafted_level, item:items(stats, weapon_tag, hands, procs, level)')
        .in('character_id', charIds)
        .not('equipped_slot', 'is', null),
      db.from('creatures').select('*').eq('node_id', combatNodeId).eq('is_alive', true),
      db.from('active_effects').select('*').eq('node_id', combatNodeId),
      db.from('xp_boost').select('multiplier, expires_at').limit(1).single(),
      db.from('weapon_progression_config').select('tier1_level, tier2_level, tier3_level').eq('id', 1).maybeSingle(),
      db.from('character_class_bonds').select('character_id, class, bond').in('character_id', charIds),
    ]);


    const allEquip = equipRes.data;
    const creaturesRaw = creaturesRes.data;
    const activeEffectsRaw = effectsRes.data;
    const xpB = xpRes.data;
    const weaponProgression = weaponCfgRes.data ?? undefined;

    // Per-member bond multiplier for the *active* class. Classless = 1.00×.
    // Used to scale direct damage and DoT/HoT magnitudes (NOT durations).
    const mBondMult: Record<string, number> = {};
    for (const m of members) {
      const activeClass = (m.c as any).class;
      const isClassless = !!(m.c as any).is_classless;
      const row = (bondsRes.data || []).find((b: any) => b.character_id === m.id && b.class === activeClass);
      const bond = isClassless ? 0 : (row?.bond ?? 0);
      mBondMult[m.id] = bondMultiplier(bond);
    }

    // ── Process equipment bonuses ────────────────────────────────
    const eq: Record<string, Record<string, number>> = {};
    const mainHandTag: Record<string, string | null> = {};
    const offHandTag: Record<string, string | null> = {};
    const mainHandLevel: Record<string, number | null> = {};
    const offHandLevel: Record<string, number | null> = {};
    const mainHandRarity: Record<string, string | null> = {};
    const offHandRarity: Record<string, string | null> = {};
    const isTwoHanded: Record<string, boolean> = {};
    const memberProcs: Record<string, { type: string; chance: number; value: number; emoji: string; text: string }[]> = {};
    for (const cid of charIds) {
      const b: Record<string, number> = {};
      let mhTag: string | null = null;
      let ohTag: string | null = null;
      let mhLvl: number | null = null;
      let ohLvl: number | null = null;
      let mhRarity: string | null = null;
      let ohRarity: string | null = null;
      const procs: any[] = [];
      for (const e of (allEquip || []).filter(e => e.character_id === cid)) {
        // Effective stats = (stat_override ?? items.stats) + applied_gems → attrs.
        // Player-applied gem upgrades must be counted exactly once here.
        const eff = effectiveItemStats({
          baseStats: (e.item as any)?.stats,
          statOverride: (e as any).stat_override,
          appliedGems: (e as any).applied_gems,
        });
        for (const [s, v] of Object.entries(eff)) {
          b[s] = (b[s] || 0) + (v as number);
        }
        if (e.equipped_slot === 'main_hand') {
          if ((e.item as any)?.weapon_tag) mhTag = (e.item as any).weapon_tag;
          if ((e.item as any)?.hands === 2) isTwoHanded[cid] = true;
          if ((e.item as any)?.level != null) mhLvl = (e.item as any).level;
          if ((e.item as any)?.rarity) mhRarity = (e.item as any).rarity;
        }
        if (e.equipped_slot === 'off_hand') {
          if ((e.item as any)?.weapon_tag) ohTag = (e.item as any).weapon_tag;
          if ((e.item as any)?.level != null) ohLvl = (e.item as any).level;
          if ((e.item as any)?.rarity) ohRarity = (e.item as any).rarity;
        }
        // Procs fire from any equipped slot (weapons, armor, rings, trinket, etc.)
        const itemProcs = (e.item as any)?.procs;
        if (Array.isArray(itemProcs)) procs.push(...itemProcs);
      }
      eq[cid] = b;
      mainHandTag[cid] = mhTag;
      offHandTag[cid] = ohTag;
      mainHandLevel[cid] = mhLvl;
      offHandLevel[cid] = ohLvl;
      mainHandRarity[cid] = mhRarity;
      offHandRarity[cid] = ohRarity;
      memberProcs[cid] = procs;
    }

    // ── Alive creatures at combat node ───────────────────────────
    const allCreatures = creaturesRaw || [];

    const dotTargetIds = new Set<string>();
    const activeEffects: any[] = activeEffectsRaw || [];
    for (const eff of activeEffects) dotTargetIds.add(eff.target_id);

    // ── Fold active item_buff:* effects into per-member stats ────
    // Buff procs persist in `active_effects` with effect_type `item_buff:<sub>`
    // and `stacks` carrying the magnitude. While active, the buff's bonus
    // is added to that member's equipment bonus map (so all existing AC /
    // attribute reads pick it up automatically). DR is tracked separately
    // and applied as a damage-pipeline step.
    const memberDR: Record<string, number> = {}; // percent points 1..95
    const memberBuffActive: Record<string, Set<string>> = {};
    for (const eff of activeEffects) {
      if (typeof eff.effect_type !== 'string' || !eff.effect_type.startsWith('item_buff:')) continue;
      if ((eff.expires_at ?? 0) <= now) { eff._expired = true; continue; }
      const cid = eff.target_id;
      if (!eq[cid]) continue;
      const sub = eff.effect_type.slice('item_buff:'.length);
      const mag = Number(eff.stacks) || 0;
      if (mag <= 0) continue;
      (memberBuffActive[cid] ??= new Set()).add(eff.effect_type);
      if (sub === 'ac') eq[cid].ac = (eq[cid].ac || 0) + mag;
      else if (sub === 'dr') memberDR[cid] = (memberDR[cid] || 0) + mag;
      else if (['str','dex','con','int','wis','cha'].includes(sub)) {
        eq[cid][sub] = (eq[cid][sub] || 0) + mag;
      }
    }

    for (const pa of pendingAbilities) {
      if (pa.target_creature_id) dotTargetIds.add(pa.target_creature_id);
    }

    const creatures = allCreatures.filter(cr =>
      sessionEngaged.has(cr.id) || cr.is_aggressive || dotTargetIds.has(cr.id)
    );

    if (creatures.length === 0) {
      await db.from('combat_sessions').delete().eq('id', session.id);
      const creature_states = allCreatures.map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      return json({ events: [], creature_states, member_states: [], session_ended: true, ticks_processed: 0 });
    }

    // ── XP boost ─────────────────────────────────────────────────
    const xpMult = (xpB?.expires_at && new Date(xpB.expires_at) > new Date()) ? Number(xpB.multiplier) : 1;

    // ── State tracking ───────────────────────────────────────────
    const events: any[] = [];
    const cHp: Record<string, number> = {};
    const cKilled = new Set<string>();
    const mHp: Record<string, number> = {};
    const mXp: Record<string, number> = {};
    const mGold: Record<string, number> = {};
    const mBhp: Record<string, number> = {};
    const mSalvage: Record<string, number> = {};
    const mCp: Record<string, number> = {};
    const degradeSet = new Set<string>();
    const clearedDots: { character_id: string; creature_id: string; dot_type: string }[] = [];
    const lootQueue: LootQueueEntry[] = [];
    const gemDropQueue: { memberId: string; gemKey: string }[] = [];
    const bondGainQueue: { memberId: string; creatureLevel: number; isBoss: boolean }[] = [];
    const consumedAbilityStacks: { character_id: string; creature_id: string; stack_type: string }[] = [];
    const killedCreatureIds = new Set<string>();
    const contractCompletions: string[] = [];


    for (const cr of creatures) cHp[cr.id] = cr.hp;
    // Initialize reward maps for everyone who could collect XP this tick
    // (active combatants + graced recently-departed party members).
    for (const m of killRecipients) {
      mXp[m.id] = 0; mGold[m.id] = 0; mBhp[m.id] = 0; mSalvage[m.id] = 0;
    }
    for (const m of members) {
      mHp[m.id] = m.c.hp;

      // Trust DB for CP, but allow client to report a LOWER value (i.e. an
      // ability cost the server hasn't seen yet). Never adopt a higher
      // client value — that would let stale client-side regen leak in
      // during combat and make the CP bar visibly tick upward.
      const dbCp = m.c.cp ?? 0;
      // SERVER AUTHORITY: client_cp is advisory only.
      // Math.min(client_cp, dbCp) guarantees the client can only *reduce* perceived
      // CP (UI sync for in-flight ability cost) and can never raise server CP.
      const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number')
        ? Math.min(client_cp, dbCp)
        : dbCp;
      mCp[m.id] = freshCp;

      // ── Hydrate stance buffs from reserved_buffs ─────────────────
      // Stances (Ignite, Envenom, Holy Shield, Force Shield, Eagle Eye,
      // Arcane Surge, Battle Cry) are stored on the character row and seed
      // member_buffs each tick so the existing engines treat them as active
      // without any expires_at check.
      const reserved: Record<string, { tier: number; reserved: number; activated_at: number }> =
        (m.c.reserved_buffs && typeof m.c.reserved_buffs === 'object') ? m.c.reserved_buffs : {};
      const mb = (buffs[m.id] = buffs[m.id] || {});
      if (Object.keys(reserved).length > 0) {
        const farFuture = Date.now() + 60_000; // re-seeded every tick anyway
        const cInt = (m.c.int || 10) + ((eq[m.id] as any)?.int || 0);
        const cWis = (m.c.wis || 10) + ((eq[m.id] as any)?.wis || 0);
        const cDex = (m.c.dex || 10) + ((eq[m.id] as any)?.dex || 0);
        const cCon = (m.c.con || 10) + ((eq[m.id] as any)?.con || 0);
        const intMod = Math.max(0, Math.floor((cInt - 10) / 2));
        const wisMod = Math.max(0, Math.floor((cWis - 10) / 2));
        const dexMod = Math.max(0, Math.floor((cDex - 10) / 2));
        const conMod = Math.max(0, Math.floor((cCon - 10) / 2));
        // Shared evaluator inputs for configured stance magnitudes.
        const calcInputs = buildServerCalcInputs(m.c.level || 1, {
          str: (m.c.str || 10) + ((eq[m.id] as any)?.str || 0),
          dex: cDex, con: cCon, int: cInt, wis: cWis,
          cha: (m.c.cha || 10) + ((eq[m.id] as any)?.cha || 0),
        });
        if (reserved.ignite)       mb.ignite_buff = true;
        if (reserved.envenom)      mb.poison_buff = true;
        if (reserved.eagle_eye) {
          // Dual-primary (Ranger DEX+WIS): blended focused vision. Cap 5.
          // Magnitude is configurable (abilities.amount_calc); the inline
          // expression stays as the fallback when no calc is configured.
          const blended = resolveMagnitude({
            classKey: m.c.class || 'ranger', abilityKey: 'eagle_eye', kind: 'amount',
            inputs: calcInputs, characterId: m.id, nodeId: combatNodeId,
          });
          mb.crit_buff = { bonus: blended };
        }
        if (reserved.arcane_surge) mb.damage_buff = true;
        if (reserved.battle_cry) {
          // Dual-primary (Warrior STR+DEX): magnitude comes from the configured
          // `battle_cry` amount calc (STR curve); duration is implicit via the
          // stance. Crit reduction shares that curve, and an equipped shield
          // adds the global shield anti-crit bonus on the damage-reduction leg.
          const hasShield = isShield(offHandTag[m.id]);
          const base = resolveMagnitude({
            classKey: m.c.class || 'warrior', abilityKey: 'battle_cry', kind: 'amount',
            inputs: calcInputs, characterId: m.id, nodeId: combatNodeId,
          });
          const dr = base + (hasShield ? SHIELD_ANTI_CRIT_BONUS : 0);
          const critReduction = base;
          mb.battle_cry_dr = { reduction: dr, crit_reduction: critReduction };
        }
        if (reserved.holy_shield) {
          // Dual-primary (Templar WIS+CON): magnitude = WIS, CON adds to retaliation damage.
          mb.holy_shield = { wis_mod: wisMod, con_mod: conMod, expires_at: farFuture };
        }
        if (reserved.shield_wall) {
          // Dual-primary (Templar WIS+CON): WIS → bonus block chance,
          // CON → bonus block amount. Requires a shield equipped to actually
          // benefit; the block step below reads both fields. Both are named
          // mechanic values (block_chance / block_amount) resolved through the
          // single funnel, with the coded helpers as the legacy fallback.
          mb.shield_wall_stance = {
            chance_bonus: resolveMagnitude({
              classKey: m.c.class || 'templar', abilityKey: 'shield_wall', kind: 'mechanic',
              param: 'block_chance', inputs: calcInputs, characterId: m.id, nodeId: combatNodeId,
            }),
            amount_bonus: resolveMagnitude({
              classKey: m.c.class || 'templar', abilityKey: 'shield_wall', kind: 'mechanic',
              param: 'block_amount', inputs: calcInputs, characterId: m.id, nodeId: combatNodeId,
            }),
          };
        }
        if (reserved.force_shield) {
          // Force Shield: ward only regenerates OUT OF COMBAT (handled by
          // apply_force_shield_regen + cron). During combat we never refill;
          // we only seed the live combat-session value from the persisted
          // characters.stance_state.force_shield_hp on the first tick of a
          // new session, then preserve it for the rest of the fight.
          // Pool cap = WIS (sustained ward). Regen rate (in apply_force_shield_regen SQL)
          // remains INT-scaled — INT shapes the spark, WIS shapes the ward.
          // Bond multiplier scales the ward magnitude as a utility shield pool.
          const shieldCapRaw = resolveMagnitude({
            classKey: m.c.class || 'wizard', abilityKey: 'force_shield', kind: 'amount',
            inputs: calcInputs, characterId: m.id, nodeId: combatNodeId,
          });
          const shieldCap = Math.max(1, Math.floor(shieldCapRaw * (mBondMult[m.id] ?? 1)));
          let current = mb.absorb_buff?.shield_hp;
          if (current === undefined) {
            const persisted = (m.c.stance_state && typeof m.c.stance_state === 'object')
              ? Number((m.c.stance_state as any).force_shield_hp)
              : NaN;
            current = Number.isFinite(persisted)
              ? Math.max(0, Math.min(shieldCap, persisted))
              : shieldCap; // first activation ever → start full
          }
          mb.absorb_buff = { shield_hp: current };
        }
      }
    }

    // ── Unified creature kill handler ────────────────────────────
    // All reward math + event formatting + loot-queue building lives in the
    // shared `resolveCreatureKill` helper. This function only handles the
    // tick-loop-local bookkeeping (effects purge, session engagement, kill set)
    // and applies the resolver's outputs to the local accumulators.
    // King Aldric Vael, the Unbroken — killing-blow slayer earns the temporary
    // King/Queen title (cleared after 30 min offline by the expire_king_slayer
    // janitor). At most one king world-wide at any time.
    const KING_ALDRIC_ID = 'e1789e02-aa86-49a2-af02-148ac53503bc';
    const kingCrownings: { characterId: string; characterName: string; gender: string }[] = [];
    const princeAscensions: { characterId: string; characterName: string; gender: string; charClass: string }[] = [];

    const handleCreatureKill = (creature: any, killerLabel: string, _chaForGold: number = 0, killerCharacterId?: string) => {
      cKilled.add(creature.id);
      sessionEngaged.delete(creature.id);
      // Purge all active_effects targeting this creature (and track for client)
      const killedEffects = activeEffects.filter(e => e.target_id === creature.id);
      for (const e of killedEffects) {
        clearedDots.push({ character_id: e.source_id, creature_id: creature.id, dot_type: e.effect_type });
      }
      // Remove from in-memory list (DB delete happens after tick loop)
      for (let i = activeEffects.length - 1; i >= 0; i--) {
        if (activeEffects[i].target_id === creature.id) activeEffects.splice(i, 1);
      }
      killedCreatureIds.add(creature.id);

      // Recipients = active combatants at the node PLUS any party member
      // who was at the node within the last KILL_GRACE_MS (mobile / movement
      // grace). Solo collapses to the single character.
      const recipients = killRecipients.map(mm => ({
        id: mm.id,
        level: mm.c.level,
        cha: (mm.c.cha || 10) + ((eq[mm.id] as any)?.cha || 0),
        isUncapped: mm.c.level < 42,
      }));


      const outcome = resolveCreatureKill(
        {
          id: creature.id,
          name: creature.name,
          level: creature.level,
          rarity: creature.rarity,
          is_humanoid: creature.is_humanoid,
          loot_table: creature.loot_table,
          loot_table_id: creature.loot_table_id,
          loot_mode: creature.loot_mode,
          drop_chance: creature.drop_chance,
          boss_death_cry: creature.boss_death_cry,
        },
        recipients,
        { nodeId: combatNodeId, killerLabel, xpBoostMultiplier: xpMult },
      );

      // Accumulate per-member rewards
      for (const mr of outcome.memberRewards) {
        mXp[mr.memberId] += mr.xp;
        mGold[mr.memberId] += mr.gold;
        mBhp[mr.memberId] += mr.bhp;
        mSalvage[mr.memberId] += mr.salvage;

        // ── Assassin contract bonus ────────────────────────────────
        // 125% of this recipient's earned reward, paid only to the
        // contract holder whose active_contract matches this kill.
        // Renown bonus only materializes for rare targets (mr.bhp > 0).
        const holder = members.find(mm => mm.id === mr.memberId)
                    ?? gracedExtras.find(mm => mm.id === mr.memberId);
        const contract = (holder?.c as any)?.active_contract;
        if (
          holder
          && (holder.c as any).class === 'assassin'
          && contract
          && contract.creature_id === creature.id
          && creature.rarity !== 'boss'
        ) {
          const bonusXp = Math.floor(mr.xp * 1.25);
          const bonusGold = Math.floor(mr.gold * 1.25);
          const bonusBhp = Math.floor(mr.bhp * 1.25);
          mXp[mr.memberId] += bonusXp;
          mGold[mr.memberId] += bonusGold;
          mBhp[mr.memberId] += bonusBhp;

          const tokens: string[] = [];
          if (bonusXp > 0) tokens.push(`+${bonusXp} XP`);
          if (bonusGold > 0) tokens.push(`+${bonusGold} gold`);
          if (bonusBhp > 0) tokens.push(`+${bonusBhp} 🏛️ Renown`);
          events.push({
            type: 'contract_complete',
            character_id: mr.memberId,
            message: `🗡️ Contract fulfilled — ${creature.name} put down.${tokens.length ? ' ' + tokens.join(', ') + '.' : ''}`,
          });

          // Clear contract + bump lifetime counter (separate update so it
          // runs even if no other character columns change).
          contractCompletions.push(mr.memberId);
          // Wipe in-memory so a second kill in the same tick can't double-claim.
          (holder.c as any).active_contract = null;
        }
      }


      // Boss death cry: live combat broadcasts via a dedicated event type so
      // both the killer and any party-mates at other nodes can render the
      // world-narration line. catchup uses the realtime `world` channel
      // instead, since live tick replies travel through the HTTP response.
      if (outcome.bossDeathCryText) {
        events.push({
          type: 'boss_death_cry',
          message: outcome.bossDeathCryText,
          creature_id: creature.id,
          creature_name: creature.name,
        });
      }

      // Push canonical event lines (kill / Renown / salvage)
      for (const ev of outcome.events) events.push(ev);

      // Queue loot drops
      for (const lq of outcome.lootQueue) lootQueue.push(lq);

      // Queue gem drops (applied via add_material into character_materials)
      for (const gd of outcome.gemDrops) gemDropQueue.push(gd);

      // Queue class-bond gains (applied via award_class_bond_for_kill RPC)
      for (const bg of outcome.bondGains) bondGainQueue.push({
        memberId: bg.memberId, creatureLevel: bg.creatureLevel, isBoss: bg.isBoss,
      });

      // King Aldric → queue a crowning for the killing-blow attacker.
      if (creature.id === KING_ALDRIC_ID && killerCharacterId) {
        const slayer = members.find(mm => mm.id === killerCharacterId);
        if (slayer) {
          kingCrownings.push({
            characterId: killerCharacterId,
            characterName: slayer.c.name,
            gender: slayer.c.gender || 'male',
          });
        }
      }
    };

    // ── Process pending abilities BEFORE the tick loop (immediate) ──
    const consumedBuffs: Record<string, string[]> = {};
    /** Actionable rows for casts rejected by the configuration preflight. */
    const abilityConfigFailures: Array<{
      character_id: string; node_id: string | null; event_type: string;
      message: string; payload: Record<string, unknown>;
    }> = [];

    for (const pa of pendingAbilities) {
      const member = members.find(m => m.id === pa.character_id);
      if (!member) continue;
      const c = member.c;
      const eb = eq[member.id] || {};

      // ── Server-side authorization (before any resource mutation) ───
      // The queued `ability_key` is a client claim. The server confirms it is an
      // active assignment for this character's class and unlock level, and takes
      // the authoritative role slot from the registry.
      const auth = authorizeQueuedAbility({
        classKey: c.class || '',
        level: c.level || 1,
        abilityKey: pa.ability_key,
        abilityType: pa.ability_type,
      });
      if (auth.error || !auth.entry) {
        events.push({
          type: 'ability_fail',
          message: `⚠️ ${c.name} cannot use that technique — ${auth.error ?? 'unavailable'}.`,
          character_id: member.id,
        });
        continue;
      }

      // ── Configuration preflight (before any resource mutation) ─────
      // Phase C: a missing / invalid configured magnitude must never silently
      // resolve to 0. The cast aborts here — no CP spend, no cooldown, no
      // stacks, no effect rows — and one actionable audit row is written.
      const configErrors = preflightAbilityConfig(auth.entry);
      if (configErrors.length > 0) {
        events.push({
          type: 'ability_fail',
          message: `⚠️ ${c.name}: ${ABILITY_CONFIG_FAILURE_TEXT}.`,
          character_id: member.id,
        });
        abilityConfigFailures.push({
          character_id: member.id,
          node_id: combatNodeId,
          event_type: 'ability_config_invalid',
          message: `${c.class}:${auth.abilityKey}: ${configErrors[0]}`,
          payload: {
            ability_key: auth.abilityKey,
            mechanic_key: auth.entry.mechanicKey,
            resolver_mode: getAbilityResolverMode(),
            errors: configErrors.slice(0, 5),
          },
        });
        continue;
      }

      const cpCost = pa.cp_cost || 0;
      // Stance reservations reduce the *spendable* pool but live in mCp as part of `cp`.
      // reserved_buffs is read-only here — owned by activate_stance / drop_stance RPCs.
      const reservedTotal = sumReservedCp(member.c.reserved_buffs);
      if (getAvailableCp(mCp[member.id], reservedTotal) < cpCost) {
        events.push({ type: 'ability_fail', message: `⚠️ ${c.name} doesn't have enough CP!`, character_id: member.id });
        continue;
      }
      mCp[member.id] -= cpCost;

      const target = creatures.find(cr => cr.id === pa.target_creature_id && cHp[cr.id] > 0 && !cKilled.has(cr.id));
      if (!target) {
        events.push({ type: 'ability_fail', message: `⚠️ ${c.name}'s target is no longer valid.`, character_id: member.id });
        continue;
      }

      // Any ability landing on a creature engages it for the rest of the session
      // (so T0 openers transition out-of-combat → in-combat correctly).
      sessionEngaged.add(target.id);

      // ── Ability to-hit helper ─────────────────────────────────────
      // All damaging abilities (except Barrage which rolls per-arrow) call this
      // once to determine hit/miss. Mirrors the autoattack hit rule:
      //   d20 + statMod + intHitBonus  vs  creature AC (minus Sunder if active).
      // Nat 20 always hits, nat 1 always misses. No crit on these rolls — ability
      // damage stays deterministic; the d20 is purely hit/miss.
      const mbForHit = buffs[member.id] || {};
      const sunderRedForTarget =
        mbForHit.sunder_target === target.id && mbForHit.sunder_reduction
          ? Math.max(0, Math.round(mbForHit.sunder_reduction * (mBondMult[member.id] ?? 1)))
          : 0;
      const intModForHit = sm((c.int || 10) + (eb.int || 0));
      const rollAbilityHit = (statMod: number): { hit: boolean; roll: number } => {
        const d = rollD20();
        if (d === 20) return { hit: true, roll: d };
        if (d === 1) return { hit: false, roll: d };
        const effAC = Math.max((target.ac || 0) - sunderRedForTarget, 0);
        const total = d + statMod + intHitBonus(intModForHit);
        return { hit: total >= effAC, roll: d };
      };

      // ── Weapon-die helper for physical abilities ──────────────────
      // Returns the equipped main-hand weapon die (and tag) for this member.
      // If no main-hand weapon is equipped, falls back to 1d4 "unarmed".
      // Used by Power Strike, Aimed Shot, Backstab, Eviscerate, Rend, Barrage.
      const getMemberWeaponDie = (): { die: number; tag: string } => {
        const wTag = mainHandTag[member.id];
        if (!wTag) return { die: 4, tag: 'unarmed' };
        const wHands: 1 | 2 = isTwoHanded[member.id] ? 2 : 1;
        const die = getWeaponDieForItem(wTag, wHands, mainHandLevel[member.id], weaponProgression, mainHandRarity[member.id]);
        return { die, tag: wTag };
      };

      // ── Dual-wield / off-hand rule for abilities ──────────────────
      // CANONICAL: every physical ability resolves with the MAIN-HAND weapon only.
      //   • Off-hand is never substituted, never picked-best, never adds an
      //     extra ability swing. Off-hand keeps its autoattack-only bonus swing
      //     (30% damage) elsewhere in this file.
      //   • Bow abilities (Aimed Shot / Barrage) are NOT gated by weapon_tag —
      //     they roll whatever main-hand die is equipped (or 1d4 if unarmed).
      //   • Two-handed weapons already produce a larger die via getWeaponDieForItem,
      //     so 2H benefit is automatic.
      // Physical weapon abilities (Power Strike, Aimed Shot, Backstab, Eviscerate,
      // Rend, Barrage) roll the equipped weapon's die + stat + ability bonus, so
      // weapon upgrades feed directly into ability damage. Spell-flavored abilities
      // (Fireball, Smite, Cutting Words, Grand Finale, Conflagrate) remain stat-only.
      // Every physical-ability event below stamps a `weapon_tag` so the combat log
      // shows the hand that rolled the die ('unarmed' if no main-hand).
      // Tiny suffix helper: render '(sword)' / '(unarmed)' on physical-ability
      // log lines so dual-wielders can see which weapon was used.
      const tagSuffix = (tag: string) => ` (${tag})`;

      // ── Ability magnitude routing ─────────────────────────────────
      // Identity for configuration is always the canonical ability_key, resolved
      // and authorized above. `ability_type` remains only the mechanic dispatch
      // hint for the handler branches below.
      const paAbilityKey = auth.abilityKey;
      const paInputs = buildServerCalcInputs(c.level || 1, {
        str: (c.str || 10) + (eb.str || 0), dex: (c.dex || 10) + (eb.dex || 0),
        con: (c.con || 10) + (eb.con || 0), int: (c.int || 10) + (eb.int || 0),
        wis: (c.wis || 10) + (eb.wis || 0), cha: (c.cha || 10) + (eb.cha || 0),
      });
      /**
       * Configured magnitude for this cast — configuration is the only source
       * (checkpoint 7).
       * `paMagEx` exposes the full result (value + whether config answered) and
       * accepts the equipped weapon die so `dice` terms can roll. Randomness
       * lives here at the call site — the evaluator only calls the injected
       * roller, and only the winning path ever rolls.
       */
      const paMagEx = (
        kind: 'amount' | 'duration' | 'mechanic',
        param?: string,
        weaponDie?: number | null,
        context?: Record<string, number>,
      ) => resolveMagnitudeEx({
        classKey: c.class || '', abilityKey: paAbilityKey, kind, param,
        inputs: {
          ...paInputs,
          weaponDie: weaponDie ?? null,
          roll: (sides: number) => rollDmg(1, sides),
          ...(context ? { context } : {}),
        },
        characterId: member.id, nodeId: combatNodeId,
      });
      const paMag = (
        kind: 'amount' | 'duration' | 'mechanic',
        param?: string,
      ): number => paMagEx(kind, param).value;


      // ── Server-authoritative stack count ──────────────────────────
      // SECURITY: finisher stack counts are read from active_effects, never
      // from client input. The client's advisory value is ignored entirely.
      const serverStacks = (
        effectType: 'poison' | 'ignite',
        targetId: string | undefined | null,
      ): number => {
        if (!targetId) return 0;
        let own = 0;
        let any = 0;
        for (const eff of activeEffects) {
          if (eff.effect_type !== effectType || eff.target_id !== targetId) continue;
          if (eff._expired || (eff.expires_at ?? 0) <= now) continue;
          const n = Number(eff.stacks) || 0;
          if (eff.source_id === member.id) own = Math.max(own, n);
          any = Math.max(any, n);
        }
        return Math.min(5, Math.max(0, own || any));
      };


      if (pa.ability_type === 'multi_attack') {
        // Barrage (Ranger / dual-primary DEX+WIS): per-arrow damage = 1d{bowDie} + floor(dexMod/2).
        // Arrow count: base 2, +1 if dexMod>=3 (precision), +1 more if wisMod>=4 (attunement). Cap 4.
        // Hit: d20 + dexMod vs AC. Crit on roll >= class crit range doubles arrow damage.
        // Buff parity with autoattacks: respects Eagle Eye (crit_buff), Arcane Surge
        // (damage_buff), Shadowstep (stealth_buff), and Disengage (disengage_next_hit).
        // Stealth/Disengage are consumed once for the whole Barrage volley (not per arrow).
        // If main-hand isn't a bow, falls back to the unarmed 1d4 die.
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const effWis = (c.wis || 10) + (eb.wis || 0);
        const dexMod = sm(effDex);
        const wisMod = sm(effWis);
        // Named mechanic value: arrow_count (unit 'count').
        const arrowCount = paMag(
          'mechanic',
          'arrow_count',
        );
        const { die: arrowDie, tag: arrowTag } = getMemberWeaponDie();
        // Per-arrow damage is configured: barrage's `amount_calc` is the FULL
        // per-arrow magnitude (weapon die + half DEX), rolled once per arrow.
        const arrowBonus = Math.max(0, Math.floor(dexMod / 2));
        const rollArrow = () => paMagEx(
          'amount',
          undefined, arrowDie,
        ).value;

        const mb = buffs[member.id] || {};
        const critBuffBonus = mb.crit_buff?.bonus || 0;
        const critRange = getClassCritRange(c.class) - critBuffBonus;
        const stealthMult = (mb.stealth_buff && typeof mb.stealth_buff === 'object') ? (mb.stealth_buff.mult ?? 2) : (mb.stealth_buff ? 2 : 0);
        const isStealth = stealthMult > 0;
        const isDmgBuff = !!mb.damage_buff;
        const hasDisengage = !!mb.disengage_next_hit;
        const disengageMult = hasDisengage ? (mb.disengage_next_hit.bonus_mult || 0) : 0;
        let totalDmg = 0;
        events.push({ type: 'ability_cast', message: `🏹 ${c.name} unleashes a Barrage of ${arrowCount} arrows!`, character_id: member.id });
        for (let i = 0; i < arrowCount; i++) {
          const t = creatures.find(cr => cr.id === pa.target_creature_id && cHp[cr.id] > 0 && !cKilled.has(cr.id));
          if (!t) break;
          const roll = rollD20();
          const totalAtk = roll + dexMod;
          if (roll !== 1 && (roll === 20 || totalAtk >= t.ac)) {
            const isCrit = roll >= critRange;
            let arrowDmg = Math.max(1, Math.floor(rollArrow()));
            if (isCrit) arrowDmg *= 2;
            if (isStealth) arrowDmg = Math.max(Math.floor(arrowDmg * stealthMult), 1);
            if (isDmgBuff) arrowDmg = Math.floor(arrowDmg * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), member.id, combatNodeId));
            if (hasDisengage) arrowDmg = Math.floor(arrowDmg * (1 + disengageMult));
            arrowDmg = Math.max(arrowDmg, 1);
            arrowDmg = Math.max(1, Math.floor(arrowDmg * mBondMult[member.id]));
            totalDmg += arrowDmg;
            cHp[t.id] = resolveDamage({ amount: arrowDmg, hp: cHp[t.id] }).hpAfter;
            events.push({
              type: 'attack_hit',
              message: `🏹 Arrow ${i + 1}/${arrowCount} strikes ${t.name}! [${arrowDmg}]`,
              attacker_name: c.name,
              target_name: t.name,
              attacker_class: c.class,
              weapon_tag: arrowTag,
              damage: arrowDmg,
              is_crit: isCrit,
              character_id: member.id,
            });
          } else {
            events.push({
              type: 'attack_miss',
              message: `🏹 Arrow ${i + 1}/${arrowCount} misses ${t.name}.`,
              attacker_name: c.name,
              target_name: t.name,
              attacker_class: c.class,
              weapon_tag: arrowTag,
              character_id: member.id,
            });
          }
          if (cHp[t.id] <= 0 && !cKilled.has(t.id)) {
            handleCreatureKill(t, c.name, (c.cha || 10) + (eb.cha || 0), member.id);
          }
        }
        // Consume stealth/disengage once per Barrage cast (parity with autoattacks)
        if (totalDmg > 0 && (isStealth || hasDisengage)) {
          if (!consumedBuffs[member.id]) consumedBuffs[member.id] = [];
          if (isStealth) {
            consumedBuffs[member.id].push('stealth');
            events.push({ type: 'buff_consumed', message: `🌑 ${c.name}'s stealth ambush empowers the volley!`, character_id: member.id });
          }
          if (hasDisengage) consumedBuffs[member.id].push('disengage');
        }
      } else if (pa.ability_type === 'execute_attack') {
        // Eviscerate (Assassin / dual-primary DEX+CHA finisher): damage = 1d{weaponDie} + dexMod + ability bonus.
        // Per-stack bonus scales with CHA showmanship. Rolls to hit on DEX.
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const effCha = (c.cha || 10) + (eb.cha || 0);
        const dexMod = sm(effDex);
        const chaMod = sm(effCha);
        const stacks = serverStacks('poison', target.id);
        // Resolve weapon once so miss + hit + tag all share the same source.
        const { die: evisDie, tag: evisTag } = getMemberWeaponDie();
        const hit = rollAbilityHit(dexMod);
        if (!hit.hit) {
          // Strike committed — poison stacks still consumed on miss.
          const stackNote = stacks > 0 ? `, wasting ${stacks} poison stack${stacks > 1 ? 's' : ''}` : '';
          events.push({ type: 'ability_miss', message: `🔪 ${c.name}'s Eviscerate misses ${target.name}${stackNote}!${tagSuffix(evisTag)}`, character_id: member.id, weapon_tag: evisTag });
          if (stacks > 0) consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'poison' });
          continue;
        }
        // Configured v2 `amount_calc` is the FULL pre-multiplier magnitude
        // (weapon die + DEX + soft DEX + level/3), deliberately unrounded so the
        // stack multiplier rounds once. The legacy closure mirrors that exactly.
        const effDexDmg = getEffectiveCombatMod(Math.max(0, dexMod), 'damage');
        const effChaStack = getEffectiveCombatMod(Math.max(0, chaMod), 'stacking');
        const baseDmg = paMagEx('amount',
          undefined, evisDie,
        ).value;
        // Named mechanic value: per_stack_multiplier (unit 'mult').
        const perStackBonus = paMag('mechanic', 'per_stack_multiplier');

        const multiplier = 1 + perStackBonus * stacks;
        const finalDmg = Math.max(1, Math.floor(Math.round(baseDmg * multiplier) * mBondMult[member.id]));
        cHp[target.id] = resolveDamage({ amount: finalDmg, hp: cHp[target.id] }).hpAfter;
        if (stacks > 0) {
          events.push({ type: 'ability_hit', message: `🔪 ${c.name} eviscerates ${target.name}, consuming ${stacks} poison stack${stacks > 1 ? 's' : ''}! [${finalDmg}]${tagSuffix(evisTag)}`, character_id: member.id, weapon_tag: evisTag });
          consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'poison' });
        } else {
          events.push({ type: 'ability_hit', message: `🔪 ${c.name} strikes ${target.name} (no poison stacks). [${finalDmg}]${tagSuffix(evisTag)}`, character_id: member.id, weapon_tag: evisTag });
        }
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), member.id);
        }

      } else if (pa.ability_type === 'ignite_consume') {
        // Conflagrate (Wizard / dual-primary INT+WIS): base = 4 + 2*intMod + floor(level/3).
        // Per-stack bonus scales with INT. Burn stack count scales with WIS via Ignite. Rolls to hit on INT.
        const effInt = (c.int || 10) + (eb.int || 0);
        const intMod = sm(effInt);
        const stacks = serverStacks('ignite', target.id);
        const hit = rollAbilityHit(intMod);
        if (!hit.hit) {
          const stackNote = stacks > 0 ? `, squandering ${stacks} burn stack${stacks > 1 ? 's' : ''}` : '';
          events.push({ type: 'ability_miss', message: `💥 ${c.name}'s Conflagrate fizzles against ${target.name}${stackNote}!`, character_id: member.id });
          if (stacks > 0) consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'ignite' });
          continue;
        }
        // Soft-scaled INT base (profile 'burst'). Post-cutover the base lives in
        // `amount_calc` and the per-stack rider in the named
        // `per_stack_multiplier` mechanic calc; both keep the inline formula as
        // their legacy closure.
        const effIntBurst = getEffectiveCombatMod(Math.max(0, intMod), 'burst');
        const baseDmg = paMag('amount');
        const perStackBonus = paMag('mechanic', 'per_stack_multiplier');

        const multiplier = 1 + perStackBonus * stacks;
        let finalDmg = Math.max(Math.floor(baseDmg * multiplier), 1);
        // Arcane Surge empowers all wizard damage
        if (buffs[member.id]?.damage_buff) finalDmg = Math.max(Math.floor(finalDmg * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), member.id, combatNodeId)), 1);
        finalDmg = Math.max(1, Math.floor(finalDmg * mBondMult[member.id]));
        cHp[target.id] = resolveDamage({ amount: finalDmg, hp: cHp[target.id] }).hpAfter;
        if (stacks > 0) {
          events.push({ type: 'ability_hit', message: `💥 ${c.name} detonates ${stacks} burn stack${stacks > 1 ? 's' : ''} on ${target.name}! [${finalDmg}]`, character_id: member.id });
          consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'ignite' });
        } else {
          events.push({ type: 'ability_hit', message: `💥 ${c.name} blasts ${target.name} (no burn stacks). [${finalDmg}]`, character_id: member.id });
        }

        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), member.id);
        }
      } else if (
        pa.ability_type === 'fireball' ||
        pa.ability_type === 'power_strike' ||
        pa.ability_type === 'aimed_shot' ||
        pa.ability_type === 'backstab' ||
        pa.ability_type === 'smite' ||
        pa.ability_type === 'cutting_words'
      ) {
        // T0 class identity abilities. Two damage paths:
        //   • Physical (power_strike / aimed_shot / backstab):
        //       damage = 1d{weaponDie} + statMod + (3 + statMod + floor(level/3))
        //     Weapon die / tier / rarity feed directly through the autoattack helper.
        //     Unarmed falls back to 1d4. Aimed Shot uses whatever main-hand is equipped
        //     (a non-bow still rolls its die — fantasy nudge, not a hard gate).
        //   • Spell (fireball / smite / cutting_words):
        //       damage = max(1, 5 + 2*statMod + floor(level/3))   (unchanged, stat-only)
        // Rolls to hit on the class stat (no crit roll on the d20).
        const T0_STAT: Record<string, 'str' | 'dex' | 'int' | 'wis' | 'cha'> = {
          fireball: 'int', power_strike: 'str', aimed_shot: 'dex',
          backstab: 'dex', smite: 'wis', cutting_words: 'cha',
        };
        const T0_LABEL: Record<string, { emoji: string; verb: string }> = {
          fireball:      { emoji: '🔥',  verb: 'hurls a fireball at' },
          power_strike:  { emoji: '⚔️',  verb: 'delivers a crushing blow to' },
          aimed_shot:    { emoji: '🎯',  verb: 'looses an aimed shot at' },
          backstab:      { emoji: '🗡️', verb: 'backstabs' },
          smite:         { emoji: '⭐',  verb: 'smites' },
          cutting_words: { emoji: '🎵',  verb: 'mocks' },
        };
        const PHYSICAL_T0 = new Set(['power_strike', 'aimed_shot', 'backstab']);
        const stat = T0_STAT[pa.ability_type];
        const eff = ((c as any)[stat] || 10) + ((eb as any)[stat] || 0);
        const mod = sm(eff);
        let { emoji, verb } = T0_LABEL[pa.ability_type];
        // Templars share the 'smite' handler with healers but flavor it as Judgment.
        if (pa.ability_type === 'smite' && c.class === 'templar') {
          emoji = '✝️';
          verb = 'passes divine judgment upon';
        }
        const isPhysT0 = PHYSICAL_T0.has(pa.ability_type);
        const isBackstab = pa.ability_type === 'backstab';
        // Resolve main-hand weapon once so both damage and event share the same tag.
        const t0Weapon = isPhysT0 ? getMemberWeaponDie() : null;
        // Backstab reads better as a possessive sentence so the local "You"
        // substitution conjugates naturally ("Your blade slips…"). The weapon
        // tag suffix is omitted — the flavor already implies a blade strike.
        const weaponSuffix = (t0Weapon && !isBackstab) ? tagSuffix(t0Weapon.tag) : '';
        const hit = rollAbilityHit(mod);
        if (!hit.hit) {
          const missMsg = isBackstab
            ? `${emoji} ${c.name}'s blade slips wide — ${target.name} is untouched.`
            : `${emoji} ${c.name} ${verb} ${target.name} — misses!${weaponSuffix}`;
          events.push({
            type: 'ability_miss',
            message: missMsg,
            character_id: member.id,
            ...(t0Weapon ? { weapon_tag: t0Weapon.tag } : {}),
          });
          continue;
        }
        // Soft-scaled primary stat (profile 'damage') — late-game stacking has
        // reduced marginal gain past softCap=20; no hard ceiling.
        const effMod = getEffectiveCombatMod(Math.max(0, mod), 'damage');
        // Checkpoint 5: the configured v2 `amount_calc` expresses the FULL
        // magnitude (weapon die + raw stat + soft bonus + level/3), so the
        // legacy closure must produce the full number too — never a delta.
        // Anything else would double-count the weapon die after the cutover.
        const t0Res = t0Weapon
          ? paMagEx('amount', undefined, t0Weapon.die)
          : paMagEx('amount');
        let dmg = Math.max(1, Math.floor(t0Res.value));
        // Templar Judgment: intentional ability-specific nerf. Post-cutover the
        // ×0.8 lives inside Judgment's configured `finalMult`, so it is only
        // applied here when the legacy closure produced the number.
        if (pa.ability_type === 'smite' && c.class === 'templar' && t0Res.source !== 'config') {
          dmg = Math.max(1, Math.floor(dmg * 0.8));
        }

        // Arcane Surge empowers all wizard damage (only fireball benefits, but
        // gating purely on damage_buff keeps the rule consistent for any class
        // that ever picks it up).
        if (buffs[member.id]?.damage_buff) dmg = Math.max(Math.floor(dmg * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), member.id, combatNodeId)), 1);
        dmg = Math.max(1, Math.floor(dmg * mBondMult[member.id]));
        cHp[target.id] = resolveDamage({ amount: dmg, hp: cHp[target.id] }).hpAfter;
        const hitMsg = isBackstab
          ? `${emoji} ${c.name}'s blade finds a vital point on ${target.name} from behind. [${dmg}]`
          : `${emoji} ${c.name} ${verb} ${target.name}. [${dmg}]${weaponSuffix}`;
        events.push({
          type: 'ability_hit',
          message: hitMsg,
          character_id: member.id,
          ...(t0Weapon ? { weapon_tag: t0Weapon.tag } : {}),
        });
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), member.id);
        }

      } else if (pa.ability_type === 'burst_damage') {
        // Grand Finale (Bard / dual-primary CHA+INT): magnitude = CHA; INT sharpens
        // the killing note by lowering the crit threshold (+floor(intMod/2) edge).
        // Rolls to hit on CHA; crit edge applies only on a successful hit.
        const effCha = (c.cha || 10) + (eb.cha || 0);
        const effInt = (c.int || 10) + (eb.int || 0);
        const chaMod = sm(effCha);
        const intMod = sm(effInt);
        const hit = rollAbilityHit(chaMod);
        if (!hit.hit) {
          events.push({ type: 'ability_miss', message: `🎵💥 ${c.name}'s Grand Finale falls flat — ${target.name} is untouched!`, character_id: member.id });
          continue;
        }
        // Soft-scaled CHA magnitude (profile 'burst') — Grand Finale base and
        // dice both taper past softCap. INT crit-edge is unchanged (threshold, not magnitude).
        const effChaBurst = getEffectiveCombatMod(Math.max(0, chaMod), 'burst');
        const baseDmg = paMag('amount');
        let damage = baseDmg + rollDmg(1, Math.max(1, Math.round(effChaBurst * 2)));
        // INT crit-edge: named mechanic value (unit 'flat'), applied as a
        // threshold reduction. d20 vs crit threshold. Floor 17.
        const critRoll = rollD20();
        const critEdge = paMag('mechanic', 'crit_edge');
        const critThreshold = Math.max(17, 20 - critEdge);
        const isFinaleCrit = critRoll >= critThreshold;
        if (isFinaleCrit) damage = damage * 2;
        // Damage buffs (e.g. Arcane Surge, future bardic empowerments) scale Grand Finale.
        if (buffs[member.id]?.damage_buff) damage = Math.max(Math.floor(damage * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), member.id, combatNodeId)), 1);
        damage = Math.max(1, Math.floor(damage * mBondMult[member.id]));
        cHp[target.id] = resolveDamage({ amount: damage, hp: cHp[target.id] }).hpAfter;
        const finaleLabel = isFinaleCrit ? ' CRIT!' : '';
        events.push({ type: 'ability_hit', message: `🎵💥 Grand Finale!${finaleLabel} ${c.name} unleashes a devastating blast of sound at ${target.name}! [${damage}]`, character_id: member.id });
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, effCha, member.id);
        }
      } else if (pa.ability_type === 'dot_debuff') {
        // Server-side Rend/bleed: create persistent active_effects row.
        // Dual-primary (Warrior STR+DEX): magnitude = weapon damage + STR (the wound),
        // duration = DEX (precision keeps it open). Rolls to hit on DEX.
        // Per-tick bleed pulls from the equipped weapon die (avg) so big swords
        // bleed harder; unarmed falls back to 1d4.
        const effStr = (c.str || 10) + (eb.str || 0);
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const strMod = sm(effStr);
        const dexMod = sm(effDex);
        // Resolve weapon once so miss + apply event + per-tick math all share it.
        const { die: rendDie, tag: rendTag } = getMemberWeaponDie();
        const hit = rollAbilityHit(dexMod);
        if (!hit.hit) {
          events.push({ type: 'ability_miss', message: `🩸 ${c.name}'s Rend glances off ${target.name} — no wound opens.${tagSuffix(rendTag)}`, character_id: member.id, weapon_tag: rendTag });
          continue;
        }

        // Soft-scaled STR contribution (profile 'dot') + weapon-die avg / 3.
        const weaponAvg = (rendDie + 1) / 2; // average roll of 1d{die}
        const effStrDot = getEffectiveCombatMod(Math.max(0, strMod), 'dot');
        let dmgPerTick = Math.max(1, Math.floor((weaponAvg + effStrDot + 2) / 3 * 0.67 + effStrDot * 0.5));
        // Damage buffs (e.g. Arcane Surge, future warrior empowerments) bake into
        // the bleed at apply time so the DoT inherits the boost for its full duration.
        if (buffs[member.id]?.damage_buff) dmgPerTick = Math.max(Math.floor(dmgPerTick * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), member.id, combatNodeId)), 1);
        dmgPerTick = Math.max(1, Math.floor(dmgPerTick * mBondMult[member.id])); // Bond mastery scalar
        const durationMs = paMag(
          'duration',
        );
        // Rend's per-tick magnitude stays mechanic-owned for now: its existing
        // `amount_calc` is a STR-only curve, while the live formula also folds
        // in the weapon-die average. It joins the funnel at checkpoint 3, when
        // dice terms make the two expressible as one calc.

        const existing = activeEffects.find(e => e.source_id === member.id && e.target_id === target.id && e.effect_type === 'bleed');
        const effData = {
          node_id: combatNodeId, target_id: target.id, source_id: member.id,
          session_id: null, effect_type: 'bleed',
          // Stacking (cap 5) and cadence-preserving refresh live in the
          // shared status primitive so every DoT behaves identically.
          ...applyStackingEffect(existing, {
            now, durationMs, damagePerTick: dmgPerTick, maxStacks: 5, tickRateMs: TICK_RATE,
          }),
        };
        if (existing) {
          Object.assign(existing, effData);
        } else {
          activeEffects.push({ id: crypto.randomUUID(), ...effData });
        }
        events.push({ type: 'bleed_applied', message: `🩸 ${c.name} rends ${target.name} — blood weeps from the gash! [${dmgPerTick}/tick]${tagSuffix(rendTag)}`, character_id: member.id, weapon_tag: rendTag });
      }
    }

    // ── Per-tick Holy Shield retaliation tracking ────────────────
    // Keyed by templar id → Set of creature ids that have already been
    // retaliated against this tick (caps to once per attacker per tick).
    const holyShieldHitThisTick: Record<string, Set<string>> = {};

    // ── Helper to apply creature hit to a member ─────────────────
    // CANONICAL DAMAGE PIPELINE (creature → player):
    //   base damage → hit quality mult → crit mult (with anti-crit) → level gap
    //   → Shield Wall (force block) → shield block (flat) → absorb
    //   → Battle Cry DR → Divine Challenge DR → caps/clamps → finalAppliedDamage
    // After damage lands, Holy Shield retaliates against the attacker (once
    // per attacker per tick).
    const applyCreatureHit = (targetId: string, targetName: string, targetC: any, targetEq: Record<string, number>, creature: any, cStr: number, dmgDie: number, tankLabel: string) => {
      const mb = buffs[targetId] || {};
      const effectiveDex = (targetC.dex || 10) + (targetEq.dex || 0);
      const effectiveStr = (targetC.str || 10) + (targetEq.str || 0);
      const effectiveWis = (targetC.wis || 10) + (targetEq.wis || 0);
      const hasShield = isShield(offHandTag[targetId]);
      const shieldAcBonus = hasShield ? SHIELD_AC_BONUS : 0;
      const tAC = calcAC(targetC.class || 'warrior', effectiveDex) + (targetEq.ac || 0) + shieldAcBonus;
      const d20 = rollD20();
      const roll = d20 + cStr + creatureAtkBonus(creature.level);

      const cs = creature.stats as any;
      const cDex = cs.dex || 10;
      const cCritBonus = dexCritBonus(cDex);
      const cCritThreshold = 20 - cCritBonus;
      let isCrit = d20 >= cCritThreshold;
      const isNat1 = d20 === 1;

      // ── Anti-crit check (WIS + shield bonus) — applied before crit resolution ──
      if (isCrit) {
        const antiCrit = wisAntiCrit(effectiveWis) + (hasShield ? SHIELD_ANTI_CRIT_BONUS : 0);
        if (antiCrit > 0 && Math.random() < antiCrit) {
          isCrit = false;
          events.push({ type: 'awareness_resist', message: `🧘 ${targetName}'s awareness deflects ${creature.name}'s critical strike!`, character_id: targetId });
        }
      }

      // ── Hit quality (graded system) ──
      const margin = roll - tAC;
      const quality = getHitQuality(margin, isNat1, isCrit);

      if (quality !== 'miss') {
        if (mb.evasion_buff?.dodge_chance && Math.random() < mb.evasion_buff.dodge_chance) {
          events.push({ type: 'evasion_dodge', message: `🦘 ${targetName} dodges ${creature.name}'s attack!`, character_id: targetId });
          return;
        }

        // Pipeline: 1. base damage → 2. hit-quality mult → 3. crit mult → 4. level-gap
        //           → 5. shield block → 6. absorb → 7. Battle Cry DR → 8. caps/clamps
        let baseDmg = Math.max(rollDmg(1, dmgDie) + cStr, 1);
        let dmg = Math.max(Math.floor(baseDmg * HIT_QUALITY_MULT[quality]), 1);
        if (isCrit) dmg = Math.max(Math.floor(dmg * CREATURE_CRIT_MULT), 1);
        const levelGap = creatureLevelGapMult(creature.level, targetC.level || 1);
        if (levelGap > 1) dmg = Math.max(Math.floor(dmg * levelGap), 1);



        // 5. Shield block (flat reduction, shield only). Shield Wall stance
        // adds WIS-scaled bonus block chance and CON-scaled bonus block
        // amount on top of the base DEX/STR formulas (chance clamped to 95%).
        if (hasShield) {
          const sw = mb.shield_wall_stance;
          const bondM = mBondMult[targetId] ?? 1;
          let blockChance = getShieldBlockChance(effectiveDex);
          if (sw) {
            blockChance = Math.min(0.95, blockChance + (sw.chance_bonus ?? 0));
          }
          if (Math.random() < blockChance) {
            const baseAmt = getShieldBlockAmount(effectiveStr);
            // Bond multiplier scales the Shield Wall stance's block-amount bonus (utility magnitude).
            const bonusAmt = sw ? Math.floor((sw.amount_bonus ?? 0) * bondM) : 0;
            const blockAmt = Math.min(baseAmt + bonusAmt, dmg);

            const preDmg = dmg;
            dmg = Math.max(dmg - blockAmt, 0);
            events.push({ type: 'shield_block', message: `🛡️ ${targetName} raises their shield and turns the blow! [${blockAmt}]`, character_id: targetId });

            if (dmg <= 0) return;
          }
        }

        // 6. Absorb shield
        if (mb.absorb_buff?.shield_hp && mb.absorb_buff.shield_hp > 0) {
          const ward = absorbFromShield(dmg, mb.absorb_buff.shield_hp);
          const absorbed = ward.absorbed;
          mb.absorb_buff.shield_hp = ward.shieldAfter;
          dmg = ward.remaining;
          // Single-icon policy: Force Shield's own emoji only — no extra
          // sparkle/star glyph. (Previous builds rendered "🛡️ ✨" which the
          // EventLog split across two visual rows.)
          events.push({ type: 'absorb', message: `🛡️ A shimmering ward soaks ${creature.name}'s strike for ${targetName}! [${absorbed}]`, character_id: targetId });
          if (dmg <= 0) return;
        }

        // 7. Battle Cry damage reduction — bond multiplier scales the DR
        // magnitude (utility), clamped to 0.95 to never produce zero damage.
        if (mb.battle_cry_dr) {
          const bondM = mBondMult[targetId] ?? 1;
          let dr = (mb.battle_cry_dr.reduction || 0) * bondM;
          if (isCrit) dr += (mb.battle_cry_dr.crit_reduction || 0) * bondM;
          dr = Math.min(0.95, dr);
          const preDmg = dmg;
          dmg = Math.max(Math.floor(dmg * (1 - dr)), 1);
          events.push({ type: 'battle_cry_dr', message: `📯 ${targetName}'s war cry softens the blow! [${preDmg - dmg}]` });
        }

        // 7b. Divine Challenge (Templar) — flat damage reduction, bond multiplier scales magnitude.
        if (mb.divine_challenge && (mb.divine_challenge.expires_at ?? 0) > now) {
          const bondM = mBondMult[targetId] ?? 1;
          const flat = Math.max(0, Math.floor((mb.divine_challenge.flat || 0) * bondM));
          if (flat > 0 && dmg > 0) {
            const preDmg = dmg;
            dmg = Math.max(dmg - flat, 1);
            events.push({ type: 'divine_challenge_dr', message: `⚜️ ${targetName}'s Divine Challenge mitigates the strike! [${preDmg - dmg}]`, character_id: targetId });
          }
        }

        // 7c. Item-buff damage reduction (from buff_resist procs)
        const itemDR = memberDR[targetId] || 0;
        if (itemDR > 0 && dmg > 0) {
          const drFrac = Math.min(95, itemDR) / 100;
          const preDmg = dmg;
          dmg = Math.max(Math.floor(dmg * (1 - drFrac)), 1);
          if (preDmg !== dmg) {
            events.push({ type: 'item_buff_dr', message: `🛡️ ${targetName}'s warding turns the blow! [${preDmg - dmg}]`, character_id: targetId });
          }
        }

        // 8. Caps and clamps
        dmg = Math.max(dmg, 1);
        if (quality === 'glancing') dmg = Math.min(dmg, GLANCING_WEAK_CAP);
        if (quality === 'weak' && margin < -2) dmg = Math.min(dmg, GLANCING_WEAK_CAP);


        mHp[targetId] = resolveDamage({ amount: dmg, hp: mHp[targetId] }).hpAfter;
        degradeSet.add(targetId);
        const critLabel = isCrit ? 'CRITICAL! ' : '';
        const cab = creatureAtkBonus(creature.level);
        const critEvent: any = { type: isCrit ? 'creature_crit' : 'creature_hit', message: `👹 ${tankLabel}${critLabel}${creature.name} strikes ${targetName}${tankLabel ? ' (Tank)' : ''}! [${dmg}]`, attacker_name: creature.name, target_name: targetName, damage: dmg, is_crit: isCrit, is_humanoid: creature.is_humanoid, creature_id: creature.id, character_id: targetId, hit_quality: quality };

        // Boss crit flavor enrichment
        if (isCrit) {
          const bossFlavor = pickBossFlavor(creature.boss_crit_flavors);
          if (bossFlavor) {
            critEvent.boss_flavor = bossFlavor;
          }
        }

        events.push(critEvent);

        // ── Holy Shield (Templar) reactive retaliation ────────────
        // After damage lands (even partial), holy aura strikes back at the
        // attacker. Once per attacker per tick. Dual-primary (Templar WIS+CON):
        // WIS is the magnitude core, CON is a durability kicker on the burn.
        if (mb.holy_shield && (mb.holy_shield.expires_at ?? 0) > now && !cKilled.has(creature.id) && cHp[creature.id] > 0) {
          const seen = holyShieldHitThisTick[targetId] || (holyShieldHitThisTick[targetId] = new Set<string>());
          if (!seen.has(creature.id)) {
            seen.add(creature.id);
            // Soft-scaled WIS + CON kickers (profile 'damage') for Holy Shield retaliation.
            // WIS contribution is now reduced by 20% (CON/level portions remain unchanged).
            const wisModForReturn = getEffectiveCombatMod(Math.max(0, sm(effectiveWis)), 'damage');
            const conKicker = getEffectiveCombatMod(Math.max(0, mb.holy_shield.con_mod ?? 0), 'damage');
            const returnDmgBase = Math.max(1, resolveMagnitude({
              classKey: targetC.class || 'templar', abilityKey: 'holy_shield', kind: 'mechanic',
              param: 'retaliation_damage',
              inputs: buildServerCalcInputs(targetC.level || 1, {
                str: (targetC.str || 10) + (targetEq.str || 0), dex: (targetC.dex || 10) + (targetEq.dex || 0),
                con: (targetC.con || 10) + (targetEq.con || 0), int: (targetC.int || 10) + (targetEq.int || 0),
                wis: effectiveWis, cha: (targetC.cha || 10) + (targetEq.cha || 0),
              }),
              characterId: targetId, nodeId: combatNodeId,
            }));
            const returnDmg = Math.max(1, Math.floor(returnDmgBase * (mBondMult[targetId] ?? 1)));
            cHp[creature.id] = resolveDamage({ amount: returnDmg, hp: cHp[creature.id] }).hpAfter;
            events.push({
              type: 'holy_shield_return',
              message: `⚡ ${targetName}'s Holy Shield burns ${creature.name}! [${returnDmg}]`,
              character_id: targetId,
              creature_id: creature.id,
            });
            if (cHp[creature.id] <= 0 && !cKilled.has(creature.id)) {
              handleCreatureKill(creature, targetName, (targetC.cha || 10) + (targetEq.cha || 0), targetId);
            }
          }
        }

        // ── Buff-on-taken (defensive procs: AC / attribute / DR) ──
        if ((memberProcs[targetId] || []).length > 0 && mHp[targetId] > 0) {
          resolveBuffProcs(memberProcs[targetId], targetId, targetName, 'on_taken', activeEffects, memberBuffActive, events, combatNodeId, now);
        }

        if (mHp[targetId] <= 0) {
          events.push({ type: 'member_death', message: `💀 ${targetName} has been defeated...`, character_id: targetId });
        }

      } else {
        const cabMiss = creatureAtkBonus(creature.level);
        events.push({ type: 'creature_miss', message: `👹 ${creature.name} attacks ${targetName}${tankLabel ? ' (Tank)' : ''} — misses!`, attacker_name: creature.name, target_name: targetName, damage: 0, is_crit: false, is_humanoid: creature.is_humanoid, creature_id: creature.id, character_id: targetId, hit_quality: 'miss' as HitQuality });
      }
    };

    // ── Pre-tick: load telegraphed casts channeling on this node ─────
    // Populated once per invocation so we can (a) pause boss autoattacks
    // while `accumulate.pause_autoattacks` is set on the cast, and (b) grow
    // Stored Power per tick after the tick loop completes.
    type ChannelingCast = {
      cast_event_id: string;
      encounter_id: string;
      creature_id: string;
      expires_at: number;
      started_at: number;
      payload: any;
    };
    const channelingByCreature = new Map<string, ChannelingCast>();
    try {
      const { data: preActive } = await db
        .from('encounter_cast_events')
        .select('id, creature_id, encounter_id, started_at, expires_at, payload')
        .eq('node_id', combatNodeId)
        .is('resolved_at', null);
      for (const c of preActive || []) {
        channelingByCreature.set(c.creature_id as string, {
          cast_event_id: c.id as string,
          encounter_id: c.encounter_id as string,
          creature_id: c.creature_id as string,
          started_at: c.started_at ? new Date(c.started_at as any).getTime() : now,
          expires_at: c.expires_at ? new Date(c.expires_at as any).getTime() : now,
          payload: c.payload || {},
        });
      }
    } catch (e) {
      console.error('[boss-cast] pre-tick fetch failed:', (e as Error).message);
    }

    // ── Multi-tick loop (deterministic time-based) ────────────────
    const previousLastTickAt = session.last_tick_at;



    for (let t = 0; t < ticks; t++) {
      const tickTime = previousLastTickAt + (t + 1) * TICK_RATE;

      // Check if all creatures dead or all members dead — stop early
      const anyCreatureAlive = creatures.some(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
      const anyMemberAlive = members.some(m => mHp[m.id] > 0);
      if (!anyCreatureAlive || !anyMemberAlive) break;

      // Add tick separator
      if (t > 0 || pendingAbilities.length > 0) {
        events.push({ type: 'tick_separator', message: '---tick---' });
      }

      // Reset per-tick Holy Shield retaliation tracking
      for (const k of Object.keys(holyShieldHitThisTick)) delete holyShieldHitThisTick[k];

      // ── Consecrate pulse phase (Templar) ────────────────────────
      // While active, each tick the consecrated ground heals every party
      // member at this node and burns every engaged creature for holy
      // damage scaled to the templar's WIS at cast time.
      for (const m of members) {
        if (mHp[m.id] <= 0) continue;
        const mb = buffs[m.id] || {};
        const cons = mb.consecrate;
        if (!cons || (cons.expires_at ?? 0) <= tickTime) continue;

        const consWis = Math.max(0, cons.wis_mod ?? 0);
        const bm = mBondMult[m.id] ?? 1;
        // Consecrate strength reduced by 35%. Post-cutover the ×0.65 rider lives
        // INSIDE the configured `amount_calc` (`finalMult`), so it is only
        // re-applied here when the legacy closure produced the magnitude.
        const consInputs = buildServerCalcInputs(m.c.level || 1, {
          str: m.c.str || 10, dex: m.c.dex || 10, con: m.c.con || 10,
          int: m.c.int || 10, wis: (m.c.wis || 10), cha: m.c.cha || 10,
        });
        const consRes = resolveMagnitudeEx({
          classKey: m.c.class || 'templar', abilityKey: 'consecrate', kind: 'amount',
          inputs: consInputs, characterId: m.id, nodeId: combatNodeId,
        });
        const consFinalMult = consRes.source === 'config' ? 1 : 0.65;
        const healAmt = Math.max(1, Math.floor(consRes.value * bm * consFinalMult));
        const burnAmt = healAmt;


        // Heal all alive members on this node (members[] is already filtered)
        for (const ally of members) {
          if (mHp[ally.id] <= 0) continue;
          // Shared heal primitive: clamps to max HP and reports the real delta.
          const heal = resolveHeal({ amount: healAmt, hp: mHp[ally.id], maxHp: ally.c.max_hp || 1 });
          mHp[ally.id] = heal.hpAfter;
          if (heal.applied > 0) {
            events.push({
              type: 'consecrate_heal',
              message: `🔆 Consecrated ground soothes ${ally.c.name}. [${heal.applied}]`,
              character_id: ally.id,
            });
          }
        }

        // Burn every engaged, alive creature
        for (const cr of creatures) {
          if (cKilled.has(cr.id) || cHp[cr.id] <= 0) continue;
          cHp[cr.id] = resolveDamage({ amount: burnAmt, hp: cHp[cr.id] }).hpAfter;
          events.push({
            type: 'consecrate_burn',
            message: `🔆 Holy fire sears ${cr.name}! [${burnAmt}]`,
            character_id: m.id,
            creature_id: cr.id,
          });
          if (cHp[cr.id] <= 0 && !cKilled.has(cr.id)) {
            const eb = eq[m.id] || {};
            handleCreatureKill(cr, m.c.name, (m.c.cha || 10) + (eb.cha || 0), m.id);
          }
        }
      }


      // ── Member auto-attacks (skip in DoT-only mode) ──────────
      // Weapon-based: damage = 1d{weaponDie} + STR. Class only affects crit
      // threshold (assassin 19) and weapon affinity. The 2H damage benefit is
      // baked into the weapon die — there is no longer a separate multiplier.
      for (const m of members) {
        if (mHp[m.id] <= 0) continue;
        const c = m.c;
        const eb = eq[m.id] || {};
        const mb = buffs[m.id] || {};
        const wTag = mainHandTag[m.id];
        const wHands: 1 | 2 = isTwoHanded[m.id] ? 2 : 1;
        const weaponDie = getWeaponDieForItem(wTag, wHands, mainHandLevel[m.id], weaponProgression, mainHandRarity[m.id]);
        const effStr = (c.str || 10) + (eb.str || 0);
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const sMod = sm(effStr);   // STR modifier — drives damage + STR floor
        const dMod = sm(effDex);   // DEX modifier — drives autoattack to-hit
        const ihb = intHitBonus((c.int || 10) + (eb.int || 0));
        const dcb = dexCritBonus((c.dex || 10) + (eb.dex || 0));
        const critBonusFromBuff = mb.crit_buff?.bonus || 0;
        const baseCrit = getClassCritRange(c.class);
        const effCrit = baseCrit - dcb - critBonusFromBuff;
        const sdf = strDmgFloor(effStr);
        const stealthMult = (mb.stealth_buff && typeof mb.stealth_buff === 'object') ? (mb.stealth_buff.mult ?? 2) : (mb.stealth_buff ? 2 : 0);
        const isStealth = stealthMult > 0;
        const isDmgBuff = !!mb.damage_buff;
        const hasDisengage = !!mb.disengage_next_hit;
        const affinity = weaponAffinity(c.class, wTag);

        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) break;

        let creatureAc = target.ac;
        if (mb.sunder_target === target.id && mb.sunder_reduction) {
          // Bond multiplier scales the AC-reduction magnitude (utility).
          const sunderAmt = Math.max(0, Math.round(mb.sunder_reduction * (mBondMult[m.id] ?? 1)));
          creatureAc = Math.max(creatureAc - sunderAmt, 0);
        }

        const roll = rollD20();
        const total = roll + dMod + ihb + affinity.hitBonus;
        const intLabel = ihb > 0 ? ` + ${ihb} INT` : '';
        const affLabel = affinity.hitBonus > 0 ? ' + 1 Prof' : '';
        const dieLabel = `1d${weaponDie}`;

        // ── Hit quality (graded system) ──
        const margin = total - creatureAc;
        const isCrit = roll >= effCrit;
        const quality = getHitQuality(margin, roll === 1, isCrit);

        if (quality !== 'miss') {
          // Pipeline: 1. base damage (weapon die + STR) → 2. STR floor (non-crit)
          // → 3. hit-quality mult → 4. crit mult → 5. affinity → 6. buffs → 7. clamp → 8. caps
          // NOTE: Two-handed weapons benefit from a larger weapon die (step 1) only;
          // there is no separate 2H damage multiplier in the autoattack pipeline.
          // Arcane Surge (damage_buff): final damage is multiplied by
          // getArcaneSurgeMult further down. No flat INT bonus on the
          // raw weapon roll — STR remains the sole damage stat for autoattacks.
          let raw = rollDmg(1, weaponDie) + sMod;
          if (!isCrit) raw = Math.max(raw, 1 + sdf); // STR damage floor (non-crit)
          let dmg = Math.max(Math.floor(raw * HIT_QUALITY_MULT[quality]), 1);
          if (isCrit) dmg = Math.max(dmg * 2, 1);
          if (affinity.damageMult > 1) dmg = Math.floor(dmg * affinity.damageMult);
          if (isStealth) {
            dmg = Math.max(Math.floor(dmg * stealthMult), 1);
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('stealth');
            events.push({ type: 'buff_consumed', message: `🌑 ${c.name}'s stealth ambush deals ×${stealthMult.toFixed(2)} damage!`, character_id: m.id });
          }
          if (isDmgBuff) dmg = Math.floor(dmg * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), m.id, combatNodeId));
          if (hasDisengage) {
            dmg = Math.floor(dmg * (1 + mb.disengage_next_hit.bonus_mult));
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('disengage');
          }

          // Clamp minimum 1
          dmg = Math.max(dmg, 1);
          // Glancing cap (always); weak cap only when margin < -2
          if (quality === 'glancing') dmg = Math.min(dmg, GLANCING_WEAK_CAP);
          if (quality === 'weak' && margin < -2) dmg = Math.min(dmg, GLANCING_WEAK_CAP);

          // Bond multiplier (mastery scalar; class-only, 1.00–1.15×).
          dmg = Math.max(1, Math.floor(dmg * mBondMult[m.id]));

          cHp[target.id] = resolveDamage({ amount: dmg, hp: cHp[target.id] }).hpAfter;
          events.push({
            type: 'attack_hit',
            message: `${isCrit ? '⚔️ CRITICAL! ' : '⚔️ '}${c.name} attacks ${target.name}! [${dmg}]`,
            attacker_name: c.name,
            target_name: target.name,
            attacker_class: c.class,
            weapon_tag: wTag || null,
            damage: dmg,
            is_crit: isCrit,
            character_id: m.id,
            hit_quality: quality,
          });

          // Envenom (Assassin / dual-primary DEX+CHA): proc chance scales with DEX,
          // max stack ceiling scales with CHA. Per-tick damage already scales with DEX.
          const dexMod = sm((c.dex || 10) + (eb.dex || 0));
          const chaMod = sm((c.cha || 10) + (eb.cha || 0));
          const envenomInputs = buildServerCalcInputs(c.level || 1, {
            str: (c.str || 10) + (eb.str || 0), dex: (c.dex || 10) + (eb.dex || 0),
            con: (c.con || 10) + (eb.con || 0), int: (c.int || 10) + (eb.int || 0),
            wis: (c.wis || 10) + (eb.wis || 0), cha: (c.cha || 10) + (eb.cha || 0),
          });
          const envenomProc = resolveMagnitude({
            classKey: c.class || 'assassin', abilityKey: 'envenom', kind: 'amount',
            inputs: envenomInputs, characterId: m.id, nodeId: combatNodeId,
          });
          const envenomMaxStacks = resolveMagnitude({
            classKey: c.class || 'assassin', abilityKey: 'envenom', kind: 'mechanic',
            param: 'max_stacks', inputs: envenomInputs, characterId: m.id, nodeId: combatNodeId,
          });
          if (mb.poison_buff && Math.random() < envenomProc) {
            // Server-side DoT creation: upsert poison into active_effects.
            // IMPORTANT: when refreshing an existing stack, preserve `next_tick_at`
            // so the tick cadence isn't reset every proc — otherwise repeated
            // procs in consecutive heartbeats would push the next tick forward
            // forever and the DoT would never deal damage.
            const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'poison');
            // Soft-scaled DEX contribution (profile 'dot') — per-tick poison damage.
            const effDexDot = getEffectiveCombatMod(Math.max(0, dexMod), 'dot');
            const dmgPerTick = Math.max(1, Math.floor(effDexDot * 1.2 * 0.67 * (mBondMult[m.id] ?? 1)));
            const effData = {
              node_id: combatNodeId, target_id: target.id, source_id: m.id,
              session_id: null, effect_type: 'poison',
              ...applyStackingEffect(existing, {
                now: tickTime, durationMs: 25000, damagePerTick: dmgPerTick,
                maxStacks: envenomMaxStacks, tickRateMs: TICK_RATE,
              }),
            };
            if (existing) {
              Object.assign(existing, effData);
            } else {
              activeEffects.push({ id: crypto.randomUUID(), ...effData });
            }
            events.push({ type: 'poison_proc', character_id: m.id, creature_id: target.id, message: `🧪 ${c.name}'s attack poisons ${target.name}!` });
          }
          // (Ignite no longer procs from autoattacks — it now pulses
          // independently each heartbeat as a "shield of fireballs". See the
          // dedicated Ignite-pulse phase below.)


          // ── Proc-on-hit (main hand) ──
          if ((memberProcs[m.id] || []).length > 0 && cHp[target.id] > 0 && !cKilled.has(target.id)) {
            resolveProcs(memberProcs[m.id], c.name, m.id, target.name, target.id, mHp, cHp, c.max_hp, events, cKilled);
          }
          // ── Buff-on-hit (self-buff procs) ──
          if ((memberProcs[m.id] || []).length > 0) {
            resolveBuffProcs(memberProcs[m.id], m.id, c.name, 'on_hit', activeEffects, memberBuffActive, events, combatNodeId, now);
          }

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), m.id);
          }
        } else {
          events.push({
            type: 'attack_miss',
            message: `⚔️ ${c.name} attacks ${target.name} — miss!`,
            attacker_name: c.name,
            target_name: target.name,
            attacker_class: c.class,
            weapon_tag: wTag || null,
            damage: 0,
            is_crit: false,
            character_id: m.id,
            hit_quality: 'miss' as HitQuality,
          });
        }
      }

      // ── Off-hand bonus attack ────────────────────────────────
      // Weapon-based: rolls the OFF-HAND weapon's own die (always 1H) +
      // STR, then applies OFFHAND_DAMAGE_MULT (30%). No weapon affinity is
      // applied to off-hand attacks (preserves prior behavior).
      for (const m of members) {
        if (mHp[m.id] <= 0) continue;
        const ohTag = offHandTag[m.id];
        if (!isOffhandWeapon(ohTag)) continue;
        const c = m.c;
        const eb = eq[m.id] || {};
        const ohDie = getWeaponDieForItem(ohTag, 1, offHandLevel[m.id], weaponProgression, offHandRarity[m.id]);
        const effStr2 = (c.str || 10) + (eb.str || 0);
        const effDex2 = (c.dex || 10) + (eb.dex || 0);
        const sMod2 = sm(effStr2);   // STR — drives offhand damage
        const dMod2 = sm(effDex2);   // DEX — drives offhand to-hit
        const ihb2 = intHitBonus((c.int || 10) + (eb.int || 0));
        const dcb2 = dexCritBonus((c.dex || 10) + (eb.dex || 0));
        const mb2 = buffs[m.id] || {};
        const critBuff2 = mb2.crit_buff?.bonus || 0;
        const baseCrit2 = getClassCritRange(c.class);
        const effCrit2 = baseCrit2 - dcb2 - critBuff2;

        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) continue;

        let creatureAc2 = target.ac;
        if (mb2.sunder_target === target.id && mb2.sunder_reduction) {
          // Bond multiplier scales the AC-reduction magnitude (utility).
          const sunderAmt2 = Math.max(0, Math.round(mb2.sunder_reduction * (mBondMult[m.id] ?? 1)));
          creatureAc2 = Math.max(creatureAc2 - sunderAmt2, 0);
        }

        const roll2 = rollD20();
        const total2 = roll2 + dMod2 + ihb2;

        // ── Hit quality (graded system) ──
        const margin2 = total2 - creatureAc2;
        const isCrit2 = roll2 >= effCrit2;
        const quality2 = getHitQuality(margin2, roll2 === 1, isCrit2);

        if (quality2 !== 'miss') {
          // Pipeline: 1. base damage (offhand die + STR)
          // → 2. hit-quality mult → 3. crit mult → 4. off-hand 30% reduction
          // → 5. Arcane Surge mult → 6. clamp → 7. caps
          const isDmgBuff2 = !!mb2.damage_buff;
          const raw2 = rollDmg(1, ohDie) + sMod2;
          let dmg2 = Math.max(Math.floor(raw2 * HIT_QUALITY_MULT[quality2]), 1);
          if (isCrit2) dmg2 = Math.max(dmg2 * 2, 1);
          dmg2 = Math.max(Math.floor(dmg2 * OFFHAND_DAMAGE_MULT), 1);
          if (isDmgBuff2) dmg2 = Math.max(Math.floor(dmg2 * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), m.id, combatNodeId)), 1);

          // Clamp minimum 1
          dmg2 = Math.max(dmg2, 1);
          // Glancing cap (always); weak cap only when margin < -2
          if (quality2 === 'glancing') dmg2 = Math.min(dmg2, GLANCING_WEAK_CAP);
          if (quality2 === 'weak' && margin2 < -2) dmg2 = Math.min(dmg2, GLANCING_WEAK_CAP);

          // Bond multiplier (class-only mastery scalar).
          dmg2 = Math.max(1, Math.floor(dmg2 * mBondMult[m.id]));

          cHp[target.id] = resolveDamage({ amount: dmg2, hp: cHp[target.id] }).hpAfter;
          events.push({
            type: 'offhand_hit',
            message: `${isCrit2 ? '🗡️ CRIT! ' : '🗡️ '}${c.name}'s off-hand finds an opening on ${target.name}! [${dmg2}]`,
            attacker_name: c.name,
            target_name: target.name,
            attacker_class: c.class,
            weapon_tag: ohTag || mainHandTag[m.id] || null,
            damage: dmg2,
            is_crit: isCrit2,
            character_id: m.id,
            is_offhand: true,
            hit_quality: quality2,
          });

          // ── Proc-on-hit (off hand) ──
          if ((memberProcs[m.id] || []).length > 0 && cHp[target.id] > 0 && !cKilled.has(target.id)) {
            resolveProcs(memberProcs[m.id], c.name, m.id, target.name, target.id, mHp, cHp, c.max_hp, events, cKilled);
          }
          // ── Buff-on-hit (self-buff procs, off-hand swing) ──
          if ((memberProcs[m.id] || []).length > 0) {
            resolveBuffProcs(memberProcs[m.id], m.id, c.name, 'on_hit', activeEffects, memberBuffActive, events, combatNodeId, now);
          }

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), m.id);
          }
        } else {
          events.push({
            type: 'offhand_miss',
            message: `🗡️ ${c.name}'s off-hand swings at ${target.name} — miss!`,
            attacker_name: c.name,
            target_name: target.name,
            attacker_class: c.class,
            weapon_tag: ohTag || mainHandTag[m.id] || null,
            damage: 0,
            is_crit: false,
            character_id: m.id,
            is_offhand: true,
            hit_quality: 'miss' as HitQuality,
          });
        }
      }

      // ── Ignite "shield of fireballs" pulse phase ────────────────
      // While Ignite is active, an orb of flame circles the wizard and
      // pulses every heartbeat at the current target. Proc chance scales with
      // INT (no more flat 40%), pulse damage scales with INT, and the applied
      // burn DoT scales with WIS — every Wizard primary contributes.
      for (const m of members) {
        if (mHp[m.id] <= 0) continue;
        const mb = buffs[m.id] || {};
        if (!mb.ignite_buff) continue;
        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) continue;

        const c = m.c;
        const eb = eq[m.id] || {};
        const intMod = sm((c.int || 10) + (eb.int || 0));
        const wisMod = sm((c.wis || 10) + (eb.wis || 0));
        const orbChance = resolveMagnitude({
          classKey: c.class || 'wizard', abilityKey: 'ignite', kind: 'amount',
          inputs: buildServerCalcInputs(c.level || 1, {
            str: (c.str || 10) + (eb.str || 0), dex: (c.dex || 10) + (eb.dex || 0),
            con: (c.con || 10) + (eb.con || 0), int: (c.int || 10) + (eb.int || 0),
            wis: (c.wis || 10) + (eb.wis || 0), cha: (c.cha || 10) + (eb.cha || 0),
          }),
          characterId: m.id, nodeId: combatNodeId,
        });
        if (Math.random() >= orbChance) continue;
        // Direct pulse damage = INT (the spark / blast).
        let pulseDmg = Math.max(1, 2 + intMod);
        if (mb.damage_buff) pulseDmg = Math.max(Math.floor(pulseDmg * surgeMult(c.class || '', c.level || 1, (c.int||10)+(eb.int||0), m.id, combatNodeId)), 1);
        pulseDmg = Math.max(1, Math.floor(pulseDmg * (mBondMult[m.id] ?? 1)));

        cHp[target.id] = resolveDamage({ amount: pulseDmg, hp: cHp[target.id] }).hpAfter;

        // Upsert burn DoT — damage-per-tick + duration scale from WIS
        // (sustained, lingering flame). Pulse and burn read different stats
        // so wizards genuinely benefit from both primaries.
        const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'ignite');
        // Soft-scaled WIS contribution (profile 'dot') — burn per-tick damage.
        const effWisDot = getEffectiveCombatMod(Math.max(0, wisMod), 'dot');
        const dmgPerTick = Math.max(1, Math.floor(effWisDot * 0.7 * 0.67 * (mBondMult[m.id] ?? 1)));
        const duration = Math.min(45000, 30000 + wisMod * 1000);
        const effData = {
          node_id: combatNodeId, target_id: target.id, source_id: m.id,
          session_id: null, effect_type: 'ignite',
          ...applyStackingEffect(existing, {
            now: tickTime, durationMs: duration, damagePerTick: dmgPerTick,
            maxStacks: 5, tickRateMs: TICK_RATE,
          }),
        };
        if (existing) {
          Object.assign(existing, effData);
        } else {
          activeEffects.push({ id: crypto.randomUUID(), ...effData });
        }

        // Engage so the pulse can also start combat on a passive target
        sessionEngaged.add(target.id);

        events.push({
          type: 'ignite_pulse',
          character_id: m.id,
          creature_id: target.id,
          attacker_name: c.name,
          target_name: target.name,
          damage: pulseDmg,
          message: `🔥 A flaming orb leaps from ${c.name} and sears ${target.name} (burn x${effData.stacks})! [${pulseDmg}]`,
        });
        // Re-emit the legacy ignite_proc event so the existing client wiring
        // (useBuffState.handleAddIgniteStack via interpretCombatTickResult)
        // updates the burn-stack badge without any new plumbing.
        events.push({
          type: 'ignite_proc',
          character_id: m.id,
          creature_id: target.id,
          message: `🔥 ${c.name}'s ignite seared ${target.name}.`,
        });

        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), m.id);
        }
      }

      // ── Server-side DoT ticking via shared resolver (active_effects rows) ─────
      {
        const memberNameMap: Record<string, string> = {};
        for (const m of members) memberNameMap[m.id] = m.c.name;
        const dotResult = resolveEffectTicks(activeEffects, cHp, cKilled, creatures, TICK_CAP, {
          tickTime,
          memberNameMap,
        });
        events.push(...dotResult.events);
        clearedDots.push(...dotResult.clearedDots);
        // Handle kills from DoTs — delegate to unified kill handler for XP/gold/rewards.
        // The resolver already marked these in cKilled; handleCreatureKill re-adds (harmless Set#add).
        // NOTE: handleCreatureKill pushes loot to lootQueue, so we intentionally
        // do NOT merge dotResult.lootQueue here — that would cause duplicate drops.
        for (const killId of dotResult.newKills) {
          const cr = creatures.find(c => c.id === killId);
          if (cr) {
            handleCreatureKill(cr, 'DoT', 0);
          }
        }
      }

      // ── Creature counterattacks (skip in DoT-only mode) ───────
      for (const creature of creatures) {
        if (cKilled.has(creature.id) || cHp[creature.id] <= 0) continue;
        // Pause boss autoattacks while a telegraphed cast is channeling
        // and `accumulate.pause_autoattacks` is truthy (default true when
        // the cast declares an accumulate block).
        const channel = channelingByCreature.get(creature.id);
        if (channel) {
          const acc = channel.payload?.accumulate;
          const pause = acc?.pause_autoattacks !== false && (acc?.enabled !== false);
          if (pause) continue;
        }
        const cs = creature.stats as any;

        const cStr = sm(cs.str || 10);
        const dmgDie = creatureDmgDie(creature.level, creature.rarity);

        // Shared targeting primitive: a designated tank soaks everything while
        // alive (`tank_strict` — nobody else is hit if the tank is down),
        // otherwise a uniformly random living member takes the swing.
        const candidates = members.map(m => ({ id: m.id, hp: mHp[m.id] }));
        const picked = selectPrimaryTarget(candidates, {
          mode: tankAtNode ? 'tank_strict' : 'random_alive',
          tankId: tankAtNode ? tankId : null,
        });
        if (!picked) continue;
        const target = members.find(m => m.id === picked.id)!;
        applyCreatureHit(
          target.id, target.c.name, target.c, eq[target.id] || {},
          creature, cStr, dmgDie, tankAtNode ? '🛡️ ' : '',
        );
      }
    } // end tick loop

    // ── Stored Power accumulation for channeling bosses ──────────
    // For each boss currently channeling with `accumulate.enabled`,
    // add one expected-mitigated-hit worth of Stored Power per tick
    // that elapsed during this invocation. Skips resolved/ended casts.
    const storedPowerBroadcasts: Array<{
      encounter_id: string;
      creature_id: string;
      cast_event_id: string;
      stored_power: number;
      visual_max: number;
    }> = [];
    try {
      for (const channel of channelingByCreature.values()) {
        const acc = channel.payload?.accumulate;
        if (!acc || acc.enabled === false) continue;
        if (channel.expires_at <= previousLastTickAt) continue; // already expired before this invocation

        const creature = creatures.find(c => c.id === channel.creature_id);
        if (!creature) continue;

        // How many ticks the cast was live during this invocation.
        const castStartTick = Math.max(previousLastTickAt, channel.started_at);
        const castEndTick = Math.min(previousLastTickAt + ticks * TICK_RATE, channel.expires_at);
        const liveMs = Math.max(0, castEndTick - castStartTick);
        const liveTicks = Math.min(ticks, Math.max(1, Math.floor(liveMs / TICK_RATE)));
        if (liveTicks <= 0) continue;

        // Expected mitigated hit against the current primary target.
        const cs = creature.stats as any;
        const cStr = sm(cs.str || 10);
        const dmgDie = creatureDmgDie(creature.level, creature.rarity);
        const avgRaw = (1 + dmgDie) / 2 + cStr;
        // Coarse mitigation heuristic (~40% avg reduction after AC/block/armor).
        // Tuning-friendly; boss authors adjust base_amount/base_aoe_amount to taste.
        const expectedPerTick = Math.max(1, Math.round(avgRaw * 0.6));
        const delta = expectedPerTick * liveTicks;

        // Prefer the tank; fall back to any live member so solo (and party
        // without a designated tank) still register a primary target. The
        // RPC COALESCEs — nulls don't clobber a source that was already set
        // at cast start, but this keeps things consistent if the seed missed.
        const sourceId = selectPrimaryTarget(
          members.map(m => ({ id: m.id, hp: mHp[m.id] })),
          { mode: 'tank_preferred', tankId: tankAtNode ? tankId : null },
        )?.id ?? null;
        const { data: newSp, error: addErr } = await db.rpc('encounter_stored_power_add', {
          _encounter_id: channel.encounter_id,
          _delta: delta,
          _reason: 'channel_tick',
          _source_id: sourceId,
        });
        if (addErr) {
          console.error('[stored-power] add failed', channel.cast_event_id, addErr.message);
          continue;
        }

        // Visual max: cap when set, else predicted full-channel growth.
        const totalCastTicks = Math.max(1, Math.round(((channel.expires_at - channel.started_at) || TICK_RATE) / TICK_RATE));
        const predictedMax = expectedPerTick * totalCastTicks + (channel.payload?.base_amount ? Number(channel.payload.base_amount) : 0);
        const cap = channel.payload?.stored_power?.cap;
        const visualMax = Number.isFinite(cap) && (cap as number) > 0 ? Math.floor(cap as number) : predictedMax;

        storedPowerBroadcasts.push({
          encounter_id: channel.encounter_id,
          creature_id: channel.creature_id,
          cast_event_id: channel.cast_event_id,
          stored_power: Number(newSp) || 0,
          visual_max: visualMax,
        });
      }
    } catch (e) {
      console.error('[stored-power] block failed:', (e as Error).message);
    }



    // ── Telegraph eligibility ────────────────────────────────────
    // Bosses telegraph by default (their config is backfilled to enabled).
    // Rare creatures are OPT-IN: they only telegraph when an admin has
    // authored a cast config with `enabled: true`. Regular creatures never do.
    const canTelegraph = (cr: any): boolean => {
      if (cr?.rarity === 'boss') return (cr as any).boss_cast?.enabled !== false;
      if (cr?.rarity === 'rare') return (cr as any).boss_cast?.enabled === true;
      return false;
    };

    // ── M6: Telegraphed boss casts ───────────────────────────────
    // Resolve any casts that have expired, then (30% chance/invocation) start
    // a new one for each engaged boss that has no active cast and is off
    // cooldown. All state lives in encounter_cast_events; casts are broadcast
    // on a node-scoped channel so every client at the node can render the
    // telegraph regardless of party membership.
    try {
      // Default cast settings, used when a boss has no boss_cast config.
      const DEFAULT_BOSS_CAST_COOLDOWN_MS = 20000;
      const DEFAULT_BOSS_CAST_MS = 4000;
      const DEFAULT_BOSS_CAST_START_CHANCE = 0.30;

      // Fetch node-scoped casts: active OR recently resolved (for cooldown check).
      // Widest cooldown any engaged boss might use — used to bound recent cast lookback.
      let maxCooldownMs = DEFAULT_BOSS_CAST_COOLDOWN_MS;
      for (const cr of creatures) {
        if (!canTelegraph(cr)) continue;
        const cd = Number((cr as any).boss_cast?.cooldown_ms);
        if (Number.isFinite(cd) && cd > maxCooldownMs) maxCooldownMs = cd;
      }
      const cooldownCutoff = new Date(now - maxCooldownMs).toISOString();
      const { data: nodeCasts } = await db
        .from('encounter_cast_events')
        .select('id, creature_id, encounter_id, cast_key, ability_key, started_at, expires_at, resolved_at, payload, node_id')
        .eq('node_id', combatNodeId)
        .or(`resolved_at.is.null,resolved_at.gte.${cooldownCutoff}`);

      const activeByCreature = new Map<string, any>();
      const lastCastAtByCreature = new Map<string, number>();
      for (const cst of nodeCasts || []) {
        if (!cst.resolved_at) {
          activeByCreature.set(cst.creature_id, cst);
        } else {
          const t = new Date(cst.resolved_at).getTime();
          const prev = lastCastAtByCreature.get(cst.creature_id) ?? 0;
          if (t > prev) lastCastAtByCreature.set(cst.creature_id, t);
        }
      }

      const castBroadcasts: any[] = [];

      // 1) Resolve expired casts.
      for (const cst of activeByCreature.values()) {
        const expiresMs = new Date(cst.expires_at).getTime();
        if (expiresMs > now) continue;

        const { data: hits, error: resolveErr } = await db.rpc(
          'encounter_boss_resolve_cast',
          { _cast_event_id: cst.id },
        );
        if (resolveErr) {
          console.error('[boss-cast] resolve failed', cst.id, resolveErr.message);
          continue;
        }

        const creature = creatures.find(c => c.id === cst.creature_id);
        const creatureName = creature?.name ?? 'The boss';
        const label = (cst.payload as any)?.label ?? cst.cast_key;
        const emoji = (cst.payload as any)?.emoji ?? '☄️';
        const hitFlavor = String((cst.payload as any)?.hit_flavor ?? '').trim();
        const dmgType = normalizeDamageType((cst.payload as any)?.damage_type);

        // Apply damage to our in-memory member HP for members who were hit.
        // Use DELTA (h.amount) rather than the RPC's absolute new_hp: the RPC
        // computed new_hp from characters.hp in the DB, which does NOT yet
        // reflect any in-memory tick-loop changes (heals, procs, DoTs) that
        // haven't been flushed. Applying the delta preserves those and keeps
        // solo/party math identical.
        for (const h of (hits || [])) {
          const memberName = members.find(m => m.id === h.character_id)?.c?.name ?? 'A hero';
          // Shared resolution primitive owns the HP clamp; `applied` is the
          // real delta and is what the log prints.
          const hpNow = mHp[h.character_id];
          const res = resolveDamage({ amount: Number(h.amount) || 0, hp: hpNow ?? 0 });
          const dmg = hpNow === undefined ? Math.max(0, Math.floor(Number(h.amount) || 0)) : res.applied;
          if (hpNow !== undefined) mHp[h.character_id] = res.hpAfter;
          // Prose + structured event come from the shared cast-event builder.
          events.push(buildCastHitEvent({
            creatureId: cst.creature_id,
            creatureName,
            characterId: h.character_id,
            characterName: memberName,
            label,
            emoji,
            hitFlavor,
            damage: dmg,
            damageType: dmgType,
          }));
        }


        activeByCreature.delete(cst.creature_id);
        lastCastAtByCreature.set(cst.creature_id, now);

        castBroadcasts.push({
          event: 'cast_resolved',
          payload: {
            cast_event_id: cst.id,
            creature_id: cst.creature_id,
            cast_key: cst.cast_key,
            node_id: combatNodeId,
            hits: (hits || []).map((h: any) => ({
              character_id: h.character_id,
              amount: h.amount,
              caused_death: h.caused_death,
            })),
          },
        });
      }

      // 2) Start new casts for engaged bosses that are idle and off cooldown.
      for (const creature of creatures) {
        if (!canTelegraph(creature)) continue;
        if (creature.is_alive === false) continue;
        if (cKilled.has(creature.id) || cHp[creature.id] <= 0) continue;
        if (!sessionEngaged.has(creature.id)) continue;
        if (activeByCreature.has(creature.id)) continue;

        // Per-boss cast config (falls back to defaults when unset).
        const cfg = ((creature as any).boss_cast ?? {}) as {
          label?: string;
          emoji?: string;
          cast_flavor?: string;
          hit_flavor?: string;
          damage_type?: string;
          amount?: number;

          base_amount?: number;
          base_aoe_amount?: number;
          cast_ms?: number;
          cooldown_ms?: number;
          chance?: number;
          lock_ms?: number;
          enabled?: boolean;
          stored_power?: {
            consume_mode?: string;
            consume_pct?: number;
            consume_amount?: number;
            primary_share?: number;
            aoe_share?: number;
            cap?: number;
          };
          accumulate?: {
            enabled?: boolean;
            source?: string;
            method?: string;
            pause_autoattacks?: boolean;
            crit_during_cast?: string;
          };
        };
        // Enable gate: opt-in via cast_config.enabled (bosses backfilled to true).
        if (cfg.enabled === false) continue;
        const castMs = Number.isFinite(cfg.cast_ms as number) && (cfg.cast_ms as number) > 0
          ? Math.floor(cfg.cast_ms as number) : DEFAULT_BOSS_CAST_MS;
        const cooldownMs = Number.isFinite(cfg.cooldown_ms as number) && (cfg.cooldown_ms as number) > 0
          ? Math.floor(cfg.cooldown_ms as number) : DEFAULT_BOSS_CAST_COOLDOWN_MS;
        const chance = Number.isFinite(cfg.chance as number)
          ? Math.max(0, Math.min(1, cfg.chance as number)) : DEFAULT_BOSS_CAST_START_CHANCE;
        const amount = Number.isFinite(cfg.amount as number) && (cfg.amount as number) > 0
          ? Math.floor(cfg.amount as number) : 8 + Math.floor((creature.level || 1) * 1.5);
        const lockMs = Number.isFinite(cfg.lock_ms as number) && (cfg.lock_ms as number) > 0
          ? Math.floor(cfg.lock_ms as number) : 0;
        const label = (cfg.label && cfg.label.trim()) || 'Cataclysm';
        const emoji = (cfg.emoji && cfg.emoji.trim()) || '☄️';
        const castFlavor = String(cfg.cast_flavor ?? '').trim();
        const hitFlavorCfg = String(cfg.hit_flavor ?? '').trim();
        const castDamageType = normalizeDamageType(cfg.damage_type);


        const lastCastAt = lastCastAtByCreature.get(creature.id) ?? 0;
        if (now - lastCastAt < cooldownMs) continue;
        if (Math.random() > chance) continue;

        // Ensure encounter exists (idempotent, cheap).
        const { data: encId, error: encErr } = await db.rpc(
          'encounter_ensure_for_creature',
          { _creature_id: creature.id },
        );
        if (encErr || !encId) {
          console.error('[boss-cast] encounter_ensure failed', creature.id, encErr?.message);
          continue;
        }

        const castKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cast';
        // Stored Power contract with approved defaults.
        const spBlock = {
          consume_mode: cfg.stored_power?.consume_mode ?? 'all',
          consume_pct: cfg.stored_power?.consume_pct ?? 100,
          consume_amount: cfg.stored_power?.consume_amount ?? 0,
          primary_share: cfg.stored_power?.primary_share ?? 1.0,
          aoe_share: cfg.stored_power?.aoe_share ?? 0.4,
        };
        const accumulateBlock = {
          enabled: cfg.accumulate?.enabled ?? true,
          source: cfg.accumulate?.source ?? 'primary_target',
          method: cfg.accumulate?.method ?? 'expected',
          pause_autoattacks: cfg.accumulate?.pause_autoattacks ?? true,
          crit_during_cast: cfg.accumulate?.crit_during_cast ?? 'disabled',
        };
        const payload: Record<string, unknown> = {
          label,
          emoji,
          // Authored flavor travels with the cast so resolution (which may run
          // in a later tick) renders the same text the admin configured.
          cast_flavor: castFlavor || undefined,
          hit_flavor: hitFlavorCfg || undefined,
          damage_type: castDamageType || undefined,
          amount,

          cast_ms: castMs,
          // Fallback: pre-migration bosses only set legacy `amount`. Treat it
          // as the primary flat damage so the resolver always has a base value.
          base_amount: cfg.base_amount ?? cfg.amount ?? 0,
          base_aoe_amount: cfg.base_aoe_amount ?? 0,
          stored_power: spBlock,
          accumulate: accumulateBlock,
        };
        if (lockMs > 0) payload.lock_ms = lockMs;

        const { data: startRows, error: startErr } = await db.rpc(
          'encounter_boss_start_cast',
          {
            _encounter_id: encId,
            _creature_id: creature.id,
            _node_id: combatNodeId,
            _cast_key: castKey,
            _ability_key: castKey,
            _cast_ms: castMs,
            _payload: payload,
          },
        );
        if (startErr) {
          console.error('[boss-cast] start failed', creature.id, startErr.message);
          continue;
        }
        const row = Array.isArray(startRows) ? startRows[0] : startRows;
        if (!row || row.skipped) continue;

        // Enforce Stored Power cap server-side. Note: cast damage is
        // intentionally FLAT — it does NOT scale with the player-vs-boss
        // level gap. Balance lives in cap + primary_share/aoe_share only.
        const capCfg = cfg.stored_power?.cap;
        const capInt = Number.isFinite(capCfg as number) && (capCfg as number) > 0
          ? Math.floor(capCfg as number) : null;
        await db.rpc('encounter_stored_power_set_cap', {
          _encounter_id: encId,
          _cap: capInt,
        });

        // Seed the encounter's primary-target pointer. Prefer the tank; on
        // solo (or a leaderless group) fall back to any live engaged member
        // so the resolver has a valid primary target. Without this the cast
        // routes every hit through the AoE branch (aoe_share defaults to 0
        // → [0] damage in the log, base_amount ignored).
        const primaryTarget = selectPrimaryTarget(
          members.map(m => ({ id: m.id, hp: mHp[m.id] })),
          { mode: 'tank_preferred', tankId: tankAtNode ? tankId : null },
        );
        const primaryId = primaryTarget?.id ?? null;
        if (primaryId) {
          await db.rpc('encounter_stored_power_add', {
            _encounter_id: encId,
            _delta: 0,
            _reason: 'cast_start',
            _source_id: primaryId,
          });
        }

        // Compute visual_max for the client at cast start so it can freeze the scale.
        const cs = creature.stats as any;
        const cStr = sm(cs.str || 10);
        const dmgDie = creatureDmgDie(creature.level, creature.rarity);
        const avgRaw = (1 + dmgDie) / 2 + cStr;
        const expectedPerTick = Math.max(1, Math.round(avgRaw * 0.6));
        const totalTicks = Math.max(1, Math.round(castMs / TICK_RATE));
        const predictedMax = expectedPerTick * totalTicks + (payload.base_amount as number || 0);
        const visualMax = cfg.stored_power?.cap && cfg.stored_power.cap > 0
          ? Math.floor(cfg.stored_power.cap)
          : predictedMax;

        const startRendered = castFlavor
          ? renderFlavor(castFlavor, { creature: creature.name, cast: label, damageType: castDamageType ?? undefined })
          : '';
        // Authored prose stands alone — no cast name or flee hint appended.
        // Stage 2: the 🌀 routing sentinel is GONE. Telegraph styling is
        // derived from the structured `log_event.type`, never from the text.
        const startMessage = startRendered
          ? `${emoji} ${startRendered}`
          : `${emoji} ${creature.name} begins channeling ${label}!`;

        events.push({
          type: 'boss_cast_start',
          creature_id: creature.id,
          message: startMessage,
          log_event: {
            v: 1,
            id: crypto.randomUUID(),
            ts: Date.now(),
            type: 'boss_telegraph',
            message: startMessage,
            source: { kind: 'creature', id: creature.id, name: creature.name },
            damageType: castDamageType ?? undefined,
            effectType: label,
            severity: 'urgent',
            scope: 'node',
          },
        });




        castBroadcasts.push({
          event: 'cast_started',
          payload: {
            cast_event_id: row.cast_event_id,
            encounter_id: encId,
            creature_id: creature.id,
            creature_name: creature.name,
            cast_key: castKey,
            ability_key: castKey,
            label,
            emoji,
            node_id: combatNodeId,
            started_at: row.started_at,
            expires_at: row.expires_at,
            cast_ms: castMs,
            amount,
            stored_power: 0,
            visual_max: visualMax,
          },
        });
      }


      // Push accumulated Stored Power updates onto the same broadcast batch.
      for (const sp of storedPowerBroadcasts) {
        castBroadcasts.push({
          event: 'cast_tick',
          payload: {
            cast_event_id: sp.cast_event_id,
            encounter_id: sp.encounter_id,
            creature_id: sp.creature_id,
            node_id: combatNodeId,
            stored_power: sp.stored_power,
            visual_max: sp.visual_max,
          },
        });
      }

      // Fire node-scoped broadcasts (best-effort — clients also hydrate on join).
      if (castBroadcasts.length > 0) {
        const nodeChannel = db.channel(`encounter-node-${combatNodeId}`);
        for (const b of castBroadcasts) {
          await nodeChannel.send({ type: 'broadcast', event: b.event, payload: b.payload });
        }
        // Realtime v2: unsubscribing releases the socket immediately.
        try { await nodeChannel.unsubscribe(); } catch { /* ignore */ }
      }

    } catch (e) {
      console.error('[boss-cast] block failed:', (e as Error).message);
    }

    // ── Deterministic last_tick_at update ────────────────────────
    const newLastTickAt = previousLastTickAt + ticks * TICK_RATE;


    // ── Report consumed one-shot buffs ──────────────────────────
    const consumedBuffsList: any[] = [];
    for (const [cid, consumed] of Object.entries(consumedBuffs)) {
      for (const buff of consumed) {
        consumedBuffsList.push({ type: 'buff_consumed', character_id: cid, buff });
      }
    }

    // ── Prepare member state updates ──────────────────────────────
    const memberStates: any[] = [];
    const memberUpdatePromises: PromiseLike<any>[] = [];
    const materialAddPromises: PromiseLike<any>[] = [];
    for (const m of members) {
      const c = m.c;
      const eb = eq[m.id] || {};
      const updates: Record<string, any> = {};

      if (mHp[m.id] !== c.hp) updates.hp = mHp[m.id];
      if (mCp[m.id] !== (c.cp ?? 0)) updates.cp = mCp[m.id];
      // EXCEPTION: clearing stances on death is the only write combat-tick performs
      // against reserved_buffs. All other paths must treat it as read-only.
      if (mHp[m.id] <= 0 && c.reserved_buffs && Object.keys(c.reserved_buffs).length > 0) {
        updates.reserved_buffs = {};
      }

      // ── Death log (for post-mortem diagnostics, esp. wimp tuning) ──
      // On the tick that drops a character to 0 HP, persist a short trace of
      // the last events that mention them plus their pre/post HP and the
      // wimp configuration that was (or wasn't) in effect.
      if (mHp[m.id] <= 0 && c.hp > 0) {
        try {
          const charEvents = events
            .filter((ev: any) =>
              ev.character_id === m.id ||
              (typeof ev.message === 'string' && ev.message.includes(c.name))
            )
            .slice(-20)
            .map((ev: any) => ({
              type: ev.type,
              message: ev.message,
              creature_id: ev.creature_id,
              creature_name: ev.creature_name,
            }));
          updates.last_death_at = new Date().toISOString();
          updates.last_death_log = {
            pre_hp: c.hp,
            max_hp: c.max_hp,
            tick_damage: c.hp - mHp[m.id],
            wimp_hp_threshold: c.wimp_hp_threshold ?? null,
            wimp_direction: c.wimp_direction ?? null,
            party_size: members.length,
            node_id: combatNodeId,
            events: charEvents,
          };
        } catch (e) {
          console.error('[combat-tick] death log build failed:', e);
        }
      }


      let newXp = c.xp + mXp[m.id];
      let newGold = c.gold + mGold[m.id];
      let newLevel = c.level;
      let newMaxHp = c.max_hp;

      if (mXp[m.id] > 0 || mGold[m.id] > 0) {
        const needed = xpForLevel(c.level);
        if (newXp >= needed && c.level < 42) {
          newLevel = c.level + 1;
          newXp -= needed;
          updates.level = newLevel;
          updates.unspent_stat_points = (c.unspent_stat_points || 0) + 1;

          if (newLevel % 3 === 0) {
            const bonuses = CLASS_LVL_BONUS[c.class] || {};
            const bonusNames: string[] = [];
            for (const [s, amt] of Object.entries(bonuses)) {
              updates[s] = (c[s] || 10) + amt;
              bonusNames.push(`+${amt} ${s.toUpperCase()}`);
            }
            if (bonusNames.length) {
              events.push({ type: 'level_bonus', message: `📈 ${CLASS_LABELS[c.class] || c.class} bonus: ${bonusNames.join(', ')}!` });
            }
          }

          if ([10, 20, 30, 40].includes(newLevel)) {
            updates.respec_points = (c.respec_points || 0) + 1;
            events.push({ type: 'respec', message: `🔄 ${c.name} earned a respec point!` });
          }

          // ── Deep-Core Forge milestone tokens ──
          // Soulbound materials that hint at the Soulforge in Kharak-Dum
          // and are consumed when the player forges their Crown / Soulforged item.
          if (newLevel === 40) {
            materialAddPromises.push(
              db.rpc('add_material', { _character_id: m.id, _key: 'soulmarked_ember', _delta: 1 })
            );
            events.push({
              type: 'milestone_ember',
              character_id: m.id,
              message: '✨ As your strength settles into something greater, you feel a distant pull deep beneath the mountains — ancient, patient, and waiting.',
            });
          }
          if (newLevel === 42) {
            materialAddPromises.push(
              db.rpc('add_material', { _character_id: m.id, _key: 'corebound_fragment', _delta: 1 })
            );
            events.push({
              type: 'milestone_ember',
              character_id: m.id,
              message: '🌋 The distant pull beneath the mountains returns — heavier now, no longer waiting, but expecting.',
            });
            princeAscensions.push({ characterId: m.id, characterName: c.name, gender: c.gender || 'male', charClass: c.class });
          }

          const fInt = (updates.int ?? c.int) + (eb.int || 0);
          const fWis = (updates.wis ?? c.wis) + (eb.wis || 0);
          const fCha = (updates.cha ?? c.cha) + (eb.cha || 0);
          const fDex = (updates.dex ?? c.dex) + (eb.dex || 0);
          const fCon = (updates.con ?? c.con) + (eb.con || 0);
          newMaxHp = calcMaxHp(c.class, fCon, newLevel) + (eb.hp || 0);
          updates.max_hp = newMaxHp;
          updates.hp = newMaxHp;
          updates.max_cp = calcMaxCp(newLevel, fWis);
          updates.max_mp = calcMaxMp(newLevel, fDex);

          events.push({ type: 'level_up', character_id: m.id, message: `🎉 Level Up! ${c.name} is now level ${newLevel}!` });
          events.push({ type: 'stat_point', message: `📊 ${c.name} gained 1 stat point to allocate!` });
        }
        if (newLevel >= 42) newXp = 0;
        updates.xp = newXp;
        updates.gold = newGold;
      }

      if (mBhp[m.id] > 0) {
        // `bhp` is legacy storage for current Renown balance.
        // Mirror the same delta into the lifetime counter for the Renown Board.
        updates.bhp = (c.bhp || 0) + mBhp[m.id];
        updates.rp_total_earned = (c.rp_total_earned || 0) + mBhp[m.id];
      }
      // Salvage lives in character_materials — write through the helper RPC
      // and let realtime drive the client. memberStates no longer carries a
      // projected salvage total.
      if (mSalvage[m.id] > 0) {
        materialAddPromises.push(
          db.rpc('add_material', { _character_id: m.id, _key: 'salvage', _delta: mSalvage[m.id] })
        );
      }

      // ── Persist Force Shield ward HP across combats ───────────────
      // The OOC regen RPC reads characters.stance_state.force_shield_hp.
      // Mirror the live combat value here every tick so a depleted shield
      // stays depleted when the fight ends and the OOC regen picks up
      // from there instead of resetting to full.
      const reservedNow: Record<string, unknown> = (c.reserved_buffs && typeof c.reserved_buffs === 'object') ? c.reserved_buffs : {};
      if (reservedNow.force_shield) {
        const liveShield = buffs[m.id]?.absorb_buff?.shield_hp;
        if (typeof liveShield === 'number' && Number.isFinite(liveShield)) {
          const prevState = (c.stance_state && typeof c.stance_state === 'object') ? c.stance_state : {};
          updates.stance_state = {
            ...prevState,
            force_shield_hp: Math.max(0, Math.floor(liveShield)),
            force_shield_updated_at: new Date().toISOString(),
          };
        }
      }

      // ── Split writes: HP/CP go through encounter delta RPCs so concurrent
      // writers (party ticks, DoT catch-up, heals) can't lose updates.
      // XP/level/stance/max_* stay on the direct PATCH. Absolute HP writes
      // from a level-up ride the PATCH so they stay atomic with new max_*.
      const leveledUp = updates.level !== undefined;
      const resourceRpcs: Promise<any>[] = [];
      if (!leveledUp) {
        if (updates.hp !== undefined) {
          const hpDelta = (updates.hp as number) - c.hp;
          if (hpDelta < 0) {
            resourceRpcs.push(db.rpc('encounter_apply_character_damage', {
              _character_id: m.id, _amount: -hpDelta,
              _source_kind: 'combat-tick', _source_creature_id: null,
            }));
          } else if (hpDelta > 0) {
            resourceRpcs.push(db.rpc('encounter_apply_character_heal', {
              _character_id: m.id, _amount: hpDelta, _source_kind: 'combat-tick',
            }));
          }
          delete updates.hp;
        }
        if (updates.cp !== undefined) {
          const cpDelta = (updates.cp as number) - (c.cp ?? 0);
          if (cpDelta !== 0) {
            resourceRpcs.push(db.rpc('encounter_apply_character_resource', {
              _character_id: m.id, _resource: 'cp', _delta: cpDelta,
              _source_kind: 'combat-tick',
            }));
          }
          delete updates.cp;
        }
      }

      if (Object.keys(updates).length > 0) {
        memberUpdatePromises.push(db.from('characters').update(updates).eq('id', m.id));
      }
      if (resourceRpcs.length > 0) {
        memberUpdatePromises.push(Promise.all(resourceRpcs));
      }

      memberStates.push({
        character_id: m.id,
        hp: updates.hp ?? mHp[m.id],
        xp: updates.xp ?? c.xp,
        gold: updates.gold ?? c.gold,
        level: newLevel,
        max_hp: newMaxHp,
        bhp: updates.bhp ?? (c.bhp || 0),
        rp_total_earned: updates.rp_total_earned ?? (c.rp_total_earned || 0),
        unspent_stat_points: updates.unspent_stat_points ?? c.unspent_stat_points ?? 0,
        max_cp: updates.max_cp ?? c.max_cp,
        max_mp: updates.max_mp ?? c.max_mp,
        respec_points: updates.respec_points ?? c.respec_points ?? 0,
        cp: updates.cp ?? mCp[m.id],
      });
    }

    // ── Graced (recently-departed) recipients: apply rewards only ─
    // These characters earned XP/gold/Renown/salvage from kills this tick
    // because they were at the node within the grace window, but they are
    // NOT active combatants — skip HP/CP/death/stance handling entirely.
    for (const m of gracedExtras) {
      const c = m.c;
      const eb = eq[m.id] || {};
      const updates: Record<string, any> = {};
      let newXp = c.xp + (mXp[m.id] || 0);
      let newGold = c.gold + (mGold[m.id] || 0);
      let newLevel = c.level;
      let newMaxHp = c.max_hp;

      if ((mXp[m.id] || 0) > 0 || (mGold[m.id] || 0) > 0) {
        const needed = xpForLevel(c.level);
        if (newXp >= needed && c.level < 42) {
          newLevel = c.level + 1;
          newXp -= needed;
          updates.level = newLevel;
          updates.unspent_stat_points = (c.unspent_stat_points || 0) + 1;
          if (newLevel % 3 === 0) {
            const bonuses = CLASS_LVL_BONUS[c.class] || {};
            const bonusNames: string[] = [];
            for (const [s, amt] of Object.entries(bonuses)) {
              updates[s] = (c[s] || 10) + amt;
              bonusNames.push(`+${amt} ${s.toUpperCase()}`);
            }
            if (bonusNames.length) {
              events.push({ type: 'level_bonus', message: `📈 ${CLASS_LABELS[c.class] || c.class} bonus: ${bonusNames.join(', ')}!` });
            }
          }
          if ([10, 20, 30, 40].includes(newLevel)) {
            updates.respec_points = (c.respec_points || 0) + 1;
            events.push({ type: 'respec', message: `🔄 ${c.name} earned a respec point!` });
          }
          if (newLevel === 42) {
            princeAscensions.push({ characterId: m.id, characterName: c.name, gender: c.gender || 'male', charClass: c.class });
          }
          const fInt = (updates.int ?? c.int) + (eb.int || 0);
          const fWis = (updates.wis ?? c.wis) + (eb.wis || 0);
          const fDex = (updates.dex ?? c.dex) + (eb.dex || 0);
          const fCon = (updates.con ?? c.con) + (eb.con || 0);
          newMaxHp = calcMaxHp(c.class, fCon, newLevel) + (eb.hp || 0);
          updates.max_hp = newMaxHp;
          updates.hp = newMaxHp;
          updates.max_cp = calcMaxCp(newLevel, fWis);
          updates.max_mp = calcMaxMp(newLevel, fDex);
          events.push({ type: 'level_up', character_id: m.id, message: `🎉 Level Up! ${c.name} is now level ${newLevel}!` });
          events.push({ type: 'stat_point', message: `📊 ${c.name} gained 1 stat point to allocate!` });
        }
        if (newLevel >= 42) newXp = 0;
        updates.xp = newXp;
        updates.gold = newGold;
      }
      if ((mBhp[m.id] || 0) > 0) {
        updates.bhp = (c.bhp || 0) + mBhp[m.id];
        updates.rp_total_earned = (c.rp_total_earned || 0) + mBhp[m.id];
      }
      if ((mSalvage[m.id] || 0) > 0) {
        materialAddPromises.push(
          db.rpc('add_material', { _character_id: m.id, _key: 'salvage', _delta: mSalvage[m.id] })
        );
      }
      if (Object.keys(updates).length > 0) {
        memberUpdatePromises.push(db.from('characters').update(updates).eq('id', m.id));
      }
      memberStates.push({
        character_id: m.id,
        hp: updates.hp ?? c.hp,
        xp: updates.xp ?? c.xp,
        gold: updates.gold ?? c.gold,
        level: newLevel,
        max_hp: newMaxHp,
        bhp: updates.bhp ?? (c.bhp || 0),
        rp_total_earned: updates.rp_total_earned ?? (c.rp_total_earned || 0),
        unspent_stat_points: updates.unspent_stat_points ?? c.unspent_stat_points ?? 0,
        max_cp: updates.max_cp ?? c.max_cp,
        max_mp: updates.max_mp ?? c.max_mp,
        respec_points: updates.respec_points ?? c.respec_points ?? 0,
        cp: c.cp ?? 0,
      });
    }



    // ── Equipment degradation promises ──────────────────────────
    const degradePromises = [...degradeSet].map(async (cid) => {
      const { data: equipped } = await db
        .from('character_inventory')
        .select('id, current_durability, item:items(rarity, name)')
        .eq('character_id', cid)
        .not('equipped_slot', 'is', null);
      if (!equipped || equipped.length === 0) return;
      const pick = equipped[Math.floor(Math.random() * equipped.length)];
      const rarity = (pick.item as any)?.rarity;
      if (pick.current_durability <= 1) {
        if (rarity === 'unique') {
          await db.from('character_inventory').delete().eq('id', pick.id);
        } else {
          await db.from('character_inventory').update({ current_durability: 0, equipped_slot: null } as any).eq('id', pick.id);
        }
      } else {
        await db.from('character_inventory').update({ current_durability: pick.current_durability - 1 }).eq('id', pick.id);
      }
    });

    // ── Prepare effect data ─────────────────────────────────────
    const expiredIds = activeEffects.filter(e => e._expired).map(e => e.id);
    const liveEffects = activeEffects.filter(e => !e._expired && !killedCreatureIds.has(e.target_id));

    // ── PHASE A: Independent writes (parallel) ──────────────────
    const contractPromises = contractCompletions.map(cid => {
      const ch = [...members, ...gracedExtras].find(mm => mm.id === cid)?.c;
      const newCount = (ch?.contracts_completed || 0) + 1;
      return db.rpc('apply_contract_complete', { _character_id: cid, _new_count: newCount });
    });
    const [authoritativeCreatureHp] = await Promise.all([
      writeCreatureState(db, creatures, cHp, cKilled, {
        sourceCharacterId: session.character_id,
        sourceKind: 'autoattack',
      }),
      cleanupEffects(db, expiredIds, killedCreatureIds),
      ...memberUpdatePromises,
      ...materialAddPromises,
      ...degradePromises,
      ...contractPromises,
    ]);


    // ── PHASE B: Order-dependent writes (sequential) ────────────
    // Loot depends on killed creatures being persisted
    const lootEvents = await processLootDrops(db, lootQueue);
    events.push(...lootEvents);

    // Apply gem drops via the unified materials helper (one add_material call
    // per drop) into character_materials.
    if (gemDropQueue.length > 0) {
      const counts = new Map<string, number>(); // key: `${memberId}|${gemKey}`
      for (const gd of gemDropQueue) {
        const k = `${gd.memberId}|${gd.gemKey}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const gemPromises: Promise<any>[] = [];
      for (const [k, n] of counts) {
        const [memberId, gemKey] = k.split('|');
        gemPromises.push(
          db.rpc('add_material', { _character_id: memberId, _key: gemKey, _delta: n })
        );
      }
      await Promise.all(gemPromises);
    }

    // Apply class-bond gains. The RPC reads the recipient's active class
    // and is a no-op for classless characters. Failures are logged but
    // never block the tick response.
    if (bondGainQueue.length > 0) {
      await Promise.all(bondGainQueue.map(bg =>
        db.rpc('award_class_bond_for_kill', {
          _character_id: bg.memberId,
          _creature_level: bg.creatureLevel,
          _is_boss: bg.isBoss,
        }).then((r: any) => {
          if (r?.error) console.error('award_class_bond_for_kill failed', r.error);
        })
      ));
    }

    // Batch effect upsert after cleanup to avoid conflicts
    if (liveEffects.length > 0) {
      const rows = liveEffects.map(e => { const { _expired, ...row } = e; return row; });
      await db.from('active_effects').upsert(rows, { onConflict: 'source_id,target_id,effect_type' });
    }

    // Cleanup expired item_buff:* rows (own expiry path — combat-resolver
    // skips them because target_id is a player, not a creature in cHp).
    await db.from('active_effects')
      .delete()
      .like('effect_type', 'item_buff:%')
      .lte('expires_at', now);


    // ── Check if session should end ─────────────────────────────
    // Session ends when no alive engaged creatures remain.
    // Effects persist independently in active_effects and are reconciled by combat-catchup.
    const anyAlive = creatures.some(cr => !cKilled.has(cr.id) && cHp[cr.id] > 0);
    const sessionEnded = !anyAlive;

    if (sessionEnded) {
      await db.from('combat_sessions').delete().eq('id', session.id);
      console.log(JSON.stringify({ fn: 'combat-tick', session_deleted_reason: 'no_creatures_alive', session_id: session.id }));
    } else {
      // Refresh the recent-member presence map so the grace window covers
      // anyone currently at the combat node. Prune entries older than 30s.
      const newRecent: Record<string, { last_at_node_ms: number }> = { ...recentMap };
      for (const m of members) newRecent[m.id] = { last_at_node_ms: now };
      for (const k of Object.keys(newRecent)) {
        if (now - (newRecent[k]?.last_at_node_ms || 0) > 30000) delete newRecent[k];
      }
      await db.from('combat_sessions').update({
        last_tick_at: newLastTickAt,
        engaged_creature_ids: [...sessionEngaged],
        member_buffs: buffs,
        node_id: combatNodeId,
        recent_member_ids: newRecent,
      }).eq('id', session.id);
    }


    // ── Response ─────────────────────────────────────────────────
    // Only emit HP for creatures the tick actually simulated. Emitting stale
    // snapshot HP for non-combat creatures caused client overrides to snap the
    // HP bar back up mid-fight when concurrent writers (DoT wake-up, another
    // player's tick) had already lowered the DB HP between our snapshot and
    // this response.
    // Only include creatures whose HP actually changed this tick, or that we
    // killed. Echoing the snapshot HP for unchanged creatures caused the client
    // to override its (fresher) realtime HP with our older tick-start value.
    const creature_states = creatures
      .filter(cr => cHp[cr.id] !== cr.hp || cKilled.has(cr.id))
      .map(cr => ({
        id: cr.id,
        hp: authoritativeCreatureHp?.[cr.id] ?? cHp[cr.id],
        alive: !cKilled.has(cr.id) && (authoritativeCreatureHp?.[cr.id] ?? cHp[cr.id]) > 0,
      }));



    // ── Diagnostics ───────────────────────────────────────────────
    const requestDurationMs = Date.now() - _requestT0;
    console.log(JSON.stringify({
      fn: 'combat-tick',
      session_id: session.id,
      node_id: combatNodeId,
      last_tick_at_read: session.last_tick_at,
      elapsed_ms: elapsedMs,
      ticks_processed: ticks,
      ticks_capped: ticksToProcess > TICK_CAP,
      session_just_created: sessionJustCreated,
      engaged_count: sessionEngaged.size,
      effects_count: liveEffects.length,
      session_ended: sessionEnded,
      request_duration_ms: requestDurationMs,
    }));

    // ── Build buff sync (remaining absorb shield HP) ────────────
    const buffSync: Record<string, { absorb_remaining: number }> = {};
    for (const cid of charIds) {
      const mb = buffs[cid];
      if (mb?.absorb_buff && mb.absorb_buff.shield_hp !== undefined) {
        buffSync[cid] = { absorb_remaining: mb.absorb_buff.shield_hp };
      }
    }

    // ── King Aldric crowning + world broadcast ──────────────────
    // Only the killing-blow attacker is crowned. If multiple parallel kills
    // are queued in the same tick (extreme edge case), the last one wins —
    // crown_king_slayer is atomic and always leaves at most one king.
    if (kingCrownings.length > 0) {
      const slayer = kingCrownings[kingCrownings.length - 1];
      try {
        await db.rpc('crown_king_slayer', { _character_id: slayer.characterId });
        const titleWord = slayer.gender === 'female' ? 'Queen' : 'King';
        const worldChannel = db.channel('world-global');
        await worldChannel.send({
          type: 'broadcast',
          event: 'world',
          payload: {
            kind: 'king_crowned',
            icon: '👑',
            text: `King Aldric Vael has fallen. ${slayer.characterName} is now ${titleWord} of Varneth.`,
            actor: slayer.characterName,
            nonce: `aldric:${Date.now()}`,
          },
        });
      } catch (e) {
        console.error('[combat-tick] king crowning failed', e);
      }
    }

    // ── Prince/Princess ascension world broadcast (Level 42) ────
    if (princeAscensions.length > 0) {
      try {
        const worldChannel = db.channel('world-global');
        for (const p of princeAscensions) {
          const titleWord = p.gender === 'female' ? 'Princess' : 'Prince';
          await worldChannel.send({
            type: 'broadcast',
            event: 'world',
            payload: {
              kind: 'prince_ascended',
              icon: '👑',
              text: `${p.characterName} has ascended to the peak of mortal strength and is now ${titleWord} of the realm.`,
              actor: p.characterName,
              nonce: `prince:${p.characterId}:${Date.now()}`,
            },
          });
        }
      } catch (e) {
        console.error('[combat-tick] prince ascension broadcast failed', e);
      }
    }



    // ── Combat Audit Log (overlord-only opt-in per character) ────
    try {
      const tracedIds = new Set(
        members.filter(m => (m.c as any)?.combat_trace_enabled).map(m => m.id)
      );
      if (tracedIds.size > 0 && events.length > 0) {
        const rows: any[] = [];
        for (const ev of events) {
          const evType = (ev as any).type ?? null;
          // Emit tick_separator rows for EVERY traced character so the audit
          // panel can visually break each simulated sub-tick apart. These
          // events have no character_id on their own.
          if (evType === 'tick_separator') {
            for (const tid of tracedIds) {
              const member = members.find(m => m.id === tid);
              rows.push({
                character_id: tid,
                character_name: member?.c?.name ?? null,
                node_id: node_id ?? null,
                event_type: 'tick_separator',
                message: '---tick---',
                payload: ev,
              });
            }
            continue;
          }
          const cid = (ev as any).character_id;
          if (!cid || !tracedIds.has(cid)) continue;
          const member = members.find(m => m.id === cid);
          rows.push({
            character_id: cid,
            character_name: member?.c?.name ?? null,
            node_id: node_id ?? null,
            event_type: evType,
            message: (ev as any).message ?? '',
            payload: ev,
          });
        }
        if (rows.length > 0) {
          await db.from('combat_audit_log').insert(rows);
        }
      }
    } catch (e) {
      console.error('[combat-tick] audit log write failed', e);
    }

    return json({
      events, creature_states, member_states: memberStates,
      consumed_buffs: consumedBuffsList, cleared_dots: clearedDots,
      consumed_ability_stacks: consumedAbilityStacks,
      active_effects: liveEffects.map(e => ({ source_id: e.source_id, target_id: e.target_id, effect_type: e.effect_type, stacks: e.stacks, damage_per_tick: e.damage_per_tick, expires_at: e.expires_at, next_tick_at: e.next_tick_at, tick_rate_ms: e.tick_rate_ms ?? 2000 })),
      session_ended: sessionEnded,
      ticks_processed: ticks,
      buff_sync: Object.keys(buffSync).length > 0 ? buffSync : undefined,
    });

  } catch (err) {
    console.error('Combat tick error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
