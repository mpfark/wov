

# Concave Region Borders (Tight Node-Wrapping Outlines)

## Problem
The current convex hull algorithm always creates outward-bulging polygons. Your reference image shows borders that wrap **tightly around each node**, following concavities and indentations in the node layout -- like shrink-wrap around the actual node positions.

## Solution: Union-of-Circles Approach

Instead of computing a convex hull, we treat each node as a circle (node radius + small padding, ~20px total) and compute the **union boundary** of all these circles for a region. This produces exactly the shape in your reference image: a smooth outline that hugs each node with a consistent small gap, wrapping into concavities.

### Algorithm
1. For each node in a region, define a circle at its position with radius `NODE_RADIUS + BORDER_PAD` (~20px)
2. Sample the boundary of each circle at fine intervals (e.g., every 5 degrees)
3. Keep only boundary points that are **outside all other circles** in the region (these are the exposed arc segments)
4. Connect adjacent exposed arcs to form the full outline path
5. Render as an SVG `<path>` with arc commands (`A`) for the curved sections and straight lines between circles

For single nodes, this simply draws a circle. For clusters, it creates the "cookie cutter" shape from your image.

### Simpler Fallback: Metaball / Marching Squares
If the arc-union math proves too complex, a simpler alternative:
1. Create an offscreen grid covering the region's bounding box
2. For each grid cell, compute the sum of `1/distance` to each node (metaball field function)
3. Use a threshold to determine inside/outside
4. Extract the contour using marching squares
5. Smooth the resulting path

The arc-union approach is preferred as it gives cleaner SVG paths and is more performant.

---

## Technical Details

### File: `src/components/admin/AdminWorldMapView.tsx`

**New constants:**
- `BORDER_PAD = 20` -- offset from node edge to border (replaces `HULL_PAD = 35`)
- `NODE_DRAW_RADIUS` -- the visual node circle radius (already exists around line 560 as `r={14}`)

**Replace functions** (`convexHull`, `expandHull`, `hullToPath`):
- Remove `convexHull()` and `expandHull()`
- Replace with `computeRegionOutline(points, radius)` that computes the union-of-circles boundary
- Update `hullToPath` to generate SVG path with arc commands

**Update the `useMemo` block** (lines 386-405):
- Instead of `convexHull` then `expandHull`, call `computeRegionOutline(hullPoints, NODE_DRAW_RADIUS + BORDER_PAD)`
- The returned path and bbox are used the same way for rendering

**No changes to:**
- Global BFS layout algorithm (stays the same)
- Node rendering, edge rendering, sidebar, interactions
- Any other files

### Union-of-Circles Algorithm Detail

```text
For each region:
  1. circles = [{cx, cy, r=20} for each node]
  2. For each circle i:
     - Find intersection points with all other circles j
     - Find arc segments of circle i that lie outside all other circles
  3. Chain the exposed arcs in order around the boundary
  4. Output SVG path: arcs (A commands) for curved parts
```

For regions with nodes that are far apart (not overlapping circles), each node gets its own independent outline -- which may need connecting via the edges between them, or we increase the radius to ensure overlap. Given nodes are spaced at `MIN_NODE_GAP = 90px`, a radius of ~48px would ensure adjacent nodes' circles overlap (90/2 + small margin). We can tune this value.

