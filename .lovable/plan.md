## Goal

Temporarily silence all background activity on the database so we can measure baseline cost with zero cron/realtime churn. Fully reversible — nothing deleted, just paused.

## What gets disabled

Single migration that unschedules (not drops) every `cron.job` currently running, and drops the always-on Realtime publications. Everything is recorded so we can restore it verbatim when you say.

### 1. Pause every cron job

Enumerate `cron.job` and call `cron.unschedule(jobname)` for each. Current known jobs:

- `world-watchdog` (every 5 min)
- `expire-timed-state` (every 15 min)
- `prune-logs` (hourly)
- `return-unique-items` (hourly)
- `process-email-queue` (30 s)
- `tick-creatures` (only when awake — likely already unscheduled, safe to attempt)
- any other job present at run time

Job definitions are stored in `cron.job`, so re-scheduling later is a one-liner per job — we'll snapshot the `schedule` + `command` columns into a temp text log in the migration description for easy restore.

### 2. Drop Realtime publications

`ALTER PUBLICATION supabase_realtime DROP TABLE` for every table currently in it:
`characters`, `creatures`, `marketplace_listings`, `node_ground_loot`, `parties`, `party_members`, `summon_requests` (and any others discovered at run time).

This stops the WAL → Realtime fan-out entirely. Client subscriptions will just sit idle.

### 3. Leave alone

- No frontend changes.
- No edge function deletions.
- No table drops, no data changes.
- `world_is_awake()` / `record_world_state()` stay as-is — with no watchdog calling them they're inert anyway.

## Expected effect

- Database goes fully idle: no periodic SELECTs, no WAL replication traffic, no HTTP calls from `pg_net`.
- App still loads, but live updates (combat ticks, marketplace, party sync, emails) will NOT flow until we restore. Effectively the game is offline for players during the test.
- You watch the Cloud usage graph for a day or two to see the true floor.

## Restore path (for later, on your say-so)

One follow-up migration re-creates:
- Each `cron.schedule(...)` from the snapshot.
- `ALTER PUBLICATION supabase_realtime ADD TABLE ...` for the tables above.

I'll keep the exact restore SQL in the pause migration's description so it's trivially reversible.

## Confirm before I write the migration

- OK that players effectively can't play (no realtime, no combat ticks, no emails) during the test window?
- Want me to also pause `process-email-queue` (signup confirmation emails will queue but not send until restore)?
