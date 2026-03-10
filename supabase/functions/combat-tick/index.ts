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

    const { party_id, node_id, member_buffs, member_dots, engaged_creature_ids } = await req.json();
    if (!party_id || !node_id) throw new Error('Missing party_id or node_id');
    const buffs: Record<string, any> = member_buffs || {};
    const dots: Record<string, any> = member_dots || {};
    const engagedIds: string[] = engaged_creature_ids || [];

    // ── Verify party leader ──────────────────────────────────────
    const { data: party } = await db.from('parties').select('id, leader_id, tank_id').eq('id', party_id).single();
    if (!party) throw new Error('Party not found');
    const { data: userChars } = await db.from('characters').select('id').eq('user_id', user.id);
    if (!userChars?.some(c => c.id === party.leader_id)) throw new Error('Not the party leader');

    // ── Fetch party members at node ──────────────────────────────
    const { data: membersRaw } = await db
      .from('party_members')
      .select('character_id, character:characters(*)')
      .eq('party_id', party_id)
      .eq('status', 'accepted');

    const members = (membersRaw || [])
      .filter(m => {
        const ch = m.character as any;
        return ch?.current_node_id === node_id && ch?.hp > 0;
      })
      .map(m => ({ id: m.character_id, c: m.character as any }));

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
    // Only fight creatures that are explicitly engaged OR aggressive
    const creatures = allCreatures.filter(cr =>
      engagedIds.includes(cr.id) || cr.is_aggressive
    );
    if (creatures.length === 0) return json({ events: [], creature_states: [], member_states: [] });

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
    const degradeSet = new Set<string>();
    const clearedDots: { character_id: string; creature_id: string; dot_type: string }[] = [];
    const lootQueue: { nodeId: string; lootTableId: string | null; itemId: string | null; creatureName: string; dropChance: number }[] = [];

    for (const cr of creatures) cHp[cr.id] = cr.hp;
    for (const m of members) { mHp[m.id] = m.c.hp; mXp[m.id] = 0; mGold[m.id] = 0; mBhp[m.id] = 0; }

    const tankId = party.tank_id || null;
    const tankAtNode = tankId ? members.some(m => m.id === tankId) : false;

    // ── Member attacks ───────────────────────────────────────────
    const consumedBuffs: Record<string, string[]> = {}; // track one-shot buffs to consume
    for (const m of members) {
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
            events.push({ type: 'poison_proc', message: `🧪 ${c.name}'s attack poisons ${target.name}!` });
          }
          // Ignite proc (40% chance if ignite buff active)
          if (mb.ignite_buff && Math.random() < 0.4) {
            events.push({ type: 'ignite_proc', message: `🔥 ${c.name}'s attack ignites ${target.name}!` });
          }

          if (cHp[target.id] <= 0) {
            cKilled.add(target.id);

            // Calculate rewards
            const baseXp = Math.floor(target.level * 10 * (XP_RARITY[target.rarity] || 1));
            const lt = (target.loot_table || []) as any[];
            const goldEntry = lt.find((e: any) => e.type === 'gold');
            let totalGold = 0;
            if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
              totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
            }
            if (target.is_humanoid) {
              totalGold = Math.floor(totalGold * chaGoldMult((c.cha || 10) + (eb.cha || 0)));
            }

            const split = members.length;
            const goldEach = Math.floor(totalGold / split);
            for (const mm of members) {
              const penalty = xpPenalty(mm.c.level, target.level);
              mXp[mm.id] += Math.floor(Math.floor(baseXp * penalty * xpMult) / split);
              mGold[mm.id] += goldEach;
            }

            const xpBoostNote = xpMult > 1 ? ` ⚡${xpMult}x` : '';
            const goldNote = goldEach > 0 ? `, +${goldEach} gold` : '';
            events.push({
              type: 'creature_kill',
              message: `☠️ ${target.name} has been slain! Rewards split ${split} ways: +${Math.floor(baseXp / split)} XP${goldNote} each.${xpBoostNote}`,
            });

            // BHP for boss kills
            if (target.rarity === 'boss') {
              const bhpReward = Math.floor(target.level * 0.5);
              if (bhpReward > 0) {
                const bhpEach = Math.floor(bhpReward / split);
                if (bhpEach > 0) {
                  for (const mm of members) {
                    if (mm.c.level >= 30) mBhp[mm.id] += bhpEach;
                  }
                  events.push({ type: 'bhp_award', message: `🏋️ +${bhpEach} Boss Hunter Points each!` });
                }
              }
            }

            // Queue loot
            if (target.loot_table_id) {
              lootQueue.push({ nodeId: node_id, lootTableId: target.loot_table_id, itemId: null, creatureName: target.name, dropChance: target.drop_chance ?? 0.5 });
            } else {
              for (const entry of lt) {
                if (entry.type === 'gold') continue;
                if (Math.random() <= (entry.chance || 0.1)) {
                  lootQueue.push({ nodeId: node_id, lootTableId: null, itemId: entry.item_id, creatureName: target.name, dropChance: 1 });
                }
              }
            }
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
    // Helper: handle DoT kill reward/loot
    const handleDotKill = (creature: any, killerName: string) => {
      cKilled.add(creature.id);
      const baseXp = Math.floor(creature.level * 10 * (XP_RARITY[creature.rarity] || 1));
      const lt = (creature.loot_table || []) as any[];
      const goldEntry = lt.find((e: any) => e.type === 'gold');
      let totalGold = 0;
      if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
        totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
      }
      const split = members.length;
      const goldEach = Math.floor(totalGold / split);
      for (const mm of members) {
        const penalty = xpPenalty(mm.c.level, creature.level);
        mXp[mm.id] += Math.floor(Math.floor(baseXp * penalty * xpMult) / split);
        mGold[mm.id] += goldEach;
      }
      const xpBoostNote = xpMult > 1 ? ` ⚡${xpMult}x` : '';
      const goldNote = goldEach > 0 ? `, +${goldEach} gold` : '';
      events.push({ type: 'creature_kill', message: `☠️ ${creature.name} has been slain by ${killerName}'s DoT! Rewards split ${split} ways: +${Math.floor(baseXp / split)} XP${goldNote} each.${xpBoostNote}` });
      // BHP for boss DoT kills
      if (creature.rarity === 'boss') {
        const bhpReward = Math.floor(creature.level * 0.5);
        if (bhpReward > 0) {
          const bhpEach = Math.floor(bhpReward / split);
          if (bhpEach > 0) {
            for (const mm of members) {
              if (mm.c.level >= 30) mBhp[mm.id] += bhpEach;
            }
            events.push({ type: 'bhp_award', message: `🏋️ +${bhpEach} Boss Hunter Points each!` });
          }
        }
      }
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

    for (const [charId, dotState] of Object.entries(dots)) {
      const member = members.find(m => m.id === charId);
      const charName = member?.c?.name || 'Unknown';

      // Bleed (Rend) — single target
      if (dotState.bleed) {
        const { creature_id, damage_per_tick } = dotState.bleed;
        const creature = creatures.find(cr => cr.id === creature_id);
        if (creature && cHp[creature_id] > 0 && !cKilled.has(creature_id)) {
          cHp[creature_id] = Math.max(cHp[creature_id] - damage_per_tick, 0);
          events.push({ type: 'dot_tick', message: `🩸 ${creature.name} bleeds for ${damage_per_tick} damage! (${charName}'s Rend)` });
          if (cHp[creature_id] <= 0) {
            handleDotKill(creature, charName);
            clearedDots.push({ character_id: charId, creature_id, dot_type: 'bleed' });
          }
        } else if (!creature || cKilled.has(creature_id)) {
          clearedDots.push({ character_id: charId, creature_id, dot_type: 'bleed' });
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
            handleDotKill(creature, charName);
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
            handleDotKill(creature, charName);
            clearedDots.push({ character_id: charId, creature_id: creatureId, dot_type: 'ignite' });
          }
        }
      }
    }


    // Helper to apply defensive buffs and deal damage to a target
    const applyCreatureHit = (targetId: string, targetName: string, targetC: any, targetEq: Record<string, number>, creature: any, cStr: number, dmgDie: number, tankLabel: string) => {
      const mb = buffs[targetId] || {};
      const acBuffBonus = mb.ac_buff || 0;
      const tAC = (targetC.ac || 10) + (targetEq.ac || 0) + acBuffBonus;
      const roll = rollD20() + cStr;

      if (roll >= tAC) {
        // Evasion check (Cloak of Shadows / Disengage)
        if (mb.evasion_buff?.dodge_chance && Math.random() < mb.evasion_buff.dodge_chance) {
          events.push({ type: 'evasion_dodge', message: `🦘 ${targetName} dodges ${creature.name}'s attack!`, character_id: targetId });
          return;
        }

        let dmg = Math.max(rollDmg(1, dmgDie) + cStr, 1);
        // Level-gap bonus: creatures deal more damage when they out-level the target
        const levelGap = creatureLevelGapMult(creature.level, targetC.level || 1);
        if (levelGap > 1) dmg = Math.max(Math.floor(dmg * levelGap), 1);

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
          events.push({ type: 'absorb', message: `🛡️✨ ${c.name} hits ${targetName} — shield absorbs ${absorbed} damage! (${mb.absorb_buff.shield_hp} remaining)`, character_id: targetId });
          if (dmg <= 0) return;
        }

        mHp[targetId] = Math.max(mHp[targetId] - dmg, 0);
        degradeSet.add(targetId);
        events.push({ type: 'creature_hit', message: `${tankLabel}${creature.name} strikes ${targetName}${tankLabel ? ' (Tank)' : ''}! Rolled ${roll} vs AC ${tAC} — ${dmg} damage.` });
        if (mHp[targetId] <= 0) {
          events.push({ type: 'member_death', message: `💀 ${targetName} has been defeated...`, character_id: targetId });
        }
      } else {
        events.push({ type: 'creature_miss', message: `${creature.name} attacks ${targetName}${tankLabel ? ' (Tank)' : ''} — misses! Rolled ${roll} vs AC ${tAC}.` });
      }
    };

    for (const creature of creatures) {
      if (cKilled.has(creature.id) || cHp[creature.id] <= 0) continue;
      const cs = creature.stats as any;
      const cStr = sm(cs.str || 10);
      const dmgDie = creatureDmgDie(creature.level, creature.rarity);

      if (tankAtNode) {
        const tank = members.find(m => m.id === tankId);
        if (!tank || mHp[tankId] <= 0) continue;
        applyCreatureHit(tankId, tank.c.name, tank.c, eq[tankId] || {}, creature, cStr, dmgDie, '🛡️ ');
      } else {
        for (const m of members) {
          if (mHp[m.id] <= 0) continue;
          applyCreatureHit(m.id, m.c.name, m.c, eq[m.id] || {}, creature, cStr, dmgDie, '');
        }
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

    // ── Write state: member HP, XP, gold, level-ups ─────────────
    const memberStates: any[] = [];
    for (const m of members) {
      const c = m.c;
      const updates: Record<string, any> = {};

      if (mHp[m.id] !== c.hp) updates.hp = mHp[m.id];

      let newXp = c.xp + mXp[m.id];
      let newGold = c.gold + mGold[m.id];
      let newLevel = c.level;
      let newMaxHp = c.max_hp;

      if (mXp[m.id] > 0 || mGold[m.id] > 0) {
        const needed = xpForLevel(c.level);
        if (newXp >= needed) {
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
        updates.xp = newXp;
        updates.gold = newGold;
      }

      // BHP award
      if (mBhp[m.id] > 0) {
        updates.bhp = (c.bhp || 0) + mBhp[m.id];
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
      });
    }

    // ── Equipment degradation (inline — RPC checks auth.uid) ────
    const degradePromises = [...degradeSet].map(async (cid) => {
      if (Math.random() > 0.25) return;
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
    const creature_states = creatures.map(cr => ({
      id: cr.id,
      hp: cHp[cr.id],
      alive: !cKilled.has(cr.id) && cHp[cr.id] > 0,
    }));

    return json({ events, creature_states, member_states: memberStates, consumed_buffs: consumedBuffsList, cleared_dots: clearedDots });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
