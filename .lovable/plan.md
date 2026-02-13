

# Hidden Paths (Discoverable via Search)

Add a `hidden` flag to node connections so admins can mark certain paths as secret. Hidden paths won't appear on the player's map, but when a player uses "Search Area" at a node with hidden exits, they can discover and travel through them.

---

## What Changes for Players

- Hidden connections are invisible on the local area map
- When clicking "Search Area," if a hidden path exists and the search roll succeeds (roll >= 10), the player gets a message like "You discover a hidden path to [Node Name]!" and is moved there automatically
- If the roll fails, they see nothing special (existing search behavior continues)

## What Changes for Admins

- The Connection manager in the Node Editor gains a "Hidden" checkbox per connection
- Hidden connections still appear in the admin world map but are rendered with a dotted/faded style to distinguish them

---

## Implementation Steps

### 1. Update Connection Type

In `src/hooks/useNodes.ts`, add `hidden?: boolean` to the connection type:

```typescript
connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean }>;
```

### 2. Filter Hidden Paths from Player Graph

In `src/components/game/PlayerGraphView.tsx`:
- Filter out connections where `hidden === true` when computing neighbors and edges
- Hidden paths won't appear as nodes or lines on the player map

### 3. Update Search to Discover Hidden Paths

In `src/pages/GamePage.tsx` `handleSearch`:
- After the existing search logic, check if the current node has any hidden connections
- On a successful search roll (>= 10), pick one hidden connection and move the player there with a discovery message
- Hidden path discovery takes priority over item search when both are possible

### 4. Admin: Hidden Checkbox in ConnectionsManager

In `src/components/admin/NodeEditorPanel.tsx` (`ConnectionsManager`):
- Display a "Hidden" indicator next to each connection
- Add a "Hidden" checkbox when adding a new connection
- The hidden flag is stored in the connection JSON: `{ node_id, direction, label, hidden: true }`

### 5. Admin: Hidden Checkbox in NodeEditorDialog

In `src/components/admin/NodeEditorDialog.tsx` (the dialog variant of the editor):
- Same changes as the panel version for consistency

### 6. Admin World Map Styling

In `src/components/admin/AdminWorldMapView.tsx`:
- Render hidden connections with a more transparent/dotted line style so admins can see them but they're visually distinct from normal paths

### 7. Player Map Legend Update

In `src/components/game/MapPanel.tsx`:
- No legend entry needed since players shouldn't know hidden paths exist

---

## Technical Notes

- No database migration needed -- `hidden` is stored inside the existing `connections` JSONB column
- The `RegionGraphView` admin component should also style hidden edges distinctly
- Bidirectional hidden connections: when adding a hidden connection A->B, the reverse B->A connection should also be marked hidden automatically

