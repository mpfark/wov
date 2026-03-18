

## Add x/y Coordinates to Nodes

### What and Why

Store `x` and `y` integer grid coordinates on each node so that all map views render from stored positions instead of computing them via BFS. This also enables the AI world builder to place nodes spatially when generating content. Hearthvale Square becomes the world origin at (0, 0).

### Database Migration

Add two columns to the `nodes` table:
```sql
ALTER TABLE public.nodes ADD COLUMN x integer NOT NULL DEFAULT 0;
ALTER TABLE public.nodes ADD COLUMN y integer NOT NULL DEFAULT 0;
```

Then backfill existing nodes by running a BFS from Hearthvale Square (id `b0000000-0000-4000-8000-000000000001`) using the same direction-offset logic currently used at render time. This will be a one-time data update executed via the insert tool after the schema migration.

### Code Changes

**1. `src/hooks/useNodes.ts`** — Add `x` and `y` to `GameNode` interface.

**2. `src/components/admin/AdminWorldMapView.tsx`** — Replace `layoutNodes()` BFS function (~60 lines) with a simple read of `node.x` / `node.y`. Convert grid coords to pixels: `px = x * SPACING + offset`. Keep collision-free since coords are now authoritative.

**3. `src/components/admin/RegionGraphView.tsx`** — Same: remove `layoutNodes()`, read stored `x/y` from nodes (needs to accept them in the GraphNode interface).

**4. `src/components/admin/PopulateNodeSelector.tsx`** — Same: remove `layoutNodes()`, read stored `x/y`.

**5. `src/components/game/PlayerWorldMapDialog.tsx`** — Same: remove `layoutNodes()`, read stored `x/y` for world map positioning.

**6. `src/components/game/PlayerGraphView.tsx`** — Replace `layoutFromCenter()` with stored coords. The local view already only shows the current node + neighbors, so just use their `x/y` translated relative to current node (centering current node at 0,0 in the SVG).

**7. `src/components/admin/NodeEditorPanel.tsx`** — When creating a node adjacent to another, auto-calculate `x/y` from parent node's coords + direction offset. Include `x` and `y` in the insert call.

**8. `src/components/admin/NodeEditorDialog.tsx`** — Same: include `x/y` on insert.

**9. `src/components/admin/RegionManager.tsx`** — When creating the entrance node for a new region, set `x/y` (can default to 0,0 or calculate from context).

**10. `src/components/admin/WorldBuilderPanel.tsx`** — Pass `x/y` from generated nodes into the insert call. Update `GeneratedNode` interface to include `x` and `y`.

**11. `src/components/admin/WorldBuilderPreviewGraph.tsx`** — Read `x/y` from generated nodes for preview layout.

**12. `supabase/functions/ai-world-builder/index.ts`** — Add `x` and `y` integer properties to the node schema in the `generate_world` tool definition. Add instructions to the system prompt telling the AI to place nodes on a grid using compass offsets from connected nodes, with context about existing node positions.

### Backfill Strategy

After migration, run a server-side BFS from Hearthvale Square through all connections, assigning coordinates using `DIRECTION_OFFSETS`. Disconnected clusters get offset positions. This is a one-time UPDATE via the insert tool — approximately 149 rows.

### Summary of Removed Code
- ~60 lines from `AdminWorldMapView.tsx` (`layoutNodes` function)
- ~40 lines from `RegionGraphView.tsx` (`layoutNodes` function)
- ~40 lines from `PopulateNodeSelector.tsx` (`layoutNodes` function)
- ~60 lines from `PlayerWorldMapDialog.tsx` (`layoutNodes` function)
- ~25 lines from `PlayerGraphView.tsx` (`layoutFromCenter` function)
- ~60 lines from `WorldBuilderPreviewGraph.tsx` (`layoutPreviewNodes` function)

Total: ~285 lines of duplicated BFS layout code removed, replaced by simple coordinate reads.

