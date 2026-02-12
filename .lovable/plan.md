

# Replace Raw JSON Connections Editor with Visual UI

## Problem
Currently, the "Connections" tab in the Node Editor shows a raw JSON textarea where admins must manually type node IDs, directions, and labels. This is error-prone and tedious.

## Solution
Replace the JSON textarea with an interactive connection manager featuring:
- A list of current connections showing the connected node's **name**, **direction**, and optional **label**
- A button to **remove** any connection (with automatic removal of the reverse connection on the other node)
- An **"Add Connection"** form with:
  - A dropdown to pick any node (from all nodes, not just the current region)
  - A direction selector (N, S, E, W, NE, NW, SE, SW)
  - An optional label text field
- When adding a connection, the **reverse connection is automatically created** on the target node (e.g., if you connect A->B going North, B gets a connection to A going South)

## Technical Details

### File: `src/components/admin/NodeEditorDialog.tsx`

**Changes to the Connections tab (lines 462-481):**

1. **Parse connections from JSON into structured state** -- already stored as `form.connections` (JSON string). We'll parse it for display and provide add/remove helpers.

2. **Replace the textarea** with:
   - A list rendering each connection as a row: `[Node Name] -- [Direction] -- [Label] -- [Remove button]`
   - An "Add Connection" section with:
     - `Select` dropdown listing all nodes (passed via a new `allNodesGlobal` prop containing every node, not just region-filtered)
     - Direction `Select` with the 8 compass directions
     - Optional label `Input`
     - "Add" button

3. **Add connection logic:**
   - Adds entry to current node's connections array
   - Immediately saves both nodes to the database (current node + target node with reverse direction)
   - Refreshes data via `onSaved()`

4. **Remove connection logic:**
   - Removes entry from current node's connections
   - Also removes the reverse connection from the target node in the database
   - Saves both and refreshes

### File: `src/pages/AdminPage.tsx`

- Pass **all nodes** (not just region-filtered) to the `NodeEditorDialog` as a new `allNodesGlobal` prop so the connection picker can reference nodes across regions.

### Direction Reversal Map
A simple mapping for auto-creating reverse connections:
```
N <-> S, E <-> W, NE <-> SW, NW <-> SE
```

