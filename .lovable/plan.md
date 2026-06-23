## Cause

`GameRoute` renders `GamePage` on the very first render (before its sync effect has a chance to set `syncing = true`). That causes a quick mount → unmount → remount of `GamePage`:

1. Mount #1: `useFirstEntryWelcome` fires, writes the `localStorage` flag, schedules the staggered lines on bus A.
2. Effect runs, `setSyncing(true)` → `GamePage` unmounts. Bus A is discarded along with the event log state. The intro lines never get displayed.
3. Sync finishes → Mount #2 on bus B. The hook now sees the flag and emits "Welcome back, Wayfarer!".

## Fix

Don't mount `GamePage` until the entry sync for the current character has actually completed. One small change in `src/pages/GameRoute.tsx`:

- Replace the `syncing` boolean with a derived "synced for this character" check:
  - Show `<LoadingScreen />` whenever `syncedForCharRef.current !== character.id` (i.e. sync for the current character hasn't finished yet), in addition to the existing `authLoading / charLoading / nodesLoading` checks.
  - Keep the sync effect, but it no longer needs to flip a boolean for the gating — it just runs the RPCs and updates the ref / triggers a re-render via a tiny state bump.

Result: `GamePage` only ever mounts once per character entry, after sync is done. `useFirstEntryWelcome` runs once on the final bus and the 7-line intro plays.

## Files touched

- `src/pages/GameRoute.tsx` (only)

## Verification

- Create a new character on an account that already has one → 7-line intro plays.
- Reload the game on that same character → only "Welcome back, Wayfarer!" appears.
- Switch between two characters → each gets its own first-entry intro the first time, "Welcome back" thereafter.
