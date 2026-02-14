

# Geographic World Map with Region Sidebar

## Overview
Replace the current level-sorted horizontal layout of the Admin World Map with a geographic Middle-earth overview map. Regions will be positioned at lore-accurate coordinates, and a clickable region list on the right side will allow zooming into any region.

## Changes

### 1. Geographic Region Positioning
Instead of placing region bubbles left-to-right by level, each region gets a fixed geographic coordinate on a large canvas representing Middle-earth:

| Region | Approximate Position |
|--------|---------------------|
| The Shire | Far west |
| Bree-land | West-center |
| The Lone-lands | Center |
| The Trollshaws | East-center |
| Rivendell | Far east |

New regions added in the future will need a geographic coordinate. A fallback auto-placement will handle regions without explicit coordinates (placing them in an unused area).

### 2. Region Sidebar (Right Panel)
A narrow scrollable list panel on the right side of the map area showing all regions with:
- Region name and level range
- Node count
- Click handler that smoothly animates the map's pan/zoom to center on that region

### 3. Zoom-to-Region Animation
When a region is clicked in the sidebar:
- Calculate the region bubble's center and radius
- Set zoom level so the region fills most of the viewport
- Animate pan to center on the region
- Highlight the selected region in the sidebar

## Technical Details

### File Modified: `src/components/admin/AdminWorldMapView.tsx`

**Region coordinate system:**
- Add a `REGION_COORDINATES` lookup mapping region names to `{ x, y }` positions on a ~2000x1200 canvas
- Fall back to auto-placement for unknown regions
- Region bubbles are still sized dynamically based on node count

**Layout refactor:**
- Replace the `cursorX` linear layout with direct coordinate placement from the geographic map
- Each region bubble is centered at its geographic coordinate
- Internal node layout within each bubble remains unchanged (BFS-based)

**Sidebar component (inline):**
- Wrap the SVG in a flex container: `[map flex-1] [sidebar w-48]`
- Sidebar lists regions with name, level range, node count
- Clicking a region calls a `zoomToRegion` function that sets `pan` and `zoom` state

**Zoom-to-region logic:**
```
zoomToRegion(regionId):
  1. Find the region bubble's cx, cy, radius
  2. Get the container's width/height
  3. Calculate zoom = containerWidth / (radius * 3)
  4. Calculate pan to center the bubble in the viewport
  5. Set zoom and pan state (with CSS transition for smooth animation)
```

**Smooth transitions:**
- Add a `isAnimating` state that temporarily applies CSS `transition: transform 0.4s ease` to the SVG when zooming to a region
- Normal pan/zoom interactions remain instant (no transition)

### Wire-up
- The `AdminPage.tsx` does not need changes -- it already passes regions and nodes to `AdminWorldMapView`
- The sidebar is self-contained within the map component

