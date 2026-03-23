/**
 * useActions — owns all player action handlers extracted from GamePage.
 * Handles movement, teleportation, searching, abilities, consumables,
 * loot rolling, kill rewards, and equipment degradation.
 */
import { useState, useCallback } from 'react';
import { Character } from '@/hooks/useCharacter';
import { rollD20, getStatModifier, rollDamage, XP_RARITY_MULTIPLIER, getXpForLevel, getXpPenalty, getMaxCp, getMaxMp, getMaxHp, getMoveCost, getCarryCapacity, getBagWeight, getChaGoldMultiplier, CLASS_LEVEL_BONUSES, CLASS_LABELS } from '@/lib/game-data';
import { CLASS_COMBAT, CLASS_ABILITIES, UNIVERSAL_ABILITIES } from '@/lib/class-abilities';
import { getNodeDisplayName } from '@/hooks/useNodes';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';
import { getCachedItemAsync } from '@/hooks/useItemCache';
import type {
  RegenBuff, FoodBuff, CritBuff, StealthBuff, DamageBuff, RootDebuff, AcBuff,
  DotDebuff, PoisonBuff, EvasionBuff, DisengageNextHit, IgniteBuff, AbsorbBuff,
  PartyRegenBuff, SunderDebuff, FocusStrikeBuff, PoisonStack, IgniteStack,
} from '@/hooks/useGameLoop';

