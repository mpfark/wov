

## Player World Map Dialog

### What
A full-screen dialog accessible from the local area mini-map that shows the entire world map, but only nodes the player has previously visited. Displays region names, area names, node names, and service icons (vendor, inn, blacksmith, teleport, trainer) -- no creatures or NPCs.

### How

**New component: `src/components/game/PlayerWorldMapDialog.tsx`**
- Opens via a globe/map button added next to the existing legend button in `MapPanel.tsx`
- Reuses the same BFS layout algorithm from `AdminWorldMapView` to position nodes
- Filters all nodes to only show ones in the player's `visitedNodeIds` set
- Renders region outlines (union-of-circles) and area outlines around visited nodes
- Shows node circles with service emoji icons (vendor, inn, blacksmith, teleport, trainer)
- Labels nodes with their display name (node name or area name fallback)
- Labels regions with name and level range
- Highlights current node with a pulsing marker
- Supports pan (mouse drag) and zoom (scroll wheel)
- Uses the existing `area-colors.ts` for region/area coloring via emoji from `useAreaTypes`
- No creature dots, no NPC indicators

**Changes to `MapPanel.tsx`:**
- Add a new prop `visitedNodeIds: Set<string>` and `characterId: string`
- Add a globe button next to the legend hover-card in the bottom toolbar
- Wire it to open `PlayerWorldMapDialog`

**Changes to `GamePage.tsx`:**
- Pass `visitedNodeIds` from `PlayerGraphView`'s internal state -- but since that state lives inside PlayerGraphView, we need to lift it. Instead, we'll fetch visited nodes independently in `MapPanel` or pass through a shared source.
- Actually, the simplest approach: `PlayerWorldMapDialog` fetches its own visited node IDs on open (single query), then filters the `nodes` array. This avoids prop drilling and keeps it self-contained.

**Data flow in `PlayerWorldMapDialog`:**
1. On dialog open, fetch `character_visited_nodes` for the character
2. Filter `nodes` to only visited ones
3. Run BFS layout on the filtered set (connections only to other visited nodes)
4. Compute region/area outlines from visited nodes only
5. Render SVG with pan/zoom

**Layout reuse:**
- Extract the BFS `layoutNodes` function and `computeRegionOutline` from `AdminWorldMapView` into a shared utility, or simply duplicate the layout logic in the new component (simpler, avoids refactoring admin code)

### Files
- **Create** `src/components/game/PlayerWorldMapDialog.tsx` -- full world map dialog with pan/zoom, fog-of-war filtering
- **Edit** `src/components/game/MapPanel.tsx` -- add globe button to open the dialog, pass through nodes/regions/areas/characterId

