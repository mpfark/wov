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
import {
  resolveEffectTicks,
  processLootDrops,
  writeCreatureState,
  cleanupEffects,
  type LootQueueEntry,
} from "../_shared/combat-resolver.ts";
import { formatProcMessage } from "../_shared/proc-log-format.ts";
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
  GLANCING_WEAK_CAP,
  getCreatureAttackBonus as creatureAtkBonus,
  getShieldBlockChance,
  getShieldBlockAmount,
  getShieldWallChanceBonus,
  getShieldWallAmountBonus,
  type HitQuality,
} from "../_shared/formulas/combat.ts";
import {
  getArcaneSurgeMult,
  getConflagratePerStack,
  getEnvenomProc,
  getEnvenomMaxStacks,
  getIgniteOrbChance,
  getBattleCryDR,
} from "../_shared/formulas/abilities.ts";
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
        mHp[attackerId] = Math.min(mHp[attackerId] + proc.value, maxHp);
        events.push({ type: 'proc', message, character_id: attackerId });
        break;
      }
      case 'burst_damage': {
        if (cKilled.has(targetId)) break;
        cHp[targetId] = Math.max(cHp[targetId] - proc.value, 0);
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
// NOT share the autoattack weapon-die path. CLASS_COMBAT_PROFILES is no
// longer referenced here; CLASS_CRIT_RANGE / WEAPON_EMOJI carry the
// remaining class flavor.

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
        return json({ events: [], creature_states: [], member_states: [], ticks_processed: 0 });
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

    // ── Parallel fetch: equipment, creatures, effects, xp_boost ──
    const charIds = members.map(m => m.id);
    const combatNodeId = session.node_id;
    const [equipRes, creaturesRes, effectsRes, xpRes, weaponCfgRes, bondsRes] = await Promise.all([
      db.from('character_inventory')
        .select('character_id, equipped_slot, item:items(stats, weapon_tag, hands, procs, level)')
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
        for (const [s, v] of Object.entries((e.item as any)?.stats || {})) {
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

    for (const cr of creatures) cHp[cr.id] = cr.hp;
    for (const m of members) {
      mHp[m.id] = m.c.hp;
      mXp[m.id] = 0; mGold[m.id] = 0; mBhp[m.id] = 0; mSalvage[m.id] = 0;
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
        if (reserved.ignite)       mb.ignite_buff = true;
        if (reserved.envenom)      mb.poison_buff = true;
        if (reserved.eagle_eye) {
          // Dual-primary (Ranger DEX+WIS): blended focused vision. Cap 5.
          const blended = Math.max(1, Math.min(5, Math.floor((dexMod + wisMod) / 2)));
          mb.crit_buff = { bonus: blended };
        }
        if (reserved.arcane_surge) mb.damage_buff = true;
        if (reserved.battle_cry) {
          // Dual-primary (Warrior STR+DEX): magnitude scales with STR (and +5%
          // shield bonus), duration is implicit via the stance. Crit reduction
          // shares the curve. Hardcoded values have been retired.
          const cStr = (m.c.str || 10) + ((eq[m.id] as any)?.str || 0);
          const strMod = Math.max(0, Math.floor((cStr - 10) / 2));
          const hasShield = isShield(offHandTag[m.id]);
          const { dr, critReduction } = getBattleCryDR(strMod, hasShield);
          mb.battle_cry_dr = { reduction: dr, crit_reduction: critReduction };
        }
        if (reserved.holy_shield) {
          // Dual-primary (Templar WIS+CON): magnitude = WIS, CON adds to retaliation damage.
          mb.holy_shield = { wis_mod: wisMod, con_mod: conMod, expires_at: farFuture };
        }
        if (reserved.shield_wall) {
          // Dual-primary (Templar WIS+CON): WIS → bonus block chance,
          // CON → bonus block amount. Requires a shield equipped to actually
          // benefit; the block step below reads both fields.
          mb.shield_wall_stance = {
            chance_bonus: getShieldWallChanceBonus(cWis),
            amount_bonus: getShieldWallAmountBonus(cCon),
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
          const shieldCapRaw = Math.max(1, wisMod + Math.floor((m.c.level || 1) * 0.5));
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

      // Recipients = every member in this combat session (party-at-node, or solo).
      const recipients = members.map(mm => ({
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

    for (const pa of pendingAbilities) {
      const member = members.find(m => m.id === pa.character_id);
      if (!member) continue;
      const c = member.c;
      const eb = eq[member.id] || {};

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
        const arrowCount = Math.min(4, 2 + (dexMod >= 3 ? 1 : 0) + (wisMod >= 4 ? 1 : 0));
        const { die: arrowDie, tag: arrowTag } = getMemberWeaponDie();
        const arrowBonus = Math.max(0, Math.floor(dexMod / 2));
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
            let arrowDmg = Math.max(rollDmg(1, arrowDie) + arrowBonus, 1);
            if (isCrit) arrowDmg *= 2;
            if (isStealth) arrowDmg = Math.max(Math.floor(arrowDmg * stealthMult), 1);
            if (isDmgBuff) arrowDmg = Math.floor(arrowDmg * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0))));
            if (hasDisengage) arrowDmg = Math.floor(arrowDmg * (1 + disengageMult));
            arrowDmg = Math.max(arrowDmg, 1);
            arrowDmg = Math.max(1, Math.floor(arrowDmg * mBondMult[member.id]));
            totalDmg += arrowDmg;
            cHp[t.id] = Math.max(cHp[t.id] - arrowDmg, 0);
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
        // Eviscerate (Rogue / dual-primary DEX+CHA finisher): damage = 1d{weaponDie} + dexMod + ability bonus.
        // Per-stack bonus scales with CHA showmanship. Rolls to hit on DEX.
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const effCha = (c.cha || 10) + (eb.cha || 0);
        const dexMod = sm(effDex);
        const chaMod = sm(effCha);
        const stacks = Math.min(pa.consume_stacks || 0, 5);
        // Resolve weapon once so miss + hit + tag all share the same source.
        const { die: evisDie, tag: evisTag } = getMemberWeaponDie();
        const hit = rollAbilityHit(dexMod);
        if (!hit.hit) {
          // Strike committed — poison stacks still consumed on miss.
          const stackNote = stacks > 0 ? `, wasting ${stacks} poison stack${stacks > 1 ? 's' : ''}` : '';
          events.push({ type: 'ability_miss', message: `🔪 ${c.name}'s Eviscerate misses ${target.name}${stackNote}!`, character_id: member.id, weapon_tag: evisTag });
          if (stacks > 0) consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'poison' });
          continue;
        }
        // Weapon-die roll + DEX (soft-scaled via 'damage' profile) + level bonus.
        // CHA per-stack rider uses 'stacking' profile — high CHA still climbs, just slower.
        const effDexDmg = getEffectiveCombatMod(Math.max(0, dexMod), 'damage');
        const effChaStack = getEffectiveCombatMod(Math.max(0, chaMod), 'stacking');
        const weaponRoll = rollDmg(1, evisDie);
        const abilityBonus = 2 + effDexDmg + Math.floor((c.level || 1) / 3);
        const baseDmg = weaponRoll + dexMod + abilityBonus;
        const perStackBonus = 0.50 + effChaStack * 0.02;
        const multiplier = 1 + perStackBonus * stacks;
        const finalDmg = Math.max(1, Math.floor(Math.round(baseDmg * multiplier) * mBondMult[member.id]));
        cHp[target.id] = Math.max(cHp[target.id] - finalDmg, 0);
        if (stacks > 0) {
          events.push({ type: 'ability_hit', message: `🔪 ${c.name} eviscerates ${target.name}, consuming ${stacks} poison stack${stacks > 1 ? 's' : ''}! [${finalDmg}]`, character_id: member.id, weapon_tag: evisTag });
          consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'poison' });
        } else {
          events.push({ type: 'ability_hit', message: `🔪 ${c.name} strikes ${target.name} (no poison stacks). [${finalDmg}]`, character_id: member.id, weapon_tag: evisTag });
        }
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0), member.id);
        }

      } else if (pa.ability_type === 'ignite_consume') {
        // Conflagrate (Wizard / dual-primary INT+WIS): base = 4 + 2*intMod + floor(level/3).
        // Per-stack bonus scales with INT. Burn stack count scales with WIS via Ignite. Rolls to hit on INT.
        const effInt = (c.int || 10) + (eb.int || 0);
        const intMod = sm(effInt);
        const stacks = Math.min(pa.consume_stacks || 0, 5);
        const hit = rollAbilityHit(intMod);
        if (!hit.hit) {
          const stackNote = stacks > 0 ? `, squandering ${stacks} burn stack${stacks > 1 ? 's' : ''}` : '';
          events.push({ type: 'ability_miss', message: `💥 ${c.name}'s Conflagrate fizzles against ${target.name}${stackNote}!`, character_id: member.id });
          if (stacks > 0) consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'ignite' });
          continue;
        }
        // Soft-scaled INT base (profile 'burst'). Per-stack bonus already uses
        // diminishingFloat in getConflagratePerStack, so no additional scaling there.
        const effIntBurst = getEffectiveCombatMod(Math.max(0, intMod), 'burst');
        const baseDmg = Math.round(4 + 2 * effIntBurst + Math.floor((c.level || 1) / 3));
        const perStackBonus = getConflagratePerStack(intMod);
        const multiplier = 1 + perStackBonus * stacks;
        let finalDmg = Math.max(Math.floor(baseDmg * multiplier), 1);
        // Arcane Surge empowers all wizard damage
        if (buffs[member.id]?.damage_buff) finalDmg = Math.max(Math.floor(finalDmg * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0)))), 1);
        finalDmg = Math.max(1, Math.floor(finalDmg * mBondMult[member.id]));
        cHp[target.id] = Math.max(cHp[target.id] - finalDmg, 0);
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
        // Resolve main-hand weapon once so both damage and event share the same tag.
        const t0Weapon = isPhysT0 ? getMemberWeaponDie() : null;
        const hit = rollAbilityHit(mod);
        if (!hit.hit) {
          events.push({
            type: 'ability_miss',
            message: `${emoji} ${c.name} ${verb} ${target.name} — misses!`,
            character_id: member.id,
            ...(t0Weapon ? { weapon_tag: t0Weapon.tag } : {}),
          });
          continue;
        }
        // Soft-scaled primary stat (profile 'damage') — late-game stacking has
        // reduced marginal gain past softCap=20; no hard ceiling.
        const effMod = getEffectiveCombatMod(Math.max(0, mod), 'damage');
        let dmg: number;
        if (t0Weapon) {
          const weaponRoll = rollDmg(1, t0Weapon.die);
          const abilityBonus = Math.round(3 + effMod + Math.floor((c.level || 1) / 3));
          dmg = Math.max(1, weaponRoll + mod + abilityBonus);
        } else {
          dmg = Math.max(1, Math.round(5 + 2 * effMod + Math.floor((c.level || 1) / 3)));
        }
        // Arcane Surge empowers all wizard damage (only fireball benefits, but
        // gating purely on damage_buff keeps the rule consistent for any class
        // that ever picks it up).
        if (buffs[member.id]?.damage_buff) dmg = Math.max(Math.floor(dmg * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0)))), 1);
        dmg = Math.max(1, Math.floor(dmg * mBondMult[member.id]));
        cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);
        events.push({
          type: 'ability_hit',
          message: `${emoji} ${c.name} ${verb} ${target.name}. [${dmg}]`,
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
        const baseDmg = Math.max(8, Math.round(effChaBurst * 4 + Math.floor(c.level * 1.5)));
        let damage = baseDmg + rollDmg(1, Math.max(1, Math.round(effChaBurst * 2)));
        // INT crit-edge: d20 vs crit threshold lowered by floor(intMod/2). Floor 17.
        const critRoll = rollD20();
        const critThreshold = Math.max(17, 20 - Math.floor(Math.max(0, intMod) / 2));
        const isFinaleCrit = critRoll >= critThreshold;
        if (isFinaleCrit) damage = damage * 2;
        // Damage buffs (e.g. Arcane Surge, future bardic empowerments) scale Grand Finale.
        if (buffs[member.id]?.damage_buff) damage = Math.max(Math.floor(damage * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0)))), 1);
        damage = Math.max(1, Math.floor(damage * mBondMult[member.id]));
        cHp[target.id] = Math.max(cHp[target.id] - damage, 0);
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
        const hit = rollAbilityHit(dexMod);
        if (!hit.hit) {
          events.push({ type: 'ability_miss', message: `🩸 ${c.name}'s Rend glances off ${target.name} — no wound opens.`, character_id: member.id });
          continue;
        }

        // Soft-scaled STR contribution (profile 'dot') + weapon-die avg / 3.
        const { die: rendDie } = getMemberWeaponDie();
        const weaponAvg = (rendDie + 1) / 2; // average roll of 1d{die}
        const effStrDot = getEffectiveCombatMod(Math.max(0, strMod), 'dot');
        let dmgPerTick = Math.max(1, Math.floor((weaponAvg + effStrDot + 2) / 3 * 0.67 + effStrDot * 0.5));
        // Damage buffs (e.g. Arcane Surge, future warrior empowerments) bake into
        // the bleed at apply time so the DoT inherits the boost for its full duration.
        if (buffs[member.id]?.damage_buff) dmgPerTick = Math.max(Math.floor(dmgPerTick * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0)))), 1);
        dmgPerTick = Math.max(1, Math.floor(dmgPerTick * mBondMult[member.id])); // Bond mastery scalar
        const durationMs = Math.min(30000, 20000 + Math.max(0, dexMod) * 1000);

        const existing = activeEffects.find(e => e.source_id === member.id && e.target_id === target.id && e.effect_type === 'bleed');
        const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
        const effData = {
          node_id: combatNodeId, target_id: target.id, source_id: member.id,
          session_id: null, effect_type: 'bleed',
          stacks: newStacks, damage_per_tick: dmgPerTick,
          // Preserve cadence on refresh so re-applying Rend doesn't reset the next tick.
          next_tick_at: existing ? existing.next_tick_at : now + TICK_RATE,
          expires_at: now + durationMs,
          tick_rate_ms: TICK_RATE,
        };
        if (existing) {
          Object.assign(existing, effData);
        } else {
          activeEffects.push({ id: crypto.randomUUID(), ...effData });
        }
        events.push({ type: 'bleed_applied', message: `🩸 ${c.name} rends ${target.name} — blood weeps from the gash! [${dmgPerTick}/tick]`, character_id: member.id });
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
        if (isCrit) dmg = Math.max(Math.floor(dmg * 1.5), 1);
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
            const stanceTag = sw ? ` 🛡️ (Shield Wall +${bonusAmt})` : '';
            events.push({ type: 'shield_block', message: `🛡️ ${targetName} raises their shield and turns the blow!${stanceTag} [${blockAmt}]`, character_id: targetId });
            if (dmg <= 0) return;
          }
        }

        // 6. Absorb shield
        if (mb.absorb_buff?.shield_hp && mb.absorb_buff.shield_hp > 0) {
          const absorbed = Math.min(dmg, mb.absorb_buff.shield_hp);
          mb.absorb_buff.shield_hp -= absorbed;
          dmg -= absorbed;
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

        // 7b. Divine Challenge (Templar) — bond multiplier scales DR.
        if (mb.divine_challenge && (mb.divine_challenge.expires_at ?? 0) > now) {
          const bondM = mBondMult[targetId] ?? 1;
          const dr = Math.min(0.95, (mb.divine_challenge.reduction || 0.30) * bondM);
          const preDmg = dmg;
          dmg = Math.max(Math.floor(dmg * (1 - dr)), 1);
          events.push({ type: 'divine_challenge_dr', message: `⚜️ ${targetName}'s Divine Challenge mitigates the strike! [${preDmg - dmg}]`, character_id: targetId });
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


        mHp[targetId] = Math.max(mHp[targetId] - dmg, 0);
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
            const wisModForReturn = getEffectiveCombatMod(Math.max(0, sm(effectiveWis)), 'damage');
            const conKicker = getEffectiveCombatMod(Math.max(0, mb.holy_shield.con_mod ?? 0), 'damage');
            const returnDmgBase = Math.max(1, Math.round(2 + wisModForReturn + conKicker + Math.floor((targetC.level || 1) / 4)));
            const returnDmg = Math.max(1, Math.floor(returnDmgBase * (mBondMult[targetId] ?? 1)));
            cHp[creature.id] = Math.max(cHp[creature.id] - returnDmg, 0);
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
        const healAmt = Math.max(1, Math.floor((2 + consWis) * bm));
        const burnAmt = Math.max(1, Math.floor((2 + consWis) * bm));

        // Heal all alive members on this node (members[] is already filtered)
        for (const ally of members) {
          if (mHp[ally.id] <= 0) continue;
          const allyMaxHp = ally.c.max_hp || 1;
          const before = mHp[ally.id];
          mHp[ally.id] = Math.min(before + healAmt, allyMaxHp);
          const restored = mHp[ally.id] - before;
          if (restored > 0) {
            events.push({
              type: 'consecrate_heal',
              message: `🔆 Consecrated ground soothes ${ally.c.name}. [${restored}]`,
              character_id: ally.id,
            });
          }
        }

        // Burn every engaged, alive creature
        for (const cr of creatures) {
          if (cKilled.has(cr.id) || cHp[cr.id] <= 0) continue;
          cHp[cr.id] = Math.max(cHp[cr.id] - burnAmt, 0);
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
      // threshold (rogue 19) and weapon affinity. The 2H damage benefit is
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
          if (isDmgBuff) dmg = Math.floor(dmg * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0))));
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

          cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);
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

          // Envenom (Rogue / dual-primary DEX+CHA): proc chance scales with DEX,
          // max stack ceiling scales with CHA. Per-tick damage already scales with DEX.
          const dexMod = sm((c.dex || 10) + (eb.dex || 0));
          const chaMod = sm((c.cha || 10) + (eb.cha || 0));
          const envenomProc = getEnvenomProc(dexMod);
          const envenomMaxStacks = getEnvenomMaxStacks(chaMod);
          if (mb.poison_buff && Math.random() < envenomProc) {
            // Server-side DoT creation: upsert poison into active_effects.
            // IMPORTANT: when refreshing an existing stack, preserve `next_tick_at`
            // so the tick cadence isn't reset every proc — otherwise repeated
            // procs in consecutive heartbeats would push the next tick forward
            // forever and the DoT would never deal damage.
            const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'poison');
            const newStacks = existing ? Math.min(existing.stacks + 1, envenomMaxStacks) : 1;
            // Soft-scaled DEX contribution (profile 'dot') — per-tick poison damage.
            const effDexDot = getEffectiveCombatMod(Math.max(0, dexMod), 'dot');
            const dmgPerTick = Math.max(1, Math.floor(effDexDot * 1.2 * 0.67 * (mBondMult[m.id] ?? 1)));
            const effData = {
              node_id: combatNodeId, target_id: target.id, source_id: m.id,
              session_id: null, effect_type: 'poison',
              stacks: newStacks, damage_per_tick: dmgPerTick,
              next_tick_at: existing ? existing.next_tick_at : tickTime + TICK_RATE,
              expires_at: tickTime + 25000,
              tick_rate_ms: TICK_RATE,
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
          if (isDmgBuff2) dmg2 = Math.max(Math.floor(dmg2 * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0)))), 1);

          // Clamp minimum 1
          dmg2 = Math.max(dmg2, 1);
          // Glancing cap (always); weak cap only when margin < -2
          if (quality2 === 'glancing') dmg2 = Math.min(dmg2, GLANCING_WEAK_CAP);
          if (quality2 === 'weak' && margin2 < -2) dmg2 = Math.min(dmg2, GLANCING_WEAK_CAP);

          // Bond multiplier (class-only mastery scalar).
          dmg2 = Math.max(1, Math.floor(dmg2 * mBondMult[m.id]));

          cHp[target.id] = Math.max(cHp[target.id] - dmg2, 0);
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
        if (Math.random() >= getIgniteOrbChance(intMod)) continue;
        // Direct pulse damage = INT (the spark / blast).
        let pulseDmg = Math.max(1, 2 + intMod);
        if (mb.damage_buff) pulseDmg = Math.max(Math.floor(pulseDmg * getArcaneSurgeMult(sm((c.int||10)+(eb.int||0)))), 1);
        pulseDmg = Math.max(1, Math.floor(pulseDmg * (mBondMult[m.id] ?? 1)));

        cHp[target.id] = Math.max(cHp[target.id] - pulseDmg, 0);

        // Upsert burn DoT — damage-per-tick + duration scale from WIS
        // (sustained, lingering flame). Pulse and burn read different stats
        // so wizards genuinely benefit from both primaries.
        const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'ignite');
        const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
        // Soft-scaled WIS contribution (profile 'dot') — burn per-tick damage.
        const effWisDot = getEffectiveCombatMod(Math.max(0, wisMod), 'dot');
        const dmgPerTick = Math.max(1, Math.floor(effWisDot * 0.7 * 0.67 * (mBondMult[m.id] ?? 1)));
        const duration = Math.min(45000, 30000 + wisMod * 1000);
        const effData = {
          node_id: combatNodeId, target_id: target.id, source_id: m.id,
          session_id: null, effect_type: 'ignite',
          stacks: newStacks, damage_per_tick: dmgPerTick,
          // Preserve cadence on refresh — see poison comment above.
          next_tick_at: existing ? existing.next_tick_at : tickTime + TICK_RATE,
          expires_at: tickTime + duration,
          tick_rate_ms: TICK_RATE,
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
          message: `🔥 A flaming orb leaps from ${c.name} and sears ${target.name} (burn x${newStacks})! [${pulseDmg}]`,
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
        const cs = creature.stats as any;
        const cStr = sm(cs.str || 10);
        const dmgDie = creatureDmgDie(creature.level, creature.rarity);

        if (tankAtNode) {
          const tank = members.find(m => m.id === tankId);
          if (!tank || mHp[tankId!] <= 0) continue;
          applyCreatureHit(tankId!, tank.c.name, tank.c, eq[tankId!] || {}, creature, cStr, dmgDie, '🛡️ ');
        } else {
          const alive = members.filter(m => mHp[m.id] > 0);
          if (alive.length === 0) continue;
          const target = alive[Math.floor(Math.random() * alive.length)];
          applyCreatureHit(target.id, target.c.name, target.c, eq[target.id] || {}, creature, cStr, dmgDie, '');
        }
      }
    } // end tick loop

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

      if (Object.keys(updates).length > 0) {
        memberUpdatePromises.push(db.from('characters').update(updates).eq('id', m.id));
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
    await Promise.all([
      writeCreatureState(db, creatures, cHp, cKilled),
      cleanupEffects(db, expiredIds, killedCreatureIds),
      ...memberUpdatePromises,
      ...materialAddPromises,
      ...degradePromises,
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
      await db.from('combat_sessions').update({
        last_tick_at: newLastTickAt,
        engaged_creature_ids: [...sessionEngaged],
        member_buffs: buffs,
        node_id: combatNodeId,
      }).eq('id', session.id);
    }

    // ── Response ─────────────────────────────────────────────────
    const combatCreatureStates = creatures.map(cr => ({
      id: cr.id,
      hp: cHp[cr.id],
      alive: !cKilled.has(cr.id) && cHp[cr.id] > 0,
    }));
    const nonCombatAlive = allCreatures
      .filter(cr => !creatures.some(cc => cc.id === cr.id))
      .map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
    const creature_states = [...combatCreatureStates, ...nonCombatAlive];

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
