

# Fix Offscreen DoT Kill — Root Cause & Plan

## Problem Identified

Two issues prevent offscreen DoT damage from working:

### Issue 1: Effects expire before reconciliation
Poison lasts **25 seconds**, ignite lasts **30-45 seconds**. If the player leaves and the wake-up timer fires at, say, 27 seconds, but `combat-catchup` runs at 28 seconds, the effect has already expired. The bulk resolver in `resolveEffectTicks` correctly skips expired effects — but the creature HP was never updated because the effect was never "ticked" while the player was away.

The bulk resolver (line 145-146) calculates `elapsedMs = now - eff.next_tick_at`. If `now > eff.expires_at`, it still processes ticks up to `expires_at` (line 149: `maxTicksByExpiry`). So this path actually works. **The real problem is Issue 2.**

### Issue 2: `lastActiveEffects` is empty at departure
The `useOffscreenDotWakeup` hook captures `lastActiveEffects` from the most recent `combat-tick` response. But when the player moves to another node:
1. `fleeStopCombat` immediately clears the heartbeat interval
2. The last tick response may have had `effects_count: 0` (DoT didn't proc yet) or the creature died that tick
3. Node change triggers `useOffscreenDotWakeup`, which reads `lastEffectsRef.current` — likely `null` or `[]`
4. Result: "no active effects to track" log, no wake-up scheduled

Even if `lastActiveEffects` IS populated, the **state is from the last tick response, not from the DB**. Between the last tick and node departure, the effects still exist in the DB but the client doesn't know about them.

### Issue 3: No reconciliation on re-entry handles this correctly anyway
`combat-catchup` IS called on node re-entry. It queries `active_effects` from DB. If effects exist, it processes them. The logs show `effects_count: 0` on every catchup call — meaning effects genuinely don't exist in the DB when the player returns.

**Root cause**: Effects expire (25-45s TTL) before the player returns. The creature's HP is never reduced because no one processed the effect ticks during that window.

## Solution

The wake-up timer is the right approach but needs to be more reliable. Two fixes:

### Fix A: Query DB for effects on node departure (not just use in-memory state)
When the player leaves a node, instead of relying on `lastActiveEffects` from the combat-tick response, **query the `active_effects` table directly** for that node. This ensures we capture effects even if the last tick response didn't include them.

**File**: `src/features/combat/hooks/useOffscreenDotWakeup.ts`
- On node departure, call `supabase.from('active_effects').select(...)` for the departed node
- Also fetch creature HP from `creatures` table for that node
- Use this fresh data for the snapshot and prediction
- This replaces the unreliable `lastEffectsRef.current` approach

### Fix B: Ensure the wake-up timer fires BEFORE effects expire
The current `BUFFER_MS = 2000` adds 2s after predicted death. But if the predicted death is at `effect.expires_at` (all ticks used up), the timer fires after expiry.

This is actually fine — `combat-catchup`'s bulk resolver processes all ticks up to `expires_at` regardless of when it runs. The key is that the effects must still exist in the DB (not yet deleted). Effects are only deleted by:
- `cleanupEffects` (called by combat-tick or combat-catchup)
- No auto-expiry/TTL in the DB

So effects persist until explicitly cleaned up. **The wake-up timer should work as-is** once Fix A ensures it actually fires.

### Fix C: Handle the case where wake-up fires but effects already expired
When `combat-catchup` runs, if `now > expires_at` for an effect, the bulk resolver calculates `maxTicksByExpiry` correctly and processes all ticks that should have occurred. This already works. No change needed here.

## Implementation

### `src/features/combat/hooks/useOffscreenDotWakeup.ts`
- Replace the snapshot capture logic: instead of using `lastEffectsRef.current`, make an async query to the DB on node departure
- Query `active_effects` for the departed node
- Query `creatures` for HP at the departed node  
- Build the snapshot from fresh DB data
- Rest of the prediction and scheduling logic stays the same

### Verify `combat-catchup` bulk mode handles post-expiry correctly
- Add a diagnostic log when bulk mode processes effects where `now > expires_at` to confirm ticks are being applied
- No logic changes needed — the math is correct

## Files Changed

| File | Change |
|------|--------|
| `src/features/combat/hooks/useOffscreenDotWakeup.ts` | Query DB for effects on node departure instead of using stale in-memory state |
| `supabase/functions/combat-catchup/index.ts` | Add diagnostic logging for post-expiry effect processing |

## What Does NOT Change

- Combat formulas, tick rate, architecture
- `_shared/combat-resolver.ts` bulk mode logic (already correct)
- `combat-tick` effect creation/persistence
- Server authority over HP/death

