

## Diagnosis: What the Server-Side Heartbeat Broke

The core problem is that `usePartyCombat` now handles **all** combat (solo + party), but it has several regression bugs compared to the old client-side `useCombat`:

### Bug 1: Combat doesn't re-engage when leaving and re-entering a node with passive creatures
**Root cause**: When you leave a node, the node-change effect in `usePartyCombat` (line 578) either enters DoT drain or calls `stopCombat()`. When you return, the **aggro processing** in GamePage (lines 518-535) only triggers for `is_aggressive` creatures. Passive creatures you were fighting are forgotten because `engagedCreatureIds` was cleared by `stopCombat()`.

The old `useCombat` had the same limitation, but the **difference** is timing — old combat used client-side intervals that were faster to re-engage. The server heartbeat adds latency on top.

### Bug 2: Empty tick response kills combat prematurely
**Root cause**: Line 453 — `if (!result || (!result.events?.length && !result.creature_states?.length))` calls `stopCombat()`. The edge function returns empty arrays when creatures die between ticks (DB already updated by realtime), causing a false "no combat" signal. The old `useCombat` checked the local creature list instead.

### Bug 3: DoT drain interferes with normal combat flow
**Root cause**: Multiple overlapping `useEffect` hooks for node changes create race conditions. The `stopCombat()` in the node-change effect clears `engagedCreatureIds` and `inCombat`, then the aggro effect tries to re-engage but the timing between creature fetch and the aggro timeout is fragile.

### Bug 4: `justStoppedRef` auto-re-aggro doesn't fire reliably
**Root cause**: Line 534-548 — the re-aggro effect depends on `params.creatures` updating *after* `inCombat` becomes false. If creatures haven't loaded yet (they're cleared synchronously in `useCreatures` on node change), the effect fires with an empty list and never retries.

---

## Plan to Fix

### 1. Fix empty-response premature combat stop
In `usePartyCombat.doTick` (around line 453), change the empty-result check: only stop combat if the server explicitly returns no alive creatures in `creature_states`, not just because events are empty. A tick with no events but alive creatures should be a no-op, not a combat stop.

### 2. Fix re-engagement after node change
In the node-change effect (line 578), instead of clearing all engaged IDs, **preserve the engaged creature IDs when entering a node we already had combat on**. More importantly, fix the auto-aggro re-engagement in `usePartyCombat` (lines 534-548) to properly wait for creatures to load before deciding there's nothing to fight.

Add a `pendingAggroRef` pattern (similar to GamePage's) inside `usePartyCombat` so that after `stopCombat()` from a node change, it waits for the creature list to populate before deciding whether to re-engage.

### 3. Consolidate aggro logic — remove duplication
Currently, aggro processing exists in **two places**: GamePage (lines 505-535) AND `usePartyCombat` (lines 526-566). These race against each other. The fix is to remove the GamePage aggro processing entirely and let `usePartyCombat` own it, with a proper "wait for creatures" mechanism.

### 4. Fix passive creature re-engagement on return
When the player returns to the same node and clicks a passive creature, `startCombat` should work. The current implementation looks correct for this case — if clicking doesn't work, it's because the edge function returns empty (Bug 2) and immediately stops combat. Fixing Bug 2 fixes this.

---

### Files to change

1. **`src/hooks/usePartyCombat.ts`**
   - Fix empty-response handling in `doTick` — only stop when server confirms 0 alive creatures
   - Add `pendingAggroRef` pattern for reliable post-node-change auto-aggro
   - Ensure `justStoppedRef` re-aggro waits for creature list to be non-empty

2. **`src/pages/GamePage.tsx`**
   - Remove the duplicate aggro processing block (lines 505-535) since `usePartyCombat` now owns all combat lifecycle

3. **`supabase/functions/combat-tick/index.ts`**
   - Ensure the function always returns `creature_states` for alive creatures at the node even when no attacks happen, so the client can distinguish "no combat activity this tick" from "no creatures exist"

