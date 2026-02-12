import { useState, useCallback, useEffect, useRef } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CharacterPanel from '@/components/game/CharacterPanel';
import NodeView from '@/components/game/NodeView';
import MapPanel from '@/components/game/MapPanel';
import VendorPanel from '@/components/game/VendorPanel';
import LootShareDialog, { LootDrop } from '@/components/game/LootShareDialog';
import StatAllocationDialog from '@/components/game/StatAllocationDialog';
import { Character } from '@/hooks/useCharacter';
import { useNodes } from '@/hooks/useNodes';
import { usePresence } from '@/hooks/usePresence';
import { useCreatures } from '@/hooks/useCreatures';
import { useInventory } from '@/hooks/useInventory';
import { useParty } from '@/hooks/useParty';
import { usePartyCombatLog } from '@/hooks/usePartyCombatLog';
import { rollD20, getStatModifier, rollDamage, CLASS_LEVEL_BONUSES, CLASS_LABELS } from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Props {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  onSignOut: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  startingNodeId?: string;
}

export default function GamePage({ character, updateCharacter, onSignOut, isAdmin, onOpenAdmin, startingNodeId }: Props) {
  const { regions, nodes, loading: nodesLoading, getNode, getRegion } = useNodes(true);
  const { playersHere } = usePresence(character.current_node_id);
  const { creatures } = useCreatures(character.current_node_id);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, inventory } = useInventory(character.id);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  } = useParty(character.id);
  const { entries: partyCombatEntries, addPartyCombatLog } = usePartyCombatLog(party?.id ?? null);
  const [eventLog, setEventLog] = useState<string[]>(['Welcome, Everyday Adventurer!']);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [pendingLoot, setPendingLoot] = useState<{ loot: LootDrop[]; creatureName: string } | null>(null);
  const [regenBuff, setRegenBuff] = useState<{ multiplier: number; expiresAt: number }>({ multiplier: 1, expiresAt: 0 });
  const [isDead, setIsDead] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const ownLogIdsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((msg: string) => {
    setEventLog(prev => [...prev.slice(-49), msg]);
    // Also write to party combat log if in a party, and track own IDs to prevent duplicates
    (async () => {
      const id = await addPartyCombatLog(msg);
      if (id) ownLogIdsRef.current.add(id);
    })();
  }, [addPartyCombatLog]);

  // Merge party combat log entries from other players into event log
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!party) return;
    for (const entry of partyCombatEntries) {
      if (!seenIdsRef.current.has(entry.id)) {
        seenIdsRef.current.add(entry.id);
        // Skip entries we created ourselves
        if (ownLogIdsRef.current.has(entry.id)) continue;
        setEventLog(prev => [...prev.slice(-49), entry.message]);
      }
    }
  }, [partyCombatEntries, party]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLog]);

  // Update last_online periodically
  useEffect(() => {
    const updateOnline = () => {
      supabase.from('characters').update({ last_online: new Date().toISOString() } as any).eq('id', character.id).then(() => {});
    };
    updateOnline();
    const interval = setInterval(updateOnline, 60000);
    return () => clearInterval(interval);
  }, [character.id]);

  // return_unique_items, regen_creature_hp, respawn_creatures run server-side via scheduled jobs

  // Passive HP regeneration — 1 HP every 30s, multiplied by regen buff
  useEffect(() => {
    const interval = setInterval(() => {
      if (character.hp < character.max_hp && character.hp > 0) {
        const mult = Date.now() < regenBuff.expiresAt ? regenBuff.multiplier : 1;
        const regenAmount = Math.max(Math.floor(1 * mult), 1);
        const newHp = Math.min(character.hp + regenAmount, character.max_hp);
        if (newHp !== character.hp) {
          updateCharacter({ hp: newHp });
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [character.hp, character.max_hp, regenBuff, updateCharacter]);

  // Refs for death respawn to avoid stale closures / cleanup races
  const deathGoldRef = useRef(character.gold);
  const deathNodeRef = useRef(startingNodeId || character.current_node_id);
  const updateCharRef = useRef(updateCharacter);
  const addLogRef = useRef(addLog);
  useEffect(() => { deathGoldRef.current = character.gold; }, [character.gold]);
  useEffect(() => { deathNodeRef.current = startingNodeId || character.current_node_id; }, [startingNodeId, character.current_node_id]);
  useEffect(() => { updateCharRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

  // Death detection and respawn — only depends on hp and isDead
  useEffect(() => {
    if (character.hp > 0 || isDead) return;
    setIsDead(true);
    const goldLost = Math.floor(deathGoldRef.current * 0.1);
    const respawnTimeout = setTimeout(async () => {
      await updateCharRef.current({
        hp: 1,
        gold: deathGoldRef.current - goldLost,
        current_node_id: deathNodeRef.current,
      });
      addLogRef.current(`💀 You have fallen! You lost ${goldLost} gold and awaken at the starting area with 1 HP.`);
      setIsDead(false);
    }, 3000);
    return () => clearTimeout(respawnTimeout);
  }, [character.hp, isDead]);

  // Sync follower's local character when leader moves them
  // The party realtime subscription updates faster than the character subscription in some cases
  useEffect(() => {
    if (!myMembership?.character?.current_node_id) return;
    if (myMembership.character.current_node_id !== character.current_node_id) {
      // Party data shows we've been moved — sync local state
      updateCharacter({ current_node_id: myMembership.character.current_node_id });
    }
  }, [myMembership?.character?.current_node_id]);

  const currentNode = character.current_node_id ? getNode(character.current_node_id) : null;
  const currentRegion = currentNode ? getRegion(currentNode.region_id) : null;

  // Effective AC including equipment
  const effectiveAC = character.ac + (equipmentBonuses.ac || 0);

  // Track previous node to detect movement for aggressive creature triggers
  const prevNodeRef = useRef<string | null>(null);
  const aggroProcessedRef = useRef<Set<string>>(new Set());

  // Aggressive creature auto-attack when entering a node
  useEffect(() => {
    if (!character.current_node_id || character.hp <= 0) return;

    // Only trigger on node change
    if (prevNodeRef.current === character.current_node_id) return;
    prevNodeRef.current = character.current_node_id;
    aggroProcessedRef.current = new Set();
  }, [character.current_node_id, character.hp]);

  // Process aggressive creatures when creatures list updates after a move
  useEffect(() => {
    if (!creatures.length || character.hp <= 0) return;
    const aggressiveCreatures = creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;

    // Mark as processed immediately to avoid re-triggering
    for (const c of aggressiveCreatures) {
      aggroProcessedRef.current.add(c.id);
    }

    // Delayed auto-attack to give the UI time to render
    const timeout = setTimeout(async () => {
      for (const creature of aggressiveCreatures) {
        if (character.hp <= 0) break;

        addLog(`⚠️ ${creature.name} is aggressive and attacks you!`);

        // Creature attacks — route to tank if available
        const tankMember = party && party.tank_id && party.tank_id !== character.id
          ? partyMembers.find(m => m.character_id === party.tank_id)
          : null;

        const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);

        if (tankMember) {
          const tankAC = 10;
          if (creatureAtk >= tankAC) {
            const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
            const tankNewHp = Math.max(tankMember.character.hp - creatureDmg, 0);
            addLog(`🛡️ ${creature.name} strikes ${tankMember.character.name} (Tank)! ${creatureDmg} damage.`);
            await supabase.rpc('update_party_member_hp', { _character_id: tankMember.character_id, _new_hp: tankNewHp });
          } else {
            addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
          }
        } else {
          if (creatureAtk >= effectiveAC) {
            const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
            const playerNewHp = Math.max(character.hp - creatureDmg, 0);
            addLog(`${creature.name} hits you for ${creatureDmg} damage! (Rolled ${creatureAtk} vs AC ${effectiveAC})`);
            await updateCharacter({ hp: playerNewHp });
            if (playerNewHp <= 0) {
              addLog('💀 You have been defeated...');
              break;
            }
          } else {
            addLog(`${creature.name} swings at you — misses! (Rolled ${creatureAtk} vs AC ${effectiveAC})`);
          }
        }
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [creatures, character.hp, effectiveAC, addLog, updateCharacter, party, partyMembers]);

  const degradeEquipment = useCallback(async () => {
    for (const item of equipped) {
      const newDur = item.current_durability - 1;
      if (newDur <= 0) {
        addLog(`💔 Your ${item.item.name} has broken!`);
        await supabase.from('character_inventory').delete().eq('id', item.id);
      } else {
        await supabase.from('character_inventory').update({ current_durability: newDur }).eq('id', item.id);
      }
    }
    if (equipped.length > 0) fetchInventory();
  }, [equipped, addLog, fetchInventory]);

  const handleMove = useCallback(async (nodeId: string) => {
    if (isDead) return;
    const targetNode = getNode(nodeId);
    if (!targetNode) return;
    const targetRegion = getRegion(targetNode.region_id);
    if (targetRegion && character.level < targetRegion.min_level) {
      addLog(`You are not strong enough to enter ${targetRegion.name} (requires Lvl ${targetRegion.min_level}).`);
      toast.error(`Level ${targetRegion.min_level} required`);
      return;
    }

    // Attack of Opportunity — each living creature gets a free strike
    const livingCreatures = creatures.filter(c => c.is_alive && c.hp > 0);
    let currentHp = character.hp;
    for (const creature of livingCreatures) {
      if (currentHp <= 0) break;
      const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
      if (atkRoll >= effectiveAC) {
        const dmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
        currentHp = Math.max(currentHp - dmg, 0);
        addLog(`⚔️ ${creature.name} strikes as you flee! (Rolled ${atkRoll} vs AC ${effectiveAC}) — ${dmg} damage!`);
      } else {
        addLog(`${creature.name} swipes at you as you flee — misses! (Rolled ${atkRoll} vs AC ${effectiveAC})`);
      }
    }
    if (currentHp < character.hp) {
      await updateCharacter({ hp: currentHp });
      await degradeEquipment();
    }
    if (currentHp <= 0) {
      addLog('💀 You were struck down while retreating...');
      return;
    }

    try {
      // If this player is following the leader, reset follow since they moved independently
      if (party && !isLeader && myMembership?.is_following) {
        await toggleFollow(false);
        addLog('You break away from the party leader.');
      }
      await updateCharacter({ current_node_id: nodeId });
      addLog(`You travel to ${targetNode.name}.`);
      // Move followers if I'm the party leader
      if (party && isLeader) {
        const followers = partyMembers.filter(m => m.is_following && m.character_id !== character.id);
        for (const f of followers) {
          await supabase.from('characters').update({ current_node_id: nodeId }).eq('id', f.character_id);
        }
        if (followers.length > 0) {
          addLog(`Your party follows you.`);
          // Refresh party member data so map shows updated positions
          fetchParty();
        }
      }
    } catch {
      addLog('Failed to move.');
    }
  }, [character, getNode, getRegion, updateCharacter, addLog, party, isLeader, partyMembers, creatures, effectiveAC, degradeEquipment, fetchParty, isDead]);

  const handleSearch = useCallback(async () => {
    if (isDead) return;
    if (!currentNode) return;
    const roll = rollD20();
    const searchItems = currentNode.searchable_items as any[];
    if (roll >= 12 && searchItems && searchItems.length > 0) {
      // Roll against each searchable item's chance
      for (const entry of searchItems) {
        if (Math.random() <= (entry.chance || 0.5)) {
          const { data: item } = await supabase.from('items').select('name').eq('id', entry.item_id).single();
          if (item) {
            await supabase.from('character_inventory').insert({
              character_id: character.id, item_id: entry.item_id, current_durability: 100,
            });
            addLog(`🔍 Search roll: ${roll} — You found ${item.name}!`);
            fetchInventory();
            return;
          }
        }
      }
      addLog(`Search roll: ${roll} — You rummage around but find nothing useful.`);
    } else {
      addLog(`Search roll: ${roll} — You find nothing of note.`);
    }
  }, [currentNode, character.id, addLog, fetchInventory, isDead]);

  const rollLoot = useCallback(async (lootTable: any[], creatureName: string) => {
    if (!lootTable || lootTable.length === 0) return;
    const droppedItems: LootDrop[] = [];
    for (const entry of lootTable) {
      if (Math.random() <= (entry.chance || 0.1)) {
        const { data: item } = await supabase.from('items').select('name, rarity').eq('id', entry.item_id).single();
        if (item) {
          droppedItems.push({ item_id: entry.item_id, item_name: item.name, item_rarity: item.rarity });
          addLog(`💎 ${creatureName} dropped ${item.name}!`);
        }
      }
    }
    if (droppedItems.length === 0) return;

    // If in a party, show loot sharing dialog; otherwise auto-assign
    if (party && partyMembers.length > 1) {
      setPendingLoot({ loot: droppedItems, creatureName });
    } else {
      for (const drop of droppedItems) {
        await supabase.from('character_inventory').insert({
          character_id: character.id, item_id: drop.item_id, current_durability: 100,
        });
      }
      fetchInventory();
    }
  }, [character.id, addLog, fetchInventory, party, partyMembers]);

  const handleLootDistribute = useCallback(async (assignments: Record<string, string>) => {
    for (const [itemId, charId] of Object.entries(assignments)) {
      await supabase.from('character_inventory').insert({
        character_id: charId, item_id: itemId, current_durability: 100,
      });
      const lootItem = pendingLoot?.loot.find(l => l.item_id === itemId);
      const member = partyMembers.find(m => m.character_id === charId);
      if (lootItem && member) {
        addLog(`📦 ${lootItem.item_name} → ${member.character.name}`);
      }
    }
    setPendingLoot(null);
    fetchInventory();
  }, [pendingLoot, partyMembers, addLog, fetchInventory]);

  // degradeEquipment moved above handleMove

  const handleAttack = useCallback(async (creatureId: string) => {
    if (isDead) return;
    const creature = creatures.find(c => c.id === creatureId);
    if (!creature) return;

    const ability = CLASS_COMBAT[character.class] || CLASS_COMBAT.warrior;
    const statBonus = equipmentBonuses[ability.stat] || 0;
    const atkRoll = rollD20();
    const statMod = getStatModifier((character as any)[ability.stat] + statBonus);
    const totalAtk = atkRoll + statMod;
    const statLabel = ability.stat.toUpperCase();
    const who = party ? character.name : 'You';

    if (atkRoll >= ability.critRange || (atkRoll !== 1 && totalAtk >= creature.ac)) {
      const dmg = rollDamage(ability.diceMin, ability.diceMax) + statMod;
      const isCrit = atkRoll >= ability.critRange;
      const finalDmg = isCrit ? dmg * 2 : Math.max(dmg, 1);
      const newHp = Math.max(creature.hp - finalDmg, 0);

      addLog(
        `${isCrit ? `${ability.emoji} CRITICAL! ` : ability.emoji + ' '}${who} ${ability.verb} ${creature.name}! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${creature.ac} — ${finalDmg} damage.`
      );

      if (newHp <= 0) {
        // Creature dies — award XP, gold, and roll loot
        const totalXp = creature.level * 10;
        const totalGold = Math.floor(creature.level * (creature.rarity === 'boss' ? 25 : creature.rarity === 'rare' ? 15 : 5) * (0.8 + Math.random() * 0.4));
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: 0, _killed: true });

        // Split rewards among party members present at the same node
        const membersHere = party
          ? partyMembers.filter(m => m.character?.current_node_id === character.current_node_id)
          : [];
        const splitCount = membersHere.length > 1 ? membersHere.length : 1;
        const xpShare = Math.floor(totalXp / splitCount);
        const goldShare = Math.floor(totalGold / splitCount);

        if (splitCount > 1) {
          addLog(`☠️ ${creature.name} has been slain! Rewards split ${splitCount} ways: +${xpShare} XP, +${goldShare} gold each.`);
          // Award XP and gold to other party members via RPC
          for (const m of membersHere) {
            if (m.character_id === character.id) continue;
            await supabase.rpc('award_party_member', {
              _character_id: m.character_id,
              _xp: xpShare,
              _gold: goldShare,
            });
          }
        } else {
          addLog(`☠️ ${creature.name} has been slain! (+${xpShare} XP, +${goldShare} gold)`);
        }

        const newXp = character.xp + xpShare;
        const newGold = character.gold + goldShare;
        const xpForNext = character.level * 100;
        if (newXp >= xpForNext) {
          const newLevel = character.level + 1;
          const levelUpUpdates: Partial<Character> = {
            xp: newXp - xpForNext,
            level: newLevel,
            max_hp: character.max_hp + 5,
            hp: character.max_hp + 5,
            gold: newGold,
            unspent_stat_points: (character.unspent_stat_points || 0) + 2,
          };

          // Class-based stat bonuses every 3 levels
          if (newLevel % 3 === 0) {
            const bonuses = CLASS_LEVEL_BONUSES[character.class] || {};
            const bonusNames: string[] = [];
            for (const [stat, amount] of Object.entries(bonuses)) {
              const currentVal = (character as any)[stat] || 10;
              const capped = Math.min(currentVal + amount, 30);
              if (capped > currentVal) {
                (levelUpUpdates as any)[stat] = capped;
                bonusNames.push(`+${amount} ${stat.toUpperCase()}`);
              }
            }
            if (bonusNames.length > 0) {
              addLog(`📈 ${CLASS_LABELS[character.class] || character.class} bonus: ${bonusNames.join(', ')}!`);
            }
          }

          addLog(`🎉 Level Up! ${who} ${party ? 'is' : 'are'} now level ${newLevel}! ${party ? `${who} gained` : 'You gained'} 2 stat points.`);
          await updateCharacter(levelUpUpdates);
        } else {
          await updateCharacter({ xp: newXp, gold: newGold });
        }
        
        // Roll loot
        await rollLoot(creature.loot_table as any[], creature.name);
      } else {
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: false });
        // Creature counterattack — targets tank if party has one
        const tankMember = party && party.tank_id && party.tank_id !== character.id
          ? partyMembers.find(m => m.character_id === party.tank_id)
          : null;
        const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);
        if (tankMember) {
          // Tank absorbs the hit
          const tankAC = 10; // We don't have tank's full AC here, use base
          if (creatureAtk >= tankAC) {
            const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
            const tankNewHp = Math.max(tankMember.character.hp - creatureDmg, 0);
            addLog(`🛡️ ${creature.name} strikes ${tankMember.character.name} (Tank)! ${creatureDmg} damage.`);
            await supabase.rpc('update_party_member_hp', { _character_id: tankMember.character_id, _new_hp: tankNewHp });
          } else {
            addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
          }
        } else {
          if (creatureAtk >= effectiveAC) {
            const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
            const playerNewHp = Math.max(character.hp - creatureDmg, 0);
            addLog(`${creature.name} strikes back at ${who}! Rolled ${creatureAtk} vs AC ${effectiveAC} — Hit! ${creatureDmg} damage.`);
            await updateCharacter({ hp: playerNewHp });
            await degradeEquipment();
            if (playerNewHp <= 0) {
              addLog(`💀 ${who} ${party ? 'has' : 'have'} been defeated...`);
            }
          } else {
            addLog(`${creature.name} attacks ${who} — misses!`);
          }
        }
      }
    } else {
      addLog(`${ability.emoji} ${who} ${ability.verb} ${creature.name} — miss! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${creature.ac}.`);
      // Creature still attacks — targets tank if available
      const tankMember = party && party.tank_id && party.tank_id !== character.id
        ? partyMembers.find(m => m.character_id === party.tank_id)
        : null;
      const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);
      if (tankMember) {
        const tankAC = 10;
        if (creatureAtk >= tankAC) {
          const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          const tankNewHp = Math.max(tankMember.character.hp - creatureDmg, 0);
          addLog(`🛡️ ${creature.name} retaliates at ${tankMember.character.name} (Tank)! ${creatureDmg} damage.`);
          await supabase.rpc('update_party_member_hp', { _character_id: tankMember.character_id, _new_hp: tankNewHp });
        } else {
          addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
        }
      } else {
        if (creatureAtk >= effectiveAC) {
          const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          const playerNewHp = Math.max(character.hp - creatureDmg, 0);
          addLog(`${creature.name} retaliates at ${who}! ${creatureDmg} damage.`);
          await updateCharacter({ hp: playerNewHp });
          await degradeEquipment();
        }
      }
    }
  }, [character, creatures, addLog, updateCharacter, equipmentBonuses, effectiveAC, rollLoot, degradeEquipment, party, partyMembers, isDead]);

  const handleUseConsumable = useCallback(async (inventoryId: string) => {
    const result = await useConsumable(inventoryId, character.id, character.hp, character.max_hp, updateCharacter);
    if (result) {
      addLog(`🧪 You used ${result.itemName} and restored ${result.restored} HP.`);
      // Apply regen buff: 3x regen for 2 minutes
      setRegenBuff({ multiplier: 3, expiresAt: Date.now() + 120000 });
      addLog(`✨ HP regeneration boosted for 2 minutes!`);
    }
  }, [useConsumable, character.id, character.hp, character.max_hp, updateCharacter, addLog]);

  const handleSpendPoint = useCallback(async (stat: string) => {
    if (character.unspent_stat_points <= 0) return;
    const currentVal = (character as any)[stat] as number;
    if (currentVal >= 30) return;
    await updateCharacter({
      [stat]: currentVal + 1,
      unspent_stat_points: character.unspent_stat_points - 1,
    });
  }, [character, updateCharacter]);

  if (nodesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-sm text-muted-foreground animate-pulse">Loading world...</p>
      </div>
    );
  }

  if (!currentNode) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <div className="text-center text-muted-foreground">
          <p className="font-display text-lg">Lost in the void...</p>
          <p className="text-sm">No starting location found. A Valar must seed the world first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col parchment-bg">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
        <h1 className="font-display text-sm text-primary text-glow">Everyday Adventurer</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={onOpenAdmin} className="text-xs font-display">
              ⚡ Admin
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onSignOut} className="text-xs text-muted-foreground">
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={22} minSize={18} maxSize={30}>
            <div className="h-full ornate-border bg-card/60">
              <CharacterPanel
                character={character}
                equipped={equipped}
                unequipped={unequipped}
                equipmentBonuses={equipmentBonuses}
                onEquip={equipItem}
                onUnequip={unequipItem}
                onDrop={dropItem}
                onUseConsumable={handleUseConsumable}
                onSpendPoint={handleSpendPoint}
                party={party}
                partyMembers={partyMembers}
                pendingInvites={pendingInvites}
                isLeader={isLeader}
                isTank={isTank}
                myMembership={myMembership}
                playersHere={playersHere}
                onCreateParty={createParty}
                onInvite={invitePlayer}
                onAcceptInvite={acceptInvite}
                onDeclineInvite={declineInvite}
                onLeaveParty={leaveParty}
                onKick={kickMember}
                onSetTank={setTank}
                onToggleFollow={toggleFollow}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={35}>
            <div className="h-full ornate-border bg-card/60 flex flex-col">
              <div className="flex-[2] min-h-0">
                <NodeView
                  node={currentNode}
                  region={currentRegion}
                  players={playersHere}
                  creatures={creatures}
                  character={character}
                  eventLog={eventLog}
                  onSearch={handleSearch}
                  onAttack={handleAttack}
                  onOpenVendor={currentNode.is_vendor ? () => setVendorOpen(true) : undefined}
                />
              </div>
              {/* Event Log - docked at bottom of middle column, 1/3 height */}
              <div className="flex-[1] min-h-0 border-t border-border px-3 py-2 flex flex-col">
                <h3 className="font-display text-xs text-muted-foreground mb-1 shrink-0">Event Log</h3>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 bg-background/30 rounded border border-border space-y-0.5">
                  {eventLog.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Your journey begins...</p>
                  ) : (
                    eventLog.map((log, i) => (
                      <p key={i} className="text-xs text-foreground/80">{log}</p>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={28} minSize={18} maxSize={35}>
            <div className="h-full ornate-border bg-card/60">
              <MapPanel
                regions={regions}
                nodes={nodes}
                currentNodeId={character.current_node_id}
                currentRegionId={currentNode.region_id}
                characterLevel={character.level}
                onNodeClick={handleMove}
                partyMembers={partyMembers}
                myCharacterId={character.id}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>


      {/* Vendor Dialog */}
      {currentNode.is_vendor && (
        <VendorPanel
          open={vendorOpen}
          onClose={() => setVendorOpen(false)}
          nodeId={currentNode.id}
          characterId={character.id}
          gold={character.gold}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onInventoryChange={fetchInventory}
          addLog={addLog}
        />
      )}

      {/* Loot Share Dialog */}
      {pendingLoot && party && (
        <LootShareDialog
          open={true}
          loot={pendingLoot.loot}
          partyMembers={partyMembers}
          creatureName={pendingLoot.creatureName}
          onConfirm={handleLootDistribute}
        />
      )}

      {/* Stat Allocation Dialog */}
      <StatAllocationDialog character={character} onAllocate={updateCharacter} />

      {/* Death Overlay */}
      {isDead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="text-center space-y-3 animate-pulse">
            <p className="font-display text-4xl text-destructive">💀</p>
            <p className="font-display text-2xl text-destructive">You Have Fallen</p>
            <p className="text-sm text-muted-foreground">Respawning at the starting area...</p>
            <p className="text-xs text-muted-foreground">You lost {Math.floor(character.gold * 0.1)} gold.</p>
          </div>
        </div>
      )}
    </div>
  );
}
