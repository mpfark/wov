# Admin-only login (does not wake the world)

Goal: an admin can sign in through a dedicated entry that never selects a character and never counts toward the world's awake state, so `tick-creatures`, `return-unique-items`, etc. keep short-circuiting. Admins can still play the game normally through the regular login — they just don't count as "awake" on their own.

## 1. Auth page — "Admin login" link

- On `AuthPage.tsx`, add a small secondary link below the main sign-in form: **"Admin login →"**.
- Clicking it toggles the form into "admin mode": same email/password fields, but the submit handler sets `sessionStorage.setItem('lovable.adminOnlySession', '1')` before calling `signInWithPassword`.
- On successful sign-in in admin mode:
  1. Verify the user has `overlord` or `steward` role via `has_role`. If not → sign out immediately and show "Not an admin account".
  2. Navigate straight to `/admin`, bypassing the onboarding gate and character select.
- Google sign-in button is hidden in admin mode (email/password only) to keep the flow explicit.
- Regular sign-in flow is unchanged — admins who want to play just log in normally.

## 2. Never touch `last_online` in an admin-only session

- `GamePage.tsx` is the only writer of `characters.last_online`. Admin-only sessions never mount it, so this is already safe.
- Add a defensive guard in `GamePage` heartbeat: if `sessionStorage.lovable.adminOnlySession === '1'`, skip the `last_online` update entirely. Protects against an admin manually navigating to `/game` mid admin-only session.
- `AdminRoute` and `AdminDashboard` do not need changes.

## 3. Server-side exclusion in `world_is_awake()`

Client discipline isn't enough — we want DB truth to also ignore admin activity even if an admin is playing normally.

New migration:

- Update `public.world_is_awake()` to exclude characters whose owning user has role `overlord` or `steward`:

  ```sql
  SELECT EXISTS (
    SELECT 1
    FROM public.characters c
    WHERE c.last_online > now() - interval '5 minutes'
      AND NOT public.has_role(c.user_id, 'overlord')
      AND NOT public.has_role(c.user_id, 'steward')
  );
  ```

- Update the matching `awake_characters` count used inside `record_world_state()` and the slumber log to use the same filter, so the indicator/history stays consistent.
- `useWorldSlumberState` mirrors the same filter (join `user_roles`, exclude admin user_ids) so the admin pill matches server truth.

### Does the game still work for an admin playing?

Yes. Regular sign-in flow, character select, combat, movement, everything — all unchanged. The only behavioral difference is that an admin playing alone will not, by themselves, wake the world for cron jobs. The moment any non-admin player is active in the last 5 minutes, `world_is_awake()` returns true for everyone (admins included), and creature ticks / respawns / uniques return resume normally.

## Out of scope

- No changes to cron cadence, `tick-creatures`, `combat-tick`, or pruning jobs.
- No new role, no schema changes beyond the two function bodies.
- No changes to how normal players log in.

## Technical notes

- Files touched: `src/pages/AuthPage.tsx`, `src/pages/GamePage.tsx` (heartbeat guard only), `src/hooks/useWorldSlumberState.ts`, and one new migration replacing `world_is_awake()` + the count expression inside `record_world_state()`.
- `sessionStorage` (not `localStorage`) so the flag dies with the tab and doesn't bleed into normal logins.
- Admin role check reuses the existing `has_role(auth.uid(), 'overlord' | 'steward')` RPC pattern.
