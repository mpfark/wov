

# Fix: Server-Side Combat Catch-Up on Creature Fetch

## Problem
When a player leaves a node with active DoTs and returns, creature HP is stale because no `combat-tick` was called while away. The DoTs exist in the `combat_sessions` table but were never processed.

## Solution
Create a new Edge Function `combat-catchup` that the client calls before displaying creatures. It checks for active combat sessions on a node, runs the same deterministic catch-up logic (DoT ticking only — no auto-attacks since no player was present), writes updated creature HP to the DB, and returns. The client then fetches creatures normally with up-to-date HP.

## Architecture

```text
Player enters node
  → Client calls combat-catchup(node_id)
    → Server checks combat_sessions for this node
    → If session exists with active DoTs:
      → Compute elapsed ticks since last_tick_at
      → Process DoT damage (bleed, poison, ignite) per tick
      → Write creature HP updates to DB
      → Update or delete combat_sessions row
    → Returns { caught_up: true/false }
  → Client fetches creatures (now with correct HP)
```

## Step 1: New Edge Function `combat-catchup`

**File: `supabase/functions/combat-catchup/index.ts`**

Lightweight function that:
1. Accepts `{ node_id }` — no auth required beyond valid JWT
2. Queries `combat_sessions` where `node_id` matches (may be multiple sessions from different characters/parties)
3. For each session with active DoTs targeting creatures at this node:
   - Compute `elapsedMs = now - last_tick_at`, derive ticks (capped at 30)
   - Use deterministic `tickTime` per tick iteration
   - Process bleed/poison/ignite DoTs identically to `combat-tick`
   - Kill creatures that reach 0 HP (call `damage_creature` RPC)
   - Remove expired DoTs
   - Update `last_tick_at` deterministically
   - Delete session if no DoTs remain and no engaged creatures
4. Returns `{ caught_up: true, sessions_processed: N }`

The DoT processing logic will be extracted or duplicated from `combat-tick` (same formulas, same tick alignment).

## Step 2: Client — Call `combat-catchup` Before Fetching Creatures

**File: `src/hooks/useCreatures.ts`**

Modify `fetchCreatures`:
1. Before querying `creatures` table, invoke `combat-catchup` with the `node_id`
2. Wait for it to complete
3. Then fetch creatures as normal (HP is now up-to-date)

```typescript
const fetchCreatures = useCallback(async () => {
  if (!nodeId) { setCreatures([]); return; }
  
  // Catch up any active combat sessions for this node
  await supabase.functions.invoke('combat-catchup', {
    body: { node_id: nodeId }
  });
  
  // Now fetch with up-to-date HP
  const { data } = await supabase
    .from('creatures')
    .select('*')
    .eq('node_id', nodeId)
    .eq('is_alive', true);
  if (data) setCreatures(data as Creature[]);
}, [nodeId]);
```

## Step 3: Remove DoT Drain References from Client

**File: `src/hooks/usePartyCombat.ts`**

Remove any remaining `drainNodeRef` or DoT drain logic if present. The combat hook should simply stop combat on node change — the next visitor to the old node will trigger `combat-catchup` automatically.

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/combat-catchup/index.ts` | **New** — lightweight DoT catch-up processor |
| `src/hooks/useCreatures.ts` | Call `combat-catchup` before fetching creatures |
| `src/hooks/usePartyCombat.ts` | Remove any drain mode remnants |

## Security

- `combat-catchup` uses service role to read `combat_sessions` and write creature HP
- Validates JWT to prevent unauthenticated calls
- `node_id` is validated against existing nodes
- Tick cap (30) prevents abuse
- No client timestamps accepted — server `Date.now()` only

