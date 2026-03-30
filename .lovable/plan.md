

# Fix Remaining Offscreen DoT Progression — Refined Audit

## Current State After Previous Fixes

The combat-catchup already:
- Resolves offscreen DoT effects in bulk mode
- Updates `combat_sessions.last_tick_at = now` for sessions linked to resolved effects
- Returns authoritative creature HP to the client

The client already:
- Clears `creatureHpOverrides` on node change
- Shows loading skeletons while waiting for catchup
- Guards `processTickResult` against stale responses

## Remaining Risk: Null `session_id` on Effects

The `active_effects` table has `session_id` as nullable. If any effect row has `session_id = NULL`, catchup's session update logic (`effects.map(e => e.session_id).filter(Boolean)`) will skip it entirely, leaving the combat session's `last_tick_at` stale. The next combat-tick would then compute a large elapsed backlog.

This is the most likely root cause of the remaining issue.

## Changes

### 1. Server: Fallback session lookup in combat-catchup

**File: `supabase/functions/combat-catchup/index.ts`**

After collecting `sessionIds` from effects, also query for any combat sessions at this node that were NOT already in the list. If effects exist at this node but their `session_id` is null, the session still needs its timeline updated.

```typescript
// After line 79: collect sessionIds from effects
const sessionIds = [...new Set(effects.map((e: any) => e.session_id).filter(Boolean))];

// NEW: Also find sessions at this node that aren't already captured
const { data: nodeSessions } = await db.from('combat_sessions')
  .select('id, last_tick_at')
  .eq('node_id', node_id);
const allSessionIds = new Set(sessionIds);
for (const s of (nodeSessions || [])) {
  allSessionIds.add(s.id);
}
const finalSessionIds = [...allSessionIds];
```

Update the session write to use `finalSessionIds` and log both the effect-linked and fallback counts.

### 2. Server: Enhanced diagnostics in combat-catchup

**File: `supabase/functions/combat-catchup/index.ts`**

Add to the diagnostic log:
- `null_session_effects`: count of effects with null session_id
- `session_last_tick_before`: map of session_id → old last_tick_at values
- `session_last_tick_after`: the new value (now)

This helps confirm whether the session timeline was actually stale.

### 3. Server: Enhanced diagnostics in combat-tick

**File: `supabase/functions/combat-tick/index.ts`**

Add to the existing diagnostic log:
- `last_tick_at_read`: the `session.last_tick_at` value as read
- `elapsed_ms`: already present
- `ticks_processed`: already present

This confirms whether combat-tick sees a freshly-updated or stale `last_tick_at`.

### 4. Client: Log first tick after node entry

**File: `src/features/combat/hooks/usePartyCombat.ts`**

In `processTickResult`, log when `ticks_processed > 1` (already done). Additionally, after the first tick response following a node change, log the number of ticks processed to confirm it's 1 (not a large retroactive batch).

Add a `nodeEntryTickRef` flag that gets set on node change and cleared after the first tick response.

### 5. Document timeline ownership

**File: `supabase/functions/combat-catchup/index.ts` (header comment)**

Add a clear comment documenting:
- combat-catchup owns offscreen effect resolution AND updates session `last_tick_at`
- combat-tick must never see a stale `last_tick_at` for a session that catchup already resolved
- if effects have null `session_id`, catchup falls back to updating all sessions at the node

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/combat-catchup/index.ts` | Fallback session lookup for null session_id effects; enhanced diagnostics |
| `supabase/functions/combat-tick/index.ts` | Add `last_tick_at_read` to diagnostic log |
| `src/features/combat/hooks/usePartyCombat.ts` | Log first-tick-after-node-change ticks_processed |

## Constraints

- No formula, tick-rate, or balance changes
- Server remains authoritative
- Fallback is conservative: updates all sessions at the node only when effect→session linkage is broken

