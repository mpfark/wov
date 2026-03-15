

## Locked Connections — Revised Design with Broadcast Unlock

### Problem
A client-side-only unlock state means only the unlocker can traverse the path. Party members and other players at the same node would still see it locked.

### Solution: Node-Scoped Broadcast

When a player unlocks a path, broadcast an `unlock_path` event on the existing node channel (`node-${nodeId}`). All players at that node receive it and add the connection to their local `unlockedConnections` state with the same expiry.

### Flow

```text
Player A has key → moves toward locked path
  → inventory check passes
  → broadcast { type: 'unlock_path', direction: 'N', node_id: 'target', expires: timestamp }
  → all players at node receive broadcast
  → each client adds to local unlockedConnections map
  → path is open for everyone for 30s
  → timer expires → connection locks again for all
```

### Changes

**1. `src/hooks/useNodes.ts`** — Add `locked?: boolean; lock_key?: string` to connection type.

**2. `src/hooks/useActions.ts` — `handleMove`**:
- Check if connection is `locked` and not in `unlockedConnections`.
- If locked: search inventory for item matching `lock_key` (case-insensitive).
- If found: broadcast `unlock_path` event on node channel, add to local state, allow move.
- If not found: block move with log message.

**3. `src/pages/GamePage.tsx`**:
- Add `unlockedConnections` state (Map of `"nodeId-direction"` → expiry timestamp).
- Listen for `unlock_path` broadcasts on the node channel — when received, add to map and set a `setTimeout` to remove on expiry.
- Pass `unlockedConnections` to `MovementPad` and `PlayerGraphView`.

**4. `src/components/game/MovementPad.tsx`**:
- Accept `unlockedConnections` prop.
- Show locked connections as visible but styled with 🔒.
- If temporarily unlocked, show as normal available direction.

**5. `src/components/game/PlayerGraphView.tsx`**:
- Show locked edges with a distinct style (lock icon, different dash pattern).
- Temporarily unlocked edges render as normal.

**6. `src/components/admin/NodeEditorPanel.tsx`**:
- Add "Locked" checkbox + "Lock Key" text input per connection in the ConnectionsManager.

### Files
- `src/hooks/useNodes.ts`
- `src/hooks/useActions.ts`
- `src/pages/GamePage.tsx`
- `src/components/game/MovementPad.tsx`
- `src/components/game/PlayerGraphView.tsx`
- `src/components/admin/NodeEditorPanel.tsx`

