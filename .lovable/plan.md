# Creature Load + Disappearance Fix

## Symptoms

1. **Slow to load**: Creatures don't appear until `combat-catchup` finishes (often 200–800ms, sometimes more), and the panel is empty during that gap.
2. **Disappears after fight → exit → re-enter**: Returning to the node shows no creature for a while.
3. **Toggling again sometimes brings the creature back**: Confirms it's a UI/sync problem, not a real death.

## Root Causes

All in `src/features/creatures/hooks/useCreatures.ts`:

### A. No cancellation of in-flight `reconcileNode` requests
When the user moves quickly between nodes (e.g., south → north → south to recover), multiple `reconcileNode(force: true)` calls are in flight. They resolve out of order. A late response for an old node can overwrite the current node's creatures and reconcile lock, leaving the creature panel empty (or wrong) until the next event or the 30s safety refetch.

### B. The "force catchup" path waits before showing anything
`fetchCreatures()` clears creatures, then awaits `reconcileNode` before painting. There's no use of the prefetch cache or a quick direct DB read to show creatures immediately while reconcile runs. This is the visible "slow to load" gap.

### C. Reconcile lock can swallow a fresh respawn UPDATE
The 500ms reconcile lock filters out any postgres UPDATE for a creature ID not in the catchup response. If a creature respawns (`is_alive` flips false → true) within that 500ms window, the realtime UPDATE is dropped and the creature stays invisible until the next refetch.

### D. Channel callback timing
`useNodeChannel` may not finish `SUBSCRIBED` before the reconcile completes. UPDATEs that arrive in the brief gap before `onCreatureUpdate.current` is wired by `useCreatures` could be missed. Smaller contributor than A/B/C, but worth tightening.

## Fix

All changes are in `src/features/creatures/hooks/useCreatures.ts`. No server changes required.

### 1. Cancel stale `reconcileNode` calls on node change

Track the current request with a token (or `AbortController`-style ref). When `nodeId` changes, increment the token; ignore any response whose token doesn't match the current one. This prevents an old node's response from clobbering the new node's state.

### 2. Optimistic display while reconcile is in flight

Two-phase load on node entry:

- **Phase 1 (immediate, ~0ms)**: If `prefetchCache` has fresh data for this node, render it right away. Otherwise issue a fast `select * from creatures where node_id = ? and is_alive = true` and render that. This gives the user *something* to interact with within ~100ms.
- **Phase 2 (~200–800ms)**: `reconcileNode(force: true)` resolves and replaces the optimistic list with the authoritative one. Reconcile lock is set as today.

Both phases respect the cancellation token from fix #1.

### 3. Tighten the reconcile lock

- Shorten the lock window from 500ms to ~150ms. The lock exists to suppress a brief window of stale realtime echoes; 150ms is enough for that.
- Allow UPDATE events through if they represent a *new* alive creature (`is_alive === true` and not in `prev`) **as long as** the creature's `node_id` matches the current `nodeId`. This ensures respawns are never swallowed.
- Keep the lock's job of filtering re-adds during the catchup→state-set transition.

### 4. Subscribe before reconcile (small ordering fix)

Make `useCreatures` start its postgres-changes subscription wiring before invoking the first `reconcileNode`, so any UPDATE that lands during the catchup window is captured rather than missed.

## Out of scope

- No formula or combat-tick changes.
- No changes to `combat-catchup` server logic.
- No change to the 1-hour boss respawn window.

## Verification

After the fix:

1. Walk into a node with creatures: list should appear within ~100ms (optimistic), then settle to the authoritative list ~200–800ms later with no flicker.
2. Engage a creature, walk one node away to recover, walk back: the creature should be visible immediately on return; if it died offscreen to DoTs, the kill toast appears and the slot stays empty until respawn.
3. Rapid back-and-forth between two nodes: only the current node's creatures are ever shown; stale responses are discarded.
4. Trigger a respawn while standing on the node (wait out a 5-min creature): the respawn appears within ~1s of the DB update.

## Files Touched

- `src/features/creatures/hooks/useCreatures.ts` (only file modified)
