import { useState, useCallback, useEffect, useRef } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CharacterPanel from '@/components/game/CharacterPanel';
import NodeView from '@/components/game/NodeView';
import MapPanel from '@/components/game/MapPanel';
import VendorPanel from '@/components/game/VendorPanel';
import LootShareDialog, { LootDrop } from '@/components/game/LootShareDialog';
import { Character } from '@/hooks/useCharacter';
import { useNodes } from '@/hooks/useNodes';
import { usePresence } from '@/hooks/usePresence';
import { useCreatures } from '@/hooks/useCreatures';
import { useInventory } from '@/hooks/useInventory';
import { useParty } from '@/hooks/useParty';
import { rollD20, getStatModifier, rollDamage } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Props {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  onSignOut: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
}

export default function GamePage({ character, updateCharacter, onSignOut, isAdmin, onOpenAdmin }: Props) {
  const { regions, nodes, getNode, getRegion } = useNodes(true);
  const { playersHere } = usePresence(character.current_node_id);
  const { creatures } = useCreatures(character.current_node_id);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, inventory } = useInventory(character.id);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow,
  } = useParty(character.id);
  const [eventLog, setEventLog] = useState<string[]>(['Welcome, Everyday Adventurer!']);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [pendingLoot, setPendingLoot] = useState<{ loot: LootDrop[]; creatureName: string } | null>(null);
  const [regenBuff, setRegenBuff] = useState<{ multiplier: number; expiresAt: number }>({ multiplier: 1, expiresAt: 0 });
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setEventLog(prev => [...prev.slice(-49), msg]);
  }, []);

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

  // Run return_unique_items on load
  useEffect(() => {
    supabase.rpc('return_unique_items').then(() => {});
  }, []);

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

  // Creature HP regen + respawn every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      supabase.rpc('regen_creature_hp').then(() => {});
      supabase.rpc('respawn_creatures').then(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

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
            await supabase.from('characters').update({ hp: tankNewHp }).eq('id', tankMember.character_id);
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
      await updateCharacter({ current_node_id: nodeId });
      addLog(`You travel to ${targetNode.name}.`);
      // Move followers if I'm the party leader
      if (party && isLeader) {
        const followers = partyMembers.filter(m => m.is_following && m.character_id !== character.id);
        for (const f of followers) {
          await supabase.from('characters').update({ current_node_id: nodeId }).eq('id', f.character_id);
        }
        if (followers.length > 0) addLog(`Your party follows you.`);
      }
    } catch {
      addLog('Failed to move.');
    }
  }, [character, getNode, getRegion, updateCharacter, addLog, party, isLeader, partyMembers, creatures, effectiveAC, degradeEquipment]);

  const handleSearch = useCallback(async () => {
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
  }, [currentNode, character.id, addLog, fetchInventory]);

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
    const creature = creatures.find(c => c.id === creatureId);
    if (!creature) return;

    const strBonus = equipmentBonuses.str || 0;
    const atkRoll = rollD20();
    const strMod = getStatModifier(character.str + strBonus);
    const totalAtk = atkRoll + strMod;

    if (atkRoll === 20 || (atkRoll !== 1 && totalAtk >= creature.ac)) {
      const dmg = rollDamage(1, 8) + strMod;
      const isCrit = atkRoll === 20;
      const finalDmg = isCrit ? dmg * 2 : Math.max(dmg, 1);
      const newHp = Math.max(creature.hp - finalDmg, 0);

      addLog(
        `${isCrit ? '⚔️ CRITICAL! ' : ''}You rolled ${atkRoll} + ${strMod} STR = ${totalAtk} vs AC ${creature.ac} — Hit! ${finalDmg} damage to ${creature.name}.`
      );

      if (newHp <= 0) {
        // Creature dies — award XP, gold, and roll loot
        const goldDrop = Math.floor(creature.level * (creature.rarity === 'boss' ? 25 : creature.rarity === 'rare' ? 15 : 5) * (0.8 + Math.random() * 0.4));
        addLog(`☠️ ${creature.name} has been slain! (+${creature.level * 10} XP, +${goldDrop} gold)`);
        await supabase.from('creatures').update({ hp: 0, is_alive: false, died_at: new Date().toISOString() }).eq('id', creatureId);
        
        const newXp = character.xp + creature.level * 10;
        const newGold = character.gold + goldDrop;
        const xpForNext = character.level * 100;
        if (newXp >= xpForNext) {
          const newLevel = character.level + 1;
          addLog(`🎉 Level Up! You are now level ${newLevel}!`);
          await updateCharacter({ xp: newXp - xpForNext, level: newLevel, max_hp: character.max_hp + 5, hp: character.max_hp + 5, gold: newGold });
        } else {
          await updateCharacter({ xp: newXp, gold: newGold });
        }
        
        // Roll loot
        await rollLoot(creature.loot_table as any[], creature.name);
      } else {
        await supabase.from('creatures').update({ hp: newHp }).eq('id', creatureId);
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
            await supabase.from('characters').update({ hp: tankNewHp }).eq('id', tankMember.character_id);
          } else {
            addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
          }
        } else {
          if (creatureAtk >= effectiveAC) {
            const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
            const playerNewHp = Math.max(character.hp - creatureDmg, 0);
            addLog(`${creature.name} strikes back! Rolled ${creatureAtk} vs AC ${effectiveAC} — Hit! ${creatureDmg} damage.`);
            await updateCharacter({ hp: playerNewHp });
            await degradeEquipment();
            if (playerNewHp <= 0) {
              addLog('💀 You have been defeated...');
            }
          } else {
            addLog(`${creature.name} attacks — misses!`);
          }
        }
      }
    } else {
      addLog(`You rolled ${atkRoll} + ${strMod} STR = ${totalAtk} vs AC ${creature.ac} — Miss!`);
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
          await supabase.from('characters').update({ hp: tankNewHp }).eq('id', tankMember.character_id);
        } else {
          addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
        }
      } else {
        if (creatureAtk >= effectiveAC) {
          const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          const playerNewHp = Math.max(character.hp - creatureDmg, 0);
          addLog(`${creature.name} retaliates! ${creatureDmg} damage.`);
          await updateCharacter({ hp: playerNewHp });
          await degradeEquipment();
        }
      }
    }
  }, [character, creatures, addLog, updateCharacter, equipmentBonuses, effectiveAC, rollLoot, degradeEquipment, party, partyMembers]);

  const handleUseConsumable = useCallback(async (inventoryId: string) => {
    const result = await useConsumable(inventoryId, character.id, character.hp, character.max_hp, updateCharacter);
    if (result) {
      addLog(`🧪 You used ${result.itemName} and restored ${result.restored} HP.`);
      // Apply regen buff: 3x regen for 2 minutes
      setRegenBuff({ multiplier: 3, expiresAt: Date.now() + 120000 });
      addLog(`✨ HP regeneration boosted for 2 minutes!`);
    }
  }, [useConsumable, character.id, character.hp, character.max_hp, updateCharacter, addLog]);

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
            <div className="h-full ornate-border bg-card/60">
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
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Event Log - Bottom Bar */}
      <div className="border-t border-border bg-card/70 px-4 py-2">
        <h3 className="font-display text-xs text-muted-foreground mb-1">Event Log</h3>
        <div className="h-28 overflow-y-auto p-2 bg-background/30 rounded border border-border space-y-0.5">
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
    </div>
  );
}
