

## CSS Zoom Scaling for Consistent Game UI

### Approach
Create a custom hook `useViewportZoom` that calculates a zoom factor based on 1920px as the design width and applies it to `document.documentElement.style.zoom`. This normalizes the UI so all players see roughly the same proportions regardless of screen resolution.

### Key Details
- **Design width**: 1920px — the baseline resolution
- **Min zoom**: 0.5 (prevent tiny UI on very small screens)
- **Max zoom**: 1.0 (don't upscale beyond native on smaller monitors)
- **Only applies on game page** — auth/admin pages remain unaffected
- Recalculates on window resize via `resize` event listener
- Cleans up zoom on unmount (resets to `1`)

### Files

1. **`src/hooks/useViewportZoom.ts`** (new) — Hook that sets `document.documentElement.style.zoom = Math.min(1, Math.max(0.5, window.innerWidth / 1920))` on mount and resize, resets on unmount.

2. **`src/pages/GamePage.tsx`** — Call `useViewportZoom()` at the top of the component.

That's it — two touches, minimal risk.

