

# Improve Node-Entry Responsiveness

## Summary

Two-pronged approach: (1) show a loading/skeleton state for creatures while combat-catchup resolves, and (2) parallelize sequential DB queries in combat-catchup to reduce server latency.

## Changes

### 1. Add loading state to `useCreatures` (client)

**File: `src/features/creatures/hooks/useCreatures.ts`**

- Add a `loading` boolean state, returned alongside `creatures`
- Set `loading = true` at start of `fetchCreatures`, `false` when done
- On node change (line 112-114): set `loading = true` and `setCreatures([])` (keep current behavior)
- Add prefetch-based creature count hint: export the count of prefetched creatures for the target node so the UI can show the right number of skeleton rows

Return: `{ creatures, creaturesLoading, prefetchedCreatureCount }`

### 2. Show skeleton creatures in NodeView while loading (client)

**File: `src/features/world/components/NodeView.tsx`**

- Accept new prop `creaturesLoading?: boolean`
- When `creaturesLoading` is true and `creatures.length === 0`, render skeleton placeholder rows inside "In the Area":
  - Use existing `Skeleton` component
  - Show 1-3 placeholder rows (use prefetched count if available, else default to 2)
  - Each row: a skeleton bar matching creature row layout (name + HP bar shape)
- This avoids empty-looking nodes while preserving the rule that real HP only comes from catchup

### 3. Thread loading state through GamePage

**File: `src/pages/GamePage.tsx`**

- Destructure `creaturesLoading` from `useCreatures`
- Pass it to `NodeView` as `creaturesLoading`

### 4. Parallelize combat-catchup queries (server)

**File: `supabase/functions/combat-catchup/index.ts`**

Current: effects query (line 42) runs first, then creatures query (line 60) runs sequentially only if effects exist.

When effects exist, the two initial queries are independent. Parallelize them:

```typescript
const [{ data: effects }, { data: creaturesRaw }] = await Promise.all([
  db.from('active_effects').select('*').eq('node_id', node_id),
  db.from('creatures').select('*').eq('node_id', node_id).eq('is_alive', true),
]);
```

For the no-effects path: the creatures are already fetched, so return immediately instead of querying again.

Also parallelize the post-resolution writes where possible:
- `writeCreatureState` + `session timeline update` + `cleanupEffects` can run in parallel (they touch different tables)
- The sequential `advancedEffects` update loop can use `Promise.all`

Add timing diagnostic: `const t0 = Date.now()` at start, include `duration_ms: Date.now() - t0` in the log.

### 5. Client diagnostics (temporary)

**File: `src/features/creatures/hooks/useCreatures.ts`**

Log timing around catchup call:
```typescript
const t0 = performance.now();
// ... invoke combat-catchup
console.log(`[creatures] catchup for ${nodeId}: ${(performance.now() - t0).toFixed(0)}ms, ${data?.creatures?.length ?? 0} creatures`);
```

## Files Changed

| File | Change |
|------|--------|
| `src/features/creatures/hooks/useCreatures.ts` | Add `creaturesLoading` state + timing diagnostics |
| `src/features/world/components/NodeView.tsx` | Show skeleton rows when loading |
| `src/pages/GamePage.tsx` | Thread `creaturesLoading` to NodeView |
| `supabase/functions/combat-catchup/index.ts` | Parallelize queries + timing log |

## Constraints

- First visible real creature HP still comes from combat-catchup
- No prefetched HP shown as authoritative
- No formula/timing/authority changes
- Skeletons are clearly non-authoritative loading indicators

