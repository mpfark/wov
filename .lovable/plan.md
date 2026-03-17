

## Fix: Make AdminRoute Independent of GameContext

### Root Cause

The admin page opens in a new tab via `window.open('/admin', '_blank')`. In that new tab, `GameProvider` initializes from scratch and loads characters, nodes, etc. The character-loading logic in `Index.tsx` (which is the `/` route) auto-navigates to `/game` when a character gets selected, creating a redirect loop. The admin page has no need for character or node data, but it's coupled to `GameContext` which pulls all of it in.

### Solution

Make `AdminRoute` self-contained by using `useAuth` and `useRole` hooks directly instead of going through `GameContext`. This eliminates any dependency on character/node loading.

### Changes

**1. `src/pages/AdminRoute.tsx`** -- Rewrite to use hooks directly:
- Import `useAuth` and `useRole` instead of `useGameContext`
- Wait for auth loading, then role loading
- If not admin, redirect to `/game` (user preference)
- Use `<Navigate>` component instead of imperative `navigate()` to avoid render-time side effects
- Pass `isValar` and `onBack` to AdminPage as before

**2. No other files change.** GameContext remains unchanged; AdminRoute simply stops using it.

### Technical Detail

```text
Before:
  /admin tab → GameProvider mounts → loads auth + characters + nodes + role
  → AdminRoute reads from GameContext → race condition with character loading

After:
  /admin tab → GameProvider mounts (still wraps everything, harmless)
  → AdminRoute uses useAuth + useRole directly → only waits for auth + role
  → No character/node dependency → clean render
```

