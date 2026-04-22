/**
 * useCombatActions — owns combat-related player actions:
 * equipment degradation, loot rolling, kill rewards, abilities, and attack.
 *
 * Pure helpers are extracted at module level for testability and readability.
 * The hook itself orchestrates these helpers with React state and side effects.
 *
 * State classification: Action orchestration (no owned state beyond lastUsedAbilityCost)
 */
import { useState, useCallback } from 'react';
import { Character } from '@/features/character';
import {
  getStatModifier, XP_RARITY_MULTIPLIER, getXpForLevel, getXpPenalty,
  getMaxCp, getMaxMp, getMaxHp, getChaGoldMultiplier, CLASS_LEVEL_BONUSES, CLASS_LABELS,
  getEffectiveMaxHp,
} from '@/lib/game-data';
import { CLASS_ABILITIES, UNIVERSAL_ABILITIES } from '@/features/combat';
import { supabase } from '@/integrations/supabase/client';
import { getCachedItemAsync } from '@/features/inventory';
import type { DotDebuff } from '@/features/combat';
import type { BuffState, BuffSetters } from '@/features/combat/hooks/useBuffState';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure helpers (module-level, outside hook)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Ability types that resolve instantly client-side (buffs only — heals stay queued for rate-limiting) */
const INSTANT_BUFF_TYPES = new Set([
  'focus_strike', 'stealth_buff', 'crit_buff', 'damage_buff', 'battle_cry',
  'regen_buff', 'poison_buff', 'evasion_buff', 'disengage_buff', 'ignite_buff',
  'absorb_buff', 'party_regen', 'root_debuff', 'sunder_debuff', 'ally_absorb',
]);

/** Ability types that require being in combat with a valid target */
const COMBAT_REQUIRED_TYPES = new Set([
  'multi_attack', 'dot_debuff', 'execute_attack', 'ignite_consume',
  'burst_damage', 'hp_transfer',
]);

/** Flavour text for queued abilities */
function getQueueFlavour(ability: { label: string; emoji: string; type: string }, creatureName?: string): string {
  const target = creatureName || 'your target';
  switch (ability.type) {
    case 'self_heal': return `⏳ ${ability.emoji} You brace yourself and begin catching your breath...`;
    case 'heal': return `⏳ ${ability.emoji} You channel healing energy...`;
    case 'dot_debuff': return `⏳ ${ability.emoji} You look for an opportunity to rend ${target}...`;
    case 'multi_attack': return `⏳ ${ability.emoji} You nock multiple arrows...`;
    case 'execute_attack': return `⏳ ${ability.emoji} You line up a vicious strike on ${target}...`;
    case 'ignite_consume': return `⏳ ${ability.emoji} You gather the flames building on ${target}...`;
    case 'hp_transfer': return `⏳ ${ability.emoji} You begin channeling your life force...`;
    case 'burst_damage': return `⏳ ${ability.emoji} You draw breath for a devastating crescendo...`;
    default: return `⏳ ${ability.emoji} ${ability.label}...`;
  }
}

/** Resolve creature target — prefer explicit targetId, fall back to active combat target */
function resolveCreatureTarget(
  creatures: any[],
  activeCombatCreatureId: string | null,
  targetId?: string,
): string | null {
  if (targetId) {
    const c = creatures.find(cr => cr.id === targetId && cr.is_alive && cr.hp > 0);
    if (c) return targetId;
  }
  return activeCombatCreatureId;
}

