

## Fix: Region Starting Node Coordinates

### Problem
When creating a new region via the "New Region" button, the starting node is always placed at coordinates `(0, 0)` with no connections. Since Hearthvale Square is also at `(0, 0)`, new region nodes stack on top of it. There's no mechanism to connect the new region's entrance to the existing world.

### Solution
Improve the region creation dialog to let the admin optionally connect the new region's starting node to an existing node, and auto-calculate appropriate coordinates.

### Changes

**`src/components/admin/RegionManager.tsx`**

1. **Add a "Connect to node" selector**: Add an optional dropdown/combobox that lets the admin pick an existing node to connect the new region's entrance to, plus a direction (N/S/E/W/etc.).

2. **Auto-calculate coordinates**: When a connecting node is selected, compute the new node's `x, y` from the selected node's coordinates + direction offset (same logic used in `AdminPage.tsx` quick-add).

3. **Create bidirectional connection**: Insert the new node with a connection back to the selected node, and update the selected node's connections to include the new region entrance.

4. **Fallback for standalone regions**: If no connecting node is selected, place the node at a large offset (e.g., `x = max_x + 10`) so it doesn't overlap existing nodes.

**Props change**: Pass `allNodes` (the full nodes array) into `RegionManager` so it can populate the connector dropdown and read coordinates.

### Technical Details
- Reuse `DIRECTION_OFFSETS` and `REVERSE_DIR` maps already defined in `AdminPage.tsx` (extract to a shared util or inline).
- The connector UI: a `Select` for choosing a node (searchable, showing node name + region) and a direction picker.
- On create: insert node with computed `x, y` and connection, then update the parent node's connections array.

