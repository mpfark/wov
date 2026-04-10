

# Party Combat & Following Fixes

## Issues Identified

### 1. Non-leader combat state not activating
**Root cause**: In `usePartyCombat.ts` line 242, `processTickResult` exits immediately with `if (!inCombatRef.current) return;`. When the leader starts combat and broadcasts `combat_tick_result`, the non-leader has never set `inCombatRef.current = true`, so the first (and all subsequent) tick results are silently discarded. The non-leader sees "fighting" in the party panel (from server data) but their local combat UI never activates.

**Fix**: Remove the early return guard in `processTickResult` OR set `inCombatRef.current = true` before processing when the data contains valid combat results. Specifically: when a non-leader receives a `combat_tick_result` broadcast and `inCombatRef.current` is false, set it to true and proceed.

### 2. Member attacking overrides tank
**Root cause**: When a non-leader clicks attack, `startCombatCore` sends an `engage_request` broadcast and returns early (line 174-181) — correct. But the attack button in the UI also calls `handleAttack` which eventually calls `startCombat`, and since the member's local `inCombat` was never set to true (issue #1), it may re-trigger logic. The actual tank override happens server-side: the `combat-tick` function checks `tankAtNode` (line 871) correctly using `party.tank_id`. The real problem is that because the member's combat state isn't synced (issue #1), the member ends up initiating a *separate solo combat session* via `handleAttack` → the server creates a solo `character_id` session instead of using the party session. This solo session has no tank concept.

**Fix**: Once issue #1 is fixed (non-leader enters combat state via broadcast), the member won't try to create a separate session. Additionally, add a guard in `startCombatCore`: if a party member and not leader, don't call `doTick` — only send the `engage_request`.

### 3. XP rewards not showing for member
**Root cause**: Direct consequence of issue #1. Since `processTickResult` never runs for the non-leader, the XP/gold updates from `member_states` in the server response are never applied locally. The server does write them to the DB, so a refresh shows the correct values.

**Fix**: Resolved by fixing issue #1.

### 4. Follower movement lagging behind
**Root cause**: The follower's `current_node_id` update relies solely on Postgres realtime subscription (500ms-2s latency). The previously removed broadcast-based listener was faster. Without it, rapid leader movement can leave the follower's client state multiple nodes behind.

**Fix**: Re-add a lightweight client-side listener for `party_move` broadcasts that updates the follower's local character state immediately (optimistic), without writing to the DB (the leader already wrote it). This is not a duplicate write — it's a local state update for instant UI response.

## Changes

### File: `src/features/combat/hooks/usePartyCombat.ts`

1. **Fix `processTickResult` for non-leaders** (line 242): Instead of returning early when `!inCombatRef.current`, allow non-leaders to enter combat state when receiving valid tick data. Add logic before the guard:
```typescript
// Non-leader: enter combat when receiving broadcast tick results
if (!inCombatRef.current && ext.current.party && !ext.current.isLeader) {
  inCombatRef.current = true;
  setInCombat(true);
}
if (!inCombatRef.current) return;
```

2. **Set engaged creatures from tick data for non-leaders**: After processing the tick, ensure the non-leader's `engagedCreatureIds` state is populated from the server response's creature states, so the UI correctly shows which creatures are in combat.

### File: `src/pages/GamePage.tsx`

3. **Re-add follower movement broadcast listener**: Add back a `useEffect` that listens to `partyMoveEvents` for the current character's ID, and immediately updates local character state with `updateCharacterLocal({ current_node_id: newNodeId })`. This gives instant UI feedback while the Postgres realtime subscription catches up.

```typescript
useEffect(() => {
  if (!character || !partyMoveEvents.length) return;
  const myMove = partyMoveEvents.find(e => e.character_id === character.id);
  if (myMove && myMove.node_id !== character.current_node_id) {
    updateCharacterLocal?.({ current_node_id: myMove.node_id });
  }
}, [partyMoveEvents, character?.id]);
```

## Files touched

| File | What |
|------|------|
| `src/features/combat/hooks/usePartyCombat.ts` | Fix non-leader combat activation + engaged creature sync |
| `src/pages/GamePage.tsx` | Re-add follower movement broadcast listener for instant node sync |