/** Build updates object for a level-up (stat recalc, class bonuses, milestones, soulwright whisper) */
function buildLevelUpUpdates(
  character: Character,
  newLevel: number,
  _equipmentBonuses: Record<string, number>,
  addLog: (msg: string) => void,
): Partial<Character> {
  const levelUpUpdates: Partial<Character> = {
    xp: 0, // caller sets the remainder
    level: newLevel,
    unspent_stat_points: (character.unspent_stat_points || 0) + 1,
  };

  addLog(`🎉 Level Up! You are now level ${newLevel}!`);
  addLog(`📊 You gained 1 stat point to allocate!`);

  if ([10, 20, 30, 40].includes(newLevel)) {
    levelUpUpdates.respec_points = (character.respec_points || 0) + 1;
    addLog(`🔄 You earned a respec point! You can reallocate a stat point.`);
  }

  // Apply class stat bonuses every 3 levels
  if (newLevel % 3 === 0) {
    const bonuses = CLASS_LEVEL_BONUSES[character.class] || {};
    const bonusNames: string[] = [];
    for (const [stat, amount] of Object.entries(bonuses)) {
      const currentVal = (levelUpUpdates as any)[stat] ?? (character as any)[stat] ?? 10;
      (levelUpUpdates as any)[stat] = currentVal + amount;
      bonusNames.push(`+${amount} ${stat.toUpperCase()}`);
    }
    if (bonusNames.length > 0) {
      addLog(`📈 ${CLASS_LABELS[character.class] || character.class} bonus: ${bonusNames.join(', ')}!`);
    }
  }

  // Level 42 — Soulforge whisper
  if (newLevel === 42) {
    const whisperChannel = supabase.channel(`chat-whisper-${character.id}`);
    whisperChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        whisperChannel.send({
          type: 'broadcast',
          event: 'whisper',
          payload: {
            senderId: 'soulwright',
            senderName: 'The Soulwright',
            text: 'You have reached the pinnacle of mortal power. Come find me at The Soulwright\'s Forge deep within Kharak-Dum, and I shall forge for you a weapon born of your own soul. This gift can only be claimed once.',
          },
        });
        setTimeout(() => supabase.removeChannel(whisperChannel), 2000);
      }
    });
    addLog(`🌟 You feel a strange presence calling to you from the Ash-Veil Perimeter...`);
  }

  // Recalculate derived stats
  const finalCon = (levelUpUpdates as any).con ?? character.con;
  const newMaxHp = getMaxHp(character.class, finalCon, newLevel);
  levelUpUpdates.max_hp = newMaxHp;
  levelUpUpdates.hp = newMaxHp;

  const finalInt = (levelUpUpdates as any).int ?? character.int;
  const finalWis = (levelUpUpdates as any).wis ?? character.wis;
  const finalCha = (levelUpUpdates as any).cha ?? character.cha;
  const finalDex = (levelUpUpdates as any).dex ?? character.dex;

  const newMaxCp = getMaxCp(newLevel, finalInt, finalWis, finalCha);
  const oldMaxCp = character.max_cp ?? 30;
  levelUpUpdates.max_cp = newMaxCp;
  levelUpUpdates.cp = Math.min((character.cp ?? 0) + (newMaxCp - oldMaxCp), newMaxCp);

  const newMaxMp = getMaxMp(newLevel, finalDex);
  const oldMaxMp = character.max_mp ?? 100;
  levelUpUpdates.max_mp = newMaxMp;
  levelUpUpdates.mp = Math.min((character.mp ?? 100) + (newMaxMp - oldMaxMp), newMaxMp);

  return levelUpUpdates;
}

/** Award XP and gold to other party members on the same node */
async function awardPartyXpGold(
  partyId: string,
  characterId: string,
  currentNodeId: string,
  totalXp: number,
  totalGold: number,
  xpSplitCount: number,
  goldSplitCount: number,
): Promise<void> {
  const { data: freshMembers } = await supabase
    .from('party_members')
    .select('character_id, character:characters(current_node_id, level)')
    .eq('party_id', partyId)
    .eq('status', 'accepted');
  const membersHere = (freshMembers || []).filter(
    (m: any) => m.character?.current_node_id === currentNodeId
  );
  const goldShare = Math.floor(totalGold / goldSplitCount);
  for (const m of membersHere) {
    if (m.character_id === characterId || !m.character_id) continue;
    const memberCapped = (m.character?.level || 0) >= 42;
    const memberXp = memberCapped ? 0 : Math.floor(totalXp / xpSplitCount);
    try {
      await supabase.rpc('award_party_member', { _character_id: m.character_id, _xp: memberXp, _gold: goldShare });
    } catch (e) { console.error('Failed to award party member:', e); }
  }
}

