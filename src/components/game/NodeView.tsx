import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { GameNode, Region } from '@/hooks/useNodes';
import { PlayerPresence } from '@/hooks/usePresence';
import { Creature } from '@/hooks/useCreatures';
import { Character } from '@/hooks/useCharacter';
import { RACE_LABELS, CLASS_LABELS } from '@/lib/game-data';

interface Props {
  node: GameNode;
  region: Region | undefined;
  players: PlayerPresence[];
  creatures: Creature[];
  character: Character;
  eventLog: string[];
  onMove: (nodeId: string) => void;
  onSearch: () => void;
  onAttack: (creatureId: string) => void;
}

export default function NodeView({
  node, region, players, creatures, character, eventLog, onMove, onSearch, onAttack,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);

  return (
    <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
      {/* Location Header */}
      <div className="text-center border-b border-border pb-2">
        <h2 className="font-display text-xl text-primary text-glow">{node.name}</h2>
        {region && (
          <p className="text-xs text-muted-foreground">
            {region.name} — Levels {region.min_level}–{region.max_level}
          </p>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-foreground/90 leading-relaxed italic">
        {node.description || 'A quiet place in Middle-earth...'}
      </p>

      {/* Creatures */}
      {creatures.length > 0 && (
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1">Creatures</h3>
          <div className="space-y-1">
            {creatures.map(c => (
              <div key={c.id} className="flex items-center justify-between p-2 bg-background/50 rounded border border-border">
                <div>
                  <span className={`text-sm font-display ${
                    c.rarity === 'boss' ? 'text-primary text-glow' :
                    c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'
                  }`}>{c.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">Lvl {c.level}</span>
                </div>
                <Button size="sm" variant="destructive" onClick={() => onAttack(c.id)} className="font-display text-xs h-7">
                  Attack
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other Players */}
      {otherPlayers.length > 0 && (
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1">Adventurers Here</h3>
          <div className="space-y-1">
            {otherPlayers.map(p => (
              <div key={p.id} className="text-xs text-foreground/80 p-1.5 bg-background/30 rounded border border-border">
                <span className="text-elvish">{p.name}</span>
                <span className="text-muted-foreground ml-1">
                  — {RACE_LABELS[p.race]} {CLASS_LABELS[p.class]} Lvl {p.level}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1">Travel</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {(node.connections as any[]).map((conn: any) => (
            <Button
              key={conn.node_id}
              variant="outline"
              size="sm"
              onClick={() => onMove(conn.node_id)}
              className="font-display text-xs"
            >
              {conn.direction}: {conn.label || 'Path'}
            </Button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={onSearch} className="w-full mt-1.5 font-display text-xs">
          Search Area
        </Button>
      </div>

    </div>
  );
}
