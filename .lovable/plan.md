
Goal: stop false admin denial on `/admin` so real stewards/overlords are not redirected to `/game` → `/`.

What’s causing it:
- `AdminRoute` is already decoupled correctly and waits on `authLoading || roleLoading`.
- The remaining bug is in `useRole`: when `user` is null it sets `loading=false`, but when `user` becomes available it does not set `loading=true` before fetching role.
- Result: for a brief render, `roleLoading=false` and `role=null`, so `isAdmin=false` and `AdminRoute` redirects prematurely.

Implementation plan:
1. Harden `useRole` loading lifecycle
   - In `src/hooks/useRole.ts`, set `loading=true` immediately when a valid user is present and role fetch starts.
   - Use `user?.id` as the effect dependency to avoid unnecessary refetches from object identity changes.
   - Add cancellation guard in the effect cleanup to avoid late state updates.

2. Make role fetch resilient to role-row edge cases
   - Replace `.maybeSingle()` with `.select('role')` list fetch.
   - Derive effective role by priority: `overlord > steward > player`.
   - This prevents accidental “no role” behavior if multiple rows ever exist for a user.

3. Keep AdminRoute guard strict
   - In `src/pages/AdminRoute.tsx`, keep redirect logic as-is (`!user || !isAdmin => /game`), but rely on corrected `roleLoading`.
   - Optional minor safety: if authenticated and role is not resolved yet, keep showing loading state (prevents any transient false redirect).

4. Verify flow end-to-end
   - From `/game`, click “Admin” (new tab) and confirm `/admin` renders directly.
   - Hard-refresh on `/admin` and confirm no redirect.
   - Confirm non-admin users still route to `/game` per your requirement.

Files to update:
- `src/hooks/useRole.ts` (primary fix)
- `src/pages/AdminRoute.tsx` (small guard polish, if needed)

No backend schema/RLS changes required.