/** Award salvage to character and party members for non-humanoid kills */
async function awardPartySalvage(
  character: Character,
  creature: any,
  goldSplitCount: number,
  partyId: string | null,
  updateCharacterLocal: (u: Partial<Character>) => void,
  addLog: (msg: string) => void,
): Promise<void> {
  const baseSalvage = 1 + Math.floor(creature.level / 5);
  const rarityMult = creature.rarity === 'boss' ? 4 : creature.rarity === 'rare' ? 2 : 1;
  const totalSalvage = baseSalvage * rarityMult;
  const salvageShare = Math.floor(totalSalvage / goldSplitCount);
  if (salvageShare <= 0) return;

  const newSalvage = (character.salvage || 0) + salvageShare;
  await supabase.rpc('award_party_member', { _character_id: character.id, _xp: 0, _gold: 0, _salvage: salvageShare });
  updateCharacterLocal({ salvage: newSalvage });

  // Award party members
  if (partyId) {
    const { data: freshMembers } = await supabase
      .from('party_members')
      .select('character_id, character:characters(current_node_id)')
      .eq('party_id', partyId)
      .eq('status', 'accepted');
    const membersHere = (freshMembers || []).filter(
      (m: any) => m.character?.current_node_id === character.current_node_id && m.character_id !== character.id
    );
    for (const m of membersHere) {
      try {
        await supabase.rpc('award_party_member', { _character_id: m.character_id, _xp: 0, _gold: 0, _salvage: salvageShare });
      } catch (e) { console.error('Failed to award salvage to party member:', e); }
    }
  }
  addLog(`🔩 You salvaged ${salvageShare} materials from ${creature.name}.`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseCombatActionsParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  updateCharacterLocal: (updates: Partial<Character>) => void;
  addLog: (msg: string) => void;
  equipped: { id: string; item_id: string; item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any }; current_durability: number; [k: string]: any }[];
  equipmentBonuses: Record<string, number>;
  creatures: any[];
  creatureHpOverrides: Record<string, number>;
  party: any;
  partyMembers: any[];
  inCombat: boolean;
  activeCombatCreatureId: string | null;
  startCombat: (id: string) => void;
  stopCombat: () => void;
  queueAbility: (index: number, targetId?: string) => void;
  isDead: boolean;
  xpMultiplier: number;
  fetchInventory: () => void;
  fetchGroundLoot: () => void;
  buffState: BuffState;
  buffSetters: BuffSetters;
  notifyCreatureKilled?: (creatureId: string) => void;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hook
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function useCombatActions(params: UseCombatActionsParams) {
  const p = params;
  const [lastUsedAbilityCost, setLastUsedAbilityCost] = useState(0);

  // ── Equipment degradation ──────────────────────────────────────
  const degradeEquipment = useCallback(async () => {
    if (p.equipped.length === 0) return;
    const shuffled = [...p.equipped].sort(() => Math.random() - 0.5);
    const toDamage = shuffled.slice(0, 1);
    for (const item of toDamage) {
      const newDur = item.current_durability - 1;
      if (newDur <= 0) {
        if (item.item.rarity === 'unique') {
          p.addLog(`💔 Your ${item.item.name} shatters and its essence returns to its origin...`);
          await supabase.from('character_inventory').delete().eq('id', item.id);
        } else {
          p.addLog(`💔 Your ${item.item.name} has broken! Visit a blacksmith to repair it.`);
          await supabase.from('character_inventory').update({ current_durability: 0, equipped_slot: null, belt_slot: null } as any).eq('id', item.id);
        }
      } else {
        await supabase.from('character_inventory').update({ current_durability: newDur }).eq('id', item.id);
      }
    }
    p.fetchInventory();
  }, [p.equipped, p.addLog, p.fetchInventory]);

  // ── Loot rolling ───────────────────────────────────────────────
  const rollLoot = useCallback(async (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number, creatureNodeId?: string | null, lootMode?: string, creatureLevel?: number) => {
    const targetNodeId = creatureNodeId || p.character.current_node_id;
    if (!targetNodeId) return;

    const mode = lootMode || 'legacy_table';

    // ── item_pool mode ──────────────────────────────────────────
    if (mode === 'item_pool') {
      const chance = dropChance ?? 0.5;
      if (Math.random() > chance) { p.fetchGroundLoot(); return; }

      // Fetch pool config
      const { data: poolConfig } = await supabase.from('loot_pool_config' as any).select('*').eq('id', 1).single();
      const cfg = poolConfig || { equip_level_min_offset: -3, equip_level_max_offset: 0, common_pct: 80, uncommon_pct: 20, consumable_drop_chance: 0.15, consumable_level_min_offset: -5, consumable_level_max_offset: 0 };
      const cLevel = creatureLevel || 1;

      // Roll equipment
      const rarityRoll = Math.random() * 100;
      const rolledRarity = rarityRoll < (cfg as any).common_pct ? 'common' : 'uncommon';
      const minLevel = cLevel + (cfg as any).equip_level_min_offset;
      const maxLevel = cLevel + (cfg as any).equip_level_max_offset;

      const { data: eligible } = await supabase
        .from('items')
        .select('id, name, rarity, drop_weight')
        .eq('world_drop', true)
        .eq('rarity', rolledRarity)
        .eq('item_type', 'equipment')
        .eq('is_soulbound', false)
        .gte('level', minLevel)
        .lte('level', maxLevel);

      if (eligible && eligible.length > 0) {
        const totalW = eligible.reduce((s, e: any) => s + (e.drop_weight || 10), 0);
        let r = Math.random() * totalW;
        let picked: any = eligible[eligible.length - 1];
        for (const e of eligible) {
          r -= ((e as any).drop_weight || 10);
          if (r <= 0) { picked = e; break; }
        }
        await supabase.from('node_ground_loot' as any).insert({
          node_id: targetNodeId,
          item_id: picked.id,
          creature_name: creatureName,
        });
        p.addLog(`💎 ${creatureName} dropped ${picked.name}!`);
      }

      // Separate consumable roll
      if (Math.random() < (cfg as any).consumable_drop_chance) {
        const cMinLevel = cLevel + (cfg as any).consumable_level_min_offset;
        const cMaxLevel = cLevel + (cfg as any).consumable_level_max_offset;
        const { data: consumables } = await supabase
          .from('items')
          .select('id, name, drop_weight')
          .eq('world_drop', true)
          .eq('item_type', 'consumable')
          .gte('level', cMinLevel)
          .lte('level', cMaxLevel);

        if (consumables && consumables.length > 0) {
          const totalCW = consumables.reduce((s, e: any) => s + (e.drop_weight || 10), 0);
          let cr = Math.random() * totalCW;
          let pickedC: any = consumables[consumables.length - 1];
          for (const e of consumables) {
            cr -= ((e as any).drop_weight || 10);
            if (cr <= 0) { pickedC = e; break; }
          }
          await supabase.from('node_ground_loot' as any).insert({
            node_id: targetNodeId,
            item_id: pickedC.id,
            creature_name: creatureName,
          });
          p.addLog(`🧴 ${creatureName} dropped ${pickedC.name}!`);
        }
      }

      p.fetchGroundLoot();
      return;
    }

    // ── salvage_only mode — no item loot ──────────────────────────
    if (mode === 'salvage_only') return;

    // ── legacy_table mode ────────────────────────────────────────
    if (lootTableId) {
      const chance = dropChance ?? 0.5;
      if (Math.random() > chance) return;
      const { data: tableEntries } = await supabase
        .from('loot_table_entries')
        .select('item_id, weight')
        .eq('loot_table_id', lootTableId);
      if (!tableEntries || tableEntries.length === 0) return;
      const totalWeight = tableEntries.reduce((s, e) => s + e.weight, 0);
      let roll = Math.random() * totalWeight;
      let pickedItemId: string | null = null;
      for (const entry of tableEntries) {
        roll -= entry.weight;
        if (roll <= 0) { pickedItemId = entry.item_id; break; }
      }
      if (!pickedItemId) pickedItemId = tableEntries[tableEntries.length - 1].item_id;
      const item = await getCachedItemAsync(pickedItemId);
      if (item) {
        if (item.rarity === 'unique') {
          const { count } = await supabase.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', pickedItemId);
          if (count && count > 0) {
            p.addLog(`✨ The unique power of ${item.name} is already claimed by another...`);
            p.fetchGroundLoot();
            return;
          }
        }
        await supabase.from('node_ground_loot' as any).insert({
          node_id: targetNodeId,
          item_id: pickedItemId,
          creature_name: creatureName,
        });
        p.addLog(`💎 ${creatureName} dropped ${item.name}!`);
      }
      p.fetchGroundLoot();
      return;
    }

    // Legacy inline loot table
    if (!lootTable || lootTable.length === 0) return;
    for (const entry of lootTable) {
      if (entry.type === 'gold') continue;
      if (Math.random() <= (entry.chance || 0.1)) {
        const item = await getCachedItemAsync(entry.item_id);
        if (item) {
          if (item.rarity === 'unique') {
            const { count } = await supabase.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', entry.item_id);
            if (count && count > 0) {
              p.addLog(`✨ The unique power of ${item.name} is already claimed by another...`);
              continue;
            }
          }
          await supabase.from('node_ground_loot' as any).insert({
            node_id: targetNodeId,
            item_id: entry.item_id,
            creature_name: creatureName,
          });
          p.addLog(`💎 ${creatureName} dropped ${item.name}!`);
        }
      }
    }
    p.fetchGroundLoot();
  }, [p.character.current_node_id, p.addLog, p.fetchGroundLoot]);

  // ── Kill rewards (orchestration — delegates to extracted helpers) ──
  const awardKillRewards = useCallback(async (creature: any, opts?: { stopCombat?: boolean }) => {
    p.notifyCreatureKilled?.(creature.id);

    const baseXp = Math.floor(creature.level * 10 * (XP_RARITY_MULTIPLIER[creature.rarity] || 1));
    const xpPenalty = getXpPenalty(p.character.level, creature.level);
    const totalXp = Math.floor(baseXp * xpPenalty * p.xpMultiplier);
    const lootTableData = creature.loot_table as any[];
    const goldEntry = lootTableData?.find((e: any) => e.type === 'gold');
    let totalGold = 0;
    if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
      totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
      if (creature.is_humanoid) {
        const effectiveCha = p.character.cha + (p.equipmentBonuses.cha || 0);
        totalGold = Math.floor(totalGold * getChaGoldMultiplier(effectiveCha));
      }
    }

    // Determine split counts
    let goldSplitCount = 1;
    let xpSplitCount = 1;
    if (p.party?.id) {
      const { data: freshMembers } = await supabase
        .from('party_members')
        .select('character_id, character:characters(current_node_id, level)')
        .eq('party_id', p.party.id)
        .eq('status', 'accepted');
      const membersHere = (freshMembers || []).filter(
        (m: any) => m.character?.current_node_id === p.character.current_node_id
      );
      goldSplitCount = membersHere.length > 1 ? membersHere.length : 1;
      const uncappedHere = membersHere.filter((m: any) => (m.character?.level || 0) < 42);
      xpSplitCount = uncappedHere.length > 0 ? uncappedHere.length : 1;
    }

    // Award party members (other than self)
    if (p.party?.id) {
      await awardPartyXpGold(p.party.id, p.character.id, p.character.current_node_id!, totalXp, totalGold, xpSplitCount, goldSplitCount);
    }

    // Award self
    const xpShare = p.character.level >= 42 ? 0 : Math.floor(totalXp / xpSplitCount);
    const goldShare = Math.floor(totalGold / goldSplitCount);
    const penaltyNote = xpPenalty < 1 ? ` (${Math.round(xpPenalty * 100)}% XP — level penalty)` : '';
    const boostNote = p.xpMultiplier > 1 ? ` ⚡${p.xpMultiplier}x` : '';
    const goldNote = goldShare > 0 ? `, +${goldShare} gold` : '';
    if (p.character.level >= 42) {
      const maxGoldNote = goldShare > 0 ? ` +${goldShare} gold.` : '';
      p.addLog(`☠️ ${creature.name} has been slain!${maxGoldNote} Your power transcends experience.`);
    } else {
      p.addLog(`☠️ ${creature.name} has been slain! (+${xpShare} XP${goldNote})${penaltyNote}${boostNote}`);
    }

    const newXp = p.character.xp + xpShare;
    const newGold = p.character.gold + goldShare;
    const xpForNext = getXpForLevel(p.character.level);

    if (newXp >= xpForNext && p.character.level < 42) {
      const newLevel = Math.min(p.character.level + 1, 42);
      const levelUpUpdates = buildLevelUpUpdates(p.character, newLevel, p.equipmentBonuses, p.addLog);
      levelUpUpdates.xp = newXp - xpForNext;
      levelUpUpdates.gold = newGold;
      await p.updateCharacter(levelUpUpdates);
    } else {
      await p.updateCharacter({ xp: newXp, gold: newGold });
    }

    // BHP for boss kills
    if (creature.rarity === 'boss') {
      const bhpReward = Math.floor(creature.level * 0.5);
      if (bhpReward > 0) {
        const bhpShare = Math.floor(bhpReward / goldSplitCount);
        if (bhpShare > 0) {
          const newBhp = (p.character.bhp || 0) + bhpShare;
          await p.updateCharacter({ bhp: newBhp });
          p.addLog(`🏋️ +${bhpShare} Boss Hunter Points!`);
        }
      }
    }

    // Salvage for non-humanoid kills
    if (!creature.is_humanoid) {
      await awardPartySalvage(p.character, creature, goldSplitCount, p.party?.id ?? null, p.updateCharacterLocal, p.addLog);
    }

    await rollLoot(creature.loot_table as any[], creature.name, creature.loot_table_id, creature.drop_chance, creature.node_id, creature.loot_mode, creature.level);
    if (opts?.stopCombat) p.stopCombat();
  }, [p.character, p.party, p.addLog, p.updateCharacter, p.updateCharacterLocal, rollLoot, p.stopCombat, p.xpMultiplier, p.equipmentBonuses, p.notifyCreatureKilled, p.fetchGroundLoot]);

  // ── Use Ability ────────────────────────────────────────────────
  const handleUseAbility = useCallback(async (abilityIndex: number, targetId?: string, _fromTick = false) => {
    if (p.isDead || p.character.hp <= 0) return;
    const allAbilities = [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[p.character.class] || [])];
    if (!allAbilities[abilityIndex]) return;
    const ability = allAbilities[abilityIndex];

    // ── Validation ──
    if (p.character.level < ability.levelRequired) {
      p.addLog(`⚠️ ${ability.emoji} ${ability.label} unlocks at level ${ability.levelRequired}.`);
      return;
    }
    const effectiveCpCost = ability.cpCost;
    if ((p.character.cp ?? 0) < effectiveCpCost) {
      p.addLog(`⚠️ Not enough CP for ${ability.label}! (${effectiveCpCost} CP needed, ${p.character.cp ?? 0} available)`);
      return;
    }

    const isInstantBuff = INSTANT_BUFF_TYPES.has(ability.type);

    // Early combat check before queuing
    if (!isInstantBuff && !_fromTick && COMBAT_REQUIRED_TYPES.has(ability.type)) {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) {
        p.addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`);
        return;
      }
    }

    // Damage/heal abilities must be queued for the heartbeat tick
    if (!isInstantBuff && !_fromTick) {
      p.queueAbility(abilityIndex, targetId);
      const cTarget = targetId ? p.creatures?.find(c => c.id === targetId)
        : p.activeCombatCreatureId ? p.creatures?.find(c => c.id === p.activeCombatCreatureId) : undefined;
      p.addLog(getQueueFlavour(ability, cTarget?.name));
      return;
    }

    // ── Ability type switch ──
    if (ability.type === 'hp_transfer') {
      if (!targetId || targetId === p.character.id) {
        p.addLog(`${ability.emoji} You must target an ally to transfer health.`);
        return;
      }
      const wisMod = getStatModifier(p.character.wis);
      const transferAmount = Math.max(3, wisMod * 2 + Math.floor(p.character.level / 2));
      const maxTransfer = p.character.hp - 1;
      if (maxTransfer <= 0) { p.addLog(`${ability.emoji} You don't have enough HP to transfer!`); return; }
      const actualTransfer = Math.min(transferAmount, maxTransfer);
      await p.updateCharacter({ hp: p.character.hp - actualTransfer });
      const { data: restored, error } = await supabase.rpc('heal_party_member', {
        _healer_id: p.character.id, _target_id: targetId, _heal_amount: actualTransfer,
      });
      if (error) { p.addLog(`${ability.emoji} Failed to transfer health: ${error.message}`); return; }
      const targetMember = p.partyMembers.find(m => m.character_id === targetId);
      const targetName = targetMember?.character.name || 'ally';
      p.addLog(`${ability.emoji} ${p.character.name} sacrifices ${actualTransfer} HP to heal ${targetName} for ${restored ?? actualTransfer} HP!`);
    } else if (ability.type === 'heal') {
      const wisMod = getStatModifier(p.character.wis);
      const healAmount = Math.max(3, wisMod * 3 + p.character.level);
      const healEffMaxHp = getEffectiveMaxHp(p.character.max_hp, p.equipmentBonuses);
      const newHp = Math.min(healEffMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLog(`${ability.emoji} You cast Heal and restore ${restored} HP!`); }
      else p.addLog(`${ability.emoji} You cast Heal but you're already at full health.`);
    } else if (ability.type === 'self_heal') {
      const conMod = getStatModifier(p.character.con);
      const healAmount = Math.max(3, conMod * 3 + p.character.level);
      const healEffMaxHp = getEffectiveMaxHp(p.character.max_hp, p.equipmentBonuses);
      const newHp = Math.min(healEffMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLog(`${ability.emoji} You use Second Wind and recover ${restored} HP!`); }
      else p.addLog(`${ability.emoji} You use Second Wind but you're already at full health.`);
    } else if (ability.type === 'regen_buff') {
      // Inspire no longer grants a regen multiplier (removed in regen overhaul)
      const inspireMsg = `${ability.emoji} ${p.character.name} plays an inspiring song!`;
      p.addLog(inspireMsg);
    } else if (ability.type === 'crit_buff') {
      const dexMod = getStatModifier(p.character.dex);
      const critBonus = Math.max(1, Math.min(dexMod, 5));
      p.buffSetters.setCritBuff({ bonus: critBonus, expiresAt: Date.now() + 30000 });
      p.addLog(`${ability.emoji} Eagle Eye! Your crit range is now ${20 - critBonus}-20 for 30s.`);
    } else if (ability.type === 'stealth_buff') {
      const dexMod = getStatModifier(p.character.dex);
      const durationMs = Math.min(15000 + dexMod * 1000, 25000);
      p.buffSetters.setStealthBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Shadowstep! You vanish into the shadows for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'damage_buff') {
      const intMod = getStatModifier(p.character.int);
      const durationMs = Math.min(25, 15 + intMod) * 1000;
      p.buffSetters.setDamageBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Arcane Surge! Your spell damage is amplified for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'multi_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'root_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for ${ability.label}.`); return; }
      const wisMod = getStatModifier(p.character.wis);
      const durationMs = Math.min(15000, 8000 + wisMod * 1000);
      const reduction = 0.3;
      p.buffSetters.setRootDebuff({ damageReduction: reduction, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} ${ability.label}! ${creature.name}'s damage reduced by ${Math.round(reduction * 100)}% for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'battle_cry') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const hasShield = p.equipped.some((e: any) => e.item?.weapon_tag === 'shield');
      const baseDR = 0.15;
      const shieldBonus = hasShield ? 0.05 : 0;
      const totalDR = baseDR + shieldBonus;
      const critReduction = 0.15;
      const durationMs = Math.min(25000, 15000 + dexMod * 1000);
      p.buffSetters.setBattleCryBuff({ damageReduction: totalDR, critReduction, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Battle Cry! ${Math.round(totalDR * 100)}% damage reduction${hasShield ? ' (shield bonus!)' : ''} for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'dot_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use Rend!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for Rend.`); return; }
      const strMod = getStatModifier(p.character.str + (p.equipmentBonuses.str || 0));
      const dmgPerTick = Math.max(1, Math.floor((strMod * 1.5 + 2) * 0.67));
      const durationMs = Math.min(30000, 20000 + strMod * 1000);
      const intervalMs = 2000;
      p.buffSetters.setBleedStacks((prev: Record<string, DotDebuff>) => ({
        ...prev,
        [cTargetId]: {
          damagePerTick: dmgPerTick, intervalMs, expiresAt: Date.now() + durationMs,
          startsAt: Date.now() + intervalMs,
          creatureId: cTargetId, creatureName: creature.name,
          creatureLevel: creature.level, creatureRarity: creature.rarity,
          creatureLootTable: (creature.loot_table as any[]) || [],
          lootTableId: creature.loot_table_id ?? null, dropChance: creature.drop_chance ?? 0.5,
          creatureNodeId: creature.node_id ?? null,
          maxHp: creature.max_hp, lastKnownHp: p.creatureHpOverrides[creature.id] ?? creature.hp,
        },
      }));
      p.addLog(`${ability.emoji} Rend! ${creature.name} bleeds for ${dmgPerTick} damage every ${intervalMs / 1000}s for ${durationMs / 1000}s.`);
    } else if (ability.type === 'poison_buff') {
      if (p.buffState.poisonBuff && p.buffState.poisonBuff.expiresAt > Date.now()) {
        p.addLog(`⚠️ ${ability.emoji} Envenom is already active.`);
        return;
      }
      const durationMs = 300_000; // 5 minutes
      p.buffSetters.setPoisonBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Envenom! Your weapons drip with poison for 5 minutes. (${p.character.cp ?? 0} CP consumed)`);
    } else if (ability.type === 'execute_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'evasion_buff') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const durationMs = Math.min(15000, 10000 + dexMod * 500);
      p.buffSetters.setEvasionBuff({ dodgeChance: 0.5, expiresAt: Date.now() + durationMs, source: 'cloak' as const });
      p.addLog(`${ability.emoji} Cloak of Shadows! 50% dodge chance for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'disengage_buff') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const dodgeDurationMs = Math.min(8000, 5000 + dexMod * 500);
      const nextHitDurationMs = 15000;
      p.buffSetters.setEvasionBuff({ dodgeChance: 1.0, expiresAt: Date.now() + dodgeDurationMs, source: 'disengage' as const });
      p.buffSetters.setDisengageNextHit({ bonusMult: 1.5, expiresAt: Date.now() + nextHitDurationMs });
      p.addLog(`${ability.emoji} Disengage! You leap back — dodging all attacks for ${Math.round(dodgeDurationMs / 1000)}s. Your next strike deals 50% bonus damage!`);
    } else if (ability.type === 'ignite_buff') {
      if (p.buffState.igniteBuff && p.buffState.igniteBuff.expiresAt > Date.now()) {
        p.addLog(`⚠️ ${ability.emoji} Ignite is already active.`);
        return;
      }
      const durationMs = 300_000; // 5 minutes
      p.buffSetters.setIgniteBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Ignite! Your spells burn with fire for 5 minutes. (${p.character.cp ?? 0} CP consumed)`);
    } else if (ability.type === 'ignite_consume') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'absorb_buff') {
      const intMod = getStatModifier(p.character.int + (p.equipmentBonuses.int || 0));
      const shieldHp = intMod + Math.floor(p.character.level * 0.5);
      const durationMs = Math.min(15000, 8000 + intMod * 1000);
      p.buffSetters.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Force Shield! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'party_regen') {
      const scaleStat = p.character.class === 'healer'
        ? getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0))
        : getStatModifier(p.character.cha + (p.equipmentBonuses.cha || 0));
      const healPerTick = Math.max(1, scaleStat + 2);
      const durationMs = Math.min(25000, 15000 + scaleStat * 1000);
      p.buffSetters.setPartyRegenBuff({ healPerTick, expiresAt: Date.now() + durationMs, source: p.character.class === 'healer' ? 'healer' : 'bard' });
      const who = p.party ? 'your party' : 'you';
      const abilityName = p.character.class === 'healer' ? 'Purifying Light! Divine radiance' : 'Crescendo! A rising melody';
      p.addLog(`${ability.emoji} ${abilityName} heals ${who} for ${healPerTick} HP every 3s for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'ally_absorb') {
      const wisMod = getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0));
      const shieldHp = wisMod * 2 + Math.floor(p.character.level * 0.7);
      const durationMs = Math.min(18000, 10000 + wisMod * 1000);
      if (targetId && targetId !== p.character.id) {
        p.buffSetters.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
        const targetMember = p.partyMembers.find(m => m.character_id === targetId);
        const targetName = targetMember?.character.name || 'ally';
        p.addLog(`${ability.emoji} Divine Aegis! You shield ${targetName} with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
      } else {
        p.buffSetters.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
        p.addLog(`${ability.emoji} Divine Aegis! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
      }
    } else if (ability.type === 'sunder_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use Sunder Armor!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for Sunder Armor.`); return; }
      const strMod = getStatModifier(p.character.str + (p.equipmentBonuses.str || 0));
      const acReduction = Math.max(2, strMod);
      const durationSec = Math.min(20, 12 + strMod);
      p.buffSetters.setSunderDebuff(prev => ({ ...prev, [cTargetId]: { acReduction, expiresAt: Date.now() + durationSec * 1000, creatureId: cTargetId, creatureName: creature.name } }));
      p.addLog(`${ability.emoji} Sunder Armor! ${creature.name}'s AC reduced by ${acReduction} for ${durationSec}s.`);
    } else if (ability.type === 'burst_damage') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'focus_strike') {
      const baseMod = getStatModifier(p.character.str) + getStatModifier(p.character.dex) + getStatModifier(p.character.int);
      const bonusDmg = Math.max(1, Math.floor(baseMod * 0.5) + Math.floor(p.character.level / 3));
      p.buffSetters.setFocusStrikeBuff({ bonusDmg });
      p.addLog(`${ability.emoji} Focus Strike! Your next attack deals +${bonusDmg} bonus damage.`);
    }

    // Deduct CP — Envenom/Ignite drain all current CP
    const isAllCpAbility = ability.type === 'poison_buff' || ability.type === 'ignite_buff';
    const finalCpCost = isAllCpAbility ? (p.character.cp ?? 0) : ability.cpCost;
    const newCp = Math.max((p.character.cp ?? 0) - finalCpCost, 0);
    await p.updateCharacter({ cp: newCp });
    setLastUsedAbilityCost(finalCpCost);
  }, [p.isDead, p.character, p.updateCharacter, p.addLog, p.party, p.partyMembers, p.inCombat, p.activeCombatCreatureId, p.creatures, p.equipmentBonuses, p.creatureHpOverrides, p.buffState.poisonStacks, p.buffState.igniteStacks, p.buffState.poisonBuff, p.buffState.igniteBuff, lastUsedAbilityCost, awardKillRewards]);

  // ── Attack ─────────────────────────────────────────────────────
  const handleAttack = useCallback((creatureId: string) => {
    if (p.isDead) return;
    p.startCombat(creatureId);
  }, [p.isDead, p.startCombat]);

  return {
    degradeEquipment, rollLoot, awardKillRewards,
    handleUseAbility, handleAttack,
    lastUsedAbilityCost,
  };
}
