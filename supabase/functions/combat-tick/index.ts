import { createClient } from "jsr:@supabase/supabase-js@2";
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
} from "../_shared/combat-math.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Map CLASS_COMBAT_PROFILES to the local format used below
const CLASS_ATK: Record<string, { stat: string; min: number; max: number; crit: number; emoji: string; verb: string }> = {};
for (const [k, v] of Object.entries(CLASS_COMBAT_PROFILES)) {
  CLASS_ATK[k] = { stat: v.stat, min: v.diceMin, max: v.diceMax, crit: v.critRange, emoji: v.emoji, verb: v.verb };
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

    const { party_id, character_id, node_id, member_buffs, member_dots, engaged_creature_ids, pending_abilities: rawPendingAbilities } = await req.json();
    if (!node_id) throw new Error('Missing node_id');
    if (!party_id && !character_id) throw new Error('Missing party_id or character_id');
    const buffs: Record<string, any> = member_buffs || {};
    const dots: Record<string, any> = member_dots || {};
    const engagedIds: string[] = engaged_creature_ids || [];
    const pendingAbilities: any[] = rawPendingAbilities || [];

    let members: { id: string; c: any }[];
    let tankId: string | null = null;
    let tankAtNode = false;

    if (party_id) {
      // ── Party mode ───────────────────────────────────────────────
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
    } else {
      // ── Solo mode ────────────────────────────────────────────────
      const { data: char } = await db.from('characters').select('*').eq('id', character_id).single();
      if (!char || char.user_id !== user.id) throw new Error('Not authorized');
      if (char.hp <= 0) {
        return json({ events: [], creature_states: [], member_states: [] });
      }
      // Allow DoT-only ticks from a different node
      const charAtNode = char.current_node_id === node_id;
      if (!charAtNode) {
        const charDots = dots[character_id];
        const hasDots = charDots && (
          Object.keys(charDots?.bleed || {}).length > 0 ||
          Object.keys(charDots?.poison || {}).length > 0 ||
          Object.keys(charDots?.ignite || {}).length > 0
        );
        if (!hasDots) {
          return json({ events: [], creature_states: [], member_states: [] });
        }
      }
      members = [{ id: character_id, c: char }];
    }

    if (members.length === 0) return json({ events: [], creature_states: [], member_states: [] });

    // ── Fetch equipment bonuses ──────────────────────────────────
    const charIds = members.map(m => m.id);
    const { data: allEquip } = await db
      .from('character_inventory')
      .select('character_id, item:items(stats)')
      .in('character_id', charIds)
      .not('equipped_slot', 'is', null);

    const eq: Record<string, Record<string, number>> = {};
    for (const cid of charIds) {
      const b: Record<string, number> = {};
      for (const e of (allEquip || []).filter(e => e.character_id === cid)) {
        for (const [s, v] of Object.entries((e.item as any)?.stats || {})) {
          b[s] = (b[s] || 0) + (v as number);
        }
      }
      eq[cid] = b;
    }

    // ── Fetch alive creatures at node ────────────────────────────
    const { data: creaturesRaw } = await db
      .from('creatures')
      .select('*')
      .eq('node_id', node_id)
      .eq('is_alive', true);

    const allCreatures = creaturesRaw || [];
    // Collect creature IDs that have active DoTs targeting them
    const dotTargetIds = new Set<string>();
    for (const dotState of Object.values(dots)) {
      for (const creatureId of Object.keys((dotState as any)?.bleed || {})) dotTargetIds.add(creatureId);
      for (const creatureId of Object.keys((dotState as any)?.poison || {})) dotTargetIds.add(creatureId);
      for (const creatureId of Object.keys((dotState as any)?.ignite || {})) dotTargetIds.add(creatureId);
    }
    // Also include creatures targeted by pending abilities
    for (const pa of pendingAbilities) {
      if (pa.target_creature_id) dotTargetIds.add(pa.target_creature_id);
    }
    // Only fight creatures that are explicitly engaged, aggressive, OR have active DoTs/abilities
    const creatures = allCreatures.filter(cr =>
      engagedIds.includes(cr.id) || cr.is_aggressive || dotTargetIds.has(cr.id)
    );
    if (creatures.length === 0) {
      // No combat targets, but return all alive creatures so client knows they exist
      const creature_states = allCreatures.map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
      return json({ events: [], creature_states, member_states: [] });
    }
    // Determine if this is a DoT-only tick (player fled or no engaged targets)
    const anyMemberAtNode = members.some(m => m.c.current_node_id === node_id);
    const isDotOnly = !anyMemberAtNode || (engagedIds.length === 0 && dotTargetIds.size > 0 && pendingAbilities.length === 0);

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
    const lootQueue: { nodeId: string; lootTableId: string | null; itemId: string | null; creatureName: string; dropChance: number }[] = [];
    const consumedAbilityStacks: { character_id: string; creature_id: string; stack_type: string }[] = [];

    for (const cr of creatures) cHp[cr.id] = cr.hp;
    for (const m of members) { mHp[m.id] = m.c.hp; mXp[m.id] = 0; mGold[m.id] = 0; mBhp[m.id] = 0; mSalvage[m.id] = 0; mCp[m.id] = m.c.cp ?? 0; }

    // ── Unified creature kill handler ────────────────────────────
    const handleCreatureKill = (creature: any, killerLabel: string, chaForGold: number = 0) => {
      cKilled.add(creature.id);
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
      // BHP for boss kills
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
      // Salvage for non-humanoid kills
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
      // Queue loot
      if (creature.loot_table_id) {
        lootQueue.push({ nodeId: node_id, lootTableId: creature.loot_table_id, itemId: null, creatureName: creature.name, dropChance: creature.drop_chance ?? 0.5 });
      } else {
        for (const entry of lt) {
          if (entry.type === 'gold') continue;
          if (Math.random() <= (entry.chance || 0.1)) {
            lootQueue.push({ nodeId: node_id, lootTableId: null, itemId: entry.item_id, creatureName: creature.name, dropChance: 1 });
          }
        }
      }
    };

    // ── Pending abilities (server-side processing) ───────────────
    if (!isDotOnly) for (const pa of pendingAbilities) {
      const member = members.find(m => m.id === pa.character_id);
      if (!member) continue;
      const c = member.c;
      const eb = eq[member.id] || {};

      // CP check & deduction
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
        // Barrage — 2-3 arrows at 70% damage
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
        // Eviscerate — base damage * (1 + 0.5 * stacks)
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
        // Conflagrate — base damage * (1 + 0.5 * stacks)
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
        // Grand Finale — CHA-based burst
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

    // tankId and tankAtNode already set during party/solo initialization above

    // ── Member attacks (skip in DoT-only mode) ─────────────────
    const consumedBuffs: Record<string, string[]> = {}; // track one-shot buffs to consume
    if (!isDotOnly) for (const m of members) {
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
      const isDmgBuff = !!mb.damage_buff; // Arcane Surge
      const hasFocusStrike = !!mb.focus_strike;
      const hasDisengage = !!mb.disengage_next_hit;

      for (let a = 0; a < 1; a++) {
        const target = creatures.find(cr => cHp[cr.id] > 0 && !cKilled.has(cr.id));
        if (!target) break;

        // Apply sunder debuff to creature AC
        let creatureAc = target.ac;
        if (mb.sunder_target === target.id && mb.sunder_reduction) {
          creatureAc = Math.max(creatureAc - mb.sunder_reduction, 0);
        }

        const roll = rollD20();
        const total = roll + sMod + ihb;
        const intLabel = ihb > 0 ? ` + ${ihb} INT` : '';

        if (roll >= effCrit || (roll !== 1 && total >= creatureAc)) {
          let raw = rollDmg(atk.min, atk.max) + sMod;
          const isCrit = roll >= effCrit;

          // Apply damage multipliers
          let dmg = isCrit ? Math.max(raw * 2, 1) : Math.max(raw, 1 + sdf);
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
          if (hasDisengage && a === 0) {
            dmg = Math.floor(dmg * (1 + mb.disengage_next_hit.bonus_mult));
            if (!consumedBuffs[m.id]) consumedBuffs[m.id] = [];
            consumedBuffs[m.id].push('disengage');
          }

          cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);

          events.push({
            type: 'attack_hit',
            message: `${isCrit ? `${atk.emoji} CRITICAL! ` : atk.emoji + ' '}${c.name} ${atk.verb} ${target.name}! Rolled ${roll} + ${sMod} ${atk.stat.toUpperCase()}${intLabel} = ${total} vs AC ${creatureAc} — ${dmg} damage.`,
          });

          // Poison proc (40% chance if poison buff active)
          if (mb.poison_buff && Math.random() < 0.4) {
            events.push({ type: 'poison_proc', character_id: m.id, creature_id: target.id, message: `🧪 ${c.name}'s attack poisons ${target.name}!` });
          }
          // Ignite proc (40% chance if ignite buff active)
          if (mb.ignite_buff && Math.random() < 0.4) {
            events.push({ type: 'ignite_proc', character_id: m.id, creature_id: target.id, message: `🔥 ${c.name}'s attack ignites ${target.name}!` });
          }

          if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
            handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
          }
        } else {
          events.push({
            type: 'attack_miss',
            message: `${atk.emoji} ${c.name} ${atk.verb} ${target.name} — miss! Rolled ${roll} + ${sMod} ${atk.stat.toUpperCase()}${intLabel} = ${total} vs AC ${creatureAc}.`,
          });
        }
      }
    }

    // ── DoT ticking (Bleed, Poison, Ignite) ──────────────────────

    for (const [charId, dotState] of Object.entries(dots)) {
      const member = members.find(m => m.id === charId);
      const charName = member?.c?.name || 'Unknown';

      // Bleed (Rend) — keyed by creature_id
      if (dotState.bleed) {
        for (const [creatureId, bs] of Object.entries(dotState.bleed as Record<string, { damage_per_tick: number }>)) {
          const creature = creatures.find(cr => cr.id === creatureId);
          if (!creature || cHp[creatureId] <= 0 || cKilled.has(creatureId)) {
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'bleed' });
            continue;
          }
          cHp[creatureId] = Math.max(cHp[creatureId] - bs.damage_per_tick, 0);
          events.push({ type: 'dot_tick', message: `🩸 ${creature.name} bleeds for ${bs.damage_per_tick} damage! (${charName}'s Rend)` });
          if (cHp[creatureId] <= 0) {
            handleCreatureKill(creature, charName);
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'bleed' });
          }
        }
      }

      // Poison stacks
      if (dotState.poison) {
        for (const [creatureId, ps] of Object.entries(dotState.poison as Record<string, { stacks: number; damage_per_tick: number }>)) {
          const creature = creatures.find(cr => cr.id === creatureId);
          if (!creature || cHp[creatureId] <= 0 || cKilled.has(creatureId)) {
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'poison' });
            continue;
          }
          const totalDmg = ps.stacks * ps.damage_per_tick;
          cHp[creatureId] = Math.max(cHp[creatureId] - totalDmg, 0);
          events.push({ type: 'dot_tick', message: `🧪 ${creature.name} takes ${totalDmg} poison damage! (${ps.stacks} stack${ps.stacks > 1 ? 's' : ''}, ${charName})` });
          if (cHp[creatureId] <= 0) {
            handleCreatureKill(creature, charName);
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'poison' });
          }
        }
      }

      // Ignite stacks
      if (dotState.ignite) {
        for (const [creatureId, is] of Object.entries(dotState.ignite as Record<string, { stacks: number; damage_per_tick: number }>)) {
          const creature = creatures.find(cr => cr.id === creatureId);
          if (!creature || cHp[creatureId] <= 0 || cKilled.has(creatureId)) {
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'ignite' });
            continue;
          }
          const totalDmg = is.stacks * is.damage_per_tick;
          cHp[creatureId] = Math.max(cHp[creatureId] - totalDmg, 0);
          events.push({ type: 'dot_tick', message: `🔥 ${creature.name} burns for ${totalDmg} fire damage! (${is.stacks} stack${is.stacks > 1 ? 's' : ''}, ${charName})` });
          if (cHp[creatureId] <= 0) {
            handleCreatureKill(creature, charName);
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'ignite' });
          }
        }
      }
    }


    // Helper to apply defensive buffs and deal damage to a target
    const applyCreatureHit = (targetId: string, targetName: string, targetC: any, targetEq: Record<string, number>, creature: any, cStr: number, dmgDie: number, tankLabel: string) => {
      const mb = buffs[targetId] || {};
      const acBuffBonus = mb.ac_buff || 0;
      // Recalculate AC from class + effective DEX (base + equipment) to avoid stale DB ac column
      const effectiveDex = (targetC.dex || 10) + (targetEq.dex || 0);
      const tAC = calcAC(targetC.class || 'warrior', effectiveDex) + (targetEq.ac || 0) + acBuffBonus;
      const d20 = rollD20();
      const roll = d20 + cStr;

      // Creature crit range: based on creature's DEX
      const cs = creature.stats as any;
      const cDex = cs.dex || 10;
      const cCritBonus = dexCritBonus(cDex);
      const cCritThreshold = 20 - cCritBonus;
      const isCrit = d20 >= cCritThreshold;
      const isNat1 = d20 === 1;

      // Hit if: crit (always hits), or (not nat 1 and roll >= AC)
      if (!isNat1 && (isCrit || roll >= tAC)) {
        // Evasion check (Cloak of Shadows / Disengage)
        if (mb.evasion_buff?.dodge_chance && Math.random() < mb.evasion_buff.dodge_chance) {
          events.push({ type: 'evasion_dodge', message: `🦘 ${targetName} dodges ${creature.name}'s attack!`, character_id: targetId });
          return;
        }

        let baseDmg = Math.max(rollDmg(1, dmgDie) + cStr, 1);
        let dmg = isCrit ? Math.max(Math.floor(baseDmg * 1.5), 1) : baseDmg;
        // Level-gap bonus: creatures deal more damage when they out-level the target
        const levelGap = creatureLevelGapMult(creature.level, targetC.level || 1);
        if (levelGap > 1) dmg = Math.max(Math.floor(dmg * levelGap), 1);

        // AC overflow reduction: when a crit forces a hit but roll < AC, excess AC reduces damage
        if (isCrit && roll < tAC) {
          const overflowMult = acOverflowMult(roll, tAC);
          const preDmg = dmg;
          dmg = Math.max(Math.floor(dmg * overflowMult), 1);
          const pctReduced = Math.round((1 - overflowMult) * 100);
          events.push({ type: 'ac_overflow', message: `🛡️ ${targetName}'s armor absorbs the blow! AC ${tAC} vs ${roll} — ${pctReduced}% damage reduced (${preDmg} → ${dmg}).` });
        }

        // WIS awareness
        const wis = wisAwareness((targetC.wis || 10) + (targetEq.wis || 0));
        if (wis > 0 && Math.random() < wis) {
          dmg = Math.max(Math.floor(dmg * 0.75), 1);
          events.push({ type: 'wis_awareness', message: `🧘 ${targetName}'s awareness softens ${creature.name}'s blow! (${dmg} damage)` });
        }

        // Absorb shield
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

    if (!isDotOnly) for (const creature of creatures) {
      if (cKilled.has(creature.id) || cHp[creature.id] <= 0) continue;
      const cs = creature.stats as any;
      const cStr = sm(cs.str || 10);
      const dmgDie = creatureDmgDie(creature.level, creature.rarity);

      if (tankAtNode) {
        const tank = members.find(m => m.id === tankId);
        if (!tank || mHp[tankId] <= 0) continue;
        applyCreatureHit(tankId, tank.c.name, tank.c, eq[tankId] || {}, creature, cStr, dmgDie, '🛡️ ');
      } else {
        // No tank — creature picks a random alive member to attack
        const alive = members.filter(m => mHp[m.id] > 0);
        if (alive.length === 0) continue;
        const target = alive[Math.floor(Math.random() * alive.length)];
        applyCreatureHit(target.id, target.c.name, target.c, eq[target.id] || {}, creature, cStr, dmgDie, '');
      }
    }

    // ── Report consumed one-shot buffs ──────────────────────────
    const consumedBuffsList: any[] = [];
    for (const [cid, consumed] of Object.entries(consumedBuffs)) {
      for (const buff of consumed) {
        consumedBuffsList.push({ type: 'buff_consumed', character_id: cid, buff });
      }
    }

    // ── Write state: creature HP / kills ─────────────────────────
    const creaturePromises = creatures.map(cr => {
      if (cKilled.has(cr.id)) {
        return db.rpc('damage_creature', { _creature_id: cr.id, _new_hp: 0, _killed: true });
      } else if (cHp[cr.id] !== cr.hp) {
        return db.rpc('damage_creature', { _creature_id: cr.id, _new_hp: cHp[cr.id] });
      }
      return Promise.resolve();
    });
    await Promise.all(creaturePromises);

    // ── Write state: member HP, XP, gold, CP, level-ups ─────────
    const memberStates: any[] = [];
    for (const m of members) {
      const c = m.c;
      const updates: Record<string, any> = {};

      if (mHp[m.id] !== c.hp) updates.hp = mHp[m.id];

      // CP changes from abilities
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
          updates.hp = newMaxHp; // Full heal on level up
          updates.max_cp = calcMaxCp(newLevel, fInt, fWis, fCha);
          updates.max_mp = calcMaxMp(newLevel, fDex);

          events.push({ type: 'level_up', character_id: m.id, message: `🎉 Level Up! ${c.name} is now level ${newLevel}!` });
          events.push({ type: 'stat_point', message: `📊 ${c.name} gained 1 stat point to allocate!` });
        }
        if (newLevel >= 42) newXp = 0;
        updates.xp = newXp;
        updates.gold = newGold;
      }

      // BHP award
      if (mBhp[m.id] > 0) {
        updates.bhp = (c.bhp || 0) + mBhp[m.id];
      }

      // Salvage award
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

    // ── Equipment degradation (inline — RPC checks auth.uid) ────
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

    // ── Loot drops ───────────────────────────────────────────────
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
            if (count && count > 0) {
              events.push({ type: 'loot_drop', message: `✨ The unique power of ${item.name} is already claimed...` });
              continue;
            }
          }
          await db.from('node_ground_loot').insert({ node_id: drop.nodeId, item_id: picked, creature_name: drop.creatureName });
          events.push({ type: 'loot_drop', message: `💎 ${drop.creatureName} dropped ${item.name}!` });
        } else if (drop.itemId) {
          const { data: item } = await db.from('items').select('name, rarity').eq('id', drop.itemId).single();
          if (!item) continue;
          if (item.rarity === 'unique') {
            const { count } = await db.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', drop.itemId);
            if (count && count > 0) {
              events.push({ type: 'loot_drop', message: `✨ The unique power of ${item.name} is already claimed...` });
              continue;
            }
          }
          await db.from('node_ground_loot').insert({ node_id: drop.nodeId, item_id: drop.itemId, creature_name: drop.creatureName });
          events.push({ type: 'loot_drop', message: `💎 ${drop.creatureName} dropped ${item.name}!` });
        }
      } catch (e) {
        console.error('Loot drop error:', e);
      }
    }

    // ── Response ─────────────────────────────────────────────────
    // Include ALL alive creatures at the node (not just combat-filtered) so client can distinguish
    // "quiet tick with alive creatures" from "no creatures exist"
    const combatCreatureStates = creatures.map(cr => ({
      id: cr.id,
      hp: cHp[cr.id],
      alive: !cKilled.has(cr.id) && cHp[cr.id] > 0,
    }));
    const nonCombatAlive = allCreatures
      .filter(cr => !creatures.some(cc => cc.id === cr.id))
      .map(cr => ({ id: cr.id, hp: cr.hp, alive: true }));
    const creature_states = [...combatCreatureStates, ...nonCombatAlive];

    return json({ events, creature_states, member_states: memberStates, consumed_buffs: consumedBuffsList, cleared_dots: clearedDots, consumed_ability_stacks: consumedAbilityStacks });
  } catch (err) {
    console.error('Combat tick error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
