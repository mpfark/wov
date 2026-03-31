

# Hybrid Combat Model — Session Lifecycle Refinement

## Summary

Refine the combat-tick session lifecycle so sessions are terminated when **no relevant participants remain**, not just on node mismatch. Combined with the previously approved changes (removing `isDotOnly`, simplifying catchup), this ensures no ghost combat rounds can occur.

## Changes

### 1. `supabase/functions/combat-tick/index.ts` — Comprehensive session termination

**Lines 170-183 (node change check)**: Replace entirely. Instead of checking for active DoTs to keep the session alive, delete the session immediately:

```typescript
if (session.node_id !== node_id) {
  await db.from('combat_sessions').delete().eq('id', session.id);
  return json({ events: [], creature_states: [], member_states: [], session_ended: true, ticks_processed: 0 });
}
```

**Line 57**: Change `TICK_CAP = 30` → `TICK_CAP = 3` (defensive safeguard only).

**Line 132 (members.length === 0 check)**: Already returns early, but also delete any existing session when no members are at the node:

```typescript
if (members.length === 0) {
  if (session) await db.from('combat_sessions').delete().eq('id', session.id);
  return json({ events: [], creature_states: [], member_states: [], session_ended: true, ticks_processed: 0 });
}
```

Move this check AFTER session load so we can clean up the session. Currently members are filtered before session load (line 112-117 filters to members at `node_id` with hp > 0). The `members.length === 0` return at line 132 fires before session lookup. Restructure so session is loaded first, then if no members remain, delete it.

**Line 264 (`isDotOnly`)**: Remove entirely. Remove all `isDotOnly` guards (lines 376, 548, 664, 736). Auto-attacks and creature counterattacks always run inside the tick loop because sessions only exist when players are present.

**Lines 891-905 (session end check)**: Simplify — remove `hasActiveEffects` check that keeps sessions alive for orphaned effects:

```typescript
const anyAlive = creatures.some(cr => !cKilled.has(cr.id) && cHp[cr.id] > 0);
if (!anyAlive) {
  await db.from('combat_sessions').delete().eq('id', session.id);
  sessionEnded = true;
} else {
  await db.from('combat_sessions').update({ ... }).eq('id', session.id);
}
```

Effects persist independently in `active_effects` and will be reconciled by `combat-catchup` on next node access.

**Diagnostics**: Add `ticks_capped: ticksToProcess > TICK_CAP` and `session_deleted_reason` to existing log.

### 2. `supabase/functions/combat-catchup/index.ts` — Pure offscreen reconciler

**Lines 83-105 (session timeline logic)**: Remove the fallback session lookup, `sessionLastTickBefore` tracking, and session `last_tick_at` updates. Sessions no longer persist offscreen so there's nothing to sync.

**Lines 119-132 (orphaned session cleanup)**: Remove. Sessions are cleaned up at source in combat-tick.

Simplified post-resolution writes:
```typescript
await Promise.all([
  writeCreatureState(db, creatures, cHp, cKilled),
  cleanupEffects(db, result.expiredIds, cKilled),
]);
```

**Header comment**: Update to reflect new role — sole offscreen effect reconciler, no session management.

### 3. `src/features/combat/hooks/usePartyCombat.ts` — Clean up

**Line 95**: Remove `nodeEntryTickRef`.

**Lines 591-606**: Keep `stopCombat()` call and override clearing on node change. Remove `nodeEntryTickRef.current = true`. Update comment from "server session persists DoTs automatically" to "effects persist as world state, reconciled on next access".

Remove any `nodeEntryTickRef` usage in `processTickResult` (need to check lines 100-560 for references).

### 4. No changes needed

- `useCreatures.ts` — already correct (skeletons → catchup → authoritative HP)
- `NodeView.tsx` — skeleton loading already correct
- `_shared/combat-resolver.ts` — no formula changes
- `active_effects` table — `session_id` stays as optional metadata, not used for lifecycle

## Session Termination Rules (enforced in combat-tick)

A session is deleted when ANY of these is true:
1. `session.node_id !== node_id` (player left the node)
2. `members.length === 0` (no alive members at the combat node)
3. No alive engaged creatures remain after tick processing

Effects survive independently and are reconciled by `combat-catchup` on next access.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Delete session on node change/no members; remove `isDotOnly`; simplify session-end; cap=3 |
| `supabase/functions/combat-catchup/index.ts` | Remove session timeline logic and orphaned session cleanup |
| `src/features/combat/hooks/usePartyCombat.ts` | Remove `nodeEntryTickRef`; update comments |

## Constraints

- No combat formula, balance, or tick-rate changes
- `session_id` remains on effects as optional metadata
- Server remains authoritative
- Tick cap is defensive safeguard, not core fix

