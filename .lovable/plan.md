
## Goal
Cut WoV daily run-usage credits by copying the patterns that dropped Frokost from ~1.86 → ~0.35/day.

## What Frokost does differently (evidence)
- **3 cron jobs total.** Email queue is a 1-min *safety net* that no-ops (pure SQL check on pgmq queues) when there's nothing to send — the real send is triggered event-driven from `enqueue_email` via `net.http_post`.
- **Working-hours schedules** (`*/30 5-17 * * 1-5`) instead of 24/7 cadence.
- **Trigger-driven (re)scheduling**: the weekly reminder cron is `cron.schedule`d only when settings enable it, and `cron.unschedule`d otherwise.
- **Minimal realtime publication** (they don't broadcast hot tables at all).

## What WoV does today
- 5 cron jobs, all 24/7:
  - `tick-creatures` every 2 min (720 runs/day)
  - `expire-king-slayer`, `expire-marketplace-listings` every 15 min (96 each)
  - `return-unique-items` every 30 min
  - `prune-logs` hourly
- Even when the world is asleep, every `tick-creatures` still runs `record_world_state()` which scans `characters` + does role checks (720 seq-scans/day for nothing).
- Realtime publication includes hot/heavy tables: `characters` (51 cols, written on every heartbeat / HP-CP-MP tick), `creatures`, `party_combat_log`. Every UPDATE hits the WAL replication slot even with 0 subscribers online.
- Email queue kick already exists (good).

## Plan

### 1. Make crons truly event-driven (biggest win)
- Add `schedule_world_crons()` / `unschedule_world_crons()` SECURITY DEFINER functions that call `cron.schedule` / `cron.unschedule` for `tick-creatures`.
- Add an AFTER UPDATE trigger on `characters.last_online` that:
  - Calls `schedule_world_crons()` when a non-admin's `last_online` crosses into the "active" window and no job exists.
  - This is the wake-up path; login-time already updates `last_online`.
- Extend `record_world_state()` so when it flips `awake → asleep` it calls `unschedule_world_crons()`.
- Keep one lightweight watchdog cron (`*/5 * * * *`) that only checks state and unschedules if stale — safety net matching Frokost's pattern.
- Net effect: **0 cron work while nobody is playing** (currently 720+ no-op runs/day).

### 2. Consolidate & slow down remaining crons
- Merge `expire-king-slayer` + `expire-marketplace-listings` into a single `expire-timed-state` job every 15 min. (2 jobs → 1, halves per-run overhead.)
- Move `return-unique-items` from `*/30` to hourly — unique-item return is not time-critical.
- Gate all of them behind `world_is_awake()` (already done) and skip the `record_world_state` insert on the fast path.

### 3. Trim realtime publication
- Drop `party_combat_log` from `supabase_realtime` — panel already receives log lines via the party broadcast channel, and inserts are batched (250 ms / 20 rows) purely for read-back.
- Drop `xp_boost` from the publication — usage is low enough that a manual broadcast on grant/expire is cheaper than always-on WAL replication.
- Keep `characters` for now (client depends on it) but plan a follow-up to split hot cols (`last_online`, `current_hp/cp/mp`, `current_node_id`) into a sibling table so the 51-col row isn't WAL-replicated on every heartbeat.

### 4. Reduce heartbeat WAL churn
- Confirm the `last_online`/resource writes are already throttled to 12 s (previous work). Add a guard so identical resource values don't UPDATE at all (skip write when nothing changed) — avoids WAL rows for idle characters staring at the map.

### 5. Verify after deploy
- `SELECT jobname, schedule FROM cron.job` shows fewer jobs.
- With no players online: `cron.job_run_details` for `tick-creatures` should stop appearing entirely (job unscheduled), not just no-op.
- `supabase--db_health` WAL size should trend down over a day.

## Technical notes
- All schedule/unschedule wrappers use `SECURITY DEFINER SET search_path = public, cron` and are callable only by service-role / triggers.
- Trigger uses `pg_trigger_depth() = 0` guard to avoid recursive fires.
- Migration is additive; existing jobs are unscheduled and re-created inside the migration so no manual dashboard steps.
- No frontend/gameplay changes; combat, party, chat, marketplace behavior identical when the world is awake.

## Out of scope (call out, don't do)
- Splitting the `characters` table (larger refactor — separate plan).
- Removing `characters`/`creatures` from the realtime publication (would require rewriting several hooks to use manual broadcasts).
