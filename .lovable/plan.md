

# Directional "Add Node" Buttons on Graph Views

## What Changes
When you hover over a node on the admin map, instead of a single `+` button in the top-right corner, you'll see small `+` buttons arranged around the node -- one for each **open direction** (N, NE, E, SE, S, SW, W, NW). Directions already taken by existing connections won't show a button, so you can only add nodes where there's room.

Clicking a directional `+` button will open the node editor with the connection direction pre-filled, so the new node knows exactly how it relates to its neighbor.

## Changes

### 1. Update callback signatures to include direction

**`AdminWorldMapView.tsx`**, **`RegionGraphView.tsx`**, **`AdminPage.tsx`**
- Change `onAddNodeAdjacent` from `(fromId: string) => void` to `(fromId: string, direction?: string) => void`
- Pass the clicked direction through to the node editor

### 2. Show directional `+` buttons on hover (both graph views)

For each node, on hover:
- Compute which of the 8 directions (N, NE, E, SE, S, SW, W, NW) are already used by existing connections
- For each **open** direction, render a small `+` button positioned around the node circle at the correct angle
- Each button calls `onAddNodeAdjacent(nodeId, direction)`

Position mapping (relative to node center, ~38px out):
| Direction | Angle | Offset |
|-----------|-------|--------|
| N | 270deg | (0, -38) |
| NE | 315deg | (27, -27) |
| E | 0deg | (38, 0) |
| SE | 45deg | (27, 27) |
| S | 90deg | (0, 38) |
| SW | 135deg | (-27, 27) |
| W | 180deg | (-38, 0) |
| NW | 225deg | (-27, -27) |

### 3. Pass direction into NodeEditorPanel

**`AdminPage.tsx`**
- Add state `adjacentDirection` alongside existing `adjacentToNodeId`
- Pass it to `NodeEditorPanel` as a new prop

**`NodeEditorPanel.tsx`**
- Accept optional `adjacentDirection?: string` prop
- When creating a new node adjacent to another, pre-select this direction in the connection form instead of leaving it blank

### Files Modified
| File | Change |
|------|--------|
| `src/components/admin/RegionGraphView.tsx` | Replace single `+` with directional `+` buttons around node |
| `src/components/admin/AdminWorldMapView.tsx` | Same directional `+` buttons, updated callback signature |
| `src/pages/AdminPage.tsx` | Track `adjacentDirection` state, pass to editor |
| `src/components/admin/NodeEditorPanel.tsx` | Accept and use `adjacentDirection` prop to pre-fill connection direction |

