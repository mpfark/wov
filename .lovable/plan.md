

# Fix: Onboarding Gate Loops for Old Users

## Root Cause

Old users (created before the profile trigger existed) have **no row** in the `profiles` table. The onboarding page uses `.update()`, which silently matches 0 rows and returns no error. Then `refetchProfile` queries the profile, gets `null`, and `hasCompletedOnboarding` stays `false` — looping back to the same page.

## Fix

**File:** `src/pages/OnboardingGatePage.tsx` (line 29-32)

Change `.update()` to `.upsert()` so a profile row is created if it doesn't exist:

```typescript
const { error } = await supabase
  .from('profiles')
  .upsert(
    { user_id: userId, full_name: trimmed, has_accepted_oath: true },
    { onConflict: 'user_id' }
  );
```

This handles both cases:
- **Old users** (no profile row): inserts a new row
- **New users** (profile row exists from trigger): updates the existing row

One file, one change.

