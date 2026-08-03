/**
 * MapItemDialog — popup for viewing a treasure-map quest item.
 *
 * Shows the item's flavor line, the X-marked region mini-map, and the target
 * region/area name. Read-only; the item is auto-consumed server-side when the
 * player arrives at the target node.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import RegionMiniMap from '@/features/world/components/RegionMiniMap';
import type { InventoryItem } from '@/features/inventory/hooks/useInventory';
import type { GameNode, Area, Region } from '@/features/world/hooks/useNodes';

interface Props {
  open: boolean;
  inv: InventoryItem | null;
  onClose: () => void;
  nodes: GameNode[];
  areas: Area[];
  regions: Region[];
  visitedNodeIds?: Set<string>;
  currentNodeId?: string | null;
}

export default function MapItemDialog({
  open, inv, onClose, nodes, areas, regions, visitedNodeIds, currentNodeId,
}: Props) {
  if (!inv) return null;
  const targetNodeId = (inv.item as any).map_target_node_id as string | null;
  const regionId = (inv.item as any).map_region_id as string | null;
  const flavor = (inv.item as any).map_flavor as string | null;

  const targetNode = targetNodeId ? nodes.find(n => n.id === targetNodeId) : null;
  const effectiveRegionId = regionId || targetNode?.region_id || '';
  const region = regions.find(r => r.id === effectiveRegionId);
  const area = targetNode?.area_id ? areas.find(a => a.id === targetNode.area_id) : null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg border-primary/30 bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow text-center tracking-wide">
{inv.item.name}
          </DialogTitle>
          {region && (
            <DialogDescription className="text-xs italic text-center">
              {region.name}{area ? ` — ${area.name}` : ''}
            </DialogDescription>
          )}
        </DialogHeader>

        {flavor && (
          <div className="px-4 py-3 bg-background/40 rounded border border-border/60 text-xs italic text-foreground/85 font-display whitespace-pre-wrap">
            {flavor}
          </div>
        )}

        <div className="rounded border border-border/60 bg-background/30 overflow-hidden">
          {effectiveRegionId && targetNodeId ? (
            <RegionMiniMap
              regionId={effectiveRegionId}
              highlightNodeId={targetNodeId}
              nodes={nodes}
              areas={areas}
              visitedNodeIds={visitedNodeIds}
              currentNodeId={currentNodeId}
            />
          ) : (
            <p className="p-4 text-xs italic text-muted-foreground text-center">
              This parchment is blank — no destination has been marked.
            </p>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground text-center italic">
          The map will crumble to dust once you stand upon the X.
        </p>
      </DialogContent>
    </Dialog>
  );
}
