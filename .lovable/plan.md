

## Region Sort Order for Directional Stacking

### Problem
When multiple regions share the same compass direction, their stacking order (distance from The Hearthlands) is arbitrary -- based on array index. Admins need explicit control over which region appears closer or further from the center.

### Solution
Add a `sort_order` integer column to the `regions` table. Regions sharing the same direction are ordered by this value: lower = closer to Hearthlands, higher = further out along the compass axis. This also controls display order in sidebars and lists.

```text
Example: Three regions all pointing North

    Hearthlands (center)
         |
    [sort_order: 1]  -- closest
         |
    [sort_order: 2]  -- middle
         |
    [sort_order: 3]  -- furthest north
```

### Changes

**Database migration**
- `ALTER TABLE regions ADD COLUMN sort_order integer NOT NULL DEFAULT 0`

**`src/components/admin/RegionManager.tsx`**
- Add a "Sort Order" number input to both the Create and Edit dialogs
- Include `sort_order` in insert and update payloads

**`src/components/admin/AdminWorldMapView.tsx`**
- When computing region positions, sort regions by `sort_order` within each direction group
- Use the sorted index (instead of arbitrary array index) as the distance multiplier from center
- Sidebar region list ordered by `sort_order`

**`src/pages/AdminPage.tsx`**
- Already orders regions by `min_level` in the query; change to `order('sort_order')` so the data flows through sorted

### Technical Details

The layout change is minimal. Currently in `getRegionCoord`:

```typescript
// Current: arbitrary index
const multiplier = 1 + myIndex * 0.6;
```

After the change, `myIndex` will come from sorting the same-direction group by `sort_order`, giving admins deterministic control over stacking.

Default `sort_order` of 0 means existing regions will all start at the same priority and can be reordered as needed.
