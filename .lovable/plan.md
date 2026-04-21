

## Fix: CP Reverts to Full During Combat

### Root Cause

In `combat-tick/index.ts` (line 366), when initializing a member's CP for the tick, the server picks `Math.max(dbCp, client_cp)`. This was intended to capture client-side CP regen that hadn't been written to DB yet. However, when a player uses an ability:

1. Client deducts CP (e.g. 30 -> 20) and writes to DB
2. Next combat tick fires before the DB write lands
3. Server reads old DB value (30) and client reports 20
4. `Math.max(30, 20)` = 30 -- the deduction is reverted

The server then returns `cp: 30` in `member_states`, and the client applies it locally, restoring full CP.

### Fix

**`supabase/functions/combat-tick/index.ts`** -- Change the CP freshness logic from `Math.max` to `Math.min`. Since CP can only decrease between ticks during combat (ability usage), the lower value is always the more correct one. CP regen is suppressed during combat, so the "regen hasn't reached DB yet" scenario doesn't apply.

```typescript
// Before:
const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number')
  ? Math.min(Math.max(dbCp, client_cp), m.c.max_cp ?? dbCp)
  : dbCp;

// After:
const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number')
  ? Math.min(client_cp, m.c.max_cp ?? dbCp)
  : dbCp;
```

Then redeploy the `combat-tick` edge function.

### Files

| File | Action |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Fix CP freshness to use `Math.min` instead of `Math.max` |
| `combat-tick` edge function | Redeploy |

