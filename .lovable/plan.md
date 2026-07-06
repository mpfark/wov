## Goal

Make the "slumber" state (nobody online in the last 5 min → cron jobs no-op) visible, both in-app for admins and in the DB logs.

## What to add

### 1. Lightweight slumber event log (DB)

New table `public.world_slumber_log`:
- `state` text ('awake' | 'asleep')
- `awake_characters` int (count that triggered the transition)
- `changed_at` timestamptz default now()

Grants + RLS: service_role full; authenticated `SELECT` only for admins (via `has_role(auth.uid(),'admin')`).

New SQL helper `public.record_world_state()`:
- Reads current `world_is_awake()` → `now_state`.
- Reads last row from `world_slumber_log` → `prev_state`.
- If different (or table empty), INSERT a row with the current awake-character count.
- Idempotent — safe to call every tick.

Wire into existing gated cron functions so we log at natural checkpoints without adding a new job:
- `tick_creatures()` — call `record_world_state()` unconditionally at the top, then keep the existing `world_is_awake()` early return.
- `guarded_return_unique_items()` — same.

Result: transitions get recorded within 2 minutes of happening, at zero extra cron cost.

### 2. Admin UI indicator

In the Admin page header/status area (wherever the existing admin dashboard lives — e.g. `src/pages/AdminPage.tsx`), add a small pill:

```
🌙 World asleep · last awake 3h 12m ago
☀️ World awake · 2 players online
```

Data source: a tiny hook `useWorldSlumberState()` that:
- Queries `world_is_awake()` via RPC (or a `SELECT ... FROM characters WHERE last_online > now() - '5 min'` count).
- Queries the last row of `world_slumber_log` for "last change" timestamp.
- Polls every 30 s (admin page only — not injected globally).

Pill styling matches existing dark-fantasy parchment tokens (no hardcoded colors). Muted/desaturated when asleep, warm glow when awake.

### 3. Optional: recent transitions list

Under the pill, a collapsible "Recent slumber activity" showing the last 20 rows of `world_slumber_log` (state, timestamp, awake_characters). Read-only, admin-only.

## Out of scope

- No changes to cron schedules or gating logic (already working correctly).
- No changes to `combat-tick` edge function (client-driven, already dormant when no players).
- No pruning job yet — table grows by ~2 rows per awake/sleep cycle, negligible. Can add later if needed.

## Technical notes

- `world_is_awake()` already exists and uses `characters.last_online > now() - interval '5 minutes'` — reused as the single source of truth.
- Migration is schema + function changes only; safe and reversible.
- Admin-only visibility uses the existing `has_role(auth.uid(),'admin')` pattern from user-roles memory.
