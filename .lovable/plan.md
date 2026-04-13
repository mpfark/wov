

# Fix Teleport from World Map + Unscaled Popup

## Problems

1. **Click never registers on the teleport button**: The SVG `onMouseDown` calls `setSelectedTeleportNode(null)` which fires *before* the node's `onClick`. So when you click a teleport node, the popup opens then immediately closes. And clicking the teleport button inside the popup also triggers the SVG mousedown first, clearing the selection.

2. **Popup scales with the map**: The `<foreignObject>` confirmation tooltip is inside the SVG `<g>` transform group, so it shrinks/grows with zoom — making it unreadable at most zoom levels.

## Fix

### 1. Move confirmation popup out of SVG — render as an HTML overlay

Instead of a `<foreignObject>` inside the scaled `<g>`, render the teleport confirmation as an absolutely-positioned `<div>` overlay on top of the SVG. Calculate its screen position by transforming the node's world coordinates through the current pan/zoom:

```
screenX = nodeX * zoom + pan.x + containerWidth/2
screenY = nodeY * zoom + pan.y + containerHeight/2
```

This keeps the popup at a fixed readable size regardless of zoom.

### 2. Fix click propagation

- On the SVG `onMouseDown`, do NOT clear `selectedTeleportNode` immediately. Instead, track whether a drag happened.
- On `onMouseUp`, if no drag occurred (mouse didn't move significantly), check if the click target was outside a teleport node — only then clear the selection.
- On the node `<g>` `onClick`, call `e.stopPropagation()` to prevent the SVG background click from interfering.
- On the overlay div, also stop propagation so clicking the teleport button doesn't trigger the SVG handlers.

### Files Changed

| File | Change |
|------|--------|
| `src/features/world/components/PlayerWorldMapDialog.tsx` | Move tooltip out of `<g>` into HTML overlay div; fix click/drag logic to not clear selection prematurely |

