

# Stale HP / Burst Damage Fix — Refined Plan

## Root Cause

`combat-catchup` resolves offscreen DoT effects but does not update `combat_sessions.last_tick_at`. When the player re-enters and auto-aggro triggers `combat-tick`, it sees a stale `last_tick_at` from minutes ago and processes up to 30 retroactive auto-attack rounds in one burst.

## Fix A: Session-scoped `last_tick_at` update (server)

**File: `supabase/functions/combat-catchup/index.ts`**

After writing creature state (line 81), collect distinct `session_id` values from the processed effects (the `active_effects` table already has a `session_id` column). Update `last_tick_at = now` only for those specific sessions — not all sessions at the node.

```typescript
// After writeCreatureState, before loot drops:
const sessionIds = [...new Set(effects.map(e => e.session_id).filter(Boolean))];
if (sessionIds.length > 0) {
  await db.from('combat_sessions')
    .update({ last_tick_at: now })
    .in('id', sessionIds);
}
```

Add `sessions_reset: sessionIds.length` to the diagnostic log.

If an effect has no `session_id` (null), it is skipped — only explicitly linked sessions are updated.

## Fix B: Clear stale HP overrides on node change (client)

**File: `src/features/combat/hooks/usePartyCombat.ts`**

In the node-change effect (line 586-594), explicitly clear `creatureHpOverridesRef.current = {}` before calling `stopCombat()`:

```typescript
useEffect(() => {
  if (params.character.current_node_id !== prevNodeRef.current) {
    prevNodeRef.current = params.character.current_node_id;
    aggroProcessedRef.current = new Set();
    recentlyKilledRef.current = new Set();
    pendingAggroRef.current = true;
    // Clear stale creature overrides immediately
    creatureHpOverridesRef.current = {};
    setCreatureHpOverrides({});
    stopCombat();
  }
}, [params.character.current_node_id, stopCombat]);
```

## Fix C: Guard `processTickResult` against stale results (client)

**File: `src/features/combat/hooks/usePartyCombat.ts`**

Add early return at the top of `processTickResult` (line 155) if combat is no longer active:

```typescript
const processTickResult = useCallback((data: CombatTickResponse) => {
  if (!inCombatRef.current) return; // Ignore late/stale tick responses
  // ... rest unchanged
```

This prevents a late async response from a previous node/session from writing stale HP overrides.

## Fix D: Diagnostics (temporary)

**Server (`combat-catchup`)**: Add `sessions_reset` and `session_ids` to the existing diagnostic log.

**Client (`usePartyCombat`)**: Log when node-change clears overrides: `console.log('[combat] Node change — cleared creature HP overrides')`.

**Client (`useCreatures`)**: Already has catch-up ordering. No additional changes needed.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/combat-catchup/index.ts` | Update `last_tick_at` only for session IDs found in processed effects |
| `src/features/combat/hooks/usePartyCombat.ts` | Clear overrides on node change; guard `processTickResult` against stale results; diagnostic log |

## Constraints

- Only sessions linked to resolved effects are updated — no blanket node-wide reset
- Zero formula/timing/tick-rate changes
- Server remains authoritative

