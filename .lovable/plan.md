## Issue

`/admin` redirects to the character/login screen even for accounts with the `overlord` role (e.g. `jeger@mikferdinandsen.dk`).

## Root cause

`src/pages/AdminRoute.tsx` gates on `!user || !isAdmin` and falls back to `<Navigate to="/game" replace />`. Two problems:

1. **No session in the tab** — `/admin` is opened via `window.open('/admin', '_blank')`. If the new tab hasn't hydrated the Supabase session yet (or the user is logged out — auth logs show a logout at 11:33:24 right before the repro), `user` is `null`, so AdminRoute bounces to `/game`. `GameRoute` then sees no user and bounces to `/`, landing on the character/login screen. The user perceives this as "admin sent me to characters."

2. **Role-derivation timing** — `useRole` only flips `loading=false` after the `user_roles` query resolves. But the guard combines `authLoading || roleLoading`. If `useAuth` resolves with `user=null`, `useRole`'s effect early-returns with `loading=false` and `role=null`, so `isAdmin=false`. The redirect target is still wrong (should go to login, not `/game`).

3. **Role enum check is correct** — DB confirms `jeger@…` has role `overlord`, and `useRole` maps that to `isAdmin=true`. So once the session is present, admin access works. The only failure mode is the "no session in this tab" path above.

## Fix

Update `src/pages/AdminRoute.tsx`:

- When `!user`: redirect to `/` (login/character screen entry) and pass `state={{ from: '/admin' }}` so the user lands back on `/admin` after sign-in (optional polish — at minimum redirect to `/` directly so they see the login form, not a flicker through `/game`).
- When `user && !isAdmin`: keep current `/game` redirect (correct — a logged-in player without admin role should go to the game).
- Optionally surface a `toast.error('Admin access required')` on the player-without-admin branch so it's not silent.

That's it — one file, no DB or role changes needed.

## Verification

1. Logged out → open `/admin` → land on `/` login (not flicker to `/game`).
2. Logged in as `jeger@mikferdinandsen.dk` (overlord) → open `/admin` → admin page loads.
3. Logged in as a `player` → open `/admin` → redirected to `/game` with toast.
