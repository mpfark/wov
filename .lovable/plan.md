

# Fix: DoT Kill Rewards Not Updating Client + Duplicate Re-engagement Messages

## Issue 1: Rend/DoT Kill — No Reward Shown Until Reload

**Root cause**: When the last engaged creature dies from a DoT (bleed) tick during a live combat-tick, the server correctly awards XP/gold/BHP and persists them to the database. The client also applies the `member_states` update locally via `updateCharacterLocal`. However, if the creature dies between live ticks (e.g., after the combat loop stops because `aliveEngagedIds` becomes empty), the kill is resolved by `combat-catchup` on the next node visit. `combat-catchup` writes rewards to the DB but its response (`kill_rewards`) is never used to update client character state — the player only sees the change on reload.

Additionally, there's a subtle race: when the last creature dies from a DoT tick, `processTickResult` calls `stopCombat()` via `setTimeout(250ms)`, ending the tick loop. If there are still active effects for a creature the DoT hasn't finished killing yet (e.g., bleed still running), the kill resolves offscreen.

**Fix**: After `reconcileNode` returns in `useCreatures` (which is called on every node entry), check the `kill_rewards` in the catchup response and apply any pending rewards to the character. This requires:

1. **`useCreatures.ts`**: Return `kill_rewards` from `reconcileNode` to the caller
2. **`GamePage.tsx`**: After creatures are fetched on node entry, if `kill_rewards` exist, update the character with the awarded XP/gold/BHP/salvage and log the kill messages

## Issue 2: Duplicate Re-engagement Messages

**Root cause**: The re-engagement effect in `useCombatAggroEffects` (line 70-85) uses `creatures` as a dependency. When combat ends (`inCombat` → false), the effect fires and finds an aggressive creature. It logs a message and calls `startCombat`. But `startCombat` → `setInCombat(true)` is async state. Meanwhile, if `creatures` updates (e.g., from a postgres_changes realtime event updating the just-killed creature), the effect re-triggers. The `justStoppedRef` guard works for the re-engagement itself, but the **mid-fight join** effect (line 87-102) runs simultaneously and may also fire for the same creature if `engagedCreatureIdsRef` hasn't been updated yet.

**Fix**: Add the re-engaging creature's ID to `aggroProcessedRef` immediately in the re-engagement path, so the mid-fight join effect (which checks `aggroProcessedRef`) won't produce a duplicate message for the same creature.

## Changes

### `src/features/creatures/hooks/useCreatures.ts`
- Make `reconcileNode` return the full catchup response (including `kill_rewards`)
- Add a callback parameter to `useCreatures` for `onCatchupRewards`
- After reconcileNode succeeds and has `kill_rewards`, invoke the callback

### `src/pages/GamePage.tsx`
- Pass an `onCatchupRewards` callback to `useCreatures` that:
  - Updates character state with XP/gold/BHP/salvage from catchup rewards
  - Logs kill reward messages to the event log

### `src/features/combat/hooks/useCombatAggroEffects.ts`
- In the re-engagement effect (line 74-81), add `nextAggro.id` to `aggroProcessedRef` before calling `startCombat`, preventing the mid-fight join from duplicating the message

## Files Summary

| File | Action |
|------|--------|
| `src/features/creatures/hooks/useCreatures.ts` | Return catchup rewards, add callback |
| `src/pages/GamePage.tsx` | Handle catchup rewards for character updates |
| `src/features/combat/hooks/useCombatAggroEffects.ts` | Add aggroProcessedRef guard to re-engagement |

