
## Goal

Keep the world fully paused by default (current state). Any player can wake it on demand from the character-select screen. A lightweight watchdog checks every 30 minutes and, if no player has been online in that window, tears everything back down to the paused baseline.

## Flow

```text
Character Select
   ├─ world asleep? → show [ Start World ] banner
   │       └─ click → RPC wake_world() → re-arm crons, realtime, triggers
   │                                    → sets world_state='awake', wake_watchdog schedules
   └─ world awake?  → normal "Enter World" per character

Every 30 min (cron 'idle-shutdown-check'):
   └─ no character.last_online in last 30 min?
          → RPC shutdown_world(): unschedule all crons, drop realtime, disable wake triggers
          → cron self-unschedules (nothing left to check until next wake)
```

## Backend (single migration)

1. **`world_state` table** — one row: `state text` (`awake`|`asleep`), `changed_at`, `changed_by`. Seeded `asleep`.
2. **`public.wake_world()`** SECURITY DEFINER, callable by any authenticated user with a character:
   - Re-add tables to `supabase_realtime` publication (characters, creatures, marketplace_listings, node_ground_loot, parties, party_members, summon_requests).
   - Re-enable the two wake triggers on `characters` and `pgmq` email queues.
   - Re-schedule crons: `world-watchdog` (5 min), `expire-timed-state` (15 min), `prune-logs` (hourly), `return-unique-items` (hourly), and new `idle-shutdown-check` (30 min).
   - Set `world_state='awake'`, stamp `changed_by = auth.uid()`.
3. **`public.shutdown_world()`** SECURITY DEFINER, called only by the idle-shutdown cron:
   - Mirror the current manual-pause migration: unschedule every cron (including itself and `tick-creatures` / `process-email-queue`), disable wake triggers, drop all 7 tables from realtime publication.
   - Set `world_state='asleep'`.
4. **`public.idle_shutdown_check()`** SECURITY DEFINER:
   - If `NOT EXISTS (SELECT 1 FROM characters WHERE last_online > now() - interval '30 minutes')` → `PERFORM shutdown_world()`.
   - Otherwise no-op.
5. Grants: `EXECUTE ON wake_world` to `authenticated`; `shutdown_world` / `idle_shutdown_check` to `postgres` only.

## Frontend

- **`src/hooks/useWorldState.ts`** — subscribes to `world_state` (single-row realtime via a small polling fetch on mount + a 60s interval; realtime is off while asleep so polling is required). Returns `{ state, wake, waking }`.
- **`src/pages/CharacterSelect.tsx`** — when `state === 'asleep'`, render a parchment banner above the character grid: "The realm slumbers. Rouse it to begin your journey." with a single **Awaken the Realm** button. Clicking calls `supabase.rpc('wake_world')`, shows a 2–5s spinner ("The realm stirs..."), then re-enables character selection. Character cards stay clickable while asleep but selecting one shows a toast prompting to wake first (or we simply gate the click). Chosen behavior: gate — cards are dimmed and non-interactive until awake.
- **No change to `GameRoute`** — once awake, entry flow is unchanged; the existing `last_online` heartbeat keeps the idle-shutdown timer from firing.

## Idle-shutdown behavior

- The 30-min cron uses `characters.last_online`, which the game already updates via existing heartbeat.
- On shutdown, the cron unschedules itself as part of `shutdown_world()`; the world stays fully paused until the next Awaken click.
- Admin-only panel sessions do not update `last_online` (already the case), so an admin browsing `/admin` won't keep the world awake.

## Out of scope

- No UI change inside the game itself.
- No change to admin manual-pause SQL — the new `shutdown_world()` function is the reusable version of it.
- No countdown UI ("world sleeps in X min"); can be added later if wanted.
