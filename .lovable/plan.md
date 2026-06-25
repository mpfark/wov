## Problem
`jeger@mikferdinandsen.dk` does have the `overlord` role in the database, so the role assignment itself is correct. The recurring failure is likely caused by the `/admin` route doing its own client-side auth/role fetch, separate from the main `GameContext`. If that fetch is briefly empty, stale, blocked, or races in a new tab, the route treats a real Overlord as non-admin and redirects to character selection.

## Better fix
Make admin access backend-authoritative and stop relying on reading `user_roles` directly from the browser for the guard.

## Implementation plan
1. **Add a small backend RPC for admin bootstrap**
   - Create a `SECURITY DEFINER` function, e.g. `public.get_my_admin_role()`.
   - It returns only the current user's effective admin role: `overlord`, `steward`, or `null`.
   - It uses `auth.uid()` internally, so the browser cannot ask for another user's role.
   - It sets `search_path = public` per project security rules.

2. **Update role loading to call the RPC**
   - Change `useRole` from `.from('user_roles').select('role')` to `supabase.rpc('get_my_admin_role')`.
   - Treat `overlord` and `steward` as admin.
   - Treat `null` as normal player.
   - This removes dependency on `user_roles` RLS policy behavior for route authorization.

3. **Make `/admin` use the shared app auth state**
   - Refactor `AdminRoute` to read `user`, `authLoading`, `isAdmin`, `isValar`, and `roleLoading` from `useGameContext()` instead of creating a second `useAuth()` + `useRole()` pair.
   - This prevents two independent auth listeners/role requests from disagreeing during tab/session hydration.

4. **Improve redirects without breaking players**
   - If unauthenticated: send to `/` with `from: '/admin'`.
   - If authenticated but not admin: send to `/game` only after the backend role RPC has completed.
   - Keep the existing “Admin access required” toast for true non-admin users.

5. **Preserve gameplay/party behavior**
   - No changes to character selection, party logic, combat, or gameplay permissions.
   - Existing `user_roles` table and policies remain intact for admin management; the route guard just becomes more reliable.

6. **Verify**
   - Confirm the RPC returns `overlord` for `jeger@mikferdinandsen.dk`.
   - Confirm `/admin` loads for Overlord.
   - Confirm a normal player still cannot access `/admin`.
   - Confirm logged-out users land at login, not character/game redirection loops.