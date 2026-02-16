
## Player World Map: Geographic Overview

### Problem
The player's map panel currently only shows a local 1-hop neighborhood graph. There's no way for players to see how regions and towns connect across the world, making navigation feel disorienting.

### Solution
Add a toggleable "World Map" view to the player's MapPanel that reuses the geographic layout logic from the admin's `AdminWorldMapView` -- region bubbles positioned with collision-aware spacing, pan/zoom controls, and a "you are here" marker. Players can toggle between the existing **Local Area** view and the new **World Map** view.

### How It Works

```text
MapPanel (right sidebar, 400px)
+-------------------------------+
| [Local Area] [World Map]  <-- tab toggle
+-------------------------------+
|                               |
| WORLD MAP VIEW:               |
|  +---------+   +---------+   |
|  | Region A|---| Region B|   |
|  | (Lvl 1-5)  | (Lvl 5-10)  |
|  +----+----+   +----+----+   |
|       |              |       |
|  +----+----+         |       |
|  | Region C|--------+       |
|  | (Lvl 10+)                |
|  +---------+  [You: ◆]      |
|                               |
| [+] [-] [Reset]  zoom ctrls  |
+-------------------------------+
| Legend ...                    |
| Party ...                     |
+-------------------------------+
```

### Changes

**New file: `src/components/game/PlayerWorldMap.tsx`**
- Simplified, read-only version of `AdminWorldMapView`
- Same layout algorithm: BFS node layout per region, collision-aware bubble placement
- No edit controls (no add-node buttons, no node editing)
- Region bubbles show name and level range
- Nodes within each region shown as small dots (not interactive for movement -- too far away)
- Cross-region edges shown as connecting lines between region bubbles
- Current node highlighted with the diamond marker and glow
- Current region bubble highlighted with a brighter border
- Pan (drag) and zoom (scroll wheel) with reset button
- Party member positions shown on nodes where applicable
- Clicking a region name could scroll/zoom to that region

**Modified file: `src/components/game/MapPanel.tsx`**
- Add a tab toggle at the top: "Local Area" (default) and "World Map"
- When "World Map" is selected, render `PlayerWorldMap` instead of `PlayerGraphView`
- Region info box at top removed when in World Map mode (redundant -- the map shows it)
- Legend and Party sections remain below in both modes

### Technical Details

- The layout algorithm is extracted/reused from `AdminWorldMapView` (BFS + collision nudging)
- Hidden connections are excluded from the player world map (same as local view)
- No database changes needed -- uses the existing `regions` and `nodes` data already passed to `MapPanel`
- The world map is purely visual/navigational context; players still move via the local area view by clicking adjacent nodes
- SVG uses `viewBox` with `preserveAspectRatio="xMidYMid meet"` for responsive sizing within the 400px sidebar
