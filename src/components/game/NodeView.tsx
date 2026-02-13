import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { GameNode, Region } from '@/hooks/useNodes';
import { PlayerPresence } from '@/hooks/usePresence';
import { Creature } from '@/hooks/useCreatures';
import { Character } from '@/hooks/useCharacter';
import { RACE_LABELS, CLASS_LABELS } from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';

interface Props {
  node: GameNode;
  region: Region | undefined;
  players: PlayerPresence[];
  creatures: Creature[];
  character: Character;
  eventLog: string[];
  onSearch: () => void;
  onAttack: (creatureId: string) => void;
  onOpenVendor?: () => void;
}

export default function NodeView({
  node, region, players, creatures, character, eventLog, onSearch, onAttack, onOpenVendor,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);

  return (
    <div className="h-full flex flex-col p-3">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {/* Location Header */}
        <div className="text-center border-b border-border pb-2">
          <h2 className="font-display text-xl text-primary text-glow">{node.name}</h2>
          {region && (
            <p className="text-xs text-muted-foreground">
              {region.name} — Levels {region.min_level}–{region.max_level}
            </p>
          )}
          {node.is_inn && (
            <p className="text-xs text-elvish mt-0.5">🏨 Inn — Resting here boosts HP regeneration</p>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-foreground/90 leading-relaxed italic">
          {node.description || 'A quiet corner of the world...'}
        </p>

      </div>

      {/* In the Area - pinned above actions */}
      {(creatures.length > 0 || otherPlayers.length > 0) && (
        <div className="pt-2">
          <h3 className="font-display text-xs text-muted-foreground mb-1">In the Area</h3>
          <div className="space-y-1">
            {creatures.map(c => (
              <div key={c.id} className="p-2 bg-background/50 rounded border border-border space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-display ${
                      c.rarity === 'boss' ? 'text-primary text-glow' :
                      c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'
                    }`}>{c.name}</span>
                    {c.is_aggressive && <span className="text-[10px] text-destructive ml-1" title="Aggressive">⚠️</span>}
                    <span className="text-xs text-muted-foreground ml-2">Lvl {c.level}</span>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => onAttack(c.id)} className="font-display text-xs h-7">
                    {CLASS_COMBAT[character.class]?.label || 'Attack'}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-background rounded-full overflow-hidden border border-border">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max((c.hp / c.max_hp) * 100, 0)}%`,
                        backgroundColor: c.hp / c.max_hp > 0.5 ? 'hsl(var(--chart-2))' : c.hp / c.max_hp > 0.25 ? 'hsl(var(--chart-4))' : 'hsl(var(--destructive))',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{c.hp}/{c.max_hp}</span>
                </div>
              </div>
            ))}
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

      {/* Action Buttons - pinned to bottom */}
      <div className="pt-3 border-t border-border mt-3">
        <h3 className="font-display text-xs text-muted-foreground mb-1">Actions</h3>
        <Button variant="secondary" size="sm" onClick={onSearch} className="w-full font-display text-xs">
          Search Area
        </Button>
        {onOpenVendor && (
          <Button variant="outline" size="sm" onClick={onOpenVendor} className="w-full mt-1.5 font-display text-xs text-primary">
            🛒 Open Shop
          </Button>
        )}
      </div>
    </div>
  );
}