// ─── Params ───────────────────────────────────────────────────────
export interface UseActionsParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  updateCharacterLocal: (updates: Partial<Character>) => void;
  addLog: (msg: string) => void;
  equipped: { id: string; item_id: string; item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any }; current_durability: number; [k: string]: any }[];
  unequipped: { id: string; item_id: string; item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any }; belt_slot: number | null; [k: string]: any }[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  getRegion: (id: string) => any;
  getNodeArea: (node: any) => any;
  currentNode: any;
  creatures: any[];
  creatureHpOverrides: Record<string, number>;
  updateCreatureHp: (id: string, hp: number) => void;
  party: any;
  partyMembers: any[];
  isLeader: boolean;
  myMembership: any;
  inCombat: boolean;
  activeCombatCreatureId: string | null;
  startCombat: (id: string) => void;
  stopCombat: () => void;
  queueAbility: (index: number, targetId?: string) => void;
  isDead: boolean;
  effectiveAC: number;
  fetchInventory: () => void;
  fetchGroundLoot: () => void;
  fetchParty: () => void;
  broadcastMove: (charId: string, charName: string, nodeId: string) => void;
  broadcastHp: (charId: string, hp: number, maxHp: number, source: string) => void;
  broadcastDamage: (creatureId: string, newHp: number, damage: number, attackerName: string, killed: boolean) => void;
  useConsumable: (inventoryId: string, characterId: string, currentHp: number, maxHp: number, updateChar: (u: { hp: number }) => Promise<void>) => Promise<any>;
  xpMultiplier: number;
  toggleFollow: (v: boolean) => Promise<void>;
  // Buff states + setters from useGameLoop
  regenBuff: RegenBuff; setRegenBuff: (v: RegenBuff) => void;
  foodBuff: FoodBuff; setFoodBuff: (v: FoodBuff) => void;
  critBuff: CritBuff; setCritBuff: (v: CritBuff) => void;
  stealthBuff: StealthBuff | null; setStealthBuff: (v: StealthBuff | null) => void;
  damageBuff: DamageBuff | null; setDamageBuff: (v: DamageBuff | null) => void;
  rootDebuff: RootDebuff | null; setRootDebuff: (v: RootDebuff | null) => void;
  acBuff: AcBuff | null; setAcBuff: (v: AcBuff | null) => void;
  bleedStacks: Record<string, DotDebuff>; setBleedStacks: (v: any) => void;
  poisonBuff: PoisonBuff | null; setPoisonBuff: (v: PoisonBuff | null) => void;
  poisonStacks: Record<string, PoisonStack>; setPoisonStacks: (v: any) => void;
  evasionBuff: EvasionBuff | null; setEvasionBuff: (v: EvasionBuff | null) => void;
  disengageNextHit: DisengageNextHit | null; setDisengageNextHit: (v: DisengageNextHit | null) => void;
  igniteBuff: IgniteBuff | null; setIgniteBuff: (v: IgniteBuff | null) => void;
  igniteStacks: Record<string, IgniteStack>; setIgniteStacks: (v: any) => void;
  absorbBuff: AbsorbBuff | null; setAbsorbBuff: (v: AbsorbBuff | null) => void;
  partyRegenBuff: PartyRegenBuff | null; setPartyRegenBuff: (v: PartyRegenBuff | null) => void;
  sunderDebuff: SunderDebuff | null; setSunderDebuff: (v: SunderDebuff | null) => void;
  focusStrikeBuff: FocusStrikeBuff | null; setFocusStrikeBuff: (v: FocusStrikeBuff | null) => void;
  notifyCreatureKilled?: (creatureId: string) => void;
  // Locked connections
  unlockedConnections?: Map<string, number>;
  onUnlockPath?: (direction: string, nodeId: string, expires: number) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────
export function useActions(params: UseActionsParams) {
  const p = params;
  const [waymarkNodeId, setWaymarkNodeId] = useState<string | null>(null);
  const [lastUsedAbilityCost, setLastUsedAbilityCost] = useState(0);
  const [teleportOpen, setTeleportOpen] = useState(false);

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
  const rollLoot = useCallback(async (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number, creatureNodeId?: string | null) => {
    const targetNodeId = creatureNodeId || p.character.current_node_id;
    if (!targetNodeId) return;

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

  // ── Kill rewards ───────────────────────────────────────────────
  const awardKillRewards = useCallback(async (creature: any, opts?: { stopCombat?: boolean }) => {
    // Immediately purge all DoTs targeting this creature
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
      const xpShare = p.character.level >= 42 ? 0 : Math.floor(totalXp / xpSplitCount);
      const goldShare = Math.floor(totalGold / goldSplitCount);
      for (const m of membersHere) {
        if (m.character_id === p.character.id || !m.character_id) continue;
        const memberCapped = (m.character?.level || 0) >= 42;
        const memberXp = memberCapped ? 0 : Math.floor(totalXp / xpSplitCount);
        try {
          await supabase.rpc('award_party_member', { _character_id: m.character_id, _xp: memberXp, _gold: goldShare });
        } catch (e) { console.error('Failed to award party member:', e); }
      }
    }
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
    // Level 42 is the max level cap - no further progression
    if (newXp >= xpForNext && p.character.level < 42) {
      const newLevel = Math.min(p.character.level + 1, 42);
      const levelUpUpdates: Partial<Character> = {
        xp: newXp - xpForNext, level: newLevel, gold: newGold,
        unspent_stat_points: (p.character.unspent_stat_points || 0) + 1,
      };

      p.addLog(`🎉 Level Up! You are now level ${newLevel}!`);
      p.addLog(`📊 You gained 1 stat point to allocate!`);

      if ([10, 20, 30, 40].includes(newLevel)) {
        levelUpUpdates.respec_points = (p.character.respec_points || 0) + 1;
        p.addLog(`🔄 You earned a respec point! You can reallocate a stat point.`);
      }

      // Apply class stat bonuses every 3 levels
      if (newLevel % 3 === 0) {
        const bonuses = CLASS_LEVEL_BONUSES[p.character.class] || {};
        const bonusNames: string[] = [];
        for (const [stat, amount] of Object.entries(bonuses)) {
          const currentVal = (levelUpUpdates as any)[stat] ?? (p.character as any)[stat] ?? 10;
          (levelUpUpdates as any)[stat] = currentVal + amount;
          bonusNames.push(`+${amount} ${stat.toUpperCase()}`);
        }
        if (bonusNames.length > 0) {
          p.addLog(`📈 ${CLASS_LABELS[p.character.class] || p.character.class} bonus: ${bonusNames.join(', ')}!`);
        }
      }

      // Special level 42 notification - Soulforge unlocked
      if (newLevel === 42) {
        // Send whisper from The Soulwright to player's whisper channel
        const whisperChannel = supabase.channel(`chat-whisper-${p.character.id}`);
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
        p.addLog(`🌟 You feel a strange presence calling to you from the Ash-Veil Perimeter...`);
      }

      // Recalculate derived stats using potentially updated values
      const finalCon = (levelUpUpdates as any).con ?? p.character.con;
      const newMaxHp = getMaxHp(p.character.class, finalCon, newLevel);
      levelUpUpdates.max_hp = newMaxHp;
      levelUpUpdates.hp = newMaxHp;

      const finalInt = (levelUpUpdates as any).int ?? p.character.int;
      const finalWis = (levelUpUpdates as any).wis ?? p.character.wis;
      const finalCha = (levelUpUpdates as any).cha ?? p.character.cha;
      const finalDex = (levelUpUpdates as any).dex ?? p.character.dex;

      const newMaxCp = getMaxCp(newLevel, finalInt, finalWis, finalCha);
      const oldMaxCp = p.character.max_cp ?? 30;
      levelUpUpdates.max_cp = newMaxCp;
      levelUpUpdates.cp = Math.min((p.character.cp ?? 0) + (newMaxCp - oldMaxCp), newMaxCp);

      const newMaxMp = getMaxMp(newLevel, finalDex);
      const oldMaxMp = p.character.max_mp ?? 100;
      levelUpUpdates.max_mp = newMaxMp;
      levelUpUpdates.mp = Math.min((p.character.mp ?? 100) + (newMaxMp - oldMaxMp), newMaxMp);

      await p.updateCharacter(levelUpUpdates);
    } else {
      await p.updateCharacter({ xp: newXp, gold: newGold });
    }

    // Award BHP for boss kills
    if (creature.rarity === 'boss' && p.character.level >= 30) {
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

    // Award salvage for non-humanoid kills
    if (!creature.is_humanoid) {
      const baseSalvage = 1 + Math.floor(creature.level / 5);
      const rarityMult = creature.rarity === 'boss' ? 4 : creature.rarity === 'rare' ? 2 : 1;
      const totalSalvage = baseSalvage * rarityMult;
      const salvageShare = Math.floor(totalSalvage / goldSplitCount);
      if (salvageShare > 0) {
        const newSalvage = (p.character.salvage || 0) + salvageShare;
        await supabase.rpc('award_party_member', { _character_id: p.character.id, _xp: 0, _gold: 0, _salvage: salvageShare });
        p.updateCharacterLocal({ salvage: newSalvage });
        // Award party members
        if (p.party?.id) {
          const { data: freshMembers } = await supabase
            .from('party_members')
            .select('character_id, character:characters(current_node_id)')
            .eq('party_id', p.party.id)
            .eq('status', 'accepted');
          const membersHere = (freshMembers || []).filter(
            (m: any) => m.character?.current_node_id === p.character.current_node_id && m.character_id !== p.character.id
          );
          for (const m of membersHere) {
            try {
              await supabase.rpc('award_party_member', { _character_id: m.character_id, _xp: 0, _gold: 0, _salvage: salvageShare });
            } catch (e) { console.error('Failed to award salvage to party member:', e); }
          }
        }
        p.addLog(`🔩 You salvaged ${salvageShare} materials from ${creature.name}.`);
      }
    }

    await rollLoot(creature.loot_table as any[], creature.name, creature.loot_table_id, creature.drop_chance, creature.node_id);
    if (opts?.stopCombat) p.stopCombat();
  }, [p.character, p.party, p.addLog, p.updateCharacter, rollLoot, p.stopCombat, p.xpMultiplier]);

  // ── Movement ───────────────────────────────────────────────────
  const handleMove = useCallback(async (nodeId: string, direction?: string) => {
    if (p.isDead) return;

    // ── Locked connection check ──
    if (direction && p.currentNode) {
      const conn = (p.currentNode.connections as any[])?.find(
        (c: any) => c.node_id === nodeId && c.direction === direction
      );
      if (conn?.locked) {
        const unlockKey = `${p.currentNode.id}-${direction}`;
        const unlockExpiry = p.unlockedConnections?.get(unlockKey);
        if (!unlockExpiry || Date.now() > unlockExpiry) {
          // Check inventory for the key item
          const allItems = [...p.equipped, ...p.unequipped];
          const hasKey = allItems.some(
            inv => inv.item?.name?.toLowerCase() === (conn.lock_key || '').toLowerCase()
          );
          if (!hasKey) {
            p.addLog(`🔒 This path is locked. You need a "${conn.lock_key}" to pass.`);
            return;
          }
          // Player has the key — unlock for everyone at this node
          const expires = Date.now() + 30_000;
          p.onUnlockPath?.(direction, nodeId, expires);
          p.addLog(`🔓 You use your ${conn.lock_key} to unlock the path...`);
        }
      }
    }

    const effectiveStr = p.character.str + (p.equipmentBonuses.str || 0);
    const bagItems = p.unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
    const bagWeight = getBagWeight(bagItems);
    const moveCost = getMoveCost(bagWeight, effectiveStr);
    if ((p.character.mp ?? 100) < moveCost) {
      p.addLog(`⚠️ You are too exhausted to move! Need ${moveCost} MP to move.`);
      return;
    }
    const capacity = getCarryCapacity(effectiveStr);
    if (bagWeight > capacity) {
      p.addLog(`⚠️ Over-encumbered! Carrying ${bagWeight}/${capacity} weight — movement costs ${moveCost} MP.`);
    }
    const targetNode = p.getNode(nodeId);
    if (!targetNode) return;
    const targetRegion = p.getRegion(targetNode.region_id);
    const currentRegion = p.character.current_node_id ? p.getRegion(p.getNode(p.character.current_node_id)?.region_id || '') : null;
    if (targetRegion && currentRegion && targetRegion.id !== currentRegion.id && p.character.level < targetRegion.min_level) {
      const levelDiff = targetRegion.min_level - p.character.level;
      p.addLog(`⚠️ You are entering ${targetRegion.name} (Lvl ${targetRegion.min_level}–${targetRegion.max_level}). These lands are ${levelDiff >= 10 ? 'extremely' : levelDiff >= 5 ? 'very' : ''} dangerous for your level!`);
    }

    if (p.inCombat) {
      const dirLabel: Record<string, string> = { N: 'north', S: 'south', E: 'east', W: 'west', NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest' };
      const dirText = direction ? ` to the ${dirLabel[direction] || direction}` : '';
      p.addLog(`🏃 You flee${dirText}!`);
      // Don't call stopCombat() here — let the node-change effect in usePartyCombat
      // handle it so DoT drain mode can activate if there are active DoTs on old node creatures.
    }

    // Opportunity attacks
    const livingCreatures = p.creatures.filter(c => c.is_alive && c.hp > 0 && (c.is_aggressive || c.id === p.activeCombatCreatureId));
    let currentHp = p.character.hp;
    const isStealthed = p.stealthBuff && Date.now() < p.stealthBuff.expiresAt;
    const isDisengaged = p.evasionBuff && Date.now() < p.evasionBuff.expiresAt && p.evasionBuff.source === 'disengage';
    if (isStealthed) {
      p.addLog('🌑 You slip through the shadows unnoticed...');
      p.setStealthBuff(null);
    } else if (isDisengaged) {
      p.addLog('🦘 You leap away cleanly — no opportunity attacks!');
      p.setEvasionBuff(null);
    } else {
      let currentAbsorb = p.absorbBuff && Date.now() < p.absorbBuff.expiresAt ? p.absorbBuff.shieldHp : 0;
      const hasEvasion = p.evasionBuff && Date.now() < p.evasionBuff.expiresAt && p.evasionBuff.dodgeChance > 0;
      for (const creature of livingCreatures) {
        if (currentHp <= 0) break;
        if (hasEvasion && Math.random() < p.evasionBuff!.dodgeChance) {
          p.addLog(`🌫️ ${p.party ? p.character.name : 'You'} dodge${p.party ? 's' : ''} ${creature.name}'s opportunity attack!`);
          continue;
        }
        const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
        if (atkRoll >= p.effectiveAC) {
          const rawDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          let dmgToHp = rawDmg;
          if (currentAbsorb > 0) {
            const absorbed = Math.min(currentAbsorb, rawDmg);
            currentAbsorb -= absorbed;
            dmgToHp = rawDmg - absorbed;
            if (absorbed > 0) p.addLog(`🛡️ Your shield absorbs ${absorbed} damage from ${creature.name}'s opportunity attack!`);
          }
          if (dmgToHp > 0) currentHp = Math.max(currentHp - dmgToHp, 0);
          p.addLog(`⚔️ ${creature.name} strikes ${p.party ? p.character.name : 'you'} while fleeing! (Rolled ${atkRoll} vs AC ${p.effectiveAC}) — ${rawDmg} damage${dmgToHp < rawDmg ? ` (${dmgToHp} after shield)` : ''}!`);
        } else {
          p.addLog(`${creature.name} swipes at ${p.party ? p.character.name : 'you'} while fleeing — misses! (Rolled ${atkRoll} vs AC ${p.effectiveAC})`);
        }
      }
      if (p.absorbBuff && Date.now() < p.absorbBuff.expiresAt) {
        if (currentAbsorb <= 0) p.setAbsorbBuff(null);
        else if (currentAbsorb !== p.absorbBuff.shieldHp) p.setAbsorbBuff({ ...p.absorbBuff, shieldHp: currentAbsorb });
      }
      // Party opportunity attacks
      if (p.party && livingCreatures.length > 0) {
        const membersHere = p.partyMembers.filter(
          m => m.character_id !== p.character.id && m.character.current_node_id === p.character.current_node_id && m.character.hp > 0
        );
        for (const member of membersHere) {
          for (const creature of livingCreatures) {
            const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
            const memberAC = 10;
            if (atkRoll >= memberAC) {
              const dmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
              p.addLog(`⚔️ ${creature.name} strikes ${member.character.name} while fleeing! (Rolled ${atkRoll}) — ${dmg} damage!`);
              try {
                const { data: newHp } = await supabase.rpc('damage_party_member', { _character_id: member.character_id, _damage: dmg });
                if (newHp !== null) p.broadcastHp?.(member.character_id, newHp, member.character.max_hp, creature.name);
              } catch (e) { console.error('Failed to apply opportunity attack to party member:', e); }
            } else {
              p.addLog(`${creature.name} swipes at ${member.character.name} while fleeing — misses!`);
            }
          }
        }
      }
    }
    if (currentHp < p.character.hp) {
      await p.updateCharacter({ hp: currentHp });
      await degradeEquipment();
    }
    if (currentHp <= 0) {
      p.addLog('💀 You were struck down while retreating...');
      return;
    }

    try {
      if (p.party && !p.isLeader && p.myMembership?.is_following) {
        await p.toggleFollow(false);
        p.addLog('You break away from the party leader.');
      }
      await p.updateCharacter({ current_node_id: nodeId, mp: Math.max((p.character.mp ?? 100) - moveCost, 0) });
      // Broadcast move FIRST so followers get instant notification
      p.broadcastMove(p.character.id, p.character.name, nodeId);
      // Track visited node (fire-and-forget upsert)
      supabase.from('character_visited_nodes').upsert(
        { character_id: p.character.id, node_id: nodeId },
        { onConflict: 'character_id,node_id' }
      ).then();
      const dirNames: Record<string, string> = { N: 'North', S: 'South', E: 'East', W: 'West', NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest' };
      const dirLabel = direction ? (dirNames[direction] || direction) : null;
      const targetArea = p.getNodeArea(targetNode);
      const moveName = getNodeDisplayName(targetNode, targetArea);
      p.addLog(`You travel ${dirLabel || moveName}.`);
      logActivity(p.character.user_id, p.character.id, 'move', `Traveled ${dirLabel || 'to ' + moveName}`, { node_id: nodeId });
      if (p.party && p.isLeader) {
        const followers = p.partyMembers.filter(m => m.is_following && m.character_id !== p.character.id);
        // Update all followers in parallel instead of sequentially
        if (followers.length > 0) {
          await Promise.all(followers.map(f =>
            supabase.from('characters').update({ current_node_id: nodeId }).eq('id', f.character_id)
          ));
          p.addLog('Your party follows you.');
          p.fetchParty();
        }
      }
    } catch {
      p.addLog('Failed to move.');
    }
  }, [p.character, p.getNode, p.getRegion, p.updateCharacter, p.addLog, p.party, p.isLeader, p.partyMembers, p.creatures, p.effectiveAC, degradeEquipment, p.fetchParty, p.isDead, p.inCombat, p.stopCombat]);

  // ── Teleport ───────────────────────────────────────────────────
  const handleTeleport = useCallback(async (nodeId: string, cpCost: number) => {
    if (p.isDead) return;
    if (p.inCombat) { p.addLog('⚠️ You cannot teleport while in combat!'); return; }
    const effectiveCpCost = p.character.level >= 39 ? Math.ceil(cpCost * 0.9) : cpCost;
    if ((p.character.cp ?? 0) < effectiveCpCost) { p.addLog('⚠️ Not enough CP to teleport.'); return; }
    const targetNode = p.getNode(nodeId);
    if (!targetNode) return;
    const currentNodeObj = p.getNode(p.character.current_node_id!);
    if (currentNodeObj && !currentNodeObj.is_teleport && p.character.level >= 25) {
      setWaymarkNodeId(p.character.current_node_id!);
      p.addLog(`📍 You leave a hidden waymark at ${currentNodeObj.name}.`);
    }
    await p.updateCharacter({ current_node_id: nodeId, cp: (p.character.cp ?? 0) - effectiveCpCost });
    p.broadcastMove(p.character.id, p.character.name, nodeId);
    supabase.from('character_visited_nodes').upsert(
      { character_id: p.character.id, node_id: nodeId },
      { onConflict: 'character_id,node_id' }
    ).then();
    p.addLog(`🌀 You teleport to ${targetNode.name} for ${effectiveCpCost} CP.`);
    logActivity(p.character.user_id, p.character.id, 'teleport', `Teleported to ${targetNode.name}`, { node_id: nodeId, cpCost });
    setTeleportOpen(false);
    if (p.party && p.isLeader) {
      const coLocated = p.partyMembers.filter(m =>
        m.character_id !== p.character.id && m.status === 'accepted' &&
        m.character.current_node_id === p.character.current_node_id
      );
      const toMove = p.character.level >= 25 ? coLocated : coLocated.filter(m => m.is_following);
      if (toMove.length > 0) {
        await Promise.all(toMove.map(f =>
          supabase.from('characters').update({ current_node_id: nodeId }).eq('id', f.character_id)
        ));
        p.addLog('Your party follows you.');
        p.fetchParty();
      }
    }
  }, [p.character, p.getNode, p.updateCharacter, p.addLog, p.broadcastMove, p.party, p.isLeader, p.partyMembers, p.fetchParty, p.isDead, p.inCombat]);

  // ── Return to Waymark ──────────────────────────────────────────
  const handleReturnToWaymark = useCallback(async (cpCost: number) => {
    if (!waymarkNodeId) return;
    const waymarkNode = p.getNode(waymarkNodeId);
    if (!waymarkNode) { p.addLog('⚠️ Your waymark has faded.'); setWaymarkNodeId(null); return; }
    if (p.isDead) return;
    if (p.inCombat) { p.addLog('⚠️ You cannot teleport while in combat!'); return; }
    const effectiveWayCost = p.character.level >= 39 ? Math.ceil(cpCost * 0.9) : cpCost;
    if ((p.character.cp ?? 0) < effectiveWayCost) { p.addLog('⚠️ Not enough CP to return to waymark.'); return; }
    await p.updateCharacter({ current_node_id: waymarkNodeId, cp: (p.character.cp ?? 0) - effectiveWayCost });
    p.broadcastMove(p.character.id, p.character.name, waymarkNodeId);
    supabase.from('character_visited_nodes').upsert(
      { character_id: p.character.id, node_id: waymarkNodeId },
      { onConflict: 'character_id,node_id' }
    ).then();
    p.addLog(`📍 You return to your waymark at ${waymarkNode.name} for ${effectiveWayCost} CP.`);
    logActivity(p.character.user_id, p.character.id, 'teleport', `Returned to waymark at ${waymarkNode.name}`, { node_id: waymarkNodeId, cpCost });
    setWaymarkNodeId(null);
    setTeleportOpen(false);
    if (p.party && p.isLeader) {
      const coLocated = p.partyMembers.filter(m =>
        m.character_id !== p.character.id && m.status === 'accepted' &&
        m.character.current_node_id === p.character.current_node_id
      );
      if (coLocated.length > 0) {
        await Promise.all(coLocated.map(f =>
          supabase.from('characters').update({ current_node_id: waymarkNodeId }).eq('id', f.character_id)
        ));
        p.addLog('Your party follows you.');
        p.fetchParty();
      }
    }
  }, [waymarkNodeId, p.character, p.getNode, p.updateCharacter, p.addLog, p.broadcastMove, p.party, p.isLeader, p.partyMembers, p.fetchParty, p.isDead, p.inCombat]);

  // ── Search ─────────────────────────────────────────────────────
  const SEARCH_CP_COST = 5;
  const handleSearch = useCallback(async () => {
    if (p.isDead) return;
    if (!p.currentNode) return;
    if (p.creatures && p.creatures.length > 0) {
      p.addLog('❌ You cannot search while creatures are nearby!');
      return;
    }
    if ((p.character.cp ?? 0) < SEARCH_CP_COST) {
      p.addLog('❌ Not enough CP to search! (Need 5 CP)');
      return;
    }
    const newCp = (p.character.cp ?? 0) - SEARCH_CP_COST;
    await supabase.from('characters').update({ cp: newCp }).eq('id', p.character.id);
    p.updateCharacter({ cp: newCp });
    const roll = rollD20();
    const searchStat = p.character.class === 'wizard' ? p.character.int : p.character.wis;
    const searchMod = getStatModifier(searchStat);
    const total = roll + searchMod;
    const hiddenPaths = p.currentNode.connections.filter((c: any) => c.hidden);
    const searchItems = p.currentNode.searchable_items as any[];
    const canFindPath = total >= 10 && hiddenPaths.length > 0;
    const canFindLoot = total >= 12 && searchItems && searchItems.length > 0;
    let tryPathFirst = canFindPath && (!canFindLoot || Math.random() < 0.5);
    if (tryPathFirst) {
      const discovered = hiddenPaths[Math.floor(Math.random() * hiddenPaths.length)];
      const targetNode = p.getNode(discovered.node_id);
      const targetName = targetNode?.name || 'an unknown place';
      p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You discover a hidden path to ${targetName}!`);
      if (targetNode) {
        await p.updateCharacter({ current_node_id: discovered.node_id });
        p.addLog(`You travel through the hidden path to ${targetName}.`);
      }
      return;
    }
    if (canFindLoot) {
      for (const entry of searchItems) {
        if (Math.random() <= (entry.chance || 0.5)) {
          const item = await getCachedItemAsync(entry.item_id);
          if (item) {
            if (item.rarity === 'unique') {
              const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
                p_character_id: p.character.id, p_item_id: entry.item_id,
              });
              if (!acquired) {
                p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — The unique power of ${item.name} is already claimed by another...`);
                return;
              }
            } else {
              await supabase.from('character_inventory').insert({
                character_id: p.character.id, item_id: entry.item_id, current_durability: 100,
              });
            }
            p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You found ${item.name}!`);
            logActivity(p.character.user_id, p.character.id, 'item_found', `Found ${item.name} while searching`, { item_name: item.name });
            p.fetchInventory();
            return;
          }
        }
      }
      p.addLog(`Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You rummage around but find nothing useful.`);
    } else if (canFindPath) {
      const discovered = hiddenPaths[Math.floor(Math.random() * hiddenPaths.length)];
      const targetNode = p.getNode(discovered.node_id);
      const targetName = targetNode?.name || 'an unknown place';
      p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You discover a hidden path to ${targetName}!`);
      if (targetNode) {
        await p.updateCharacter({ current_node_id: discovered.node_id });
        p.addLog(`You travel through the hidden path to ${targetName}.`);
      }
    } else {
      p.addLog(`Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You find nothing of note.`);
    }
  }, [p.currentNode, p.character, p.addLog, p.fetchInventory, p.isDead, p.getNode, p.updateCharacter]);

  // ── Use Consumable ─────────────────────────────────────────────
  const handleUseConsumable = useCallback(async (inventoryId: string) => {
    const consGearConMod = Math.floor((p.equipmentBonuses.con || 0) / 2);
    const consEffectiveMaxHp = p.character.max_hp + (p.equipmentBonuses.hp || 0) + consGearConMod;
    const result = await p.useConsumable(inventoryId, p.character.id, p.character.hp, consEffectiveMaxHp, p.updateCharacter);
    if (result) {
      if (result.isPotion) {
        if (result.restored > 0) p.addLog(`🧪 You used ${result.itemName} and restored ${result.restored} HP.`);
        else p.addLog(`🧪 You used ${result.itemName}. You are already at full health.`);
        logActivity(p.character.user_id, p.character.id, 'general', `Used ${result.itemName} (+${result.restored} HP)`);
        p.setRegenBuff({ multiplier: 3, expiresAt: Date.now() + 120000 });
        p.addLog('✨ HP regeneration boosted for 2 minutes!');
      } else if (result.hpRegen > 0) {
        p.addLog(`🍞 You consumed ${result.itemName}. +${result.hpRegen} HP & CP regen for 5 minutes.`);
        logActivity(p.character.user_id, p.character.id, 'general', `Consumed ${result.itemName} (+${result.hpRegen} regen)`);
        p.setFoodBuff({ flatRegen: result.hpRegen, expiresAt: Date.now() + 300000 });
      }
    }
  }, [p.useConsumable, p.character.id, p.character.hp, p.character.max_hp, p.equipmentBonuses, p.updateCharacter, p.addLog]);

  // Ability types that resolve instantly client-side (buffs only — heals stay queued for rate-limiting)
  const INSTANT_BUFF_TYPES = new Set([
    'focus_strike', 'stealth_buff', 'crit_buff', 'damage_buff', 'battle_cry',
    'regen_buff', 'poison_buff', 'evasion_buff', 'disengage_buff', 'ignite_buff',
    'absorb_buff', 'party_regen', 'root_debuff', 'sunder_debuff', 'ally_absorb',
  ]);

  // Flavour text for queued abilities (shown instead of generic "⏳ Ability...")
  const getQueueFlavour = (ability: { label: string; emoji: string; type: string }, creatureName?: string): string => {
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
  };

  // Ability types that require being in combat with a valid target
  const COMBAT_REQUIRED_TYPES = new Set([
    'multi_attack', 'dot_debuff', 'execute_attack', 'ignite_consume',
    'burst_damage', 'hp_transfer',
  ]);

  // Helper: resolve creature target — prefer explicit targetId (from selected/tab target), fall back to active combat target
  const resolveCreatureTarget = (targetId?: string): string | null => {
    if (targetId) {
      const c = p.creatures.find(cr => cr.id === targetId && cr.is_alive && cr.hp > 0);
      if (c) return targetId;
    }
    return p.activeCombatCreatureId;
  };

  // ── Use Ability (large) ────────────────────────────────────────
  const handleUseAbility = useCallback(async (abilityIndex: number, targetId?: string, _fromTick = false) => {
    if (p.isDead || p.character.hp <= 0) return;
    const allAbilities = [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[p.character.class] || [])];
    if (!allAbilities[abilityIndex]) return;
    const ability = allAbilities[abilityIndex];
    if (p.character.level < ability.levelRequired) {
      p.addLog(`⚠️ ${ability.emoji} ${ability.label} unlocks at level ${ability.levelRequired}.`);
      return;
    }
    const effectiveCpCost = p.character.level >= 39 ? Math.ceil(ability.cpCost * 0.9) : ability.cpCost;
    if ((p.character.cp ?? 0) < effectiveCpCost) {
      p.addLog(`⚠️ Not enough CP for ${ability.label}! (${effectiveCpCost} CP needed, ${p.character.cp ?? 0} available)`);
      return;
    }

    // Buff-only abilities resolve instantly (no tick queue needed)
    const isInstantBuff = INSTANT_BUFF_TYPES.has(ability.type);

    // Early combat check before queuing — reject abilities that need a target if not in combat
    if (!isInstantBuff && !_fromTick && COMBAT_REQUIRED_TYPES.has(ability.type)) {
      const cTargetId = resolveCreatureTarget(targetId);
      if (!p.inCombat || !cTargetId) {
        p.addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`);
        return;
      }
    }

    // Damage/heal abilities must be queued for the heartbeat tick
    if (!isInstantBuff && !_fromTick) {
      p.queueAbility(abilityIndex, targetId);
      const cTarget = targetId ? p.creatures?.find(c => c.id === targetId) : p.activeCombatCreatureId ? p.creatures?.find(c => c.id === p.activeCombatCreatureId) : undefined;
      p.addLog(getQueueFlavour(ability, cTarget?.name));
      return;
    }

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
      const gearConMod = Math.floor((p.equipmentBonuses.con || 0) / 2);
      const effectiveMaxHp = p.character.max_hp + (p.equipmentBonuses.hp || 0) + gearConMod;
      const newHp = Math.min(effectiveMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLog(`${ability.emoji} You cast Heal and restore ${restored} HP!`); }
      else p.addLog(`${ability.emoji} You cast Heal but you're already at full health.`);
    } else if (ability.type === 'self_heal') {
      const conMod = getStatModifier(p.character.con);
      const healAmount = Math.max(3, conMod * 3 + p.character.level);
      const gearConMod = Math.floor((p.equipmentBonuses.con || 0) / 2);
      const effectiveMaxHp = p.character.max_hp + (p.equipmentBonuses.hp || 0) + gearConMod;
      const newHp = Math.min(effectiveMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLog(`${ability.emoji} You use Second Wind and recover ${restored} HP!`); }
      else p.addLog(`${ability.emoji} You use Second Wind but you're already at full health.`);
    } else if (ability.type === 'regen_buff') {
      p.setRegenBuff({ multiplier: 2, expiresAt: Date.now() + 90000 });
      const inspireMsg = `${ability.emoji} ${p.character.name} plays an inspiring song! HP & CP regeneration doubled for 90 seconds.`;
      if (p.party) p.addLog(`${inspireMsg}[INSPIRE_BUFF]`);
      else p.addLog(inspireMsg);
    } else if (ability.type === 'crit_buff') {
      const dexMod = getStatModifier(p.character.dex);
      const critBonus = Math.max(1, Math.min(dexMod, 5));
      p.setCritBuff({ bonus: critBonus, expiresAt: Date.now() + 30000 });
      p.addLog(`${ability.emoji} Eagle Eye! Your crit range is now ${20 - critBonus}-20 for 30s.`);
    } else if (ability.type === 'stealth_buff') {
      const dexMod = getStatModifier(p.character.dex);
      const durationMs = Math.min(15000 + dexMod * 1000, 25000);
      p.setStealthBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Shadowstep! You vanish into the shadows for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'damage_buff') {
      const intMod = getStatModifier(p.character.int);
      const durationMs = Math.min(25, 15 + intMod) * 1000;
      p.setDamageBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Arcane Surge! Your spell damage is amplified for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'multi_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'root_debuff') {
      const cTargetId = resolveCreatureTarget(targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for ${ability.label}.`); return; }
      const wisMod = getStatModifier(p.character.wis);
      const durationMs = Math.min(15000, 8000 + wisMod * 1000);
      const reduction = 0.3;
      p.setRootDebuff({ damageReduction: reduction, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} ${ability.label}! ${creature.name}'s damage reduced by ${Math.round(reduction * 100)}% for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'battle_cry') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const bonus = Math.max(3, dexMod + 2);
      const durationMs = Math.min(25000, 15000 + dexMod * 1000);
      p.setAcBuff({ bonus, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Battle Cry! AC increased by ${bonus} for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'dot_debuff') {
      const cTargetId = resolveCreatureTarget(targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use Rend!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for Rend.`); return; }
      const strMod = getStatModifier(p.character.str + (p.equipmentBonuses.str || 0));
      const dmgPerTick = Math.max(1, Math.floor((strMod * 1.5 + 2) * 0.67));
      const durationMs = Math.min(30000, 20000 + strMod * 1000);
      const intervalMs = 2000;
      p.setBleedStacks((prev: Record<string, DotDebuff>) => ({
        ...prev,
        [cTargetId]: {
          damagePerTick: dmgPerTick, intervalMs, expiresAt: Date.now() + durationMs,
          startsAt: Date.now() + intervalMs, // first tick fires on the NEXT heartbeat
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
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const durationMs = Math.min(30000, 20000 + dexMod * 1000);
      p.setPoisonBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Envenom! Your weapons drip with poison for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'execute_attack') {
      // Processed server-side via combat-tick heartbeat
    }
      if (newHp <= 0) { await awardKillRewards(creature, { stopCombat: true }); return; }
    } else if (ability.type === 'evasion_buff') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const durationMs = Math.min(15000, 10000 + dexMod * 500);
      p.setEvasionBuff({ dodgeChance: 0.5, expiresAt: Date.now() + durationMs, source: 'cloak' as const });
      p.addLog(`${ability.emoji} Cloak of Shadows! 50% dodge chance for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'disengage_buff') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const dodgeDurationMs = Math.min(8000, 5000 + dexMod * 500);
      const nextHitDurationMs = 15000;
      p.setEvasionBuff({ dodgeChance: 1.0, expiresAt: Date.now() + dodgeDurationMs, source: 'disengage' as const });
      p.setDisengageNextHit({ bonusMult: 1.5, expiresAt: Date.now() + nextHitDurationMs });
      p.addLog(`${ability.emoji} Disengage! You leap back — dodging all attacks for ${Math.round(dodgeDurationMs / 1000)}s. Your next strike deals 50% bonus damage!`);
    } else if (ability.type === 'ignite_buff') {
      const intMod = getStatModifier(p.character.int + (p.equipmentBonuses.int || 0));
      const durationMs = Math.min(45000, 30000 + intMod * 1000);
      p.setIgniteBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Ignite! Your spells burn with fire for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'ignite_consume') {
      // Processed server-side via combat-tick heartbeat
    }
      if (newHp <= 0) { await awardKillRewards(creature, { stopCombat: true }); return; }
    } else if (ability.type === 'absorb_buff') {
      const intMod = getStatModifier(p.character.int + (p.equipmentBonuses.int || 0));
      const shieldHp = intMod + Math.floor(p.character.level * 0.5);
      const durationMs = Math.min(15000, 8000 + intMod * 1000);
      p.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Force Shield! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'party_regen') {
      const scaleStat = p.character.class === 'healer'
        ? getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0))
        : getStatModifier(p.character.cha + (p.equipmentBonuses.cha || 0));
      const healPerTick = Math.max(1, scaleStat + 2);
      const durationMs = Math.min(25000, 15000 + scaleStat * 1000);
      p.setPartyRegenBuff({ healPerTick, expiresAt: Date.now() + durationMs, source: p.character.class === 'healer' ? 'healer' : 'bard' });
      const who = p.party ? 'your party' : 'you';
      const abilityName = p.character.class === 'healer' ? 'Purifying Light! Divine radiance' : 'Crescendo! A rising melody';
      p.addLog(`${ability.emoji} ${abilityName} heals ${who} for ${healPerTick} HP every 3s for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'ally_absorb') {
      const wisMod = getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0));
      const shieldHp = wisMod * 2 + Math.floor(p.character.level * 0.7);
      const durationMs = Math.min(18000, 10000 + wisMod * 1000);
      if (targetId && targetId !== p.character.id) {
        p.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
        const targetMember = p.partyMembers.find(m => m.character_id === targetId);
        const targetName = targetMember?.character.name || 'ally';
        p.addLog(`${ability.emoji} Divine Aegis! You shield ${targetName} with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
      } else {
        p.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
        p.addLog(`${ability.emoji} Divine Aegis! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
      }
    } else if (ability.type === 'sunder_debuff') {
      const cTargetId = resolveCreatureTarget(targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use Sunder Armor!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for Sunder Armor.`); return; }
      const strMod = getStatModifier(p.character.str + (p.equipmentBonuses.str || 0));
      const acReduction = Math.max(2, strMod);
      const durationSec = Math.min(20, 12 + strMod);
      p.setSunderDebuff({ acReduction, expiresAt: Date.now() + durationSec * 1000, creatureId: cTargetId, creatureName: creature.name });
      p.addLog(`${ability.emoji} Sunder Armor! ${creature.name}'s AC reduced by ${acReduction} for ${durationSec}s.`);
    } else if (ability.type === 'burst_damage') {
      // Processed server-side via combat-tick heartbeat
    }

    // Deduct CP
    const finalCpCost = p.character.level >= 39 ? Math.ceil(ability.cpCost * 0.9) : ability.cpCost;
    const newCp = Math.max((p.character.cp ?? 0) - finalCpCost, 0);
    await p.updateCharacter({ cp: newCp });
    setLastUsedAbilityCost(finalCpCost);
  }, [p.isDead, p.character, p.updateCharacter, p.addLog, p.party, p.partyMembers, p.inCombat, p.activeCombatCreatureId, p.creatures, p.equipmentBonuses, p.creatureHpOverrides, p.poisonStacks, p.igniteStacks, lastUsedAbilityCost, awardKillRewards]);

  // ── Attack ─────────────────────────────────────────────────────
  const handleAttack = useCallback((creatureId: string) => {
    if (p.isDead) return;
    p.startCombat(creatureId);
  }, [p.isDead, p.startCombat]);

  return {
    handleMove, handleTeleport, handleReturnToWaymark, handleSearch,
    handleUseConsumable, handleUseAbility, handleAttack,
    rollLoot, awardKillRewards, degradeEquipment,
    waymarkNodeId, lastUsedAbilityCost,
    teleportOpen, setTeleportOpen,
  };
}
