

## Travel System Overhaul

Replace the text-based travel buttons in the center panel with a visual SVG node graph in the right panel, similar to the admin graph editor.

### Changes Overview

**1. Remove travel buttons from NodeView (center panel)**
- Remove the "Travel" heading and the grid of directional travel buttons
- Keep "Search Area" and "Open Shop" action buttons

**2. Simplify the World Map (right panel)**
- Show only the current region the player is in (no list of all regions)
- Display region name, level range

**3. Replace Local Area list with an SVG graph view**
- Create a new `PlayerGraphView` component based on the admin `RegionGraphView`
- Show only the current node and its directly connected neighbors (not the full region)
- Current node is highlighted (golden/primary glow)
- Connected nodes are clickable to travel
- No admin features (no "+" buttons for adding nodes)
- Edges rendered as dashed lines with optional path labels
- Vendor nodes show a shop icon

**4. Wire up click-to-travel**
- Clicking a neighboring node in the graph triggers the existing `handleMove` function (which already handles Attack of Opportunity on retreat)

### Technical Details

**New file: `src/components/game/PlayerGraphView.tsx`**
- Adapted from `RegionGraphView`, stripped of admin controls
- Props: `currentNodeId`, `nodes` (current + connected only), `onNodeClick`
- Reuses the same BFS `layoutNodes` algorithm but centered on current node
- Current node styled distinctly (primary fill, glow effect)
- Connected nodes styled as interactive/clickable
- Smaller spacing since fewer nodes are shown

**Modified: `src/components/game/NodeView.tsx`**
- Remove lines 94-108 (the Travel section with directional buttons)
- Keep "Actions" section with Search and Vendor buttons
- The `onMove` prop can be removed from this component since travel is handled by the map

**Modified: `src/components/game/MapPanel.tsx`**
- World Map: filter regions to only show the current one
- Local Area: replace the button list with `PlayerGraphView`, passing only the current node + its direct neighbors
- Pass `onNodeClick` through to `PlayerGraphView`

**Modified: `src/pages/GamePage.tsx`**
- Remove `onMove` from NodeView props (minor cleanup)
- No logic changes needed -- `handleMove` is already wired to `onNodeClick` in MapPanel
