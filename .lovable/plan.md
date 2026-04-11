

# Improved Party Follow Grace Window — Refined Plan

## Summary

Same architecture as the approved plan (enrich broadcast, grace window on follower side, bounded catch-up). Four refinements to reduce false follow-breaks from normal network jitter.

## Refinements Applied

### 1. Grace window: 1000ms (was 700ms)

```typescript
const FOLLOW_GRACE_MS = 1000;
```

Named constant, easy to tune later.

### 2. One-miss tolerance before breaking follow

Add a `missedFollowCountRef` (number) alongside `lastFollowMoveRef`.

```text
On receiving party_move where character_id === myId:
  - If not following → ignore
  - If my node === from_node_id AND within grace window:
    → move, log "You hurry after <leader>."
    → reset missedFollowCount to 0
  - Else (node mismatch OR grace expired):
    → increment missedFollowCount
    → if missedFollowCount >= 2:
        → break follow, log "You lose track of <leader>."
    → else:
        → log nothing (silently tolerate one miss)
```

This means a single delayed/out-of-order event won't break follow. Two consecutive mismatches will.

### 3. `lastFollowMoveRef` for staleness only

Used exclusively to discard older events when a newer one has already been processed. **Not** used as a movement cooldown or throttle. Fresh valid events always execute immediately.

### 4. Bounded catch-up preserved

- Only auto-follow when follower is at `from_node_id` (one node behind at most)
- No multi-node teleport
- No unlimited rubberbanding

## Files Touched

| File | Change |
|------|--------|
| `src/features/party/hooks/usePartyBroadcast.ts` | Add `from_node_id` + `timestamp` to `PartyMoveEvent` and `broadcastMove` |
| `src/features/world/hooks/useMovementActions.ts` | Pass origin node + timestamp to `broadcastMove`; update `moveFollowers` signature |
| `src/pages/GamePage.tsx` | Replace simple node-snap effect with grace window + one-miss tolerance logic |

## Not Changed

- Server authority, DB schema, combat/aggro logic, movement cooldowns, party leadership mechanics

