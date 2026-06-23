## Problem

When an existing user creates a brand-new character, the event log only shows the empty-state placeholder ("Your journey begins…") instead of the staggered first-entry welcome sequence (the 7-line "You awaken from a wandering daydream…" intro).

The welcome sequence lives in `src/features/world/hooks/useFirstEntryWelcome.ts` and emits via `addLocalLog` → `bus.emit('log:local')` → `setEventLog`. It only fires when no `localStorage` flag exists for that character id.

## Likely root cause

The hook uses a **module-level `Set` (`handledThisPageLoad`)** as a second gate on top of the `localStorage` flag. In the create-new-character flow there's a window where the hook can be invoked, mark the new character id as "handled", and then the actual emit never lands in the *current* `bus`:

1. `CharacterCreation` calls `onCharacterReady(char.id)` → context selects the new id.
2. `Index` navigates to `/game`. `GameRoute` mounts, `character?.id` is now set.
3. `GameRoute` starts `sync_character_resources` and renders `<LoadingScreen />` — `GamePage` (and its `bus` + `log:local` listener) is **not mounted yet**.
4. If anything during that window causes the hook to run with the new id (e.g. a transient mount of GamePage before `syncing` flips true, a StrictMode-style double effect on a parent, or a fast remount), the id gets added to `handledThisPageLoad` and the `localStorage` flag is scheduled (with a 6.3 s delay).
5. When `GamePage` finally mounts on the *new* bus, the hook bails out (`handledThisPageLoad.has(id)` is true), so no welcome lines are ever emitted on the bus that the event log is actually listening to.

The result: the user sees the placeholder text and never the intro. (Players who only ever have one character don't hit this because there's no prior session state and timing tends to align.)

## Fix

Make `localStorage` the single source of truth and remove the brittle module-level gate. Stamp the flag *at the moment we schedule the lines*, not 6.3 s later, so remounts during the opening seconds collapse cleanly to "Welcome back" instead of either double-firing or being silently suppressed.

Concrete changes in `src/features/world/hooks/useFirstEntryWelcome.ts`:

- Delete the module-level `handledThisPageLoad` set entirely.
- In the effect:
  - Read the `localStorage` flag synchronously.
  - If absent: write it **immediately**, then schedule the 7 staggered `emitRef.current(line)` calls.
  - If present: emit "Welcome back, Wayfarer!" once.
- Keep the `emitRef` indirection so late timers still reach the current `bus`.

## Why this fixes the reported case

- New character → no `localStorage` key → flag written immediately → all 7 lines scheduled against the live `GamePage` bus → they appear in the event log.
- Remount during the 6 s window → flag already set → "Welcome back" (acceptable fallback, no more stuck-on-placeholder state).
- Existing character returning → unchanged behavior.

## Files touched

- `src/features/world/hooks/useFirstEntryWelcome.ts` (only)

No DB, no other component changes.

## Verification

- Create a new character on an account that already has one → confirm the 7-line intro plays in the event log.
- Reload the game on that same character → confirm only "Welcome back, Wayfarer!" appears.
- Create a second new character → confirm the intro plays again for that one.
