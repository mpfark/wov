

# Improve Party Following: Parallel Move + Follower Presence Broadcast

## Summary
Two targeted changes to reduce party follow latency and improve presence visibility, in two files only.

## Changes

### File 1: `src/features/world/hooks/useMovementActions.ts`

**A. Add `broadcastMove` param to `moveFollowers`** (line 125)

Add an optional `broadcastMove` parameter. After the DB writes complete, loop through moved members and broadcast each one:

```ts
async function moveFollowers(
  ...,
  broadcastMove?: (charId: string, charName: string, nodeId: string) => void,
): Promise<void> {
  // ... existing filter + Promise.all DB writes ...
  if (broadcastMove) {
    for (const f of toMove) {
      broadcastMove(f.character_id, f.character.name, targetNodeId);
    }
  }
  addLog('Your party follows you.');
  fetchParty();
}
```

**B. Parallelize in `handleMove`** (lines 297-311)

Change `await updateCharacter(...)` to `const leaderMove = updateCharacter(...)`, fire `moveFollowers` as `const followerMove = moveFollowers(...)`, then `await Promise.all([leaderMove, followerMove])`. Pass `p.broadcastMove` as the new param.

**C. Parallelize in `handleTeleport`** (lines 331-343)

Same pattern: `const leaderMove = updateCharacter(...)`, `const followerMove = moveFollowers(...)`, `await Promise.all([leaderMove, followerMove])`.

**D. Parallelize in `handleReturnToWaymark`** (lines 356-367)

Same pattern.

### File 2: `src/pages/GamePage.tsx`

**Follower self-broadcast** (lines 456-469)

After the follower optimistically updates their node, also call `broadcastMove` so other clients see the move instantly:

```ts
updateCharacter({ current_node_id: latestMove.node_id });
broadcastMove(character.id, character.name, latestMove.node_id);
addLocalLog(`You follow ${latestMove.character_name}.`);
```

Add `broadcastMove`, `character.id`, `character.name` to the effect dependency array.

## What Does NOT Change

- 500ms keyboard cooldown
- Party broadcast channel structure
- DB schema / RLS
- Leader-authoritative model

