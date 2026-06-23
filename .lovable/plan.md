## Goal
Replace the Attributes-tab Wimp form with a compact control in the MapPanel's bottom toolbar: an HP threshold number input (absolute HP, not %) and a direction button that opens a compass picker popover.

## Changes

**Schema — `wimp_hp_threshold` semantics change from "percent" to "absolute HP"**
- New migration: drop the `0–100` CHECK constraint on `characters.wimp_hp_threshold` so values up to `max_hp` are allowed. Keep `>= 0`. Default stays 0 (disabled).
- No data migration needed — current values are 0 for all live characters (feature was just added).

**New component — `src/features/world/components/WimpControl.tsx`**
- Compact pill placed in the MapPanel bottom toolbar (between left action buttons and the right-side legend, or grouped with the action buttons).
- Layout: `[⚠️ icon] [number input HP] [direction button → popover]`
- HP input: small number field, min 0, max `character.max_hp`. 0 = disabled.
- Direction button: shows the current compass arrow (or `—` when none); clicking opens a Popover with a 3×3 compass grid (N/NE/E/SE/S/SW/W/NW + center "Off").
- Saving: debounced auto-save on change via `useGameContext().updateCharacter({ wimp_hp_threshold, wimp_direction })`. No explicit Save button.
- Visual state: glows amber when active (`threshold > 0 && direction`), muted when off.
- Tooltip on the wrapper: "Wimp: auto-flee when HP drops to this value".

**Wire-up — `src/features/world/components/MapPanel.tsx`**
- Render `<WimpControl character={character} />` inside the bottom toolbar's left action group.

**Auto-flee hook — `src/features/combat/hooks/useWimp.ts`**
- Change trigger condition from `(hp / max_hp) * 100 <= threshold` to `hp <= threshold` (absolute HP).
- Update the trigger log to show the HP value, not the percent.

**Remove old UI**
- Delete `src/features/character/components/WimpSettings.tsx`.
- Remove its import and `<WimpSettings />` usage from `CharacterPanel.tsx` (just under the Defense renderSection).

## Out of scope
- No party-wide wimp.
- No "wimp toward party leader" smart targeting.
- Threshold still client-enforced (closing the tab disables it) — unchanged from current behavior.