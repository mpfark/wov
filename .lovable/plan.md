

## Compact Action Bar Layout for NodeView

### Problem
The middle column's NodeView stacks location info, creatures, NPCs, other players, and all action buttons vertically. With plans for 3 abilities per class and up to 10 belt potions, the actions section will overflow and push content off-screen.

### Solution: Reorganize into compact zones

**1. Collapsible "In the Area" section**
- Wrap the creatures/NPCs/players list in a collapsible section (using the existing Radix Collapsible component) that defaults to open but can be collapsed to save space when not needed.

**2. Compact Action Bar (pinned to bottom)**
- Replace the current stacked full-width buttons with a dense, icon-forward grid layout:
  - **Row 1 -- Core actions**: Search, Shop, Blacksmith as small icon buttons in a horizontal row (not full-width). Only show Shop/Blacksmith when available.
  - **Row 2 -- Abilities**: Up to 3 class abilities shown as compact emoji+label buttons in a horizontal flex-wrap row, with cooldown overlays. Healer target selector stays as a small dropdown only when relevant.
  - **Row 3 -- Belt Potions**: Render as a scrollable horizontal row of small icon-only (or emoji + short name) pill buttons. With 10 potions this stays on 1-2 lines instead of 10 stacked buttons.

**3. Creature cards -- tighter layout**
- Reduce padding from `p-2` to `p-1.5`, combine name + level + attack button on a single line with inline HP bar (instead of a separate row for the HP bar).

### Visual sketch

```text
+--------------------------------------+
| [Location Name]                      |  <- header (compact)
| Region -- Lvl range                  |
+--------------------------------------+
| "A quiet corner of the world..."     |  <- description (scrollable)
+--------------------------------------+
| v In the Area            [collapse]  |  <- collapsible
|  [Goblin Lvl3 ====-- 14/20] [Strike]|  <- single-line creature
|  [Wolf   Lvl2 ======  8/8 ] [Strike]|
|  [NPC: Merchant]            [Talk]   |
+--------------------------------------+
| [Search] [Shop] [Smithy]            |  <- row of compact buttons
| [💪 2nd Wind] [⚔️ Ability2] [🛡 Ab3] |  <- abilities row
| [🧪HP] [🧪MP] [🧪HP] [🧪HP] ...     |  <- belt potions, wrapping
+--------------------------------------+
```

### Technical Details

**Files to modify:**
- `src/components/game/NodeView.tsx` -- Main layout restructure:
  - Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from UI components
  - Wrap "In the Area" section in a Collapsible, default open
  - Creature cards: merge HP bar inline with name row, reduce padding
  - Action bar: change from vertical stack to horizontal flex-wrap groups
  - Abilities: update props to accept an array of `ClassAbility` objects (future-proofing for 3 abilities), render as compact row
  - Belt potions: change from `flex-wrap` with full labels to a scrollable horizontal strip with shorter labels or emoji-only with tooltips
  - All buttons use `h-6` or `h-7` height with minimal padding

- `src/lib/class-abilities.ts` -- No changes needed now, but the interface already supports the multi-ability future.

- `src/pages/GamePage.tsx` -- Minor: pass abilities as array when that expansion happens; no changes needed for this layout refactor.

**Key decisions:**
- Collapsible defaults to open so new players see everything; experienced players can collapse it
- Belt potions use tooltip on hover for the full name, showing only emoji + abbreviated name (e.g., "🧪 HP Pot") to fit more per row
- Abilities use `flex-wrap` so 1-3 abilities flow naturally without forcing specific grid columns
- No structural changes to the middle column split ratio or the three-column layout itself
