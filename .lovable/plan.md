

# Fix: Status Bars Resetting After Login

## Root Cause

When regen ticks fire, `updateCharacter` is called which:
1. Marks HP/CP/MP as "pending" to protect against realtime reverts
2. Updates local state optimistically (bars go up)
3. Writes clamped values to DB (HP clamped to `max_hp`, which excludes gear bonuses)
4. **Immediately clears the pending flag** in the `finally` block

The problem: the Supabase realtime echo from that DB write arrives *after* pending is cleared. Since pending is empty, the realtime handler accepts the stale/clamped DB value and overwrites the local optimistic state — bars snap back down.

Switching tabs triggers a re-render or new realtime event that happens to arrive in sync, which is why it "fixes itself."

## Fix

**One change in `src/features/character/hooks/useCharacter.ts`:**

In `updateCharacter` (line 217-224), replace the immediate pending-clear in `finally` with a delayed timeout (same pattern as `updateCharacterLocal` already uses):

```typescript
// Before (clears immediately — realtime echo arrives later and reverts)
finally {
  const current = pendingWritesRef.current.get(charId);
  if (current) {
    fields.forEach(f => current.delete(f));
    if (current.size === 0) pendingWritesRef.current.delete(charId);
  }
}

// After (delay clearing so the realtime echo is ignored)
finally {
  setTimeout(() => {
    const current = pendingWritesRef.current.get(charId);
    if (current) {
      fields.forEach(f => current.delete(f));
      if (current.size === 0) pendingWritesRef.current.delete(charId);
    }
  }, 3000);
}
```

This gives the realtime subscription time to deliver its echo while the fields are still marked as pending, so the echo is ignored and local optimistic values are preserved.

No other files need changes.

