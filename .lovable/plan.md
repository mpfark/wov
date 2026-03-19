

## Stop Auto-Centering on Node Click & Auto-Switch to New Node After Quick-Add

### What Changes

1. **Remove auto-center on node click** — Currently, clicking a node in the admin map calls `centerOnNode()` which animates the viewport to center on that node. This will be removed so the map stays put. Region sidebar clicks will continue to center as they do now.

2. **After quick-add, switch the editor to the newly created node** — When a new node is saved via the adjacent quick-add buttons, the `NodeEditorPanel` will pass the new node's ID back to `AdminPage`, which will switch `editingNodeId` to the new node. This lets you rapidly extend a path by repeatedly clicking directional quick-add buttons.

### Code Changes

**`src/components/admin/AdminWorldMapView.tsx`** (line ~920)
- Remove the `if (newSelected) centerOnNode(newSelected);` call inside the node click handler. The node will still be visually selected and the editor panel will open — the viewport just won't jump.

**`src/components/admin/NodeEditorPanel.tsx`**
- Change `onSaved` prop type from `() => void` to `(newNodeId?: string) => void`.
- After creating a new node (line ~727), call `onSaved(inserted.id)` instead of `onSaved()` so the parent knows which node was just created.

**`src/pages/AdminPage.tsx`**
- Update `handleEditorSaved` to accept an optional `newNodeId` parameter. When provided, set `editingNodeId` to the new node ID, clear `isNewNode`, and clear `adjacentToNodeId` — effectively switching the panel to edit the newly created node (with its quick-add buttons available for the next expansion).

