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
import {
  getStatModifier as sm,
  rollD20,
  rollDamage as rollDmg,
  getIntHitBonus as intHitBonus,
  getDexCritBonus as dexCritBonus,
  getWisAntiCrit as wisAntiCrit,
  getStrDamageFloor as strDmgFloor,
  
  getCreatureDamageDie as creatureDmgDie,
  getCreatureLevelGapMultiplier as creatureLevelGapMult,
  getXpForLevel as xpForLevel,
  getMaxCp as calcMaxCp,
  getMaxMp as calcMaxMp,
  getMaxHp as calcMaxHp,
  calculateAC as calcAC,
  
  CLASS_LEVEL_BONUSES as CLASS_LVL_BONUS,
  CLASS_LABELS,
  getWeaponAffinityBonus as weaponAffinity,
  isOffhandWeapon,
  OFFHAND_DAMAGE_MULT,
  SHIELD_AC_BONUS,
  SHIELD_ANTI_CRIT_BONUS,
  isShield,
  getClassCritRange,
  getWeaponDie,
  getHitQuality,
  HIT_QUALITY_MULT,
  GLANCING_WEAK_CAP,
  getCreatureAttackBonus as creatureAtkBonus,
  getShieldBlockChance,
  getShieldBlockAmount,
  type HitQuality,
} from "../_shared/combat-math.ts";

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

