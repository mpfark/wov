## Goal

Stop replaying the long first-entry welcome for established characters when they log in from a new device or after localStorage gets cleared. New level-1 characters still get the full immersive intro on their actual first entry.

## Behavior

In `src/features/world/hooks/useFirstEntryWelcome.ts`:

- If `character.level > 1` and there's no existing localStorage flag for that character, **skip the long intro and emit "Welcome back, Wayfarer!"** instead. Also write the localStorage flag so the logic stays consistent on subsequent entries.
- If `character.level === 1` and no flag exists → play the full `FIRST_LINES` sequence as today (genuine first entry).
- If the flag already exists → "Welcome back, Wayfarer!" as today.

## Technical notes

- Pass `characterLevel` into `useFirstEntryWelcome` from the caller (likely `GamePage`), alongside the existing `characterId` and `emit`.
- Update the hook signature: `useFirstEntryWelcome(characterId, characterLevel, emit)`.
- No DB change, no server change, no other call sites affected.

## Caveat (for awareness, no action)

This is still client-side, so localStorage eviction on a level-1 character could replay the intro once. In practice, characters spend very little time at level 1, so this edge case is small.
