# Improve Party Following: Parallel Move + Follower Presence Broadcast

## Problem

1. **Sequential delay**: `moveFollowers` runs *after* the leader's `updateCharacter` completes, adding latency before followers' DB positions update.
2. **No follower presence broadcast**: When followers are moved by the leader, only their DB position updates. They don't broadcast `party_move` for themselves, so other followers and the presence system don't get immediate feedback.

## Changes

### 1. Parallelize moveFollowers with leader's move (`useMovementActions.ts`)

In `handleMove`, `handleTeleport`, and `handleReturnToWaymark`: fire `moveFollowers` concurrently with the leader's own `updateCharacter` call instead of awaiting it sequentially.

**handleMove** (line ~297-311): Change from:
```
await updateCharacter({ current_node_id: nodeId, mp: ... });
broadcastMove(...);
// ... log, visited node ...
await moveFollowers(...);
```
To:
```
const leaderMove = updateCharacter({ current_node_id: nodeId, mp: ... });
broadcastMove(...);
// ... log, visited node ...
const followerMove = moveFollowers(...);
await Promise.all([leaderMove, followerMove]);
```

Same pattern for `handleTeleport` (line ~331-343) and `handleReturnToWaymark` (line ~356-367).

### 2. Add broadcastMove for each follower (`moveFollowers` function + params)

Update `moveFollowers` to accept a `broadcastMove` callback and call it for each moved follower, so other party members get immediate broadcast feedback.

**moveFollowers signature**: Add `broadcastMove: (charId: string, charName: string, nodeId: string) => void` parameter.

**Inside moveFollowers**: After the `Promise.all` DB updates, broadcast for each moved member:
```ts
for (const f of toMove) {
  broadcastMove(f.character_id, f.character.name, targetNodeId);
}
```

Update all 3 call sites to pass `p.broadcastMove`.

### 3. Follower-side: broadcast own presence on follow (`GamePage.tsx`)

In the follower effect (line ~456-469), after the follower optimistically updates their own node via `updateCharacter`, also call `broadcastMove` so other clients see the move immediately:

```ts
updateCharacter({ current_node_id: latestMove.node_id });
broadcastMove(character.id, character.name, latestMove.node_id);
addLocalLog(`You follow ${latestMove.character_name}.`);
```

Add `broadcastMove` to the effect's dependency array.

## Files Changed

| File | Change |
|------|--------|
| `src/features/world/hooks/useMovementActions.ts` | Add `broadcastMove` param to `moveFollowers`; parallelize calls in 3 handlers |
| `src/pages/GamePage.tsx` | Add `broadcastMove` call in follower effect |

## What Does NOT Change

- 500ms keyboard cooldown (stays as-is)
- Party broadcast channel structure
- DB schema / RLS
- Leader-authoritative model