// Decode user id from JWT locally — avoids per-tick GoTrue round-trip that was
// returning intermittent (then persistent) Unauthorized errors and stalling combat.
function getUserIdFromJwt(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
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
    const db = createClient(url, srvKey);

    // Auth — extract user id from JWT (no network round-trip; getUser() was
    // returning intermittent 401s under tick load and stalling combat entirely).
    const authHeader = req.headers.get('Authorization');
    const userId = getUserIdFromJwt(authHeader);
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
    const [equipRes, creaturesRes, effectsRes, xpRes] = await Promise.all([
      db.from('character_inventory')
        .select('character_id, equipped_slot, item:items(stats, weapon_tag, hands, procs)')
        .in('character_id', charIds)
        .not('equipped_slot', 'is', null),
      db.from('creatures').select('*').eq('node_id', combatNodeId).eq('is_alive', true),
      db.from('active_effects').select('*').eq('node_id', combatNodeId),
      db.from('xp_boost').select('multiplier, expires_at').limit(1).single(),
    ]);

    const allEquip = equipRes.data;
    const creaturesRaw = creaturesRes.data;
    const activeEffectsRaw = effectsRes.data;
    const xpB = xpRes.data;

    // ── Process equipment bonuses ────────────────────────────────
    const eq: Record<string, Record<string, number>> = {};
    const mainHandTag: Record<string, string | null> = {};
    const offHandTag: Record<string, string | null> = {};
    const isTwoHanded: Record<string, boolean> = {};
    const memberProcs: Record<string, { type: string; chance: number; value: number; emoji: string; text: string }[]> = {};
    for (const cid of charIds) {
      const b: Record<string, number> = {};
      let mhTag: string | null = null;
      let ohTag: string | null = null;
      const procs: any[] = [];
      for (const e of (allEquip || []).filter(e => e.character_id === cid)) {
        for (const [s, v] of Object.entries((e.item as any)?.stats || {})) {
          b[s] = (b[s] || 0) + (v as number);
        }
        if (e.equipped_slot === 'main_hand') {
          if ((e.item as any)?.weapon_tag) mhTag = (e.item as any).weapon_tag;
          if ((e.item as any)?.hands === 2) isTwoHanded[cid] = true;
          const itemProcs = (e.item as any)?.procs;
          if (Array.isArray(itemProcs)) procs.push(...itemProcs);
        }
        if (e.equipped_slot === 'off_hand') {
          if ((e.item as any)?.weapon_tag) ohTag = (e.item as any).weapon_tag;
          const itemProcs = (e.item as any)?.procs;
          if (Array.isArray(itemProcs)) procs.push(...itemProcs);
        }
      }
      eq[cid] = b;
      mainHandTag[cid] = mhTag;
      offHandTag[cid] = ohTag;
      memberProcs[cid] = procs;
    }

    // ── Alive creatures at combat node ───────────────────────────
    const allCreatures = creaturesRaw || [];

    const dotTargetIds = new Set<string>();
    const activeEffects: any[] = activeEffectsRaw || [];
    for (const eff of activeEffects) dotTargetIds.add(eff.target_id);
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
    const consumedAbilityStacks: { character_id: string; creature_id: string; stack_type: string }[] = [];
    const killedCreatureIds = new Set<string>();

    for (const cr of creatures) cHp[cr.id] = cr.hp;
    for (const m of members) {
      mHp[m.id] = m.c.hp;
      mXp[m.id] = 0; mGold[m.id] = 0; mBhp[m.id] = 0; mSalvage[m.id] = 0;
      // Use freshest CP: max of DB value and client-reported value (solo only)
      const dbCp = m.c.cp ?? 0;
      const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number') ? Math.min(client_cp, m.c.max_cp ?? dbCp) : dbCp;
      mCp[m.id] = freshCp;
    }

    // ── Unified creature kill handler ────────────────────────────
    // All reward math + event formatting + loot-queue building lives in the
    // shared `resolveCreatureKill` helper. This function only handles the
    // tick-loop-local bookkeeping (effects purge, session engagement, kill set)
    // and applies the resolver's outputs to the local accumulators.
    const handleCreatureKill = (creature: any, killerLabel: string, _chaForGold: number = 0) => {
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
    };

    // ── Process pending abilities BEFORE the tick loop (immediate) ──
    const consumedBuffs: Record<string, string[]> = {};

    for (const pa of pendingAbilities) {
      const member = members.find(m => m.id === pa.character_id);
      if (!member) continue;
      const c = member.c;
      const eb = eq[member.id] || {};

      const cpCost = pa.cp_cost || 0;
      if (mCp[member.id] < cpCost) {
        events.push({ type: 'ability_fail', message: `⚠️ ${c.name} doesn't have enough CP!`, character_id: member.id });
        continue;
      }
      mCp[member.id] -= cpCost;

      const target = creatures.find(cr => cr.id === pa.target_creature_id && cHp[cr.id] > 0 && !cKilled.has(cr.id));
      if (!target) {
        events.push({ type: 'ability_fail', message: `⚠️ ${c.name}'s target is no longer valid.`, character_id: member.id });
        continue;
      }

      // Class abilities use ability-specific stat-scaling formulas (NOT the
      // weapon-die autoattack path). Each ability's identity is tied to its
      // class's primary stat and is independent of equipped weapon.
      if (pa.ability_type === 'multi_attack') {
        // Barrage (Ranger / DEX): per-arrow base = 2 + dexMod + floor(level/4).
        // Hit: d20 + dexMod vs AC. Crit on roll >= class crit range doubles arrow damage.
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const dexMod = sm(effDex);
        const arrowCount = dexMod >= 3 ? 3 : 2;
        const perArrowBase = Math.max(2 + dexMod + Math.floor((c.level || 1) / 4), 1);
        const critRange = getClassCritRange(c.class);
        let totalDmg = 0;
        for (let i = 0; i < arrowCount; i++) {
          const t = creatures.find(cr => cr.id === pa.target_creature_id && cHp[cr.id] > 0 && !cKilled.has(cr.id));
          if (!t) break;
          const roll = rollD20();
          const totalAtk = roll + dexMod;
          if (roll !== 1 && (roll === 20 || totalAtk >= t.ac)) {
            const isCrit = roll >= critRange;
            const arrowDmg = Math.max(isCrit ? perArrowBase * 2 : perArrowBase, 1);
            totalDmg += arrowDmg;
            cHp[t.id] = Math.max(cHp[t.id] - arrowDmg, 0);
            const critTag = isCrit ? ' CRIT!' : '';
            events.push({ type: 'ability_hit', message: `🏹🏹 Arrow ${i + 1}: ${c.name} hits ${t.name}!${critTag} Rolled ${roll}+${dexMod}=${totalAtk} vs AC ${t.ac} — ${arrowDmg} damage.`, character_id: member.id });
          } else {
            events.push({ type: 'ability_miss', message: `🏹🏹 Arrow ${i + 1}: ${c.name} misses ${t.name}! Rolled ${roll}+${dexMod}=${totalAtk} vs AC ${t.ac}.`, character_id: member.id });
          }
          if (cHp[t.id] <= 0 && !cKilled.has(t.id)) {
            handleCreatureKill(t, c.name, (c.cha || 10) + (eb.cha || 0));
          }
        }
        if (totalDmg > 0) {
          events.push({ type: 'ability_hit', message: `🏹🏹 Barrage total: ${totalDmg} damage! (${arrowCount} arrows)`, character_id: member.id });
        }
      } else if (pa.ability_type === 'execute_attack') {
        // Eviscerate (Rogue / DEX finisher): base = 4 + 2*dexMod + floor(level/3).
        // Guaranteed hit, no crit roll. Multiplier from poison stacks (0–5).
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const dexMod = sm(effDex);
        const stacks = Math.min(pa.consume_stacks || 0, 5);
        const baseDmg = 4 + 2 * dexMod + Math.floor((c.level || 1) / 3);
        const multiplier = 1 + 0.5 * stacks;
        const finalDmg = Math.max(Math.floor(baseDmg * multiplier), 1);
        cHp[target.id] = Math.max(cHp[target.id] - finalDmg, 0);
        if (stacks > 0) {
          events.push({ type: 'ability_hit', message: `🔪 ${c.name} eviscerates ${target.name}, consuming ${stacks} poison stack${stacks > 1 ? 's' : ''} for ${finalDmg} damage!`, character_id: member.id });
          consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'poison' });
        } else {
          events.push({ type: 'ability_hit', message: `🔪 ${c.name} strikes ${target.name} for ${finalDmg} damage. (No poison stacks)`, character_id: member.id });
        }
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
        }
      } else if (pa.ability_type === 'ignite_consume') {
        // Conflagrate (Wizard / INT detonator): base = 4 + 2*intMod + floor(level/3).
        // Guaranteed hit, no crit roll. Multiplier from burn stacks (0–5).
        // INT-scaling preserved so wizards aren't punished for not equipping a melee weapon.
        const effInt = (c.int || 10) + (eb.int || 0);
        const intMod = sm(effInt);
        const stacks = Math.min(pa.consume_stacks || 0, 5);
        const baseDmg = 4 + 2 * intMod + Math.floor((c.level || 1) / 3);
        const multiplier = 1 + 0.5 * stacks;
        const finalDmg = Math.max(Math.floor(baseDmg * multiplier), 1);
        cHp[target.id] = Math.max(cHp[target.id] - finalDmg, 0);
        if (stacks > 0) {
          events.push({ type: 'ability_hit', message: `💥 ${c.name} detonates ${stacks} burn stack${stacks > 1 ? 's' : ''} on ${target.name} for ${finalDmg} damage!`, character_id: member.id });
          consumedAbilityStacks.push({ character_id: member.id, creature_id: target.id, stack_type: 'ignite' });
        } else {
          events.push({ type: 'ability_hit', message: `💥 ${c.name} blasts ${target.name} for ${finalDmg} damage. (No burn stacks)`, character_id: member.id });
        }
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
        }
      } else if (
        pa.ability_type === 'fireball' ||
        pa.ability_type === 'power_strike' ||
        pa.ability_type === 'aimed_shot' ||
        pa.ability_type === 'backstab' ||
        pa.ability_type === 'smite' ||
        pa.ability_type === 'cutting_words'
      ) {
        // Phase 1 T0 class identity abilities. All share one formula:
        //   damage = max(1, 5 + 2*statMod + floor(level/3))
        // Guaranteed hit, no crit roll, no weapon interaction. CP already
        // deducted above. Stat is per-class.
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
        const stat = T0_STAT[pa.ability_type];
        const eff = ((c as any)[stat] || 10) + ((eb as any)[stat] || 0);
        const mod = sm(eff);
        const dmg = Math.max(1, 5 + 2 * mod + Math.floor((c.level || 1) / 3));
        cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);
        const { emoji, verb } = T0_LABEL[pa.ability_type];
        events.push({
          type: 'ability_hit',
          message: `${emoji} ${c.name} ${verb} ${target.name} for ${dmg} damage.`,
          character_id: member.id,
        });
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
        }
      } else if (pa.ability_type === 'burst_damage') {
        const effCha = (c.cha || 10) + (eb.cha || 0);
        const chaMod = sm(effCha);
        const baseDmg = Math.max(8, chaMod * 4 + Math.floor(c.level * 1.5));
        const damage = baseDmg + rollDmg(1, Math.max(1, chaMod * 2));
        cHp[target.id] = Math.max(cHp[target.id] - damage, 0);
        events.push({ type: 'ability_hit', message: `🎵💥 Grand Finale! ${c.name} unleashes a devastating blast of sound at ${target.name} for ${damage} damage!`, character_id: member.id });
        if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
          handleCreatureKill(target, c.name, effCha);
        }
      } else if (pa.ability_type === 'dot_debuff') {
        // Server-side Rend/bleed: create persistent active_effects row
        const effStr = (c.str || 10) + (eb.str || 0);
        const strMod = sm(effStr);
        const dmgPerTick = Math.max(1, Math.floor((strMod * 1.5 + 2) * 0.67));
        const durationMs = Math.min(30000, 20000 + strMod * 1000);
        const existing = activeEffects.find(e => e.source_id === member.id && e.target_id === target.id && e.effect_type === 'bleed');
        const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
        const effData = {
          node_id: combatNodeId, target_id: target.id, source_id: member.id,
          session_id: null, effect_type: 'bleed',
          stacks: newStacks, damage_per_tick: dmgPerTick,
          next_tick_at: now + TICK_RATE, expires_at: now + durationMs,
          tick_rate_ms: TICK_RATE,
        };
        if (existing) {
          Object.assign(existing, effData);
        } else {
          activeEffects.push({ id: crypto.randomUUID(), ...effData });
        }
        events.push({ type: 'bleed_applied', message: `🩸 ${c.name} rends ${target.name}! Bleeding for ${dmgPerTick} damage every 2s.`, character_id: member.id });
      }
    }

    // ── Helper to apply creature hit to a member ─────────────────
    // CANONICAL DAMAGE PIPELINE (creature → player):
    //   base damage → hit quality mult → crit mult (with anti-crit) → level gap
    //   → shield block (flat) → absorb → Battle Cry DR → caps/clamps → finalAppliedDamage
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

        // 5. Shield block (flat reduction, shield only)
        if (hasShield) {
          const blockChance = getShieldBlockChance(effectiveDex);
          if (Math.random() < blockChance) {
            const blockAmt = Math.min(getShieldBlockAmount(effectiveStr), dmg);
            const preDmg = dmg;
            dmg = Math.max(dmg - blockAmt, 0);
            events.push({ type: 'shield_block', message: `🛡️ ${targetName} blocks with shield! (−${blockAmt} damage, ${preDmg} → ${dmg})`, character_id: targetId });
            if (dmg <= 0) return;
          }
        }

        // 6. Absorb shield
        if (mb.absorb_buff?.shield_hp && mb.absorb_buff.shield_hp > 0) {
          const absorbed = Math.min(dmg, mb.absorb_buff.shield_hp);
          mb.absorb_buff.shield_hp -= absorbed;
          dmg -= absorbed;
          events.push({ type: 'absorb', message: `🛡️✨ ${creature.name} hits ${targetName} — shield absorbs ${absorbed} damage! (${mb.absorb_buff.shield_hp} remaining)`, character_id: targetId });
          if (dmg <= 0) return;
        }

        // 7. Battle Cry damage reduction
        if (mb.battle_cry_dr) {
          let dr = mb.battle_cry_dr.reduction || 0;
          if (isCrit) dr += mb.battle_cry_dr.crit_reduction || 0;
          const preDmg = dmg;
          dmg = Math.max(Math.floor(dmg * (1 - dr)), 1);
          events.push({ type: 'battle_cry_dr', message: `📯 ${targetName}'s war cry reduces damage! (${preDmg} → ${dmg})` });
        }

        // 8. Caps and clamps
        dmg = Math.max(dmg, 1);
        if (quality === 'glancing') dmg = Math.min(dmg, GLANCING_WEAK_CAP);
        if (quality === 'weak' && margin < -2) dmg = Math.min(dmg, GLANCING_WEAK_CAP);

        mHp[targetId] = Math.max(mHp[targetId] - dmg, 0);
        degradeSet.add(targetId);
        const critLabel = isCrit ? 'CRITICAL! ' : '';
        const cab = creatureAtkBonus(creature.level);
        const critEvent: any = { type: isCrit ? 'creature_crit' : 'creature_hit', message: `${tankLabel}${critLabel}${creature.name} strikes ${targetName}${tankLabel ? ' (Tank)' : ''}! Rolled ${d20} + ${cStr} STR${cab > 0 ? ` + ${cab} Lvl` : ''} = ${roll} vs AC ${tAC} — ${dmg} damage.`, attacker_name: creature.name, target_name: targetName, damage: dmg, is_crit: isCrit, is_humanoid: creature.is_humanoid, creature_id: creature.id, character_id: targetId, hit_quality: quality };

        // Boss crit flavor enrichment
        if (isCrit) {
          const bossFlavor = pickBossFlavor(creature.boss_crit_flavors);
          if (bossFlavor) {
            critEvent.boss_flavor = bossFlavor;
          }
        }

        events.push(critEvent);
        if (mHp[targetId] <= 0) {
          events.push({ type: 'member_death', message: `💀 ${targetName} has been defeated...`, character_id: targetId });
        }
      } else {
        const cabMiss = creatureAtkBonus(creature.level);
        events.push({ type: 'creature_miss', message: `${creature.name} attacks ${targetName}${tankLabel ? ' (Tank)' : ''} — misses! Rolled ${d20} + ${cStr} STR${cabMiss > 0 ? ` + ${cabMiss} Lvl` : ''} = ${roll} vs AC ${tAC}.`, attacker_name: creature.name, target_name: targetName, damage: 0, is_crit: false, is_humanoid: creature.is_humanoid, creature_id: creature.id, character_id: targetId, hit_quality: 'miss' as HitQuality });
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
        const weaponDie = getWeaponDie(wTag, wHands);
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
        const isStealth = !!mb.stealth_buff;
        const isDmgBuff = !!mb.damage_buff;
        const hasDisengage = !!mb.disengage_next_hit;
        const affinity = weaponAffinity(c.class, wTag);

        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) break;

        let creatureAc = target.ac;
        if (mb.sunder_target === target.id && mb.sunder_reduction) {
          creatureAc = Math.max(creatureAc - mb.sunder_reduction, 0);
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
          let raw = rollDmg(1, weaponDie) + sMod;
          if (!isCrit) raw = Math.max(raw, 1 + sdf); // STR damage floor (non-crit)
          let dmg = Math.max(Math.floor(raw * HIT_QUALITY_MULT[quality]), 1);
          if (isCrit) dmg = Math.max(dmg * 2, 1);
          if (affinity.damageMult > 1) dmg = Math.floor(dmg * affinity.damageMult);
          if (isStealth) {
            dmg = dmg * 2;
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('stealth');
            events.push({ type: 'buff_consumed', message: `🌑 ${c.name}'s stealth ambush deals double damage!`, character_id: m.id });
          }
          if (isDmgBuff) dmg = Math.floor(dmg * 1.5);
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

          cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);
          events.push({
            type: 'attack_hit',
            message: `${isCrit ? '⚔️ CRITICAL! ' : '⚔️ '}${c.name} attacks ${target.name}! Rolled ${roll} + ${sMod} STR${intLabel}${affLabel} = ${total} vs AC ${creatureAc} — ${dmg} damage (${dieLabel}).`,
            attacker_name: c.name,
            target_name: target.name,
            attacker_class: c.class,
            weapon_tag: wTag || null,
            damage: dmg,
            is_crit: isCrit,
            character_id: m.id,
            hit_quality: quality,
          });

          if (mb.poison_buff && Math.random() < 0.4) {
            // Server-side DoT creation: upsert poison into active_effects
            const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'poison');
            const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
            const dexMod = sm((c.dex || 10) + (eb.dex || 0));
            const dmgPerTick = Math.max(1, Math.floor(dexMod * 1.2 * 0.67));
            const effData = {
              node_id: combatNodeId, target_id: target.id, source_id: m.id,
              session_id: null, effect_type: 'poison',
              stacks: newStacks, damage_per_tick: dmgPerTick,
              next_tick_at: tickTime + TICK_RATE, expires_at: tickTime + 25000,
              tick_rate_ms: TICK_RATE,
            };
            if (existing) {
              Object.assign(existing, effData);
            } else {
              activeEffects.push({ id: crypto.randomUUID(), ...effData });
            }
            events.push({ type: 'poison_proc', character_id: m.id, creature_id: target.id, message: `🧪 ${c.name}'s attack poisons ${target.name}!` });
          }
          if (mb.ignite_buff && Math.random() < 0.4) {
            const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'ignite');
            const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
            const intMod = sm((c.int || 10) + (eb.int || 0));
            const dmgPerTick = Math.max(1, Math.floor(intMod * 0.7 * 0.67));
            const duration = Math.min(45000, 30000 + intMod * 1000);
            const effData = {
              node_id: combatNodeId, target_id: target.id, source_id: m.id,
              session_id: null, effect_type: 'ignite',
              stacks: newStacks, damage_per_tick: dmgPerTick,
              next_tick_at: tickTime + TICK_RATE, expires_at: tickTime + duration,
              tick_rate_ms: TICK_RATE,
            };
            if (existing) {
              Object.assign(existing, effData);
            } else {
              activeEffects.push({ id: crypto.randomUUID(), ...effData });
            }
            events.push({ type: 'ignite_proc', character_id: m.id, creature_id: target.id, message: `🔥 ${c.name}'s attack ignites ${target.name}!` });
          }

          // ── Proc-on-hit (main hand) ──
          if ((memberProcs[m.id] || []).length > 0 && cHp[target.id] > 0 && !cKilled.has(target.id)) {
            resolveProcs(memberProcs[m.id], c.name, m.id, target.name, target.id, mHp, cHp, c.max_hp, events, cKilled);
          }

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
          }
        } else {
          events.push({
            type: 'attack_miss',
            message: `⚔️ ${c.name} attacks ${target.name} — miss! Rolled ${roll} + ${sMod} STR${intLabel}${affLabel} = ${total} vs AC ${creatureAc}.`,
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
        const ohDie = getWeaponDie(ohTag, 1);
        const effStr2 = (c.str || 10) + (eb.str || 0);
        const sMod2 = sm(effStr2);
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
          creatureAc2 = Math.max(creatureAc2 - mb2.sunder_reduction, 0);
        }

        const roll2 = rollD20();
        const total2 = roll2 + sMod2 + ihb2;

        // ── Hit quality (graded system) ──
        const margin2 = total2 - creatureAc2;
        const isCrit2 = roll2 >= effCrit2;
        const quality2 = getHitQuality(margin2, roll2 === 1, isCrit2);

        if (quality2 !== 'miss') {
          // Pipeline: 1. base damage (offhand die + STR) → 2. hit-quality mult
          // → 3. crit mult → 4. off-hand 30% reduction → 5. clamp → 6. caps
          const raw2 = rollDmg(1, ohDie) + sMod2;
          let dmg2 = Math.max(Math.floor(raw2 * HIT_QUALITY_MULT[quality2]), 1);
          if (isCrit2) dmg2 = Math.max(dmg2 * 2, 1);
          dmg2 = Math.max(Math.floor(dmg2 * OFFHAND_DAMAGE_MULT), 1);

          // Clamp minimum 1
          dmg2 = Math.max(dmg2, 1);
          // Glancing cap (always); weak cap only when margin < -2
          if (quality2 === 'glancing') dmg2 = Math.min(dmg2, GLANCING_WEAK_CAP);
          if (quality2 === 'weak' && margin2 < -2) dmg2 = Math.min(dmg2, GLANCING_WEAK_CAP);

          cHp[target.id] = Math.max(cHp[target.id] - dmg2, 0);
          events.push({
            type: 'offhand_hit',
            message: `${isCrit2 ? '🗡️ CRIT! ' : '🗡️ '}${c.name}'s off-hand strikes ${target.name}! Rolled ${roll2}+${sMod2} STR${ihb2 > 0 ? `+${ihb2} INT` : ''}=${total2} vs AC ${creatureAc2} — ${dmg2} damage (1d${ohDie}, 30%).`,
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

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
          }
        } else {
          events.push({
            type: 'offhand_miss',
            message: `🗡️ ${c.name}'s off-hand swings at ${target.name} — miss! Rolled ${roll2}+${sMod2} STR${ihb2 > 0 ? `+${ihb2} INT` : ''}=${total2} vs AC ${creatureAc2}.`,
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
    for (const m of members) {
      const c = m.c;
      const eb = eq[m.id] || {};
      const updates: Record<string, any> = {};

      if (mHp[m.id] !== c.hp) updates.hp = mHp[m.id];
      if (mCp[m.id] !== (c.cp ?? 0)) updates.cp = mCp[m.id];

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
      if (mSalvage[m.id] > 0) {
        updates.salvage = (c.salvage || 0) + mSalvage[m.id];
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
        salvage: updates.salvage ?? (c.salvage || 0),
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
      ...degradePromises,
    ]);

    // ── PHASE B: Order-dependent writes (sequential) ────────────
    // Loot depends on killed creatures being persisted
    const lootEvents = await processLootDrops(db, lootQueue);
    events.push(...lootEvents);

    // Batch effect upsert after cleanup to avoid conflicts
    if (liveEffects.length > 0) {
      const rows = liveEffects.map(e => { const { _expired, ...row } = e; return row; });
      await db.from('active_effects').upsert(rows, { onConflict: 'source_id,target_id,effect_type' });
    }

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
