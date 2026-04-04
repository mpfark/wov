

# Email Verification + Onboarding Gate

## Summary

1. Enable email confirmation on signup (currently disabled)
2. Add a new "Oath & Identity" onboarding screen that requires full name + a fantasy-themed pledge checkbox
3. Gate all existing and new users through this screen if they haven't completed it yet
4. Add `full_name` and `has_accepted_oath` columns to the `profiles` table

## Database Changes

**Migration: Add onboarding fields to `profiles` table**

```sql
ALTER TABLE public.profiles
  ADD COLUMN full_name text,
  ADD COLUMN has_accepted_oath boolean NOT NULL DEFAULT false;
```

Both columns are nullable/defaulted so existing rows remain valid. Existing users will have `full_name = NULL` and `has_accepted_oath = false`, which triggers the onboarding gate.

## Auth Configuration

Use `cloud--configure_auth` to **disable** auto-confirm for email signups. This means new users must click a verification link in their email before they can sign in.

## New Component: `OnboardingGatePage`

A new page at `src/pages/OnboardingGatePage.tsx`:

- Displayed when user is authenticated but `has_accepted_oath = false` or `full_name` is empty
- Contains:
  - A "Full Name" input (first and last name, required, max 60 chars)
  - A fantasy-themed oath checkbox: *"I swear upon the realm of Varneth to uphold honor, play with integrity, and respect my fellow wayfarers. I shall not exploit, cheat, or disrupt the world we share."*
  - A "Proceed" button (disabled until both fields are filled and checkbox is checked)
- On submit: updates `profiles` table with `full_name` and `has_accepted_oath = true`
- Styled consistently with the existing parchment/fantasy theme

## Flow Changes in `Index.tsx`

After the `!user` check (AuthPage) and before loading checks, add a new gate:

```
if user is authenticated:
  fetch profile (full_name, has_accepted_oath)
  if profile not completed → show OnboardingGatePage
  else → continue to character select / creation
```

This intercepts both new and existing users. Existing users who haven't completed the oath will see this screen on their next login.

## Changes to `ProfilePage.tsx`

Add `full_name` as a read-only display field so users can see what they entered. The display name field remains editable as before.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/OnboardingGatePage.tsx` | New component: oath + full name form |
| `src/pages/Index.tsx` | Add onboarding gate check before character flow |
| `src/pages/ProfilePage.tsx` | Show full name (read-only) |
| `src/contexts/GameContext.tsx` | Add profile onboarding state to context |
| Migration | Add `full_name` and `has_accepted_oath` to `profiles` |
| Auth config | Disable auto-confirm for email signups |

## What Does NOT Change

- Character creation flow (unchanged, just gated behind onboarding)
- Existing auth flow (login/signup forms stay the same)
- Game logic, combat, admin tools
- Email templates (already set up with branded templates)

