import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Combat formulas (replicated from game-data.ts) ───────────────

function sm(stat: number): number { return Math.floor((stat - 10) / 2); }
function rollD20(): number { return Math.floor(Math.random() * 20) + 1; }
function rollDmg(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function dim(mod: number, cap: number): number { return Math.min(cap, Math.floor(Math.sqrt(Math.max(0, mod)))); }
function dimF(mod: number, per: number, cap: number): number { return Math.min(cap, Math.sqrt(Math.max(0, mod)) * per); }

const intHitBonus = (int: number) => dim(sm(int), 3);
const dexCritBonus = (dex: number) => dim(sm(dex), 4);
const wisAwareness = (wis: number) => dimF(sm(wis), 0.03, 0.15);
const strDmgFloor = (str: number) => dim(sm(str), 3);
const chaGoldMult = (cha: number) => 1 + dimF(sm(cha), 0.05, 0.25);

function dexMultiAttack(dex: number): number {
  const m = sm(dex);
  return m >= 5 ? 3 : m >= 3 ? 2 : 1;
}

function creatureDmgDie(level: number, rarity: string): number {
  const base: Record<string, number> = { regular: 4, rare: 6, boss: 10 };
  return (base[rarity] || 4) + Math.floor(level / 2);
}

function xpForLevel(level: number): number {
  return Math.floor(Math.pow(level, 2.0) * 50);
}

function xpPenalty(playerLvl: number, creatureLvl: number): number {
  const diff = Math.max(playerLvl - creatureLvl, 0);
  const rate = playerLvl <= 5 ? 0.10 : playerLvl <= 10 ? 0.15 : 0.20;
  return Math.max(1 - diff * rate, 0.10);
}

function calcMaxCp(level: number, int: number, wis: number, cha: number): number {
  const m = Math.max(sm(int), sm(wis), sm(cha), 0);
  return 60 + (level - 1) * 3 + m * 5;
}

function calcMaxMp(level: number, dex: number): number {
  const m = Math.max(sm(dex), 0);
  return 100 + m * 10 + Math.floor((level - 1) * 2);
}

const XP_RARITY: Record<string, number> = { regular: 1, rare: 1.5, boss: 2.5 };

const CLASS_ATK: Record<string, { stat: string; min: number; max: number; crit: number; emoji: string; verb: string }> = {
  warrior: { stat: 'str', min: 1, max: 10, crit: 20, emoji: '⚔️', verb: 'swings at' },
  wizard:  { stat: 'int', min: 1, max: 8,  crit: 20, emoji: '🔥', verb: 'hurls flame at' },
  ranger:  { stat: 'dex', min: 1, max: 8,  crit: 20, emoji: '🏹', verb: 'shoots' },
  rogue:   { stat: 'dex', min: 1, max: 6,  crit: 19, emoji: '🗡️', verb: 'strikes' },
  healer:  { stat: 'wis', min: 1, max: 6,  crit: 20, emoji: '⭐', verb: 'smites' },
  bard:    { stat: 'cha', min: 1, max: 6,  crit: 20, emoji: '🎵', verb: 'mocks' },
};

const CLASS_LVL_BONUS: Record<string, Record<string, number>> = {
  warrior: { str: 1, dex: 1 }, wizard: { int: 1, wis: 1 },
  ranger: { dex: 1, wis: 1 }, rogue: { dex: 1, cha: 1 },
  healer: { wis: 1, con: 1 }, bard: { cha: 1, int: 1 },
};

const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger',
  rogue: 'Rogue', healer: 'Healer', bard: 'Bard',
};

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

    const { party_id, node_id, member_buffs } = await req.json();
    if (!party_id || !node_id) throw new Error('Missing party_id or node_id');
    const buffs: Record<string, any> = member_buffs || {};

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

    const creatures = creaturesRaw || [];
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
    const degradeSet = new Set<string>();
    const lootQueue: { nodeId: string; lootTableId: string | null; itemId: string | null; creatureName: string; dropChance: number }[] = [];

    for (const cr of creatures) cHp[cr.id] = cr.hp;
    for (const m of members) { mHp[m.id] = m.c.hp; mXp[m.id] = 0; mGold[m.id] = 0; }

    const tankId = party.tank_id ?? party.leader_id;
    const tankAtNode = members.some(m => m.id === tankId);

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
      const numAtk = dexMultiAttack((c.dex || 10) + (eb.dex || 0));
      const isStealth = !!mb.stealth_buff;
      const isDmgBuff = !!mb.damage_buff; // Arcane Surge
      const hasFocusStrike = !!mb.focus_strike;
      const hasDisengage = !!mb.disengage_next_hit;

      for (let a = 0; a < numAtk; a++) {
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

    // ── Creature counterattacks ──────────────────────────────────
    for (const creature of creatures) {
      if (cKilled.has(creature.id) || cHp[creature.id] <= 0) continue;
      const cs = creature.stats as any;
      const cStr = sm(cs.str || 10);
      const dmgDie = creatureDmgDie(creature.level, creature.rarity);

      if (tankAtNode) {
        const tank = members.find(m => m.id === tankId);
        if (!tank || mHp[tankId] <= 0) continue;
        const tEq = eq[tankId] || {};
        const tAC = (tank.c.ac || 10) + (tEq.ac || 0);
        const roll = rollD20() + cStr;

        if (roll >= tAC) {
          let dmg = Math.max(rollDmg(1, dmgDie) + cStr, 1);
          const wis = wisAwareness((tank.c.wis || 10) + (tEq.wis || 0));
          if (wis > 0 && Math.random() < wis) {
            dmg = Math.max(Math.floor(dmg * 0.75), 1);
            events.push({ type: 'wis_awareness', message: `🧘 ${tank.c.name}'s awareness softens ${creature.name}'s blow! (${dmg} damage)` });
          }
          mHp[tankId] = Math.max(mHp[tankId] - dmg, 0);
          degradeSet.add(tankId);
          events.push({ type: 'creature_hit', message: `🛡️ ${creature.name} strikes ${tank.c.name} (Tank)! Rolled ${roll} vs AC ${tAC} — ${dmg} damage.` });
          if (mHp[tankId] <= 0) {
            events.push({ type: 'member_death', message: `💀 ${tank.c.name} has been defeated...`, character_id: tankId });
          }
        } else {
          events.push({ type: 'creature_miss', message: `${creature.name} attacks ${tank.c.name} (Tank) — misses! Rolled ${roll} vs AC ${tAC}.` });
        }
      } else {
        // No tank at node — each creature attacks each member
        for (const m of members) {
          if (mHp[m.id] <= 0) continue;
          const mEq = eq[m.id] || {};
          const mAC = (m.c.ac || 10) + (mEq.ac || 0);
          const roll = rollD20() + cStr;

          if (roll >= mAC) {
            let dmg = Math.max(rollDmg(1, dmgDie) + cStr, 1);
            const wis = wisAwareness((m.c.wis || 10) + (mEq.wis || 0));
            if (wis > 0 && Math.random() < wis) {
              dmg = Math.max(Math.floor(dmg * 0.75), 1);
              events.push({ type: 'wis_awareness', message: `🧘 ${m.c.name}'s awareness softens ${creature.name}'s blow! (${dmg} damage)` });
            }
            mHp[m.id] = Math.max(mHp[m.id] - dmg, 0);
            degradeSet.add(m.id);
            events.push({ type: 'creature_hit', message: `${creature.name} strikes ${m.c.name}! Rolled ${roll} vs AC ${mAC} — ${dmg} damage.` });
            if (mHp[m.id] <= 0) {
              events.push({ type: 'member_death', message: `💀 ${m.c.name} has been defeated...`, character_id: m.id });
            }
          } else {
            events.push({ type: 'creature_miss', message: `${creature.name} attacks ${m.c.name} — misses! Rolled ${roll} vs AC ${mAC}.` });
          }
        }
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
          newMaxHp = c.max_hp + 5;
          updates.level = newLevel;
          updates.max_hp = newMaxHp;
          updates.hp = newMaxHp; // Full heal on level up
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
          updates.max_cp = calcMaxCp(newLevel, fInt, fWis, fCha);
          updates.max_mp = calcMaxMp(newLevel, fDex);

          events.push({ type: 'level_up', character_id: m.id, message: `🎉 Level Up! ${c.name} is now level ${newLevel}!` });
          events.push({ type: 'stat_point', message: `📊 ${c.name} gained 1 stat point to allocate!` });
        }
        updates.xp = newXp;
        updates.gold = newGold;
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

    return json({ events, creature_states, member_states: memberStates });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
