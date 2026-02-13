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
import { useCombat } from '@/hooks/useCombat';
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
  const isDeadRef = useRef(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
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

  // Regen tick visual indicator
  const [regenTick, setRegenTick] = useState(false);

  // Refs for regen to avoid stale closures resetting the timer
  const regenCharRef = useRef({ hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id });
  const regenBuffRef = useRef(regenBuff);
  const getNodeRef = useRef(getNode);
  const updateCharRegenRef = useRef(updateCharacter);
  useEffect(() => { regenCharRef.current = { hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id }; }, [character.hp, character.max_hp, character.current_node_id]);
  useEffect(() => { regenBuffRef.current = regenBuff; }, [regenBuff]);
  useEffect(() => { getNodeRef.current = getNode; }, [getNode]);
  useEffect(() => { updateCharRegenRef.current = updateCharacter; }, [updateCharacter]);

  // Passive HP regeneration — 1 HP every 30s, multiplied by regen buff and inn bonus
  useEffect(() => {
    const interval = setInterval(() => {
      const { hp, max_hp, current_node_id } = regenCharRef.current;
      if (hp < max_hp && hp > 0) {
        const buff = regenBuffRef.current;
        const potionMult = Date.now() < buff.expiresAt ? buff.multiplier : 1;
        const node = current_node_id ? getNodeRef.current(current_node_id) : null;
        const innMult = node?.is_inn ? 3 : 1;
        const totalMult = potionMult * innMult;
        const regenAmount = Math.max(Math.floor(1 * totalMult), 1);
        const newHp = Math.min(hp + regenAmount, max_hp);
        if (newHp !== hp) {
          updateCharRegenRef.current({ hp: newHp });
          setRegenTick(true);
          setTimeout(() => setRegenTick(false), 1200);
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []); // stable — no deps, reads from refs

  // Refs for death respawn to avoid stale closures / cleanup races
  const deathGoldRef = useRef(character.gold);
  const deathNodeRef = useRef(startingNodeId || character.current_node_id);
  const updateCharRef = useRef(updateCharacter);
  const addLogRef = useRef(addLog);
  useEffect(() => { deathGoldRef.current = character.gold; }, [character.gold]);
  useEffect(() => { deathNodeRef.current = startingNodeId || character.current_node_id; }, [startingNodeId, character.current_node_id]);
  useEffect(() => { updateCharRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

  // Death detection and respawn — only depends on hp
  useEffect(() => {
    if (character.hp > 0 || isDeadRef.current) return;
    isDeadRef.current = true;
    setIsDead(true);
    setDeathCountdown(3);
    const countdownInterval = setInterval(() => {
      setDeathCountdown(prev => Math.max(prev - 1, 0));
    }, 1000);
    const goldLost = Math.floor(deathGoldRef.current * 0.1);
    const respawnTimeout = setTimeout(async () => {
      await updateCharRef.current({
        hp: 1,
        gold: deathGoldRef.current - goldLost,
        current_node_id: deathNodeRef.current,
      });
      addLogRef.current(`💀 You have fallen! You lost ${goldLost} gold and awaken at the starting area with 1 HP.`);
      isDeadRef.current = false;
      setIsDead(false);
      clearInterval(countdownInterval);
    }, 3000);
    return () => { clearTimeout(respawnTimeout); clearInterval(countdownInterval); isDeadRef.current = false; };
  }, [character.hp]);

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

  // Track node entry to trigger aggressive creature auto-attacks only once per move
  const prevNodeRef = useRef<string | null>(null);
  const aggroProcessedRef = useRef<Set<string>>(new Set());
  const pendingAggroRef = useRef(false);

  // Flag that we moved to a new node — aggro should be checked once creatures load
  useEffect(() => {
    if (!character.current_node_id || character.hp <= 0) return;
    if (prevNodeRef.current === character.current_node_id) return;
    prevNodeRef.current = character.current_node_id;
    aggroProcessedRef.current = new Set();
    pendingAggroRef.current = true;
  }, [character.current_node_id, character.hp]);

  // Refs for forward-declared callbacks used by useCombat
  const rollLootRef = useRef<(lootTable: any[], creatureName: string) => Promise<void>>(async () => {});
  const degradeEquipmentRef = useRef<() => Promise<void>>(async () => {});

  // --- Auto-combat hook (must be before aggro effect) ---
  const { inCombat, activeCombatCreatureId, startCombat, stopCombat: stopCombatFn } = useCombat({
    character,
    creatures,
    updateCharacter,
    equipmentBonuses,
    effectiveAC,
    addLog,
    rollLoot: useCallback(async (lootTable: any[], creatureName: string) => {
      await rollLootRef.current(lootTable, creatureName);
    }, []),
    degradeEquipment: useCallback(async () => {
      await degradeEquipmentRef.current();
    }, []),
    party,
    partyMembers,
    isDead,
  });

  const handleAttack = useCallback((creatureId: string) => {
    if (isDead) return;
    startCombat(creatureId);
  }, [isDead, startCombat]);

  // Process aggressive creatures ONLY after a node change (pendingAggroRef) — now starts auto-combat
  useEffect(() => {
    if (!pendingAggroRef.current || !creatures.length || character.hp <= 0) return;
    pendingAggroRef.current = false;

    const aggressiveCreatures = creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;

    for (const c of aggressiveCreatures) {
      aggroProcessedRef.current.add(c.id);
    }

    const timeout = setTimeout(() => {
      if (character.hp <= 0) return;
      const firstAggro = aggressiveCreatures[0];
      if (firstAggro) {
        addLog(`⚠️ ${firstAggro.name} is aggressive and attacks you!`);
        startCombat(firstAggro.id);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [creatures, character.hp, addLog, startCombat]);

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
    const livingCreatures = creatures.filter(c => c.is_alive && c.hp > 0 && (c.is_aggressive || c.id === activeCombatCreatureId));
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
      if (entry.type === 'gold') continue; // Gold handled separately in kill rewards
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

  // Wire up refs for forward-declared callbacks
  useEffect(() => { rollLootRef.current = rollLoot; }, [rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = degradeEquipment; }, [degradeEquipment]);

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
                isAtInn={currentNode?.is_inn ?? false}
                regenBuff={regenBuff}
                regenTick={regenTick}
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
                  inCombat={inCombat}
                  activeCombatCreatureId={activeCombatCreatureId}
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
                character={character}
                party={party}
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
          <div className="text-center space-y-4">
            <p className="font-display text-5xl text-destructive animate-pulse">💀</p>
            <p className="font-display text-2xl text-destructive">You Have Fallen</p>
            <p className="font-display text-6xl text-destructive/80 tabular-nums">{deathCountdown}</p>
            <p className="text-sm text-muted-foreground">Respawning at the starting area...</p>
            <p className="text-xs text-muted-foreground">You lost {Math.floor(deathGoldRef.current * 0.1)} gold.</p>
          </div>
        </div>
      )}
    </div>
  );
}
