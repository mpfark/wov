## Problem

Today the world-awake check in the database explicitly ignores any character whose owner is a Steward or Overlord:

- `world_is_awake()` — filters out admin-owned characters entirely.
- `record_world_state()` — same filter, so it also drives the `schedule_tick_creatures` / `unschedule_tick_creatures` decisions.

Effect: when an admin enters the world with a real character, their `last_online` heartbeat does **not** count as activity. The world stays "asleep", `tick-creatures` stays unscheduled, and — critically — since they never flipped it awake, nothing ever triggers a sleep transition when they leave either. Combat, DoTs, and spawn ticks silently don't run for admin-played characters.

You wanted the opposite: admin-only sessions (admin panel, no character) should not wake the world, but an admin *playing* a character should behave exactly like any other player — wake on entry, let the 5-minute idle window put the world back to sleep on exit.

## Why this is safe to change

The "admin-only login" path already avoids waking the world by construction, not by SQL filter:

- `Index.tsx` checks `sessionStorage.lovable.adminOnlySession === '1'` and hard-redirects to `/admin`.
- `AdminRoute` / `AdminPage` never mount `GamePage`, so no character heartbeat runs and no `characters.last_online` update fires.

So the SQL-level admin exemption is redundant for the admin-only case and actively wrong for the "admin plays a character" case. Removing it lets the existing heartbeat-driven activity window do its job for everyone.

## Plan

Single migration, two function replacements — no frontend changes.

1. `public.world_is_awake()` — drop the two `NOT has_role(...)` clauses; keep the 5-minute `last_online` window.
2. `public.record_world_state()` — same: drop the admin exemption from the `count(*)` query. Keep the transition logic that calls `schedule_tick_creatures` / `unschedule_tick_creatures` and writes to `world_slumber_log`.

Everything else stays: SECURITY DEFINER, `search_path`, the wake/sleep scheduling wrappers, the watchdog cron, and the admin-panel dashboard card that reads these functions.

## Result

- Admin logs into admin panel only → no character heartbeat → world stays asleep (unchanged).
- Admin (or anyone) enters the world with a character → `last_online` updates → next `record_world_state()` tick flips to awake, `tick-creatures` gets scheduled.
- Admin logs out / goes idle 5 min → activity window empties → world flips back to asleep, `tick-creatures` gets unscheduled (this is what's missing today).

## Out of scope

- No changes to `AdminLayout`, admin-only session storage flag, or the slumber dashboard card.
- No change to the watchdog cron cadence.
