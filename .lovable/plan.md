

# Fix: Client Cannot Read `active_effects` Due to RLS

## Root Cause

The `active_effects` table only has a `service_role` RLS policy. When `useOffscreenDotWakeup` queries this table using the client-side Supabase client (authenticated role), RLS blocks all rows — returning 0 effects every time.

This explains the console log: `effects=0, creatures=1` on every departure, even when effects clearly exist (confirmed by edge function logs showing `effects_count: 1`).

## Solution

Two options:

**Option A (Recommended)**: Move the departure snapshot query to `combat-catchup` edge function (service role). Instead of the client querying `active_effects` directly, call `combat-catchup` with a new flag like `{ node_id, snapshot_only: true }` that returns effects + creature HP without resolving them. This keeps the service role as the only reader of `active_effects`.

**Option B**: Add a `SELECT` RLS policy for authenticated users on `active_effects`. This is simpler but exposes effect data to all authenticated users.

I recommend **Option A** because it maintains the existing security model.

## Implementation

### 1. Update `combat-catchup/index.ts`
- Add handling for a `snapshot_only: true` parameter
- When set, return `{ effects, creatures }` without resolving effects or modifying state
- Skip throttle check for snapshot requests

### 2. Update `useOffscreenDotWakeup.ts`
- Replace the direct `supabase.from('active_effects').select(...)` query with `supabase.functions.invoke('combat-catchup', { body: { node_id, snapshot_only: true } })`
- Parse the returned effects and creatures to build the snapshot
- Rest of prediction logic stays the same

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/combat-catchup/index.ts` | Add `snapshot_only` mode that returns raw effects + creatures |
| `src/features/combat/hooks/useOffscreenDotWakeup.ts` | Use `combat-catchup` instead of direct DB query |

