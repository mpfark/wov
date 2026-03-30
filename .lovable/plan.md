

# Fix: Fully Deterministic `last_tick_at` Advancement

## Problem

Both `combat-tick` and `combat-catchup` contain a branch that sets `last_tick_at = now - remainingMs` when the tick cap is hit. This introduces wall-clock dependency and potential drift.

## Change

Remove the `if (ticksToProcess > TICK_CAP)` branch in both files. Always use the same formula:

```typescript
newLastTickAt = previousLastTickAt + ticks * TICK_RATE;
```

The next request will compute `elapsedMs = now - last_tick_at`, which naturally includes any unprocessed remainder from the capped ticks.

## Files

| File | Lines | Change |
|------|-------|--------|
| `supabase/functions/combat-tick/index.ts` | ~795-802 | Replace if/else with single assignment |
| `supabase/functions/combat-catchup/index.ts` | ~199-206 | Replace if/else with single assignment |

Both blocks change from:
```typescript
let newLastTickAt: number;
if (ticksToProcess > TICK_CAP) {
  const processedMs = ticks * TICK_RATE;
  const remainingMs = elapsedMs - processedMs;
  newLastTickAt = now - remainingMs;
} else {
  newLastTickAt = previousLastTickAt + ticks * TICK_RATE;
}
```

To:
```typescript
const newLastTickAt = previousLastTickAt + ticks * TICK_RATE;
```

