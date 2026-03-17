

## Open Admin in a Separate Browser Tab

### Why This Makes Sense
Currently navigating to `/admin` replaces the game view, which means you lose your active game state (combat, chat, presence) every time you need to check admin tools. Opening admin in a new tab lets you keep the game running while managing the world side-by-side.

### Changes

1. **`src/pages/GamePage.tsx`** — Change the admin button's `onClick` from `navigate('/admin')` to `window.open('/admin', '_blank')`. This opens the admin dashboard in a new browser tab.

2. **`src/pages/AdminRoute.tsx`** — Update the "back" button behavior. Instead of `navigate(-1)` (which may have no history in a new tab), use `window.close()` as primary action, falling back to `navigate('/')` if the tab can't be closed.

That's it — two small tweaks, no architectural changes needed since admin is already a separate route with its own lazy-loaded bundle.

