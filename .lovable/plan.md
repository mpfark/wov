

## Character Panel Redesign

Two main changes to `src/components/game/CharacterPanel.tsx`:

### 1. Stats: Compact Inline List

Replace the current 3x2 grid of stat boxes with a single horizontal row of compact stat chips. Each stat shows:
- 3-letter label (STR, DEX, etc.)
- Total value (with green bonus indicator if equipment adds to it)
- Modifier in parentheses

Layout: a single `flex flex-wrap` row with small inline items like `STR 14(+2)` separated by subtle dividers. This cuts the vertical space roughly in half.

AC and Gold will be merged into this same row as additional chips.

### 2. Equipment: "Paper Doll" Body Layout

Replace the 3-column grid with a visual body silhouette arrangement using CSS positioning. The slots will be laid out to roughly mirror where they'd appear on a person:

```text
         [Head]
      [Amulet]
  [Shoulders]  
     [Chest]
[Main Hand]  [Off Hand]
    [Gloves]
     [Belt]
     [Ring]  [Trinket]
     [Pants]
```

Each slot remains a small clickable box showing the item name (colored by rarity) or "Empty". Tooltips stay the same. The layout uses a centered column with weapons flanking left/right, giving it that classic RPG equipment screen feel.

### Technical Details

**File: `src/components/game/CharacterPanel.tsx`**

**Stats section (lines 106-123)** -- Replace the `grid grid-cols-3` block with:
- A `flex flex-wrap gap-x-3 gap-y-1 justify-center` container
- Each stat rendered as a compact inline span: `<span>STR 14<small>(+2)</small></span>`
- AC and Gold folded in as additional items in the same row (removing the separate AC/Gold section at lines 125-138)

**Equipment section (lines 140-187)** -- Replace the `grid grid-cols-3` layout with:
- A centered flex-column layout with rows for each body region
- Row 1: Head (centered)
- Row 2: Amulet (centered)
- Row 3: Shoulders (centered)
- Row 4: Chest (centered)
- Row 5: Main Hand (left) + Off Hand (right), flanking the body
- Row 6: Gloves (centered)
- Row 7: Belt (centered)
- Row 8: Ring (left) + Trinket (right)
- Row 9: Pants (centered)
- Each slot keeps the same interactive behavior (click to unequip, tooltip on hover)
- Slot boxes will be slightly narrower (~16-18 chars wide) to fit the body shape

No changes to props, hooks, inventory section, or party panel. Pure visual rearrangement.

