

# Refactor: Independent `active_effects` Table (LP-Style DoTs)

## Overview

Replace the JSONB `dots` column in `combat_sessions` with a dedicated `active_effects` table where each DoT is its own row. This decouples effect lifecycle from session lifecycle, simplifies catch-up logic, and enables cleaner multi-caster support.

## Current Architecture

```text
combat_sessions.dots = {
  [character_id]: {
    bleed:  { [creature_id]: { damage_per_tick, stacks, next_tick_at, expires_at } },
    poison: { [creature_id]: { ... } },
    ignite: { [creature_id]: { ... } }
  }
}
```

All DoTs live inside one JSONB blob per session. Creation, ticking, expiry, and kill-cleanup all require JSON surgery on this blob in both `combat-tick` and `combat-catchup`.

## New Architecture

```text
active_effects table:
  id              uuid PK
  node_id         uuid NOT NULL          -- indexed, used by catch-up
  target_id       uuid NOT NULL          -- creature id
  source_id       uuid NOT NULL          -- character id who applied it
  session_id      uuid NULL              -- FK to combat_sessions (nullable for persistence beyond session)
  effect_type     text NOT NULL          -- 'bleed' | 'poison' | 'ignite'
  stacks          int NOT NULL DEFAULT 1
  damage_per_tick int NOT NULL
  next_tick_at    bigint NOT NULL
  expires_at      bigint NOT NULL
  tick_rate_ms    int NOT NULL DEFAULT 2000
  created_at      timestamptz DEFAULT now()
```

RLS: service_role only (same as `combat_sessions`).

Index: `(node_id, expires_at)` for efficient catch-up queries.

## Migration Plan

### Step 1: Database Migration

Create `active_effects` table with the schema above, RLS policy for service_role, and index on `(node_id)`.

### Step 2: Update `combat-tick` Edge Function

**DoT creation** (lines ~602-629): Instead of writing into `sessionDots[charId].poison[creatureId]`, INSERT a row into `active_effects`:
```typescript
await db.from('active_effects').upsert({
  node_id: combatNodeId,
  target_id: target.id,
  source_id: m.id,
  session_id: session.id,
  effect_type: 'poison',
  stacks: newStacks,
  damage_per_tick: dmgPerTick,
  next_tick_at: tickTime + TICK_RATE,
  expires_at: tickTime + 25000,
}, { onConflict: 'source_id,target_id,effect_type' });
```

Add a unique constraint on `(source_id, target_id, effect_type)` to support upsert (one effect per type per caster per target).

**DoT ticking** (lines ~692-772): Query `active_effects` for the session's node instead of iterating `sessionDots`:
```typescript
const { data: effects } = await db.from('active_effects')
  .select('*').eq('node_id', combatNodeId);
```
Process each row, update `next_tick_at`, delete expired rows.

**Kill cleanup** (lines ~288-293): Instead of purging from JSONB, delete rows:
```typescript
await db.from('active_effects').delete().eq('target_id', creature.id);
```

**Response**: Replace `active_dots` JSONB response with a structured array from the `active_effects` query, mapped back to the existing client format for backward compatibility.

**Session cleanup** (lines ~965-985): Remove `dots` from the session update. Session end check uses `active_effects` count instead:
```typescript
const { count } = await db.from('active_effects')
  .select('id', { count: 'exact', head: true })
  .eq('session_id', session.id);
const hasActiveDots = (count || 0) > 0;
```

### Step 3: Update `combat-catchup` Edge Function

Simplify dramatically — instead of parsing JSONB per session, query effects by node:
```typescript
const { data: effects } = await db.from('active_effects')
  .select('*').eq('node_id', node_id).gt('expires_at', 0);
```
Process ticks on each effect row, update creature HP, delete expired effects. Session lookup becomes optional (only needed to update `last_tick_at`).

### Step 4: Client-Side Updates

**`usePartyCombat.ts`**: Update `CombatTickResponse.active_dots` handling. The server response shape changes from nested JSONB to a flat array. Map it in `processTickResult`:
```typescript
// Server now returns: active_effects: [{ source_id, target_id, effect_type, stacks, ... }]
// Convert to existing format for UI compatibility:
const dotsByChar: Record<string, any> = {};
for (const eff of data.active_effects || []) {
  if (!dotsByChar[eff.source_id]) dotsByChar[eff.source_id] = { bleed: {}, poison: {}, ignite: {} };
  dotsByChar[eff.source_id][eff.effect_type][eff.target_id] = {
    stacks: eff.stacks, damage_per_tick: eff.damage_per_tick, expires_at: eff.expires_at,
  };
}
ext.current.onActiveDots?.(dotsByChar);
```

**`GamePage.tsx`**: `handleActiveDots` callback remains unchanged — it already consumes the `Record<string, any>` format.

### Step 5: Remove `dots` Column from `combat_sessions`

After verifying the new system works, drop the `dots` column via migration:
```sql
ALTER TABLE combat_sessions DROP COLUMN dots;
```

## Files Modified

| File | Change |
|------|--------|
| Migration SQL | Create `active_effects` table, unique constraint, RLS, index |
| `supabase/functions/combat-tick/index.ts` | Replace all `sessionDots` JSONB operations with `active_effects` table queries |
| `supabase/functions/combat-catchup/index.ts` | Query `active_effects` by `node_id` instead of parsing session JSONB |
| `src/hooks/usePartyCombat.ts` | Map new `active_effects` array response to existing client format |
| Migration SQL (cleanup) | Drop `dots` column from `combat_sessions` |

## Impact Summary

- **Database**: ~50-100 rows at peak. One index scan per catch-up. Net neutral on write load (upserts replace JSONB updates).
- **Backward compatible**: Client UI code (`NodeView`, `GamePage` DoT display) requires zero changes — the mapping layer in `usePartyCombat` preserves the existing format.
- **LP-style benefit**: Effects are independent objects that survive session deletion, enabling future features like environmental DoTs or cross-session debuffs.

