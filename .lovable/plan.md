

# Cap Level at 42 in Combat Tick

## Problem
The server-side `combat-tick` edge function (party combat) has no level 42 cap check. Line 574 allows leveling beyond 42. The solo combat path in `useActions.ts` already has the cap (`&& p.character.level < 42`), but the server path does not.

## Fix

**File: `supabase/functions/combat-tick/index.ts`** (line 574)

Add level cap check to the level-up condition:
```typescript
// Before (no cap):
if (newXp >= needed) {

// After (capped at 42):
if (newXp >= needed && c.level < 42) {
```

Also cap XP accumulation at level 42 — players at max level should stop gaining XP entirely, so excess XP doesn't pile up:
```typescript
// After level-up block, before writing xp:
if (newLevel >= 42) {
  newXp = 0; // No XP accumulation at max level
}
```

**File: `supabase/functions/admin-users/index.ts`** — already has the cap, no changes needed.

**File: `src/hooks/useActions.ts`** — already has the cap, no changes needed.

This is a one-line fix in the edge function plus an optional XP reset to prevent phantom XP bars filling at max level.

