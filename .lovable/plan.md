

# Optimization: Return Creatures from `combat-catchup`

## Insight

Merging `combat-tick` (988 lines of attack resolution) with creature fetching would create an unwieldy mega-function with two very different call patterns. But there's a simpler win hiding in plain sight.

## Current Flow (node entry)

```text
Client                    Server
  │                         │
  ├─ invoke combat-catchup ─►  (loads creatures internally, processes DoTs)
  │◄─── { caught_up: true } ──│
  │                         │
  ├─ SELECT * FROM creatures ► (loads the SAME creatures again)
  │◄─── [creature rows] ─────│
```

Two round-trips, and `combat-catchup` already has the up-to-date creature list in memory after processing DoTs — it just throws it away.

## Proposed Flow

```text
Client                    Server
  │                         │
  ├─ invoke combat-catchup ─►  (loads creatures, processes DoTs)
  │◄─ { creatures: [...] } ──│  (returns them directly)
  │                         │
  (done — no second query)
```

## Changes

### 1. `supabase/functions/combat-catchup/index.ts`
- Already loads creatures at the node. After processing DoTs and updating HP, return the final creature state in the response.
- If no effects exist, still query and return creatures (replacing the client-side fetch entirely for node entry).

### 2. `src/hooks/useCreatures.ts`
- `fetchCreatures`: Use the creatures returned by `combat-catchup` directly instead of making a separate DB query.
- Keep the fallback SELECT only for the 30s respawn-check interval (where calling catchup is wasteful since there may be no effects).

## What stays separate

- **`combat-tick`** remains its own function — it handles the 2s heartbeat with attacks, abilities, and DoTs. Different call pattern, different caller (`usePartyCombat`), different response shape.
- **Prefetch** for adjacent nodes stays as a direct DB query (no combat state to catch up on neighboring nodes).
- **Realtime updates** via the node channel remain unchanged.

## Impact

- Eliminates 1 round-trip on every node entry
- Zero change to `combat-tick` (no risk to active combat)
- `combat-catchup` grows by ~5 lines (adding creatures to the response when no effects exist)
- `useCreatures.fetchCreatures` shrinks (removes the post-catchup SELECT)

