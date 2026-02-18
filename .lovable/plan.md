

# Add Keybinds for Abilities, Potions, and Search + Update Movement Defaults

## Overview
Expand the keyboard binding system to cover abilities (1, 2, 3), belt potions (Shift+1 through Shift+6), and Search (S), while updating the default movement keys to a compass layout (Q/W/E/A/D/Z/X/C).

## Changes

### 1. Update Default Movement Bindings (`src/hooks/useKeyboardMovement.ts`)

Change `DEFAULT_BINDINGS` to the new compass layout:

```text
DEFAULT_BINDINGS = {
  NW: ['q'],  N: ['w'],  NE: ['e'],
  W:  ['a'],             E:  ['d'],
  SW: ['z'],  S: ['x'],  SE: ['c'],
}
```

Arrow keys will be removed from defaults (users can re-add them via the rebind UI).

### 2. Add Action Keybindings Type and Defaults (`src/hooks/useKeyboardMovement.ts`)

Add a new exported type and defaults for non-movement actions:

- **Search**: default key `s`
- **Ability 1/2/3**: default keys `1`, `2`, `3`
- **Potion 1-6**: default keys `Shift+1` (`!`), `Shift+2` (`@`), `Shift+3` (`#`), `Shift+4` (`$`), `Shift+5` (`%`), `Shift+6` (`^`)

Note: Shift+number keys produce special characters in `e.key` (e.g., `!`, `@`, `#`, `$`, `%`, `^`), so we'll bind to those actual key values.

A new `ActionBindings` type will map action names to their key(s), stored separately in localStorage under `action-keybindings`.

### 3. Expand the Hook Return Value (`src/hooks/useKeyboardMovement.ts`)

The hook will also accept callbacks for:
- `onSearch`: fires when search key is pressed
- `onUseAbility(index)`: fires when ability 1/2/3 key is pressed
- `onUseBeltPotion(index)`: fires when potion 1-6 key is pressed

The `keydown` handler will check action bindings after movement bindings. It will skip ability/potion keys if dead or in a dialog, same as movement.

### 4. Wire Up Callbacks in GamePage (`src/pages/GamePage.tsx`)

Pass `onSearch`, `onUseAbility`, and `onUseBeltPotion` callbacks to `useKeyboardMovement`:
- `onSearch` calls existing `handleSearch`
- `onUseAbility(index)` calls `handleUseAbility(index)` (with current heal target if applicable)
- `onUseBeltPotion(index)` calls `handleUseConsumable(beltedPotions[index].id)` if that slot exists

### 5. Update Keybindings UI in MapPanel (`src/components/game/MapPanel.tsx`)

Add a second section below the compass grid in the keybind popover showing the action bindings:
- A row for Search (S)
- A row for Abilities (1, 2, 3)
- A row for Potions (Shift+1 through Shift+6)

Each cell is rebindable with the same click-then-press-key pattern used for movement.

### 6. Show Keybind Hints in NodeView (`src/components/game/NodeView.tsx`)

Display small keybind hints on the action bar buttons:
- Search button shows `[S]`
- Ability buttons show `[1]`, `[2]`, `[3]`
- Belt potion buttons show `[!]`, `[@]`, etc. (or a cleaner label like `Sh+1`)

---

## Technical Details

### Shift+Number Key Values
On standard US keyboards, `e.key` for Shift+1 is `!`, Shift+2 is `@`, Shift+3 is `#`, Shift+4 is `$`, Shift+5 is `%`, Shift+6 is `^`. The binding system will store and match these characters directly. The `getKeyLabel` function will be updated to display them as `Sh+1`, `Sh+2`, etc.

### localStorage
- Movement bindings: `movement-keybindings` (existing)
- Action bindings: `action-keybindings` (new)
- Reset clears both to new defaults

### Conflict Handling
When a user binds a key that's already used (in either movement or action bindings), it will be removed from the old binding first, same as the current movement rebinding logic.

### Files Modified
- `src/hooks/useKeyboardMovement.ts` -- new defaults, action bindings, expanded keydown handler
- `src/pages/GamePage.tsx` -- pass action callbacks to the hook
- `src/components/game/MapPanel.tsx` -- expanded keybind UI
- `src/components/game/NodeView.tsx` -- keybind hint labels on buttons

