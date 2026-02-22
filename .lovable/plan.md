
# Admin World Map: Region Outlines and Connection-Based Layout

## What Changes

### 1. Region shapes become convex hull outlines instead of circles
Currently each region is drawn as a circular bubble. Instead, the region boundary will be computed as a **convex hull** (tight polygon outline) around all the nodes belonging to that region, with padding. This gives each region an organic shape that matches its actual node spread.

### 2. Region positioning becomes connection-driven
Currently regions are placed using their `direction` field (N, S, E, NE, etc.) relative to The Hearthlands. Instead, regions will be positioned based on **which nodes connect them to other regions**. The layout algorithm will:
- Place The Hearthlands at the center
- Find cross-region edges (nodes in one region connected to nodes in another)
- Position connected regions so that the "gateway" nodes between them are close together
- Use a force-directed or BFS-based approach radiating outward from Hearthlands

### 3. Region `direction` field no longer used for map layout
The `direction` column on the `regions` table stays (no schema change needed), but the map view will ignore it. The sidebar will also stop showing the direction badge.

---

## Technical Approach

### File: `src/components/admin/AdminWorldMapView.tsx`

**Layout algorithm rewrite** (the large `useMemo` block, lines 205-379):

1. **Build a region adjacency graph** from cross-region node connections. Each edge records which nodes serve as "gateways."

2. **BFS from Hearthlands** to assign region positions:
   - Start with Hearthlands at origin
   - For each neighboring region, compute a direction vector from the average position of the gateway nodes in the current region toward their connected nodes
   - Place the neighbor region offset in that direction, at a distance based on both regions' sizes

3. **Layout nodes within each region** using the existing `layoutNodes()` BFS (unchanged).

4. **Compute convex hull** for each region's node positions (with ~60px padding) to get an irregular polygon outline.

5. **Render `<polygon>` or `<path>`** instead of `<circle>` for each region bubble.

**Convex hull helper**: Add a small function implementing the Graham scan or gift-wrapping algorithm to compute the hull from a set of 2D points. The hull points will be expanded outward by the padding amount.

**Rendering changes**:
- Replace `<circle cx={b.cx} cy={b.cy} r={b.radius} .../>` with `<path d={hullPath} .../>` using the computed convex hull polygon
- Region labels positioned at the centroid of the hull (or top of bounding box)
- The `zoomToRegion` function updated to use the hull's bounding box instead of radius

**Sidebar**: Remove the direction badge display (line 470-472).

### No database or schema changes needed
The `direction` and `sort_order` columns remain on the `regions` table -- they just won't drive the map layout anymore.

### No changes to other files
The player map view, RegionGraphView, RegionManager, and other components remain unchanged.
