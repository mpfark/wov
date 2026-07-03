## Problem

The wimp system auto-flees in your **configured** compass direction whenever your HP is at/under your threshold. It has no idea that you already chose to flee manually in a different direction. Concrete case that just happened:

1. HP got low, you manually walked **northeast** away from the creature.
2. Combat was still active (HP still ≤ threshold on the next update).
3. Wimp fired for the first time and moved you **southwest** (your configured wimp direction) — back into the creature. You died.

Root cause: `useWimp.ts` has a `firedRef` latch that only resets when combat ends. It's never set when the player moves themselves, so wimp still has its "one free flee" available even after you've already escaped manually.

## Fix

Treat any **player-initiated movement while in combat** as "the player is handling it" and suppress wimp for the remainder of that combat session. Same latch, just tripped from a second source.

### Changes

**`src/features/combat/hooks/useWimp.ts`**
- Expose a new imperative method on `WimpApi`: `notifyPlayerMoved()` — sets `firedRef.current = true` (and clears `warnedNoPathRef` so nothing surprising logs).
- Keep the existing reset-on-combat-end effect so a fresh fight re-enables wimp.

**`src/features/world/hooks/useMovementActions.ts`**
- In `handleMove`, when the move succeeds and `options?.wimpFlee` is **not** set (i.e. the player initiated it) and combat is active, call the new `wimp.notifyPlayerMoved()`.
- Wiring: `useMovementActions` doesn't currently know about the wimp API. Simplest path is to accept an optional `onPlayerCombatMove?: () => void` callback in its params and have `GamePage.tsx` pass `() => wimpRef.current?.notifyPlayerMoved()`.

**`src/pages/GamePage.tsx`**
- Mirror the existing `wimpFleeRef` pattern with a `wimpNotifyRef` (needed because `useMovementActions` is created before `useWimp`).
- Pass the callback into `useMovementActions`, and populate the ref in the same effect that already wires `wimpFleeRef`.

### Explicitly out of scope

- No changes to threshold logic, wimp direction UI, opportunity-attack rules, or death-penalty math.
- Not changing Holy Shield / mutual-kill behavior (previous discussion).
- No new preference toggle — the "manual move suppresses wimp" behavior is on by default; if you ever want it configurable we can add a checkbox later.

### Verification

- Set wimp threshold high enough to trigger, engage a creature, drop below threshold, manually move once → wimp does not subsequently fire in this combat. Confirm no `⚠️ Wimp flee …` log after the manual move.
- End combat and re-engage → wimp fires normally again on the next low-HP tick.
- Do nothing manually while low HP → wimp still fires as before (regression check).
