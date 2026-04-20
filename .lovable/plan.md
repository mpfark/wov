

## Problem

The Items page toolbar is stuffed into the left list panel (`w-1/2`), so adding "Rename Legacy" + "Rebalance Stats" alongside Search, Unassigned, and New overflows the available width.

Looking at the other admin managers: most only have list-scoped controls (Search, Region filter, New) that comfortably fit inside the list column. **Items is the only page with global cleanup actions** that operate on the whole table, not just the visible list.

## Recommendation

Don't change all admin pages. Only Items has the overflow problem because only Items has page-wide bulk actions. A blanket full-width toolbar would (a) waste space on the other pages and (b) blur the meaning of the existing pattern where the toolbar header belongs to the list column.

## Plan: split Items toolbar into two rows

**Row 1 — Page-level actions bar** (full width across `ItemManager`, above the two columns)
- Lives outside the `w-1/2` list panel, spans the full content area
- Contains the global cleanup actions: **Rename Legacy**, **Rebalance Stats**
- Right-aligned, small height, subtle separator below
- Reads as "tools that affect the whole item catalog"

**Row 2 — List toolbar** (unchanged position, inside the list column)
- `AdminEntityToolbar` keeps: icon + "Items" + count + Search + Unassigned + **New**
- These are all list-scoped (search filters the list; New adds a row that appears in the list)
- Now fits comfortably in the `w-1/2` width

### Layout sketch

```text
┌─────────────────────────────────────────────────────┐
│              [Rename Legacy] [Rebalance Stats]      │  ← new full-width bar
├──────────────────────────┬──────────────────────────┤
│ 📦 Items (349)  Search   │                          │
│   Unassigned (305) [+New]│      Editor panel        │
├──────────────────────────┤                          │
│ [All] [Equipment] [...]  │                          │
│  ...item list...         │                          │
└──────────────────────────┴──────────────────────────┘
```

### Files

- **Edited file**: `src/components/admin/ItemManager.tsx`
  - Wrap the existing `<div className="h-full flex">` in `<div className="h-full flex flex-col">`
  - Add a new top bar div above the flex row containing the two AI buttons
  - Remove `Rename Legacy` and `Rebalance Stats` from inside `AdminEntityToolbar` (lines 417–422)
  - Keep Search, Unassigned, New inside the toolbar

### Out of scope

- No changes to `CreatureManager`, `NPCManager`, `LootTableManager`, `UserManager`, etc. — they don't have overflow.
- No changes to the shared `AdminEntityToolbar` component — its contract stays the same.
- No new shared component for the page actions bar — it's a single inline `<div>` in `ItemManager` for now. If a second manager later grows global actions, we promote it then.

