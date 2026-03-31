import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  resolveEffectTicks,
  processLootDrops,
  writeCreatureState,
  cleanupEffects,
  type LootQueueEntry,
} from "../_shared/combat-resolver.ts";
import {
  getStatModifier as sm,
  rollD20,
  rollDamage as rollDmg,
  getIntHitBonus as intHitBonus,
  getDexCritBonus as dexCritBonus,
  getWisDodgeChance as wisAwareness,
  getStrDamageFloor as strDmgFloor,
  getChaGoldMultiplier as chaGoldMult,
  getDexMultiAttack as dexMultiAttack,
  getCreatureDamageDie as creatureDmgDie,
  getCreatureLevelGapMultiplier as creatureLevelGapMult,
  getXpForLevel as xpForLevel,
  getXpPenalty as xpPenalty,
  getMaxCp as calcMaxCp,
  getMaxMp as calcMaxMp,
  getMaxHp as calcMaxHp,
  getAcOverflowMultiplier as acOverflowMult,
  calculateAC as calcAC,
  XP_RARITY_MULTIPLIER as XP_RARITY,
  CLASS_COMBAT_PROFILES,
  CLASS_LEVEL_BONUSES as CLASS_LVL_BONUS,
  CLASS_LABELS,
  getWeaponAffinityBonus as weaponAffinity,
  isOffhandWeapon,
  OFFHAND_DAMAGE_MULT,
  SHIELD_AC_BONUS,
  SHIELD_AWARENESS_BONUS,
  isShield,
} from "../_shared/combat-math.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CLASS_ATK: Record<string, { stat: string; min: number; max: number; crit: number; emoji: string; verb: string }> = {};
for (const [k, v] of Object.entries(CLASS_COMBAT_PROFILES)) {
  CLASS_ATK[k] = { stat: v.stat, min: v.diceMin, max: v.diceMax, crit: v.critRange, emoji: v.emoji, verb: v.verb };
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const TICK_RATE = 2000;
const TICK_CAP = 3; // Defensive safeguard — sessions end on node change, so large backlogs should not occur

// ── Main handler ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(url, srvKey);

    // Auth — verify JWT and extract user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Unauthorized');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userDb = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userDb.auth.getUser();
    if (authErr || !user) throw new Error('Unauthorized');

    const {
      party_id, character_id, node_id, member_buffs,
      engaged_creature_ids, pending_abilities: rawPendingAbilities,
      // New: client can request session creation
      action,
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
      const { data: userChars } = await db.from('characters').select('id').eq('user_id', user.id);
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

      tankId = party.tank_id || null;
      tankAtNode = tankId ? members.some(m => m.id === tankId) : false;
      sessionKey = { party_id };
    } else {
      const { data: char } = await db.from('characters').select('*').eq('id', character_id).single();
      if (!char || char.user_id !== user.id) throw new Error('Not authorized');
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

    if (existingSession) {
      session = existingSession;
    } else if (action === 'start' || engagedIds.length > 0 || pendingAbilities.length > 0) {
      // Create new session
      const insertData: any = {
        node_id,
        last_tick_at: now,
        tick_rate_ms: TICK_RATE,
        engaged_creature_ids: engagedIds,
        member_buffs: {},
        ...sessionKey,
      };
      const { data: newSession } = await db.from('combat_sessions').insert(insertData).select().single();
      session = newSession;
    }

    if (!session) {
      // No session and nothing to start — return idle state
      const { data: creaturesRaw } = await db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true);
      const creature_states = (creaturesRaw || []).map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      return json({ events: [], creature_states, member_states: [], ticks_processed: 0 });
    }

    // ── Session termination: player left the node ────────────────
    if (session.node_id !== node_id) {
      await db.from('combat_sessions').delete().eq('id', session.id);
      console.log(JSON.stringify({ fn: 'combat-tick', session_deleted_reason: 'node_changed', session_id: session.id, old_node: session.node_id, new_node: node_id }));
      return json({ events: [], creature_states: [], member_states: [], session_ended: true, ticks_processed: 0 });
    }

    // ── Update session with latest engaged creatures from client ──
    const sessionEngaged = new Set<string>(session.engaged_creature_ids || []);
    for (const id of engagedIds) sessionEngaged.add(id);

    // ── Calculate ticks to process ──────────────────────────────
    const elapsedMs = now - session.last_tick_at;
    const ticksToProcess = Math.floor(elapsedMs / TICK_RATE);
    const ticks = Math.min(ticksToProcess, TICK_CAP);

    if (ticks === 0 && pendingAbilities.length === 0) {
      // Not enough time has passed for a tick
      const { data: creaturesRaw } = await db.from('creatures').select('*').eq('node_id', session.node_id).eq('is_alive', true);
      const creature_states = (creaturesRaw || []).map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      // Return actual active effects for UI sync (not empty array)
      const { data: currentEffects } = await db.from('active_effects').select('source_id, target_id, effect_type, stacks, damage_per_tick, expires_at').eq('node_id', session.node_id);
      return json({ events: [], creature_states, member_states: [], ticks_processed: 0, active_effects: (currentEffects || []) });
    }

    // ── Fetch equipment bonuses ──────────────────────────────────
    const charIds = members.map(m => m.id);
    const { data: allEquip } = await db
      .from('character_inventory')
      .select('character_id, equipped_slot, item:items(stats, weapon_tag)')
      .in('character_id', charIds)
      .not('equipped_slot', 'is', null);

    const eq: Record<string, Record<string, number>> = {};
    const mainHandTag: Record<string, string | null> = {};
    const offHandTag: Record<string, string | null> = {};
    for (const cid of charIds) {
      const b: Record<string, number> = {};
      let mhTag: string | null = null;
      let ohTag: string | null = null;
      for (const e of (allEquip || []).filter(e => e.character_id === cid)) {
        for (const [s, v] of Object.entries((e.item as any)?.stats || {})) {
          b[s] = (b[s] || 0) + (v as number);
        }
        if (e.equipped_slot === 'main_hand' && (e.item as any)?.weapon_tag) {
          mhTag = (e.item as any).weapon_tag;
        }
        if (e.equipped_slot === 'off_hand' && (e.item as any)?.weapon_tag) {
          ohTag = (e.item as any).weapon_tag;
        }
      }
      eq[cid] = b;
      mainHandTag[cid] = mhTag;
      offHandTag[cid] = ohTag;
    }

    // ── Fetch alive creatures at combat node ─────────────────────
    const combatNodeId = session.node_id; // Use session's node (may differ from client's current node for DoT drain)
    const { data: creaturesRaw } = await db
      .from('creatures')
      .select('*')
      .eq('node_id', combatNodeId)
      .eq('is_alive', true);

    const allCreatures = creaturesRaw || [];

    // Collect creature IDs that have active effects targeting them
    const dotTargetIds = new Set<string>();
    const { data: activeEffectsRaw } = await db.from('active_effects')
      .select('*')
      .eq('node_id', combatNodeId);
    const activeEffects: any[] = activeEffectsRaw || [];
    for (const eff of activeEffects) dotTargetIds.add(eff.target_id);
    for (const pa of pendingAbilities) {
      if (pa.target_creature_id) dotTargetIds.add(pa.target_creature_id);
    }

    const creatures = allCreatures.filter(cr =>
      sessionEngaged.has(cr.id) || cr.is_aggressive || dotTargetIds.has(cr.id)
    );

    if (creatures.length === 0) {
      // No combat targets — clean up session
      await db.from('combat_sessions').delete().eq('id', session.id);
      const creature_states = allCreatures.map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      return json({ events: [], creature_states, member_states: [], session_ended: true, ticks_processed: 0 });
    }

    // Sessions only exist while players are present — no isDotOnly mode

    // ── XP boost ─────────────────────────────────────────────────
    const { data: xpB } = await db.from('xp_boost').select('multiplier, expires_at').limit(1).single();
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
    const killedCreatureIds = new Set<string>(); // Track creature IDs to delete effects for

    for (const cr of creatures) cHp[cr.id] = cr.hp;
    for (const m of members) { mHp[m.id] = m.c.hp; mXp[m.id] = 0; mGold[m.id] = 0; mBhp[m.id] = 0; mSalvage[m.id] = 0; mCp[m.id] = m.c.cp ?? 0; }

    // ── Unified creature kill handler ────────────────────────────
    const handleCreatureKill = (creature: any, killerLabel: string, chaForGold: number = 0) => {
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
      const baseXp = Math.floor(creature.level * 10 * (XP_RARITY[creature.rarity] || 1));
      const lt = (creature.loot_table || []) as any[];
      const goldEntry = lt.find((e: any) => e.type === 'gold');
      let totalGold = 0;
      if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
        totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
        if (creature.is_humanoid && chaForGold > 0) {
          totalGold = Math.floor(totalGold * chaGoldMult(chaForGold));
        }
      }
      const goldSplit = members.length;
      const uncapped = members.filter(mm => mm.c.level < 42);
      const xpSplit = uncapped.length || 1;
      const goldEach = Math.floor(totalGold / goldSplit);
      for (const mm of members) {
        if (mm.c.level < 42) {
          const penalty = xpPenalty(mm.c.level, creature.level);
          mXp[mm.id] += Math.floor(Math.floor(baseXp * penalty * xpMult) / xpSplit);
        }
        mGold[mm.id] += goldEach;
      }
      const displayMember = uncapped[0] || members[0];
      const displayPenalty = xpPenalty(displayMember.c.level, creature.level);
      const displayXp = displayMember.c.level >= 42 ? 0 : Math.floor(Math.floor(baseXp * displayPenalty * xpMult) / xpSplit);
      const xpBoostNote = xpMult > 1 ? ` ⚡${xpMult}x` : '';
      const penaltyNote = displayPenalty < 1 ? ` (${Math.round(displayPenalty * 100)}% XP — level penalty)` : '';
      const goldNote = goldEach > 0 ? `, +${goldEach} gold` : '';
      const allCapped = uncapped.length === 0;
      if (allCapped) {
        const cappedGoldNote = goldEach > 0 ? ` +${goldEach} gold${goldSplit > 1 ? ' each' : ''}.` : '';
        events.push({ type: 'creature_kill', message: `☠️ ${creature.name} has been slain!${cappedGoldNote} Your power transcends experience.` });
      } else if (goldSplit > 1) {
        events.push({ type: 'creature_kill', message: `☠️ ${creature.name} has been slain! Rewards split ${xpSplit} ways: +${displayXp} XP${goldNote} each.${penaltyNote}${xpBoostNote}` });
      } else {
        events.push({ type: 'creature_kill', message: `☠️ ${creature.name} has been slain! +${displayXp} XP${goldNote}.${penaltyNote}${xpBoostNote}` });
      }
      if (creature.rarity === 'boss') {
        const bhpReward = Math.floor(creature.level * 0.5);
        if (bhpReward > 0) {
          const bhpEach = Math.floor(bhpReward / members.length);
          if (bhpEach > 0) {
            for (const mm of members) {
              if (mm.c.level >= 30) mBhp[mm.id] += bhpEach;
            }
            events.push({ type: 'bhp_award', message: `🏋️ +${bhpEach} Boss Hunter Points each!` });
          }
        }
      }
      if (!creature.is_humanoid) {
        const baseSalvage = 1 + Math.floor(creature.level / 5);
        const rarityMult = creature.rarity === 'boss' ? 4 : creature.rarity === 'rare' ? 2 : 1;
        const totalSalvage = baseSalvage * rarityMult;
        const salvageEach = Math.floor(totalSalvage / members.length);
        if (salvageEach > 0) {
          for (const mm of members) mSalvage[mm.id] += salvageEach;
          events.push({ type: 'salvage', message: `🔩 +${salvageEach} salvage each from ${creature.name}.` });
        }
      }
      if (creature.loot_table_id) {
        lootQueue.push({ nodeId: combatNodeId, lootTableId: creature.loot_table_id, itemId: null, creatureName: creature.name, dropChance: creature.drop_chance ?? 0.5 });
      } else {
        for (const entry of lt) {
          if (entry.type === 'gold') continue;
          if (Math.random() <= (entry.chance || 0.1)) {
            lootQueue.push({ nodeId: combatNodeId, lootTableId: null, itemId: entry.item_id, creatureName: creature.name, dropChance: 1 });
          }
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

      if (pa.ability_type === 'multi_attack') {
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const dexMod = sm(effDex);
        const arrowCount = dexMod >= 3 ? 3 : 2;
        let totalDmg = 0;
        for (let i = 0; i < arrowCount; i++) {
          const t = creatures.find(cr => cr.id === pa.target_creature_id && cHp[cr.id] > 0 && !cKilled.has(cr.id));
          if (!t) break;
          const roll = rollD20();
          const totalAtk = roll + dexMod;
          if (roll !== 1 && (roll === 20 || totalAtk >= t.ac)) {
            const rawDmg = rollDmg(CLASS_ATK.ranger.min, CLASS_ATK.ranger.max) + dexMod;
            const arrowDmg = Math.max(Math.floor(rawDmg * 0.7), 1);
            totalDmg += arrowDmg;
            cHp[t.id] = Math.max(cHp[t.id] - arrowDmg, 0);
            events.push({ type: 'ability_hit', message: `🏹🏹 Arrow ${i + 1}: ${c.name} hits ${t.name}! Rolled ${roll}+${dexMod}=${totalAtk} vs AC ${t.ac} — ${arrowDmg} damage.`, character_id: member.id });
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
        const effDex = (c.dex || 10) + (eb.dex || 0);
        const dexMod = sm(effDex);
        const stacks = Math.min(pa.consume_stacks || 0, 5);
        const baseDmg = rollDmg(CLASS_ATK.rogue.min, CLASS_ATK.rogue.max) + dexMod;
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
        const effInt = (c.int || 10) + (eb.int || 0);
        const intMod = sm(effInt);
        const stacks = Math.min(pa.consume_stacks || 0, 5);
        const baseDmg = rollDmg(CLASS_ATK.wizard.min, CLASS_ATK.wizard.max) + intMod;
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
      }
    }

    // ── Helper to apply creature hit to a member ─────────────────
    const applyCreatureHit = (targetId: string, targetName: string, targetC: any, targetEq: Record<string, number>, creature: any, cStr: number, dmgDie: number, tankLabel: string) => {
      const mb = buffs[targetId] || {};
      const acBuffBonus = mb.ac_buff || 0;
      const effectiveDex = (targetC.dex || 10) + (targetEq.dex || 0);
      const shieldAcBonus = isShield(offHandTag[targetId]) ? SHIELD_AC_BONUS : 0;
      const tAC = calcAC(targetC.class || 'warrior', effectiveDex) + (targetEq.ac || 0) + acBuffBonus + shieldAcBonus;
      const d20 = rollD20();
      const roll = d20 + cStr;

      const cs = creature.stats as any;
      const cDex = cs.dex || 10;
      const cCritBonus = dexCritBonus(cDex);
      const cCritThreshold = 20 - cCritBonus;
      const isCrit = d20 >= cCritThreshold;
      const isNat1 = d20 === 1;

      if (!isNat1 && (isCrit || roll >= tAC)) {
        if (mb.evasion_buff?.dodge_chance && Math.random() < mb.evasion_buff.dodge_chance) {
          events.push({ type: 'evasion_dodge', message: `🦘 ${targetName} dodges ${creature.name}'s attack!`, character_id: targetId });
          return;
        }

        let baseDmg = Math.max(rollDmg(1, dmgDie) + cStr, 1);
        let dmg = isCrit ? Math.max(Math.floor(baseDmg * 1.5), 1) : baseDmg;
        const levelGap = creatureLevelGapMult(creature.level, targetC.level || 1);
        if (levelGap > 1) dmg = Math.max(Math.floor(dmg * levelGap), 1);

        if (isCrit && roll < tAC) {
          const overflowMult = acOverflowMult(roll, tAC);
          const preDmg = dmg;
          dmg = Math.max(Math.floor(dmg * overflowMult), 1);
          const pctReduced = Math.round((1 - overflowMult) * 100);
          events.push({ type: 'ac_overflow', message: `🛡️ ${targetName}'s armor absorbs the blow! AC ${tAC} vs ${roll} — ${pctReduced}% damage reduced (${preDmg} → ${dmg}).` });
        }

        const shieldAwarenessBonus = isShield(offHandTag[targetId]) ? SHIELD_AWARENESS_BONUS : 0;
        const wis = wisAwareness((targetC.wis || 10) + (targetEq.wis || 0)) + shieldAwarenessBonus;
        if (wis > 0 && Math.random() < wis) {
          dmg = Math.max(Math.floor(dmg * 0.75), 1);
          events.push({ type: 'wis_awareness', message: `🧘 ${targetName}'s awareness softens ${creature.name}'s blow! (${dmg} damage)` });
        }

        if (mb.absorb_buff?.shield_hp && mb.absorb_buff.shield_hp > 0) {
          const absorbed = Math.min(dmg, mb.absorb_buff.shield_hp);
          mb.absorb_buff.shield_hp -= absorbed;
          dmg -= absorbed;
          events.push({ type: 'absorb', message: `🛡️✨ ${creature.name} hits ${targetName} — shield absorbs ${absorbed} damage! (${mb.absorb_buff.shield_hp} remaining)`, character_id: targetId });
          if (dmg <= 0) return;
        }

        mHp[targetId] = Math.max(mHp[targetId] - dmg, 0);
        degradeSet.add(targetId);
        const critLabel = isCrit ? 'CRITICAL! ' : '';
        events.push({ type: isCrit ? 'creature_crit' : 'creature_hit', message: `${tankLabel}${critLabel}${creature.name} strikes ${targetName}${tankLabel ? ' (Tank)' : ''}! Rolled ${d20} + ${cStr} STR = ${roll} vs AC ${tAC} — ${dmg} damage.` });
        if (mHp[targetId] <= 0) {
          events.push({ type: 'member_death', message: `💀 ${targetName} has been defeated...`, character_id: targetId });
        }
      } else {
        events.push({ type: 'creature_miss', message: `${creature.name} attacks ${targetName}${tankLabel ? ' (Tank)' : ''} — misses! Rolled ${d20} + ${cStr} STR = ${roll} vs AC ${tAC}.` });
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
      for (const m of members) {
        if (mHp[m.id] <= 0) continue;
        const c = m.c;
        const eb = eq[m.id] || {};
        const mb = buffs[m.id] || {};
        const atk = CLASS_ATK[c.class] || CLASS_ATK.warrior;
        const effStat = (c[atk.stat] || 10) + (eb[atk.stat] || 0);
        const sMod = sm(effStat);
        const ihb = intHitBonus((c.int || 10) + (eb.int || 0));
        const dcb = dexCritBonus((c.dex || 10) + (eb.dex || 0));
        const mileCrit = c.level >= 28 ? 1 : 0;
        const critBonusFromBuff = mb.crit_buff?.bonus || 0;
        const effCrit = atk.crit - dcb - mileCrit - critBonusFromBuff;
        const sdf = strDmgFloor((c.str || 10) + (eb.str || 0));
        const isStealth = !!mb.stealth_buff;
        const isDmgBuff = !!mb.damage_buff;
        const hasFocusStrike = !!mb.focus_strike;
        const hasDisengage = !!mb.disengage_next_hit;
        const affinity = weaponAffinity(c.class, mainHandTag[m.id]);

        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) break;

        let creatureAc = target.ac;
        if (mb.sunder_target === target.id && mb.sunder_reduction) {
          creatureAc = Math.max(creatureAc - mb.sunder_reduction, 0);
        }

        const roll = rollD20();
        const total = roll + sMod + ihb + affinity.hitBonus;
        const intLabel = ihb > 0 ? ` + ${ihb} INT` : '';
        const affLabel = affinity.hitBonus > 0 ? ' + 1 Prof' : '';

        if (roll >= effCrit || (roll !== 1 && total >= creatureAc)) {
          let raw = rollDmg(atk.min, atk.max) + sMod;
          const isCrit = roll >= effCrit;
          let dmg = isCrit ? Math.max(raw * 2, 1) : Math.max(raw, 1 + sdf);
          if (affinity.damageMult > 1) dmg = Math.floor(dmg * affinity.damageMult);
          if (isStealth) {
            dmg = dmg * 2;
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('stealth');
            events.push({ type: 'buff_consumed', message: `🌑 ${c.name}'s stealth ambush deals double damage!`, character_id: m.id });
          }
          if (isDmgBuff) dmg = Math.floor(dmg * 1.5);
          if (hasFocusStrike) {
            dmg += mb.focus_strike.bonus_dmg;
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('focus_strike');
            events.push({ type: 'buff_consumed', message: `🎯 ${c.name}'s Focus Strike adds ${mb.focus_strike.bonus_dmg} bonus damage!`, character_id: m.id });
          }
          if (hasDisengage) {
            dmg = Math.floor(dmg * (1 + mb.disengage_next_hit.bonus_mult));
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('disengage');
          }

          cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);
          events.push({
            type: 'attack_hit',
            message: `${isCrit ? `${atk.emoji} CRITICAL! ` : atk.emoji + ' '}${c.name} ${atk.verb} ${target.name}! Rolled ${roll} + ${sMod} ${atk.stat.toUpperCase()}${intLabel}${affLabel} = ${total} vs AC ${creatureAc} — ${dmg} damage.`,
          });

          if (mb.poison_buff && Math.random() < 0.4) {
            // Server-side DoT creation: upsert poison into active_effects
            const existing = activeEffects.find(e => e.source_id === m.id && e.target_id === target.id && e.effect_type === 'poison');
            const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
            const dexMod = sm((c.dex || 10) + (eb.dex || 0));
            const dmgPerTick = Math.max(1, Math.floor(dexMod * 1.2 * 0.67));
            const effData = {
              node_id: combatNodeId, target_id: target.id, source_id: m.id,
              session_id: session.id, effect_type: 'poison',
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
              session_id: session.id, effect_type: 'ignite',
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

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
          }
        } else {
          events.push({
            type: 'attack_miss',
            message: `${atk.emoji} ${c.name} ${atk.verb} ${target.name} — miss! Rolled ${roll} + ${sMod} ${atk.stat.toUpperCase()}${intLabel}${affLabel} = ${total} vs AC ${creatureAc}.`,
          });
        }
      }

      // ── Off-hand bonus attack ────────────────────────────────
      for (const m of members) {
        if (mHp[m.id] <= 0) continue;
        if (!isOffhandWeapon(offHandTag[m.id])) continue;
        const c = m.c;
        const eb = eq[m.id] || {};
        const atk = CLASS_ATK[c.class] || CLASS_ATK.warrior;
        const effStat = (c[atk.stat] || 10) + (eb[atk.stat] || 0);
        const sMod2 = sm(effStat);
        const ihb2 = intHitBonus((c.int || 10) + (eb.int || 0));
        const dcb2 = dexCritBonus((c.dex || 10) + (eb.dex || 0));
        const mileCrit2 = c.level >= 28 ? 1 : 0;
        const mb2 = buffs[m.id] || {};
        const critBuff2 = mb2.crit_buff?.bonus || 0;
        const effCrit2 = atk.crit - dcb2 - mileCrit2 - critBuff2;

        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) continue;

        let creatureAc2 = target.ac;
        if (mb2.sunder_target === target.id && mb2.sunder_reduction) {
          creatureAc2 = Math.max(creatureAc2 - mb2.sunder_reduction, 0);
        }

        const roll2 = rollD20();
        const total2 = roll2 + sMod2 + ihb2;

        if (roll2 >= effCrit2 || (roll2 !== 1 && total2 >= creatureAc2)) {
          const raw2 = rollDmg(atk.min, atk.max) + sMod2;
          const isCrit2 = roll2 >= effCrit2;
          const preBuff2 = isCrit2 ? Math.max(raw2 * 2, 1) : Math.max(raw2, 1);
          const dmg2 = Math.max(Math.floor(preBuff2 * OFFHAND_DAMAGE_MULT), 1);

          cHp[target.id] = Math.max(cHp[target.id] - dmg2, 0);
          events.push({
            type: 'offhand_hit',
            message: `${isCrit2 ? '🗡️ CRIT! ' : '🗡️ '}${c.name}'s off-hand strikes ${target.name}! Rolled ${roll2}+${sMod2}=${total2} vs AC ${creatureAc2} — ${dmg2} damage (30%).`,
          });

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
          }
        } else {
          events.push({
            type: 'offhand_miss',
            message: `🗡️ ${c.name}'s off-hand swings at ${target.name} — miss! Rolled ${roll2}+${sMod2}=${total2} vs AC ${creatureAc2}.`,
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
        for (const killId of dotResult.newKills) {
          const cr = creatures.find(c => c.id === killId);
          if (cr) {
            handleCreatureKill(cr, 'DoT', 0);
          }
        }
        // Merge loot from DoT kills into main lootQueue
        lootQueue.push(...dotResult.lootQueue);
      }

      // ── Creature counterattacks (skip in DoT-only mode) ───────
      if (!isDotOnly) for (const creature of creatures) {
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

    // ── Write state: creature HP / kills (shared resolver) ─────
    await writeCreatureState(db, creatures, cHp, cKilled);

    // ── Write state: member HP, XP, gold, CP, level-ups ─────────
    const memberStates: any[] = [];
    for (const m of members) {
      const c = m.c;
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

          const fInt = updates.int ?? c.int;
          const fWis = updates.wis ?? c.wis;
          const fCha = updates.cha ?? c.cha;
          const fDex = updates.dex ?? c.dex;
          const fCon = updates.con ?? c.con;
          newMaxHp = calcMaxHp(c.class, fCon, newLevel);
          updates.max_hp = newMaxHp;
          updates.hp = newMaxHp;
          updates.max_cp = calcMaxCp(newLevel, fInt, fWis, fCha);
          updates.max_mp = calcMaxMp(newLevel, fDex);

          events.push({ type: 'level_up', character_id: m.id, message: `🎉 Level Up! ${c.name} is now level ${newLevel}!` });
          events.push({ type: 'stat_point', message: `📊 ${c.name} gained 1 stat point to allocate!` });
        }
        if (newLevel >= 42) newXp = 0;
        updates.xp = newXp;
        updates.gold = newGold;
      }

      if (mBhp[m.id] > 0) {
        updates.bhp = (c.bhp || 0) + mBhp[m.id];
      }
      if (mSalvage[m.id] > 0) {
        updates.salvage = (c.salvage || 0) + mSalvage[m.id];
      }

      if (Object.keys(updates).length > 0) {
        await db.from('characters').update(updates).eq('id', m.id);
      }

      memberStates.push({
        character_id: m.id,
        hp: updates.hp ?? mHp[m.id],
        xp: updates.xp ?? c.xp,
        gold: updates.gold ?? c.gold,
        level: newLevel,
        max_hp: newMaxHp,
        bhp: updates.bhp ?? (c.bhp || 0),
        unspent_stat_points: updates.unspent_stat_points ?? c.unspent_stat_points ?? 0,
        max_cp: updates.max_cp ?? c.max_cp,
        max_mp: updates.max_mp ?? c.max_mp,
        respec_points: updates.respec_points ?? c.respec_points ?? 0,
        salvage: updates.salvage ?? (c.salvage || 0),
        cp: updates.cp ?? mCp[m.id],
      });
    }

    // ── Equipment degradation ────────────────────────────────────
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
    await Promise.all(degradePromises);

    // ── Loot drops (shared resolver) ───────────────────────────
    const lootEvents = await processLootDrops(db, lootQueue);
    events.push(...lootEvents);

    // ── Write active_effects to DB (shared cleanup + upsert) ──
    const expiredIds = activeEffects.filter(e => e._expired).map(e => e.id);
    await cleanupEffects(db, expiredIds, killedCreatureIds);
    // Upsert remaining active effects
    const liveEffects = activeEffects.filter(e => !e._expired && !killedCreatureIds.has(e.target_id));
    for (const eff of liveEffects) {
      const { _expired, ...row } = eff;
      await db.from('active_effects').upsert(row, { onConflict: 'source_id,target_id,effect_type' });
    }

    // ── Check if session should end ─────────────────────────────
    const anyAlive = creatures.some(cr => !cKilled.has(cr.id) && cHp[cr.id] > 0);
    const hasActiveEffects = liveEffects.length > 0;
    const sessionEnded = !anyAlive && !hasActiveEffects;

    if (sessionEnded) {
      await db.from('combat_sessions').delete().eq('id', session.id);
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
    console.log(JSON.stringify({
      fn: 'combat-tick',
      session_id: session.id,
      node_id: combatNodeId,
      last_tick_at_read: session.last_tick_at,
      elapsed_ms: elapsedMs,
      ticks_processed: ticks,
      engaged_count: sessionEngaged.size,
      effects_count: liveEffects.length,
      session_ended: sessionEnded,
    }));

    return json({
      events, creature_states, member_states: memberStates,
      consumed_buffs: consumedBuffsList, cleared_dots: clearedDots,
      consumed_ability_stacks: consumedAbilityStacks,
      active_effects: liveEffects.map(e => ({ source_id: e.source_id, target_id: e.target_id, effect_type: e.effect_type, stacks: e.stacks, damage_per_tick: e.damage_per_tick, expires_at: e.expires_at })),
      session_ended: sessionEnded,
      ticks_processed: ticks,
    });
  } catch (err) {
    console.error('Combat tick error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
