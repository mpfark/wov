# Unify the two world-loading screens

## What you're seeing

Two separate loaders render back-to-back on the way into the game:

| Where | Text | Styling |
|---|---|---|
| `src/pages/GameRoute.tsx:42` | "Loading your adventure…" | `font-display text-primary text-glow animate-pulse` (default size, gold glow) |
| `src/pages/GamePage.tsx:1139` | "Loading world…" | `font-display text-sm text-muted-foreground animate-pulse` (small, dim, no glow) |

The gate shows while auth/character/nodes/sync are pending. Once it passes, `GamePage` mounts and briefly shows its own loader because it re-checks `useNodes` locally. The result is a visible style jump (size + color + glow change) right before the world appears.

## Plan

1. **Create a shared component** `src/components/LoadingScreen.tsx` that renders the parchment-bg full-screen layout with a single, consistent style: `font-display text-primary text-glow animate-pulse` (the more polished of the two), accepting a `message` prop with a default of `"Loading your adventure..."`.
2. **Replace the inline loader in `GameRoute.tsx`** (lines 40-44) with `<LoadingScreen />`.
3. **Replace the inline loader in `GamePage.tsx`** (lines 1137-1141) with `<LoadingScreen message="Loading world..." />` — same visual treatment, different copy so the second flash (if it occurs) is just a text swap, not a style swap.

## Result

Both states share identical typography, color, glow, and layout. The transition between them becomes seamless — at most a brief copy change, with no visible restyle.

## Out of scope (mention only)

The fact that `GamePage` re-runs `useNodes(true)` after the gate already loaded nodes via context is the deeper reason a second loader can flash at all. Collapsing that to a single fetch is a separate refactor; I'd rather not bundle it into a visual fix unless you want me to.
