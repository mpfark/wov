# Fix: Hidden flag not persisting on node connections

## Problem

When marking a path between two nodes as **Hidden** in the admin Node Editor, the flag visibly saves at first but then disappears. The root cause is a state-sync race between the **ConnectionsManager** sub-panel and the parent **NodeEditorPanel**:

- `ConnectionsManager` writes connection changes (including `hidden: true`) directly to the DB and then asynchronously triggers `loadNode(activeNodeId)` to refresh the parent's `form.connections` JSON string.
- If the user makes any other edit on the node and clicks the top-level **Save Node** button before that refresh lands (or in some flows, even after — because `loadNode` isn't awaited), `saveNode()` writes the **stale** `form.connections` string back to the DB, silently dropping `hidden`.
- The reverse side on the connected node is unaffected by the parent save, so the two ends can also drift out of sync (one hidden, one not).

A secondary issue: in `saveEditConnection`, the **reverse-side** update only patches `direction` + `hidden`, never `label`. This isn't the reported bug but is worth fixing in the same pass.

## Plan

### 1. Make connection edits authoritative and atomic

In `src/components/admin/NodeEditorPanel.tsx` → `ConnectionsManager`:

- After every connection mutation (`addConnection`, `saveEditConnection`, `removeConnection`, `quickConnect`), re-fetch the node's `connections` from the DB and pass them up to the parent so `form.connections` is updated in lock-step. Add a new prop `onConnectionsChanged(newConnectionsJson: string)` and call it with the freshly-fetched array stringified.
- In the parent, wire `onConnectionsChanged` to `setForm(f => ({ ...f, connections: json }))` so the top-level Save Node button can never overwrite the just-saved hidden flag with stale JSON.

### 2. Don't let `saveNode` clobber connections

Still in `NodeEditorPanel.tsx`:

- In `saveNode()`, when updating an existing node, **omit the `connections` field from the update payload** entirely. Connections are now owned by `ConnectionsManager` and are always written through it. This removes the entire class of "stale form string overwrites real DB state" bugs for connections (hidden, locked, lock_key, lock_hint, label, direction).
- For **new** node creation (where `ConnectionsManager` isn't shown yet), keep the existing behavior since the initial connection list is built from `adjacentToNodeId` and is still trustworthy.

### 3. Always write the `hidden` field explicitly

In `ConnectionsManager`:

- Replace the conditional spread `...(editHidden ? { hidden: true } : {})` with an explicit `hidden: !!editHidden` on both the from-side and reverse-side writes (and same for `addConnection`/`addHidden`). Storing `hidden: false` instead of omitting it makes the intent unambiguous and survives any future shallow-merge logic.
- On the reverse-side update inside `saveEditConnection`, also propagate `label` so a label change on one end mirrors to the other (consistency fix).

### 4. Verification

After the change, repro the original flow:
1. Open admin → World → click a node → Connections tab.
2. Edit an existing connection, check **Hidden**, Save.
3. Confirm the eye/Hidden badge appears on the row.
4. Make an unrelated change (e.g. edit description) and click the top-level **Save Node**.
5. Re-open the node — Hidden flag still present.
6. Open the *connected* node and confirm the reverse connection also shows Hidden.

## Technical notes

- Files touched: `src/components/admin/NodeEditorPanel.tsx` only.
- No DB migration needed; `connections` is already a `jsonb` column with arbitrary keys.
- No changes required on the player side — `useMovementActions`, `MovementPad`, `PlayerGraphView`, `PlayerWorldMapDialog`, `useKeyboardMovement` all already filter on `c.hidden`, so once the flag persists correctly, hidden paths will behave as designed (discoverable only via search).
