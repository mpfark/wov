

# Fix: Status Bars Hidden Behind Background + Travel Loading Bug

## Issues Found

### 1. Status bars hidden behind illustration
In `NodeView.tsx`, the scrollable content div (line 147) has `relative z-10` to sit above the background, but the **StatusBarsStrip** (line 399-403), **HeartbeatIndicator** (line 177-181), **"In the Area" section** (line 184-396), and **Action Bar** (line 405-446) are all siblings outside that z-10 div. They render at the default stacking level and get covered by the `LocationBackground` overlay.

**Fix**: Add `relative z-10` to the outer flex container (line 144) so all content sits above the background, or wrap the non-scrollable sections in a `relative z-10` as well.

### 2. Background doesn't load when traveling from no-illustration to illustration
In `LocationBackground.tsx`, when `resolvedUrl` becomes empty (line 23-27), the code fades out and clears `loadedUrl` but **does not reset `prevUrlRef.current`**. So when the player then travels to a node that resolves to the same URL that was previously shown (e.g., same area illustration), the check on line 29 (`resolvedUrl === prevUrlRef.current`) returns `true` and skips loading entirely.

**Fix**: Reset `prevUrlRef.current = ''` when the URL becomes empty.

## Changes

### `src/features/world/components/NodeView.tsx`
- Line 144: Change the outer div to include `relative` so all child content (status bars, action bar, creatures) stacks above the background. The `LocationBackground` already uses `absolute inset-0 z-0`.

### `src/features/world/components/LocationBackground.tsx`
- Inside the `if (!resolvedUrl)` branch (line 23-27): add `prevUrlRef.current = ''` so the ref resets when there's no illustration, preventing the stale-ref skip on the next navigation.

Both are one-line fixes.

