# Something is still running while the world sleeps

## What the audit found

The world genuinely is asleep (`world_state` = `asleep` since 2026-08-21 19:00 UTC), and the sleep routine did its job: it unscheduled every job it knows about (`world-watchdog`, `tick-creatures`, `expire-timed-state`, `effects-catchup`, `process-email-queue`, `return-unique-items`, `prune-logs`, `idle-shutdown-check`), dropped the realtime tables from the publication, and disabled the wake triggers.

But seven newer background jobs were added after that sleep routine was written, and none of them were ever added to its shutdown list or gated on world state. They have kept firing continuously for the last three days with zero players online. Job runs in the last 24 hours:

| Job | Schedule | Runs / 24h |
|---|---|---|
| prune-encounter-tick-batches | every minute | 1440 |
| prune-encounter-access-grants | every 5 min | 288 |
| purge-ground-loot | every 5 min | 288 |
| sweep-stranded-encounters | every 5 min | 288 |
| prune-effects-catchup-log | hourly | 24 |
| prune-terminal-combat-actions | hourly | 24 |
| prune-combat-audit | hourly | 24 |

That is ~2,400 database transactions per day, several of them multi-table joins and deletes (`sweep_stranded_encounters` scans encounters plus three dependent tables), running forever on an empty world. The database never gets an idle window, which is why usage does not drop when the world goes to sleep.

Confirmed as **not** the cause: no edge function was invoked in the last 24 hours, and no outbound HTTP (`pg_net`) calls were made — so no AI, email, or catch-up work is running. The cost is purely idle database maintenance activity.

Secondary observation: because `idle-shutdown-check` is (correctly) removed while asleep, and `world-watchdog` too, nothing re-arms the lifecycle until a player logs in — that part is by design and stays as is.

## What I propose to change

Make the maintenance jobs sleep with the world, without weakening any of them while the world is awake.

1. **Register the seven jobs with the sleep/wake lifecycle.** Add them to the list `shutdown_world()` unschedules and to the list `wake_world()` re-schedules, so going to sleep silences them and waking restores the exact same schedules.
2. **Add a self-guard to each job body** so a stray schedule can never resurrect the cost: each job first checks the world state and returns immediately when asleep. This is the same "guarded" pattern already used by `guarded_expire_timed_state` and `guarded_return_unique_items`.
3. **Run one final sweep on shutdown.** Before sleeping, `shutdown_world()` performs a single pass of the pruning/sweep functions so nothing is left stranded for the duration of the sleep (ground loot, stranded encounters, expired grants). This keeps behaviour identical to today's continuous pruning from a player's point of view.
4. **Reduce the awake cadence of the heaviest job.** `prune-encounter-tick-batches` runs every minute but only needs to keep the most recent recoverable tick; move it to every 5 minutes while awake. Retention (180s minimum, newest tick never deleted) is unchanged.
5. **Stop the currently running jobs now.** Since the world is already asleep, unschedule the seven jobs as part of the change (after one final sweep pass), so the cost stops immediately rather than at the next sleep transition.

Nothing in combat, tick pacing, encounters, abilities, player data, or the frontend changes.

## Technical detail

- Single idempotent migration; no table or column changes.
- `shutdown_world()` and `wake_world()` job-name arrays extended with: `prune-combat-audit`, `prune-encounter-tick-batches`, `prune-encounter-access-grants`, `purge-ground-loot`, `prune-effects-catchup-log`, `sweep-stranded-encounters`, `prune-terminal-combat-actions`.
- New `guarded_*` wrappers (SECURITY DEFINER, `search_path = public`) that early-return when `world_state.state <> 'awake'`; cron commands call the wrappers, the underlying functions keep their current signatures and logic so any direct/admin call still works.
- Final-sweep block in `shutdown_world()` wrapped per call in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING` so a failing sweep can never block the world from sleeping.
- Verification after the migration: `cron.job` contains none of the seven while asleep; `cron.job_run_details` shows no new runs; then a wake/sleep cycle check that all seven return and disappear again.
