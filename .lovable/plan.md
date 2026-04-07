

# Open-Ended Area Outlines on the Player Map

## Problem
Area outlines currently close around only the visible nodes, making areas that continue beyond the map edge look like dead-ends. Players can't tell an area extends further.

## Approach
For each area, detect border nodes that have connections to off-screen nodes in the **same area**. At those border nodes, extend the outline by adding "bleed" circles projected outward toward the SVG edge. This makes the outline fade off the visible area rather than closing into a bubble.

## Changes

### `PlayerGraphView.tsx` — area hull computation (~line 270-309)

In the loop that builds circles for `computeRegionOutline`:

1. For each area node that has a connection to a **non-displayed node in the same area**, compute the direction toward that off-screen node (using stored x/y coords).
2. Add 2-3 extra circles along that direction, extending past the last visible node by `SPACING * 0.5`, `SPACING * 1.0`, and `SPACING * 1.5`. These circles extend the outline toward the SVG edge.
3. The outline algorithm will naturally produce an open-looking shape that bleeds off the viewable area instead of closing off.

This requires knowing whether the off-screen connected node shares the same area. We already have `_areas` and all `nodes` — for each neighbor's connection to a non-displayed node, look up the full node from the `nodes` array and check `area_id`.

**Key logic sketch:**
```typescript
// After building circles from visible area nodes...
for (const n of areaNodes) {
  const pos = nodePositions.get(n.id);
  if (!pos) continue;
  for (const conn of n.connections) {
    if (displayedIds.has(conn.node_id)) continue; // skip visible nodes
    const offNode = nodes.find(nd => nd.id === conn.node_id);
    if (!offNode || offNode.area_id !== area.id) continue; // only same-area
    // Project outward
    const dx = (offNode.x - n.x) || 0;
    const dy = (offNode.y - n.y) || 0;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    for (let step = 1; step <= 3; step++) {
      circles.push({
        cx: pos.px + (dx/len) * SPACING * step * 0.5,
        cy: pos.py + (dy/len) * SPACING * step * 0.5,
        r: AREA_OUTLINE_RADIUS,
      });
    }
  }
}
```

No other files need changes. The outline geometry utility stays the same — it just receives more circles and produces a shape that extends past the SVG viewport, which SVG clips naturally.

## Files Modified

| File | Change |
|------|--------|
| `src/features/world/components/PlayerGraphView.tsx` | Add bleed circles for border nodes with same-area off-screen connections |

