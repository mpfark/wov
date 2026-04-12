

# Optimized combat-tick DB Queries — Refined Plan

## Summary

Same optimization approach (parallelize reads, batch effect upserts, parallelize writes). Two safety refinements applied.

## Refinement 1: Order-dependent writes stay sequential

Post-tick writes split into two phases:

**Phase A — parallel (independent writes):**
```typescript
await Promise.all([
  writeCreatureState(db, creatures, cHp, cKilled),
  cleanupEffects(db, expiredIds, killedCreatureIds),
  ...memberUpdatePromises,
  ...degradePromises,
]);
```

**Phase B — sequential (order-dependent):**
```typescript
// Loot depends on killed creatures being persisted
const lootEvents = await processLootDrops(db, lootQueue);

// Effect upsert after cleanup to avoid conflicts
if (liveEffects.length > 0) {
  const rows = liveEffects.map(e => { const { _expired, ...row } = e; return row; });
  await db.from('active_effects').upsert(rows, { onConflict: 'source_id,target_id,effect_type' });
}

// Session update last (reflects final state)
await db.from('combat_sessions').upsert(sessionRow);
```

This preserves the performance win from Phase A while preventing ordering bugs in Phase B.

## Refinement 2: Batch upsert conflict key is verified safe

Confirmed: `active_effects` has a `UNIQUE` constraint on `(source_id, target_id, effect_type)`:

```
active_effects_source_id_target_id_effect_type_key UNIQUE (source_id, target_id, effect_type)
```

The in-memory effect model enforces this too — poison/ignite/bleed find-and-update existing rows rather than creating duplicates (lines 705, 724 of combat-tick). Batch upsert with `onConflict: 'source_id,target_id,effect_type'` is correct.

## Everything else unchanged from original plan

- Parallelize reads (equipment, creatures, effects, xp_boost) via `Promise.all`
- Early-exit idle path: parallelize the two queries
- No DB schema changes, no client changes, no combat logic changes

## File touched

| File | Change |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Parallelize reads, split writes into independent-parallel + ordered-sequential phases, batch effect upserts |

