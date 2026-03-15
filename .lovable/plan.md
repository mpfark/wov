

## Add Creature Check to Search Restriction

### What
Prevent searching a node when there are living creatures present. The player must clear all creatures before they can search.

### Changes

**`src/hooks/useActions.ts`** (~line 539):
- Add an early return check: if there are alive creatures at the current node, log a message like "❌ You cannot search while creatures are nearby!" and return.
- The hook already has access to `p` params — need to verify creatures are passed in or accessible.

**`src/pages/GamePage.tsx`** (lines ~1177 and ~1237):
- Update `searchDisabled` from `character.cp < 5` to `character.cp < 5 || creatures.length > 0`
- This grays out the Search button when creatures are present.

**`src/hooks/useActions.ts`** (handleSearch guard):
- Add `if (p.creatures && p.creatures.length > 0)` guard with log message, as a server-side safety net even if the button is disabled.

Need to check if `creatures` is available in the useActions params or GamePage scope.

