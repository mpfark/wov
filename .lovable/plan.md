

## Admin World Map -- All Regions with Grouped Nodes

Replace the current single-region graph view in the **Admin World tab** with a full world map that shows **all regions at once**, each as a labeled bubble containing its nodes. The player-side map remains unchanged.

### What Changes

**Current behavior**: The admin World tab has a region dropdown, and shows only the nodes for the selected region.

**New behavior**: The World tab shows a single SVG map with all regions visible. Each region is a large circle containing its nodes. Cross-region connections (like Woody End to The Bree Gate) are visible as lines between region bubbles. Clicking a node still opens the node editor. The region dropdown is replaced with an "All Regions" overview, though clicking a region bubble or node still lets you edit it.

### Visual Layout

- Regions arranged left-to-right sorted by `min_level`
- Each region rendered as a large translucent circle with its name and level range as a label
- Nodes laid out inside their region circle using the existing direction-based BFS layout, but scaled down
- Intra-region edges drawn as dashed lines inside the bubble
- Cross-region edges drawn as longer dashed lines between bubbles
- Admin "+" buttons preserved on edges and node hover for adding nodes
- Current admin interactions (click node to edit, add node adjacent/between) all still work

### Files

**New: `src/components/admin/AdminWorldMapView.tsx`**
- Accepts `regions`, `nodes` (all nodes), `onNodeClick`, `onAddNodeBetween`, `onAddNodeAdjacent`
- Groups nodes by `region_id`
- Positions region bubbles in a row/grid sorted by `min_level`, with vertical stagger to avoid overlap
- Each bubble radius scales with node count: `Math.max(100, sqrt(nodeCount) * 60)`
- Inside each bubble, runs the existing BFS direction layout but with tighter spacing (~80px) and smaller node circles (r=20)
- Draws intra-region edges inside each bubble
- Detects cross-region connections (where a node's connection points to a node in a different region) and draws them as lines between the two bubbles
- Region label (name + level range) rendered above each bubble
- Preserves hover-to-add-node and midpoint "+" buttons from current `RegionGraphView`

**Modified: `src/pages/AdminPage.tsx`**
- Remove the region `Select` dropdown and per-region filtering from the World tab
- Replace `RegionGraphView` with `AdminWorldMapView`, passing all `regions` and all `nodes`
- Keep `selectedRegion` state but set it when a node is clicked (derived from the clicked node's `region_id`) so the `NodeEditorDialog` still gets the correct `regionId`
- Keep `RegionManager` button for creating/deleting regions
- Pass `allNodes` filtered by region to `NodeEditorDialog` (use the clicked node's region)

### Technical Details

- Region bubble positions: sort regions by `min_level`, place them in a row with ~300px horizontal spacing and alternating Y offset (+/- 40px) for visual interest
- Node layout inside bubble: reuse the same `layoutNodes` BFS function from `RegionGraphView`, then offset all positions relative to the bubble center
- Cross-region edge detection: for each node, check if any `connection.node_id` belongs to a node with a different `region_id`; draw a line from the source node position to the target node position across bubbles
- SVG viewBox computed dynamically to fit all bubbles
- Scrollable container with pan support via overflow-auto

