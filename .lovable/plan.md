## What's already in place

`src/features/inventory/hooks/useInventory.ts` already calls `sync_character_resources` after every equip and unequip:

```ts
await supabase.from('character_inventory').update({ equipped_slot: slot }).eq('id', inventoryId);
await syncResources();   // writes gear-adjusted max_hp/max_cp/max_mp to DB
fetchInventory();
```

The same RPC is also called on world entry (`GameRoute`), on stat allocation/respec/training, and after solo level-up. So the literal request — "sync after every equip/unequip" — is already implemented.

## The remaining gap (why you may still see snap-backs)

After `sync_character_resources` writes new `max_hp/max_cp/max_mp` to the DB, the client only learns about the new values via the Supabase realtime channel in `useCharacter`. If realtime is delayed, dropped, or briefly disconnected, the local `character.max_hp` stays stale and the bars show the pre-sync number — which looks identical to a snap-back.

We need an explicit refetch right after the sync RPC so the new caps are guaranteed to be in local state, regardless of realtime.

## Proposed change (small, surgical)

### 1. Pass `refetchCharacters` into `useInventory`

`useInventory(characterId)` currently doesn't know about the character store. Add an optional second arg:

```ts
useInventory(characterId, { onResourcesSynced })
```

…where `onResourcesSynced` is wired by `GameRoute` / `GamePage` to call `refetchCharacters()`.

### 2. Call it after every sync

In `useInventory.syncResources`:

```ts
const syncResources = useCallback(async () => {
  if (!characterId) return;
  try {
    await supabase.rpc('sync_character_resources', { p_character_id: characterId });
    onResourcesSynced?.();   // ← pull the fresh max_* into local state right away
  } catch (e) { console.error(...); }
}, [characterId, onResourcesSynced]);
```

### 3. Same treatment for the other sync sites

- `useStatAllocation`: it already takes a `refetch` callback — verify it's invoked after the RPC (currently the realtime echo is doing the work; make it explicit).
- `useCombatActions` solo level-up (line ~497): add a `refetchCharacters()` call right after the sync RPC.
- `GameRoute` world-entry sync (line 23): already followed by `refetchCharacters()`; verify and leave.

### 4. Optional safety net

Add a one-shot retry: if the local `max_hp` doesn't change within 500ms of an equip/unequip, retry the sync once. This defends against the rare case where the RPC succeeded but the trigger silently no-op'd. (Skip if you'd rather keep the change minimal.)

## Files touched

- `src/features/inventory/hooks/useInventory.ts` — accept `onResourcesSynced`, call it after every sync
- `src/pages/GamePage.tsx` (or wherever `useInventory` is constructed) — wire `refetchCharacters` in
- `src/features/character/hooks/useStatAllocation.ts` — explicit refetch after sync (if not already)
- `src/features/combat/hooks/useCombatActions.ts` — explicit refetch after the level-up sync RPC

No DB migration, no formula changes, no edge-function changes. Behavior change: the new gear-adjusted max appears in the UI within one round-trip of the equip click, instead of one round-trip + one realtime hop.

## Out of scope

- Touching the underlying formulas or the sync RPC itself.
- Reworking the realtime subscription.
