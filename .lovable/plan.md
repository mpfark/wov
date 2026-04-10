

# Party Play Audit Fixes

Seven targeted fixes across 4 files, plus one migration to clean up the old RPC. Locked path bypass for followers is confirmed intentional (Option A).

## Changes

### 1. Add `character_visited_nodes` upsert for followers
**File:** `src/features/world/hooks/useMovementActions.ts` — `moveFollowers()`

After the `Promise.all` that updates follower `current_node_id`, add a parallel batch of `character_visited_nodes` upserts so followers discover nodes on the world map.

### 2. Remove duplicate broadcast-based follower movement
**File:** `src/pages/GamePage.tsx` — lines 436-449

Remove the `useEffect` block that listens to `partyMoveEvents` and calls `updateCharacter({ current_node_id })`. The leader's `moveFollowers()` already handles DB updates + broadcasts. This eliminates the redundant second DB write per follower per move.

### 3. Summon: refetch character after accept
**File:** `src/features/world/components/SummonRequestNotification.tsx`

Add an `onRefetch` callback prop. After successful `onAccept`, call `onRefetch()` to re-read the character's new `current_node_id` from the DB. Pass `updateCharacter` or a dedicated refetch from `GamePage.tsx`.

### 4. Summon: live countdown timer
**File:** `src/features/world/components/SummonRequestNotification.tsx`

Add a `useEffect` with a 1-second `setInterval` that increments a `tick` state counter, causing re-renders so `remaining` recalculates each second.

### 5. Party accept: surface errors via toast
**File:** `src/features/party/hooks/useParty.ts` — `acceptInvite`

Check the RPC response for errors and return the error message so the caller can display feedback (or use toast directly).

### 6. Drop old `summon_player` RPC
**Migration:** Drop the `summon_player` function that directly teleports without consent — it's no longer called.

### 7. Filter party realtime subscriptions
**File:** `src/features/party/hooks/useParty.ts` — realtime channel setup

Add a `filter` to the `party_members` postgres_changes subscription scoped to the current `party_id` (when known), reducing unnecessary `fetchParty()` calls from other parties' changes.

---

## Files touched

| File | What |
|------|------|
| `src/features/world/hooks/useMovementActions.ts` | Follower node discovery upserts |
| `src/pages/GamePage.tsx` | Remove duplicate follower move effect; pass refetch to SummonRequestNotification |
| `src/features/world/components/SummonRequestNotification.tsx` | Live countdown + character refetch after accept |
| `src/features/party/hooks/useParty.ts` | Accept error handling + filtered realtime |
| New migration | Drop `summon_player` RPC |

## Not changed
- Locked path bypass for followers (intentional — leader opens for party)
- Server tick rate, polling intervals, combat math
- MP-free travel for followers (by design)

