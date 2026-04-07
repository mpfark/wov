

# Simplify Area Continuations: Fade the Hull Itself at the Edge

## Problem
The current approach uses separate rectangular "continuation bands" with gradients, which look disconnected and weird — they don't match the organic hull shape. The user wants a simpler approach: keep the hull outlines around nodes as-is, but where the area continues off-screen, let the hull and its fill naturally fade out at the map edge — matching how ghost nodes and lines already fade.

## Approach
Replace the entire `AreaContinuation` system (rectangles + gradients) with an SVG mask-based fade. Apply a single edge-fade mask to all area hulls so that any hull geometry near the viewport edge gradually fades to transparent. This way:

- The hull shape stays organic (union-of-circles)
- Where an area stops at a visible boundary node, the outline fades at the edge instead of closing sharply
- No extra rectangles, no extra gradients per area — just one mask

## Changes

### `PlayerGraphView.tsx`

1. **Remove** all `AreaContinuation` related code:
   - Remove the `AreaContinuation` interface, `getContinuationEdge`, `getContinuationGradientVector`, `CardinalEdge` type
   - Remove `areaContinuations` from the hull computation (the `edgeSources` logic, continuation building)
   - Remove all continuation gradient `<defs>` and continuation `<rect>`/`<line>` rendering

2. **Add an SVG edge-fade mask** in `<defs>`:
   - A `<mask>` with a white rectangle (fully visible) in the center and a `<radialGradient>` or four `<linearGradient>` rectangles around the edges that fade from white to black (transparent)
   - Simpler approach: a single rect with a radial gradient centered on the viewbox, white in the middle, fading to transparent near edges

3. **Apply the mask** to the area hulls group:
   - Wrap the area hull `<path>` elements in a `<g mask="url(#edge-fade)">` so they naturally fade at the viewport boundary

4. **Restore bleed circles** (from the original plan) so hulls extend past the edge:
   - For each primary area node with a same-area off-screen connection, add densely spaced circles projecting outward (step size = `AREA_OUTLINE_RADIUS * 1.4`, enough steps to reach the viewport edge)
   - The mask handles the fade, so the hull just needs to extend far enough to reach the masked zone

### Technical Detail: Edge Fade Mask
```xml
<defs>
  <linearGradient id="fade-left" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0%" stop-color="black"/>
    <stop offset="100%" stop-color="white"/>
  </linearGradient>
  <!-- similar for right, top, bottom -->
  <mask id="edge-fade">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="0" y="0" width="fadeWidth" height="100%" fill="url(#fade-left)"/>
    <rect x="viewBoxWidth-fadeWidth" ... fill="url(#fade-right)"/>
    <rect ... fill="url(#fade-top)"/>
    <rect ... fill="url(#fade-bottom)"/>
  </mask>
</defs>
```

The fade width would be roughly `AREA_OUTLINE_RADIUS * 2` — enough to create a subtle transition at the edges.

## Files Modified

| File | Change |
|------|--------|
| `src/features/world/components/PlayerGraphView.tsx` | Remove continuation system, add edge-fade mask + bleed circles |

