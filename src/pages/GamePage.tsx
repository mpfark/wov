import { useState, useCallback, useEffect, useRef } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CharacterPanel from '@/components/game/CharacterPanel';
import NodeView from '@/components/game/NodeView';
import MapPanel from '@/components/game/MapPanel';
import { Character } from '@/hooks/useCharacter';
import { useNodes } from '@/hooks/useNodes';
import { usePresence } from '@/hooks/usePresence';
import { useCreatures } from '@/hooks/useCreatures';
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
  const [eventLog, setEventLog] = useState<string[]>(['Welcome to Middle-earth!']);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setEventLog(prev => [...prev.slice(-49), msg]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLog]);

  const currentNode = character.current_node_id ? getNode(character.current_node_id) : null;
  const currentRegion = currentNode ? getRegion(currentNode.region_id) : null;

  const handleMove = useCallback(async (nodeId: string) => {
    const targetNode = getNode(nodeId);
    if (!targetNode) return;
    const targetRegion = getRegion(targetNode.region_id);
    if (targetRegion && character.level < targetRegion.min_level) {
      addLog(`You are not strong enough to enter ${targetRegion.name} (requires Lvl ${targetRegion.min_level}).`);
      toast.error(`Level ${targetRegion.min_level} required`);
      return;
    }
    try {
      await updateCharacter({ current_node_id: nodeId });
      addLog(`You travel to ${targetNode.name}.`);
    } catch {
      addLog('Failed to move.');
    }
  }, [character, getNode, getRegion, updateCharacter, addLog]);

  const handleSearch = useCallback(() => {
    const roll = rollD20();
    if (roll >= 15) {
      addLog(`Search roll: ${roll} — You found something interesting! (Items coming soon)`);
    } else {
      addLog(`Search roll: ${roll} — You find nothing of note.`);
    }
  }, [addLog]);

  const handleAttack = useCallback(async (creatureId: string) => {
    const creature = creatures.find(c => c.id === creatureId);
    if (!creature) return;

    const atkRoll = rollD20();
    const strMod = getStatModifier(character.str);
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
        addLog(`☠️ ${creature.name} has been slain! (+${creature.level * 10} XP)`);
        await supabase.from('creatures').update({ hp: 0, is_alive: false, died_at: new Date().toISOString() }).eq('id', creatureId);
        const newXp = character.xp + creature.level * 10;
        const xpForNext = character.level * 100;
        if (newXp >= xpForNext) {
          const newLevel = character.level + 1;
          addLog(`🎉 Level Up! You are now level ${newLevel}!`);
          await updateCharacter({ xp: newXp - xpForNext, level: newLevel, max_hp: character.max_hp + 5, hp: character.max_hp + 5 });
        } else {
          await updateCharacter({ xp: newXp });
        }
      } else {
        await supabase.from('creatures').update({ hp: newHp }).eq('id', creatureId);
        // Creature counterattack
        const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);
        if (creatureAtk >= character.ac) {
          const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          const playerNewHp = Math.max(character.hp - creatureDmg, 0);
          addLog(`${creature.name} strikes back! Rolled ${creatureAtk} vs AC ${character.ac} — Hit! ${creatureDmg} damage.`);
          await updateCharacter({ hp: playerNewHp });
          if (playerNewHp <= 0) {
            addLog('💀 You have been defeated...');
          }
        } else {
          addLog(`${creature.name} attacks — misses!`);
        }
      }
    } else {
      addLog(`You rolled ${atkRoll} + ${strMod} STR = ${totalAtk} vs AC ${creature.ac} — Miss!`);
      // Creature still attacks
      const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);
      if (creatureAtk >= character.ac) {
        const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
        const playerNewHp = Math.max(character.hp - creatureDmg, 0);
        addLog(`${creature.name} retaliates! ${creatureDmg} damage.`);
        await updateCharacter({ hp: playerNewHp });
      }
    }
  }, [character, creatures, addLog, updateCharacter]);

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
        <h1 className="font-display text-sm text-primary text-glow">Middle-earth</h1>
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
              <CharacterPanel character={character} />
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
                onMove={handleMove}
                onSearch={handleSearch}
                onAttack={handleAttack}
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
    </div>
  );
}
