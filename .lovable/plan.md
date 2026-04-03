

# Remove Skeleton Placeholders from NodeView

## Change

In `src/features/world/components/NodeView.tsx`, remove the skeleton shimmer rows that display while creatures are loading. Creature rows will simply fade in via `animate-polish-fade-in` when they appear.

### What to remove
- The loading branch that renders `.skeleton-shimmer` divs (the block gated by `creaturesLoading`)
- The `prefetchedCreatureCount` logic and any refs/state supporting skeleton count

### What stays
- `animate-polish-fade-in` on each creature row (already in place)
- The dev-only `creaturesVisibleRef` diagnostic log

## Files Changed

| File | Change |
|------|--------|
| `src/features/world/components/NodeView.tsx` | Remove skeleton placeholder rendering and related count logic |

