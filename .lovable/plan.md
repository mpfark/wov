

# Client-Assisted Offscreen DoT Kill Completion — Refined Plan

## Summary

Same offscreen DoT wake-up plan as previously approved, with three refinements: tick-accurate lethal prediction, explicit leave-time snapshots, and wake-up rescheduling for surviving creatures.

## Refinement 1: Per-Effect Tick Simulation for Lethal Prediction

**File**: `src/features/combat/hooks/useOffscreenDotWakeup.ts`

**Previous approach**: Sum `damage_per_tick` across effects, divide HP by total DPS, multiply by tick interval. This is inaccurate when effects have different tick rates or expire at different times.

**Refined approach**: Simulate the future tick sequence using actual effect timing:

```text
function predictLethalTime(creatureHp, effects):
  hp = creatureHp
  // Build a timeline of all future ticks from all effects
  ticks = []
  for each effect:
    t = effect.next_tick_at
    while t <= effect.expires_at:
      ticks.push({ time: t, damage: effect.damage_per_tick })
      t += effect.tick_rate_ms
  // Sort by time, walk forward
  sort ticks by time
  for each tick in ticks:
    hp -= tick.damage
    if hp <= 0:
      return tick.time  // predicted death time
  return null  // effects expire before killing
```

- Uses `next_tick_at`, `expires_at`, `tick_rate_ms`, and `damage_per_tick` per effect
- Stops early when HP hits 0 — returns that tick's timestamp as predicted death time
- Returns `null` if all effects expire before the creature dies (no wake-up needed for kill)
- Still prediction-only — server determines real outcome
- Add +2s buffer to predicted time before scheduling `reconcileNode`

## Refinement 2: Explicit Leave-Time Snapshot

**File**: `src/features/combat/hooks/useOffscreenDotWakeup.ts`

**Previous approach**: Loosely reference `lastActiveEffects` from `usePartyCombat`.

**Refined approach**: Capture an explicit snapshot when the player leaves a node:

```typescript
interface OffscreenSnapshot {
  nodeId: string;
  capturedAt: number;             // Date.now() at departure
  creatureHp: Record<string, number>;  // creature_id → last known HP
  effects: Array<{
    target_id: string;
    effect_type: string;
    damage_per_tick: number;
    stacks: number;
    next_tick_at: number;
    expires_at: number;
    tick_rate_ms: number;
  }>;
}
```

- Snapshot is captured when `currentNodeId` changes (detected via `useEffect` on node ID)
- Uses `creatureHpOverrides` merged with creature base HP for accurate starting HP
- Uses the last `active_effects` from combat tick responses, enriched with `next_tick_at` and `tick_rate_ms` from the DB or from known defaults (2000ms)
- Prediction runs on this frozen snapshot, not on live-updating refs

**File**: `src/features/combat/hooks/usePartyCombat.ts`

- Store full `active_effects` array (including timing fields) in `lastActiveEffectsRef` on each tick response
- Return `lastActiveEffects` for the hook to consume

## Refinement 3: Wake-Up Rescheduling

**File**: `src/features/combat/hooks/useOffscreenDotWakeup.ts`

**Previous approach**: One wake-up per node, then done.

**Refined approach**: After each wake-up reconciliation call:

1. `reconcileNode(nodeId)` returns the reconciled creature list
2. If creature is dead or no relevant effects remain → clear tracked prediction, done
3. If creature is still alive and effects remain:
   - Fetch updated creature HP and effect state from the reconciled result
   - Re-run the tick simulation with updated data
   - If still predicted lethal → schedule another wake-up timer
   - If no longer lethal (effects expire first) → clear prediction
4. Max one active timer per node (clear old before scheduling new)
5. Safety cap: max 3 rescheduled wake-ups per node to prevent infinite loops

Implementation detail:
- `reconcileNode` already returns `Creature[]` — use this for updated HP
- For updated effects, query `active_effects` for the node after reconciliation (lightweight select)
- Track a `rescheduleCount` per node entry in the tracked map

## Everything Else: Unchanged

All other aspects of the plan remain as previously approved:

| Aspect | Status |
|--------|--------|
| New hook `useOffscreenDotWakeup.ts` | Unchanged (with refinements above) |
| `usePartyCombat.ts` — store + return `lastActiveEffects` | Unchanged |
| `GamePage.tsx` — wire the hook | Unchanged |
| `combat-catchup/index.ts` — log `reason` + `creatures_killed` | Unchanged |
| `combat/index.ts` — export new hook | Unchanged |
| Max 5 tracked nodes (FIFO) | Unchanged |
| 10s client throttle per node | Unchanged |
| Client never sends damage/HP/death state | Unchanged |
| Server remains sole authority | Unchanged |
| Diagnostics logging | Unchanged |

## Files Changed

| File | Change |
|------|--------|
| `src/features/combat/hooks/useOffscreenDotWakeup.ts` | New hook — per-effect tick simulation, explicit snapshot, reschedule logic |
| `src/features/combat/hooks/usePartyCombat.ts` | Store + return `lastActiveEffects` with timing fields |
| `src/features/combat/index.ts` | Export new hook |
| `src/pages/GamePage.tsx` | Wire `useOffscreenDotWakeup` |
| `supabase/functions/combat-catchup/index.ts` | Log `reason` + `creatures_killed` |

