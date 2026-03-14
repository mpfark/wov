import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GameNode, Region, Area, getNodeDisplayName } from '@/hooks/useNodes';
import { PartyMember } from '@/hooks/useParty';
import { supabase } from '@/integrations/supabase/client';

interface TeleportDestination {
  node: GameNode;
  region: Region;
  cpCost: number;
}

interface PartyMemberDestination {
  member: PartyMember;
  node: GameNode;
  region: Region;
  cpCost: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentNode: GameNode;
  currentRegion: Region | undefined;
  regions: Region[];
  nodes: GameNode[];
  areas?: Area[];
  playerCp: number;
  playerMaxCp: number;
  characterLevel: number;
  characterId?: string;
  onTeleport: (nodeId: string, cpCost: number) => void;
  waymark?: { node: GameNode; region: Region | undefined } | null;
  onReturnToWaymark?: (cpCost: number) => void;
  partyMembers?: PartyMember[];
  myCharacterId?: string;
}

function calculateTeleportCpCost(fromRegion: Region | undefined, toRegion: Region): number {
  if (!fromRegion) return 15;
  if (fromRegion.id === toRegion.id) return 10;
  const levelDiff = Math.abs(toRegion.min_level - fromRegion.min_level);
  return Math.min(10 + levelDiff * 2, 30);
}

export default function TeleportDialog({ open, onClose, currentNode, currentRegion, regions, nodes, areas = [], playerCp, playerMaxCp, characterLevel, characterId, onTeleport, waymark, onReturnToWaymark, partyMembers = [], myCharacterId }: Props) {
  // Fetch visited node IDs to filter teleport destinations
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !characterId) return;
    supabase.from('character_visited_nodes').select('node_id').eq('character_id', characterId)
      .then(({ data }) => {
        if (data) setVisitedIds(new Set(data.map(r => r.node_id)));
      });
  }, [open, characterId]);

  const destinations: TeleportDestination[] = nodes
    .filter(n => n.is_teleport && n.id !== currentNode.id && visitedIds.has(n.id))
    .map(n => {
      const region = regions.find(r => r.id === n.region_id);
      return region ? { node: n, region, cpCost: calculateTeleportCpCost(currentRegion, region) } : null;
    })
    .filter(Boolean) as TeleportDestination[];

  destinations.sort((a, b) => a.region.min_level - b.region.min_level || getNodeDisplayName(a.node, areas.find(ar => ar.id === a.node.area_id)).localeCompare(getNodeDisplayName(b.node, areas.find(ar => ar.id === b.node.area_id))));

  const waymarkCpCost = waymark?.region ? calculateTeleportCpCost(currentRegion, waymark.region) : 15;
  const canAffordWaymark = playerCp >= waymarkCpCost;

  // Party member destinations — members at different nodes
  const partyDestinations: PartyMemberDestination[] = partyMembers
    .filter(m => m.character_id !== myCharacterId && m.character?.current_node_id && m.character.current_node_id !== currentNode.id)
    .map(m => {
      const node = nodes.find(n => n.id === m.character.current_node_id);
      if (!node) return null;
      const region = regions.find(r => r.id === node.region_id);
      if (!region) return null;
      return { member: m, node, region, cpCost: calculateTeleportCpCost(currentRegion, region) };
    })
    .filter(Boolean) as PartyMemberDestination[];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow">🌀 Teleport</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {characterLevel >= 25 && !currentNode.is_teleport && (
            <span className="text-primary font-display">⚡ Arcane Recall active — </span>
          )}
          Travel instantly to another teleport point. Your CP: <span className="text-primary font-display">{playerCp}/{playerMaxCp}</span>
        </p>
        <ScrollArea className="max-h-64">
          <div className="space-y-1.5 pr-2">
            {/* Waymark Return Option */}
            {waymark && onReturnToWaymark && (
              <div className="flex items-center justify-between p-2 rounded border-2 border-primary/60 bg-primary/10 hover:bg-primary/20 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm text-primary truncate">📍 Return to Waymark</p>
                  <p className="text-[10px] text-primary/80 truncate">
                    {waymark.node.name}
                    {waymark.region && <span> — {waymark.region.name}</span>}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canAffordWaymark}
                  onClick={() => onReturnToWaymark(waymarkCpCost)}
                  className={`font-display text-[10px] h-6 px-2 ml-2 shrink-0 ${canAffordWaymark ? 'text-primary border-primary/50' : 'text-muted-foreground'}`}
                >
                  ⚡ {waymarkCpCost} CP
                </Button>
              </div>
            )}

            {/* Party Member Destinations */}
            {partyDestinations.length > 0 && (
              <>
                <p className="text-[10px] text-muted-foreground font-display pt-1">👥 Party Members</p>
                {partyDestinations.map(d => {
                  const canAfford = playerCp >= d.cpCost;
                  return (
                    <div key={d.member.id} className="flex items-center justify-between p-2 rounded border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-sm text-primary truncate">
                          {d.member.character.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {getNodeDisplayName(d.node, areas.find(a => a.id === d.node.area_id))} — {d.region.name}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canAfford}
                        onClick={() => onTeleport(d.node.id, d.cpCost)}
                        className={`font-display text-[10px] h-6 px-2 ml-2 shrink-0 ${canAfford ? 'text-primary border-primary/50' : 'text-muted-foreground'}`}
                      >
                        ⚡ {d.cpCost} CP
                      </Button>
                    </div>
                  );
                })}
              </>
            )}

            {/* Regular teleport destinations */}
            {destinations.length === 0 && !waymark && partyDestinations.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-4 text-center">No teleport destinations available.</p>
            )}
            {destinations.map(d => {
              const canAfford = playerCp >= d.cpCost;
              return (
                <div key={d.node.id} className="flex items-center justify-between p-2 rounded border border-border bg-background/40 hover:bg-background/60 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm text-foreground truncate">{getNodeDisplayName(d.node, areas.find(a => a.id === d.node.area_id))}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {d.region.name} — Lv {d.region.min_level}–{d.region.max_level}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canAfford}
                    onClick={() => onTeleport(d.node.id, d.cpCost)}
                    className={`font-display text-[10px] h-6 px-2 ml-2 shrink-0 ${canAfford ? 'text-primary border-primary/50' : 'text-muted-foreground'}`}
                  >
                    ⚡ {d.cpCost} CP
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
