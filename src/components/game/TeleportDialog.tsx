import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { GameNode, Region } from '@/hooks/useNodes';

interface TeleportDestination {
  node: GameNode;
  region: Region;
  cost: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentNode: GameNode;
  currentRegion: Region | undefined;
  regions: Region[];
  nodes: GameNode[];
  playerGold: number;
  onTeleport: (nodeId: string, cost: number) => void;
}

function calculateTeleportCost(fromRegion: Region | undefined, toRegion: Region, toNode: GameNode): number {
  if (!fromRegion) return 50;
  if (fromRegion.id === toRegion.id) return 25;
  // Cost scales with level difference between regions
  const levelDiff = Math.abs(toRegion.min_level - fromRegion.min_level);
  return Math.max(25, 25 + levelDiff * 10);
}

export default function TeleportDialog({ open, onClose, currentNode, currentRegion, regions, nodes, playerGold, onTeleport }: Props) {
  const destinations: TeleportDestination[] = nodes
    .filter(n => n.is_teleport && n.id !== currentNode.id)
    .map(n => {
      const region = regions.find(r => r.id === n.region_id);
      return region ? { node: n, region, cost: calculateTeleportCost(currentRegion, region, n) } : null;
    })
    .filter(Boolean) as TeleportDestination[];

  // Sort by region level then node name
  destinations.sort((a, b) => a.region.min_level - b.region.min_level || a.node.name.localeCompare(b.node.name));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow">🌀 Teleport</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Travel instantly to another teleport point. Your gold: <span className="text-primary font-display">{playerGold}</span>
        </p>
        <ScrollArea className="max-h-64">
          <div className="space-y-1.5 pr-2">
            {destinations.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-4 text-center">No teleport destinations available.</p>
            )}
            {destinations.map(d => {
              const canAfford = playerGold >= d.cost;
              return (
                <div key={d.node.id} className="flex items-center justify-between p-2 rounded border border-border bg-background/40 hover:bg-background/60 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm text-foreground truncate">{d.node.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {d.region.name} — Lv {d.region.min_level}–{d.region.max_level}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canAfford}
                    onClick={() => onTeleport(d.node.id, d.cost)}
                    className={`font-display text-[10px] h-6 px-2 ml-2 shrink-0 ${canAfford ? 'text-primary border-primary/50' : 'text-muted-foreground'}`}
                  >
                    🪙 {d.cost}g
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
