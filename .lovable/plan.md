

## Fix: Size Region Bubbles to Fit Nodes (Not the Other Way Around)

### The Problem

The current code calculates a bubble radius first, then scales node positions down to fit inside it. With many nodes, this compresses them so much that they overlap (node radius is 28px but spacing can shrink to under 40px).

### The Fix

Reverse the logic in `AdminWorldMapView.tsx`:

1. **First**, run the BFS layout and compute node positions at a fixed minimum spacing (e.g., 90px between adjacent nodes -- guaranteeing no overlap with r=28 circles)
2. **Then**, calculate the bubble radius to encompass all the laid-out nodes (plus padding)
3. Position nodes relative to the bubble center

This way the bubble always grows large enough to contain its nodes without overlap.

### Technical Detail (single file change)

**`src/components/admin/AdminWorldMapView.tsx`** -- modify the region/node positioning logic (around lines 140-175):

- Run `layoutNodes()` and multiply grid positions by a fixed `MIN_NODE_GAP = 90` (pixels between adjacent node centers, ensuring 28+28+34 = no overlap)
- Compute the bounding box of those positions
- Set bubble radius to `Math.max(160, Math.max(bboxWidth, bboxHeight) / 2 + BUBBLE_PAD)`
- Center nodes inside the bubble
- Remove the current scale-to-fit math that causes compression

Everything else (edges, interactions, zoom/pan, cross-region lines) stays the same.

