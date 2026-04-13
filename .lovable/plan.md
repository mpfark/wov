

# Show Node Names Only When Unique

## Problem
Every node on the player world map shows a label, but most nodes just repeat their area name since `getNodeDisplayName` falls back to the area name. This clutters the map with redundant labels.

## Fix

In `PlayerWorldMapDialog.tsx`, at the node name `<text>` element (~line 476), only render the label when the node has its own unique name that differs from its area name.

Replace:
```tsx
const displayName = getNodeDisplayName(node, area);
```
With a check:
```tsx
const hasUniqueName = node.name && node.name.trim() && (!area || node.name.trim() !== area.name);
```

Then conditionally render the name label only when `hasUniqueName` is true (or when it's the current node, so you always know where you are).

## Files
| File | Change |
|------|--------|
| `src/features/world/components/PlayerWorldMapDialog.tsx` | Add unique-name check, conditionally render node label |

No other files changed.

