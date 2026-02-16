

## Direction-Based Region Placement + Region Editing

### What Changes

**The Hearthlands** becomes the fixed center of the world map. Every other region gets a compass direction (N, S, E, W, NE, NW, SE, SW) relative to The Hearthlands, chosen by the admin. The admin world map uses these directions to position region bubbles geographically instead of lining them up by level. Admins can also edit a region's name and level range.

### Database Change

Add a `direction` column to the `regions` table:
- Type: `text`, nullable, default `null`
- Stores one of: `N`, `S`, `E`, `W`, `NE`, `NW`, `SE`, `SW`
- The Hearthlands has no direction (it is the origin)

### Admin World Map Layout Change (`AdminWorldMapView.tsx`)

Currently, all regions start at (0,0) and get nudged apart by collision resolution with no directional intent. The new logic:

1. Place The Hearthlands at the center of the canvas
2. For each other region, use its `direction` value to compute an initial position offset from center (e.g., N = up, SE = down-right)
3. Regions without a direction fall back to a grid below the map
4. Collision nudging still runs afterward to prevent overlaps, but now preserves the general compass layout
5. The offset distance scales with the number of regions to keep spacing reasonable

### Region Manager Changes (`RegionManager.tsx`)

Currently only supports creating regions. Will be expanded to:

- **Create**: Add a direction dropdown (N/S/E/W/NE/NW/SE/SW) to the create dialog
- **Edit**: Clicking a region in the sidebar opens an edit dialog where the admin can change the name, min/max level, and direction
- **Delete**: Existing delete functionality remains (overlord only)

### Region Sidebar Enhancement (`AdminWorldMapView.tsx`)

Each region in the sidebar will show its assigned direction as a small compass indicator. Clicking a region will offer an "Edit" button that opens the edit dialog.

### Files Changed

| File | Change |
|------|--------|
| **Database migration** | `ALTER TABLE regions ADD COLUMN direction text DEFAULT null` |
| `src/components/admin/RegionManager.tsx` | Add direction selector to create form; add edit dialog with name, level range, and direction fields |
| `src/components/admin/AdminWorldMapView.tsx` | Replace `getRegionCoord` with direction-based placement using The Hearthlands as origin; pass direction data to region interface; add edit button to sidebar |
| `src/pages/AdminPage.tsx` | Pass updated region data (including direction) through to components |

### Technical Details

**Direction-to-offset mapping** (used for initial region placement before collision nudging):

```text
         NW    N    NE
           \   |   /
        W -- CENTER -- E
           /   |   \
         SW    S    SE
```

Each direction maps to a base offset vector multiplied by a spacing constant (e.g., 400px):
- `N: (0, -400)`, `S: (0, 400)`, `E: (400, 0)`, `W: (-400, 0)`
- `NE: (280, -280)`, `NW: (-280, -280)`, `SE: (280, 280)`, `SW: (-280, 280)`

If multiple regions share the same direction, they stack along that axis with increasing distance.

**Identifying The Hearthlands**: Matched by the well-known ID `00000000-0000-0000-0000-000000000001`. This region is always placed at canvas center and cannot be assigned a direction.

**Edit flow**: The edit dialog updates the region via `supabase.from('regions').update(...)` and calls `onCreated()` (renamed conceptually to `onRefresh`) to reload data.

