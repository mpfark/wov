

# Refactor: Shared Combat/Effect Resolver

## Problem

Effect tick processing, creature HP writes, effect cleanup, and loot drops are implemented independently in both `combat-tick` and `combat-catchup`. This creates divergence risk where the same combat event produces different results depending on which path processes it.

## Shared Module

Create `supabase/functions/_shared/combat-resolver.ts` containing three extracted helpers:

### 1. `resolveEffectTicks(effects, creatureHpMap, killedSet, tickCap, now)`

Owns the core loop: for each effect, calculate elapsed ticks, apply damage, detect kills, advance `next_tick_at`, mark expired effects. Returns a result object with updated HP map, newly killed creature IDs, expired effect IDs, effects to upsert, and a loot queue.

This replaces:
- `combat-tick` lines 704-736 (DoT ticking inside the per-tick loop)
- `combat-catchup` lines 71-127 (the entire effect processing loop)

The key difference: `combat-tick` processes effects one tick at a time inside its outer tick loop (calling this once per tick with `tickTime`), while `combat-catchup` processes all elapsed ticks for each effect in bulk. The resolver supports both modes via a parameter:
- **Single-tick mode** (`tickTime` provided): process effects due at that tick time
- **Bulk mode** (`tickTime` omitted): calculate all elapsed ticks per effect and process them all

### 2. `processLootDrops(db, lootQueue)`

Owns loot table resolution, weighted item picking, unique item deduplication, and ground loot insertion. Returns loot event messages.

This replaces:
- `combat-tick` lines 888-927
- `combat-catchup` lines 149-180

### 3. `writeCreatureState(db, creatures, hpMap, killedSet)`

Calls `damage_creature` RPC for changed/killed creatures.

This replaces:
- `combat-tick` lines 770-778
- `combat-catchup` lines 129-138

### 4. `cleanupEffects(db, expiredIds, killedCreatureIds)`

Deletes expired effects and effects targeting killed creatures.

This replaces:
- `combat-tick` lines 929-944
- `combat-catchup` lines 140-147

## Changes to Endpoints

### `combat-tick/index.ts`
- Import and call `resolveEffectTicks` in single-tick mode inside the tick loop (replacing lines 704-736)
- Import and call `processLootDrops` (replacing lines 888-927)
- Import and call `writeCreatureState` (replacing lines 770-778)
- Import and call `cleanupEffects` (replacing lines 929-944)
- When `ticks === 0` and no pending abilities, query active effects and return them in the response instead of `active_effects: []`
- `handleCreatureKill` stays in combat-tick (it handles XP/gold/salvage/BHP split which is combat-tick-specific), but pushes to the same `lootQueue` format consumed by `processLootDrops`

### `combat-catchup/index.ts`
- Import and call `resolveEffectTicks` in bulk mode (replacing lines 71-127)
- Import and call `processLootDrops` (replacing lines 149-180)
- Import and call `writeCreatureState` (replacing lines 129-138)
- Import and call `cleanupEffects` (replacing lines 140-147)
- Session cleanup logic (lines 182-196) stays here as it's catchup-specific

### Comment/Documentation Cleanup
- Remove any remaining references to `combat_sessions.dots` — `active_effects` table is the sole source of truth
- Update comments in both endpoints to reference the shared resolver

## Data Flow

```text
combat-tick (per tick in loop)
  ├─ member auto-attacks (combat-tick only)
  ├─ resolveEffectTicks(single-tick mode)  ← shared
  ├─ creature counterattacks (combat-tick only)
  └─ after loop:
      ├─ writeCreatureState()              ← shared
      ├─ cleanupEffects()                  ← shared
      └─ processLootDrops()               ← shared

combat-catchup (on node entry)
  ├─ resolveEffectTicks(bulk mode)         ← shared
  ├─ writeCreatureState()                  ← shared
  ├─ cleanupEffects()                      ← shared
  └─ processLootDrops()                    ← shared
```

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/combat-resolver.ts` | New: shared resolver with 4 exported functions |
| `supabase/functions/combat-tick/index.ts` | Import shared helpers, remove ~120 lines of duplicated logic |
| `supabase/functions/combat-catchup/index.ts` | Import shared helpers, remove ~100 lines of duplicated logic |

## Constraints

- No formula changes — same damage, same tick rate, same timing
- Deterministic time advancement preserved (`next_tick_at += ticks * tick_rate_ms`)
- Tick cap behavior unchanged
- `active_effects` table remains sole source of truth for DoT state
- Fix: `combat-tick` returns actual active effects even when 0 ticks processed

