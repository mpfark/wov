

# Adjustment: Deterministic Tick Timing in Server-Authoritative Combat

## Problem

The current plan sets `last_tick_at = now` after processing, which causes time drift — fractional milliseconds are lost each cycle, and capped ticks discard unprocessed time entirely.

## Changes to the Plan

These adjustments apply to **Step 2** (Server — combat-tick Edge Function) of the existing refactor plan. No other steps change.

### 1. Advance `last_tick_at` by exact tick count, not wall clock

```text
BEFORE:  last_tick_at = now
AFTER:   last_tick_at = last_tick_at + (ticks * TICK_RATE)
```

This keeps tick boundaries perfectly aligned regardless of when requests arrive.

### 2. Use `tickTime` inside the loop, not `now`

Each iteration computes its own deterministic timestamp:

```typescript
const previousLastTickAt = session.last_tick_at;
for (let t = 0; t < ticks; t++) {
  const tickTime = previousLastTickAt + (t + 1) * TICK_RATE;
  // All DoT expiry/next_tick checks use tickTime
  // e.g. if (dot.expires_at <= tickTime) → remove
  // e.g. while (dot.next_tick_at <= tickTime) → apply + advance
}
```

This ensures every tick resolves at its mathematically correct point in time, making results identical regardless of request timing or batch size.

### 3. Preserve unprocessed time when tick cap is hit

When `ticksToProcess` exceeds the safety cap (e.g. 30), the excess time must not be discarded:

```typescript
const TICK_CAP = 30;
const ticksToProcess = Math.floor(elapsedMs / TICK_RATE);
const ticks = Math.min(ticksToProcess, TICK_CAP);

// After processing:
if (ticksToProcess > TICK_CAP) {
  const processedMs = ticks * TICK_RATE;
  const remainingMs = elapsedMs - processedMs;
  session.last_tick_at = now - remainingMs;
} else {
  session.last_tick_at = session.last_tick_at + ticks * TICK_RATE;
}
```

The next request will pick up from the correct point, processing the remaining ticks without loss.

### Summary of what changes in the plan

| Aspect | Old plan | Updated |
|--------|----------|---------|
| `last_tick_at` update | `= now` | `+= ticks * TICK_RATE` |
| DoT/effect time reference | `now` | `tickTime` per iteration |
| Tick cap overflow | Time lost | Remainder preserved via `now - remainingMs` |

Everything else in the refactor plan (combat_sessions table, DoT JSONB structure, client simplification, party sync) remains unchanged.

