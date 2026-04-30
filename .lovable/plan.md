## What you're seeing

When you queue an ability:

1. The CP bar drops by the ability cost as a **reservation** (a translucent overlay on top of your actual CP).
2. ~2 seconds later the server tick fires, applies the real CP debit, and returns the new CP value.
3. **Bug:** for one or two render frames the bar visibly **pops back up** (looks like CP returned), then **drops back down** to the correct post-debit value.

## Root cause

In `usePartyCombat.doTick` two state updates happen one after the other after the server response:

- `processTickResult(result)` → calls `updateCharacterLocal({ cp: newLowerCp, ... })` (and ~10 other setStates, callbacks, and a `fetchGroundLoot()` side effect).
- Then `setPendingCpCost(0)` → drops the reservation overlay.

These two updates live in **different hooks** (`useCharacter` vs `usePartyCombat`) and are separated by callbacks that can break React's auto-batching (`fetchGroundLoot`, `onAbsorbSync`, `onCreatureDebuffs`, etc). The result is that React commits them in two separate paints. Depending on which one wins the race, the user sees the reservation lifted **before** the server CP debit lands — the bar visibly springs up, then falls back down a frame later.

The visual math in `StatusBarsStrip` makes it worse:

```ts
const cp = Math.max(0, rawCp - reservedCp);  // displayed value
```

So during the in-between frame, `rawCp` is still the OLD value but `reservedCp` is already 0 → bar shows the un-reserved (full) CP for one frame → "CP returned".

## Fix

Two complementary changes inside `src/features/combat/hooks/usePartyCombat.ts`:

1. **Clear the reservation in the same React batch as the server CP value.** Move `setPendingCpCost(0)` to fire **immediately before** `processTickResult(result)` rather than after it. Since the server response IS the post-debit truth, there's no value in keeping the overlay alive through a fan-out of callbacks. Doing the clear first means: when `updateCharacterLocal({ cp })` lands the new (already-debited) value, the reservation is already gone — no double-subtraction frame, no spring-up frame.

2. **Use `flushSync` to commit reservation-clear + character-CP together.** Wrap the pair so React guarantees a single paint:

   ```ts
   import { flushSync } from 'react-dom';
   // …
   flushSync(() => {
     setPendingCpCost(0);
     // updateCharacterLocal will run inside processTickResult immediately after
   });
   processTickResult(result);
   ```

   This eliminates the inter-render gap regardless of how many callbacks `processTickResult` fans out to.

3. **Defensive clamp in `StatusBarsStrip`.** When `reservedCp > rawCp - lastKnownCp` (i.e. the server has already debited more than the reservation), treat the reservation as already consumed:

   ```ts
   // If the server's rawCp has already dropped by at least reservedCp since the
   // reservation was made, the debit has landed — stop subtracting.
   const reservedToShow = Math.min(reservedCp, Math.max(0, rawCp - 0));
   ```

   This is a belt-and-braces guard so a future regression in the hook can't reintroduce a flicker.

## Files to edit

- `src/features/combat/hooks/usePartyCombat.ts` — reorder + `flushSync` the reservation clear so it commits with the server CP value (lines ~602–614 in `doTick`). Also keep the existing error-path clear at line ~600.
- `src/features/character/components/StatusBarsStrip.tsx` — small defensive guard on `reservedCp` so a stale reservation can never make the bar dip lower than the current `rawCp`.

## Out of scope

- No server changes. The combat-tick edge function already returns the correct post-debit CP — this is purely a client display sync issue.
- No changes to the reservation UX itself (the dashed overlay segment stays, it just stops flickering on resolution).
