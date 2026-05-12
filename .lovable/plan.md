## Goal

Apply the area-hover tooltip behavior to the **World Map dialog** (the full-screen map opened from the action bar), not the small side-panel mini-map. Also lock the teleport tooltip on that dialog to click-to-open / click-elsewhere-to-close.

## Changes

### 1. Revert prior tooltip work in `PlayerGraphView.tsx`
The previous turn added hover tooltips to the side-panel mini-map. Since the user wants this on the World Map dialog instead, remove:
- `tooltip` state, `containerRef`, `computeTooltipPos`, `handleAreaHover`, `handleNodeHover`
- The HTML overlay div that renders the tooltip
- `levels: number[]` field on `NodeCreatureInfo` and the area-hull `areaId`/`areaName` additions used only for tooltip
- Restore the file to its pre-change state

### 2. Add hover tooltip to `PlayerWorldMapDialog.tsx`

Add a single `tooltip` state `{ x, y, title, lines }` positioned relative to the existing `containerRef`. Render it as a `pointer-events-none absolute` HTML overlay (same styling as the version that was in `PlayerGraphView`) so it floats above the SVG.

**Area hover** — on each `<path>` in the `areaOutlines` map (lines 372–377):
- `onMouseEnter` / `onMouseMove`: show area name as title, plus a "Creatures: Lv X–Y" line computed from creature levels at all visible nodes inside that area.
- `onMouseLeave`: clear tooltip.

**Node hover** — on each node `<g>` (lines 469–548):
- Show node name as title.
- Add lines for service emojis present (🌀 Teleport, 🏨 Inn, 🪙 Vendor, 🔨 Blacksmith, 💎 Jewelcrafter, ⚜ Stonebinder, 🏛️ Trainer/Marketplace).
- Add a "Creatures: Lv X–Y" line if the node has creatures.

**Creature data** — fetch creature `level` per node from Supabase once when the dialog opens (mirrors the approach used in `PlayerGraphView` previously: `creatures` table grouped by `node_id`). Cache in a `Map<string, number[]>`.

Also clear `tooltip` inside the existing `handleMouseUp` and on `<svg onMouseLeave>`.

### 3. Teleport tooltip behavior
The dialog already uses `selectedTeleportNode` set via `onClick` on the node `<g>`, with `handleMouseUp` clearing it on background click (when `!didDrag`). This already implements click-to-open / click-elsewhere-to-close. **No change needed**, but verify after the hover tooltip additions that:
- Hovering a teleport node only shows the hover tooltip; it does **not** close the open teleport confirmation overlay.
- Clicking the same teleport node again toggles it closed (already true at line 476).
- Clicking another teleport node switches selection.

## Files

- `src/features/world/components/PlayerGraphView.tsx` — revert tooltip additions
- `src/features/world/components/PlayerWorldMapDialog.tsx` — add hover tooltip + creature level fetch
