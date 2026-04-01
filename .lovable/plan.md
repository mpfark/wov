

# Fix: Offscreen DoT Kill Rewards + Creature State on Re-entry

## Issue 1: Wrong reward info for level 42 character

The `combat-catchup` reward logic correctly sets `xpEach = 0` for level 42 characters (line 282-284). However, the `kill_rewards` response object on line 298 recalculates `xp_each` using a different formula that ignores the level cap check. It uses `primaryChar.level` with `xpPenalty` but doesn't check `uncapped`.

Additionally, the client-side log message in `useOffscreenDotWakeup.ts` (line 251) always shows `+${reward.xp_each} XP` even when it should say "Your power transcends experience." and the `salvage_each` reward is never shown in the message.

**Fix in `combat-catchup/index.ts`:**
- Line 298: Use 0 for `xp_each` when `primaryChar.level >= 42`
- Add `primary_level` to the kill_rewards object so the client can format correctly

**Fix in `useOffscreenDotWakeup.ts`:**
- Check if `xp_each === 0` and adjust the log message accordingly (show transcend message or omit XP)
- Include salvage in the log message when present

## Issue 2: Creature appears alive when re-entering the node

The `reconcileNode` call on node entry (force=true) calls `combat-catchup`. If the wake-up timer already killed the creature and cleaned up effects, catchup returns `effects_count: 0, creatures_alive: 0` and `reconcileNode` returns `[]`. Then the fallback DB query also returns `[]`. The creature should not appear.

**But if the player returns BEFORE the wake-up timer fires**, the effects still exist in the DB. The entry `combat-catchup` call should resolve them. Looking at the logs, this works (`effects_count:1, kills:1`). The problem is that the reconcileNode result (empty creature list = dead) is returned, but a **realtime channel update** arrives showing the creature's old alive state, temporarily re-inserting it into the creatures array. Then `damage_creature` RPC fires `is_alive=false`, which triggers another realtime update that removes it — causing the "attacks then disappears" behavior.

**Fix in `useCreatures.ts`:**
- When `fetchCreatures` runs and gets reconciled results, set a flag (ref) indicating "authoritative fetch in progress" 
- During this window, ignore realtime creature inserts/updates that would add creatures not in the reconciled set
- Simpler approach: after reconcileNode returns, if it processed kills (returned fewer creatures than expected), briefly suppress realtime creature additions for that node

Actually, the simplest fix: the `onCreatureUpdate` handler on line 141-155 already handles `!updated.is_alive` by filtering out. The issue is likely that the creature row gets updated twice: first `hp` changes (still alive), then `is_alive=false`. The first update shows the creature with reduced HP, and the second removes it. During the gap, auto-aggro kicks in.

**Better fix**: In `fetchCreatures`, after reconcileNode completes successfully, mark the reconciled creature IDs. In `onCreatureUpdate`, if a creature arrives that wasn't in the reconciled set AND it's the current node, skip adding it. This is complex.

**Simplest fix**: Suppress creature-initiated combat for a short grace period after node entry. The `useCreatures` hook already clears creatures to `[]` on node change (line 177). The reconcileNode call then returns the authoritative list. Any realtime updates that arrive during reconciliation showing stale alive creatures get processed by the handler — but since the creature is about to be killed, it briefly appears. 

The real fix is to ensure `writeCreatureState` in `combat-catchup` sets `is_alive=false` BEFORE returning the response, which it does (it calls `damage_creature` RPC). The realtime update for `is_alive=false` should fire. The race is between the reconcileNode HTTP response arriving (setting creatures=[]) and the realtime postgres_changes event arriving (re-adding the creature).

**Proposed fix**: After `fetchCreatures` sets creatures from reconcileNode, add a short "reconcile lock" (500ms ref flag). During this window, `onCreatureUpdate` should not re-add creatures that aren't already in the current list.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/combat-catchup/index.ts` | Fix `xp_each` in kill_rewards to respect level 42 cap |
| `src/features/combat/hooks/useOffscreenDotWakeup.ts` | Fix log message for level 42 (transcend), include salvage |
| `src/features/creatures/hooks/useCreatures.ts` | Add reconcile lock to prevent realtime re-adding dead creatures |

