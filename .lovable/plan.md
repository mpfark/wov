

## Character Panel Layout: Two-Column Stats + Buffs

### Overview
Restructure the Attributes section of the Character Panel into a two-column layout. Column 1 shows stats with base values (no modifier display). Column 2 shows active buffs, giving them a dedicated, always-visible home instead of being a small strip above the XP bar.

### Current vs New Layout

```text
CURRENT:                              NEW:
+----------------------------+        +----------------------------+
| Attributes                 |        | Attributes                 |
| Stat    Base +Gear  Mod [+]|        | +-------------+-----------+|
| STR     11   +2    (+1) [+]|        | | STR  11 +2  | Inn  3x   ||
| DEX     10        ( 0)     |        | | DEX  10     | Potion 3x ||
| CON     12   +1   (+1) [+]|        | | CON  12 +1  | Food +2   ||
| ...                        |        | | INT   9     | Eagle Eye ||
|                            |        | | WIS  10     |           ||
| Active Buffs (separate)    |        | | CHA  11     |           ||
| [Inn] [Potion] [Food]     |        | +-------------+-----------+|
+----------------------------+        | AC 14+2      Gold 120     |
                                      +----------------------------+
```

### Changes

**File: `src/components/game/CharacterPanel.tsx`**

1. **Remove the Mod column** from the stat rows -- delete the `(+1)` modifier display and its header column. The modifier is still used internally for rolls; it just won't clutter the panel.

2. **Two-column grid for Attributes section**: Replace the current single-column stat list with a `grid grid-cols-[1fr_auto]` layout:
   - **Left column**: The 6 stat rows (name, base value, gear bonus, spend button) -- same as now minus the modifier.
   - **Right column**: The `ActiveBuffs` component, moved here from its current position between HP bar and XP bar. Rendered vertically to fit the column.

3. **Move ActiveBuffs**: Remove it from between HP and XP bars (line 252). Render it inside the right column of the new two-column grid. Change its layout from `flex-wrap` horizontal pills to a vertical `flex-col` stack so buffs list downward alongside the stats.

4. **Clean up header row**: Remove the "Mod" header and its tooltip since that column no longer exists. Simplify to just "Stat" and "Base +Gear".

### Technical Details

- The `ActiveBuffs` sub-component layout changes from `flex flex-wrap` to `flex flex-col` for vertical stacking
- The buff pills remain the same visually (emoji + label + detail) but stack vertically
- When no buffs are active, the right column can collapse or show a subtle "No buffs" placeholder
- The modifier tooltips on individual stats can remain (hovering a stat row still explains what it does), just the inline `(+1)` text is removed
- AC and Gold row below stays unchanged

