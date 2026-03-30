

# Combat Progression Fixes (1, 3, 4, 5)

Implementing fixes for tick stalling, flee race conditions, stale HP display, and diagnostics. Deferring Fix 2 (server-side display tick cap).

---

## Fix 1: Eliminate tick-busy stalling

**File: `src/features/combat/hooks/usePartyCombat.ts`**

Currently line 355: `if (tickBusyRef.current) return;` silently drops ticks when a previous request is in-flight. With 2s intervals and potential edge function cold starts, this causes 4-6s gaps.

Change: Add a `tickPendingRef` so that when a tick is dropped due to busy, it's retried immediately when the current tick completes.

```typescript
// Add ref
const tickPendingRef = useRef(false);

// In doTick:
if (tickBusyRef.current) {
  tickPendingRef.current = true;
  return;
}
tickBusyRef.current = true;
try {
  // ... existing tick logic unchanged ...
} finally {
  tickBusyRef.current = false;
  if (tickPendingRef.current) {
    tickPendingRef.current = false;
    setTimeout(() => doTickRef.current(), 0);
  }
}
```

No formula or timing changes — just ensures missed polls are retried instead of silently lost.

---

## Fix 3: Synchronous flee — stop combat BEFORE node change

**File: `src/features/combat/hooks/usePartyCombat.ts`**

Add a new `fleeStopCombat` function that synchronously kills the tick interval before useActions changes the node. This prevents the race where the 2s interval fires one more tick on the old node after the player has logically fled.

```typescript
const fleeStopCombat = useCallback(() => {
  if (intervalRef.current) {
    clearWorkerInterval(intervalRef.current);
    intervalRef.current = null;
  }
  inCombatRef.current = false;
  tickBusyRef.current = false;
  tickPendingRef.current = false;
}, []);
```

Export `fleeStopCombat` from the hook return object.

**File: `src/hooks/useActions.ts`**

- Add `fleeStopCombat` to `UseActionsParams` interface
- In `moveToNode`, call `p.fleeStopCombat()` synchronously before the node update when `p.inCombat` is true (at line ~393, before the opportunity attack block)

**File: `src/pages/GamePage.tsx`**

- Pass `fleeStopCombat` from the combat hook to useActions params

---

## Fix 4: Prevent stale HP flash on node entry

**File: `src/features/creatures/hooks/useCreatures.ts`**

Currently the prefetch cache is applied *before* combat-catchup, so users briefly see stale HP. Reorder so that when catch-up is active, the prefetch cache is skipped and creatures are only set from the catch-up response.

```typescript
const fetchCreatures = useCallback(async (skipCatchup = false) => {
  if (!nodeId) { setCreatures([]); return; }

  if (!skipCatchup) {
    const { data } = await supabase.functions.invoke('combat-catchup', {
      body: { node_id: nodeId }
    });
    if (data?.creatures) {
      setCreatures(data.creatures as Creature[]);
      return;
    }
  }

  // Only use prefetch cache for skipCatchup (respawn interval) or catchup failure
  const cached = prefetchCache.get(nodeId);
  if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
    setCreatures(cached.data);
    prefetchCache.delete(nodeId);
    return;
  }

  const { data } = await supabase
    .from('creatures').select('*')
    .eq('node_id', nodeId).eq('is_alive', true);
  if (data) setCreatures(data as Creature[]);
}, [nodeId]);
```

---

## Fix 5: Diagnostics

**Server — `supabase/functions/combat-tick/index.ts`**

Add a `console.log` after tick processing with structured JSON: session_id, node_id, elapsed_ms, ticks_processed, engaged_count, effects_count.

**Server — `supabase/functions/combat-catchup/index.ts`**

Add a `console.log` after processing: node_id, effects_count, creatures_alive, kills.

**Client — `src/features/combat/hooks/usePartyCombat.ts`**

In `processTickResult`, log a warning when `ticks_processed > 1` (indicating catch-up occurred) with the gap since last tick.

---

## Files changed

| File | Change |
|------|--------|
| `src/features/combat/hooks/usePartyCombat.ts` | Add `tickPendingRef` retry, `fleeStopCombat`, client tick gap warning |
| `src/hooks/useActions.ts` | Add `fleeStopCombat` param, call it before node change on flee |
| `src/pages/GamePage.tsx` | Pass `fleeStopCombat` to useActions |
| `src/features/creatures/hooks/useCreatures.ts` | Reorder prefetch/catchup to prevent stale HP flash |
| `supabase/functions/combat-tick/index.ts` | Add structured diagnostic logging |
| `supabase/functions/combat-catchup/index.ts` | Add structured diagnostic logging |

## Constraints

- Zero formula changes
- Zero tick rate changes (still 2s)
- Server remains sole time authority
- No client-side simulation added
- Build + typecheck + tests must pass

