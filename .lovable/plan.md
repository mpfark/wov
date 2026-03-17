

## Remove Zoom, Cap UI Width + Chat Panel on Wide Screens

### Problem
The zoom scaling wastes vertical space on smaller screens. The real issue is the center panel stretching too wide on large monitors while side panels stay at 400px.

### Approach
1. **Remove `useViewportZoom`** — delete the hook and its import from GamePage.
2. **Cap the main layout width** — wrap the game content in a `max-w-[1920px] mx-auto` container so it never stretches beyond 1920px. On ultra-wide monitors, parchment background fills the sides.
3. **Add a Chat Panel as a 4th column on wide screens (≥1600px)** — The game already has a chat system (`useChat`). Currently chat lives inline in the event log area. On wide screens, break it out into its own ~320px panel on the far right, giving the layout a dedicated social column (chat + whispers). On narrower screens, chat stays where it is now.

### Layout at different widths

```text
< 768px (mobile):   [center only, side panels as sheet overlays]
768–1023px (tablet): [center only, side panels as sheet overlays]  
1024–1599px:         [char 400px] [center flex-1] [map 400px]
≥ 1600px:            [char 400px] [center flex-1] [map 400px] [chat 320px]
```

### Files Changed

1. **Delete `src/hooks/useViewportZoom.ts`**
2. **`src/pages/GamePage.tsx`**
   - Remove `useViewportZoom` import and call
   - Add `max-w-[1920px] mx-auto` to the root layout div
   - Add a `useMediaQuery` check for ≥1600px (`isWideScreen`)
   - When `isWideScreen`, render a 4th column (320px) containing the chat messages and input, and remove chat from the event log area
   - When not wide, keep chat where it currently is

This gives wide-screen players a dedicated chat panel instead of wasted space, while narrower screens get a capped, proportional layout.

