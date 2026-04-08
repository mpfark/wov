

# Stale Combat Session Fix — Safety Refinements

Two targeted changes, no other modifications.

## Change 1: Server — Reuse existing session creation path

**File:** `supabase/functions/combat-tick/index.ts` (lines 182-187)

Currently when `session.node_id !== node_id`, the server deletes the stale session and returns `session_ended: true`. Instead, delete the stale session and set `session = null`, allowing the existing creation logic at lines 159-173 to handle it.

Replace lines 182-187:
```typescript
if (session.node_id !== node_id) {
  await db.from('combat_sessions').delete().eq('id', session.id);
  console.log(JSON.stringify({ fn: 'combat-tick', session_deleted_reason: 'node_changed', session_id: session.id, old_node: session.node_id, new_node: node_id }));
  session = null;
}
```

Then wrap the existing session creation block (lines 159-179) so it also runs when `session` was just nulled. The simplest approach: move the node-mismatch check **before** the create-if-needed block, and adjust the condition so `session === null` after mismatch deletion triggers the normal creation path.

Restructured flow:
1. Load existing session (line 145)
2. **New:** If existing session has wrong node → delete it, treat as no session
3. Create session if needed (existing logic, unchanged)
4. If still no session → return idle

## Change 2: Client — Safer `session_ended` guard

**File:** `src/features/combat/hooks/usePartyCombat.ts` (lines 295-298)

Replace:
```typescript
if (result.sessionEnded) {
  stopCombat();
  return;
}
```

With:
```typescript
if (result.sessionEnded) {
  const stillEngaged =
    (result.aliveEngagedIds?.length ?? 0) > 0 ||
    engagedCreatureIdsRef.current.length > 0;
  if (!stillEngaged) {
    stopCombat();
    return;
  }
  // Ignore session_ended — next tick will create a fresh session
}
```

## Deployment

Redeploy the `combat-tick` edge function after the server-side change.

## Files Changed
| File | Change |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Move node-mismatch check before session creation; null out session instead of returning |
| `src/features/combat/hooks/usePartyCombat.ts` | Guard `session_ended` with alive-creature check |

