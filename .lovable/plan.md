

## Fix Password Reset & Add Forgot Password Flow

### Root Cause
Two issues:
1. **No user-facing forgot password flow** — The login page has no "Forgot password?" link, so users can't request a reset themselves.
2. **Admin reset generates link but doesn't send it** — `admin.generateLink()` creates a recovery link but does NOT trigger the auth email hook. It needs to use `resetPasswordForEmail()` or manually send the generated link.

### Plan

#### 1. Add "Forgot Password" UI to AuthPage
- Add a "Forgot password?" link on the login form
- Show an email-only form that calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`
- This triggers the auth email hook → queues the recovery email → sends via the custom domain

#### 2. Create `/reset-password` page
- New page at `src/pages/ResetPasswordPage.tsx`
- Detects `type=recovery` in the URL hash (Supabase redirects back with this)
- Shows a "Set new password" form
- Calls `supabase.auth.updateUser({ password })` to apply the new password
- Redirects to login on success

#### 3. Add route in App.tsx
- Add `<Route path="/reset-password" element={<ResetPasswordPage />} />` (public, not behind auth)

#### 4. Fix admin "Reset PW" button
- In `admin-users/index.ts`, change from `generateLink({ type: "recovery" })` to `resetPasswordForEmail(email, { redirectTo })` — this actually triggers the email sending flow
- Alternatively, keep `generateLink` but also send the email by invoking the auth email hook with the generated URL

#### 5. Add `resetPasswordForEmail` to useAuth hook
- Export a `resetPassword(email)` function for reuse

### Files Changed
- `src/pages/AuthPage.tsx` — add forgot password state and form
- `src/pages/ResetPasswordPage.tsx` — new file, password reset form
- `src/App.tsx` — add `/reset-password` route
- `src/hooks/useAuth.ts` — add `resetPasswordForEmail` wrapper
- `supabase/functions/admin-users/index.ts` — fix to actually send email

### Regarding User Profile/Name Page
A user profile page for updating display name is a separate feature and not needed for password reset to work. We can add it as a follow-up if desired.

