

# Unify Player World Map to Admin Map Style

## Goal
Replace the player world map's custom rendering style with the admin world map's visual approach: colored area hulls with edge-interpolation, region outlines, and simple nodes showing only town names. Remove per-node emoji, service icons, and detailed labels — keep it clean, colorful, and map-like.

## Changes

### File: `src/features/world/components/PlayerWorldMapDialog.tsx`

**Remove**: The local `computeOutline` function (~100 lines) and related types/constants (`Circle`, `normalizeAngle`, `ptOnCircle`, `ptDist`, `OUTLINE_PAD`, `AREA_PAD`).

**Import**: `computeRegionOutline` from `@/features/world/utils/outline-geometry` (same as admin map).

**Update region hulls**: Use admin-style computation with edge-interpolation circles along intra-region connections for smoother outlines. Use same constants as admin (`OUTLINE_RADIUS = NODE_R + 20`, `AREA_OUTLINE_RADIUS = NODE_R + 10`).

**Update area hulls**: Same edge-interpolation approach. Render as filled + stroked paths (like admin), not just dashed outlines. Show area name labels above each area hull.

**Update region labels**: Position above the top of the hull (min node Y minus padding), matching admin placement.

**Simplify node rendering**:
- Remove area-type emoji inside nodes
- Remove service icons below nodes
- Nodes become simple small circles colored by area type
- Show node name text only — no emoji, no service badges
- Current node keeps its pulse indicator and diamond marker
- Ghost nodes stay as-is (dashed circle with `?`)

**Edges**: Keep current solid/dashed styles for visited/ghost edges — they already look clean.

**Keep unchanged**: Pan/zoom controls, ghost nodes, visited-node filtering, dialog wrapper, center-on-current behavior.

### Summary of visual result
- Colored area fills grouping nodes (matching admin)
- Dashed region outlines with region name + level range
- Area names as small labels
- Simple colored dots for nodes with just the town name above
- Current node highlighted with pulse
- Ghost nodes as fog-of-war `?` markers
- No emoji, no service icons, no creature dots on the world map

### Files touched
| File | Change |
|------|--------|
| `src/features/world/components/PlayerWorldMapDialog.tsx` | Replace outline logic, simplify node rendering |

No database, server, or other file changes needed.

