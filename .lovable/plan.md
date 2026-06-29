# What's still waking the database

I checked `cron.job` and the top query stats. The DB is genuinely quiet on gameplay now, but three things are still keeping it busy 24/7 — even with zero players online.

## 1. Email cron is still firing every 5 seconds

Despite the earlier event-driven change, job #17 in `cron.job` is still scheduled `5 seconds`. Stats confirm it:

- The email cron's `CASE…WHEN EXISTS` query has been called **~1,000,000 times** (top 8 by call count).
- It alone produces ~17,280 wake-ups/day and ~86,000 writes/day into `cron.job_run_details` (5 rows per run × 17k).
- `cron.job_run_details` UPDATE/INSERTs occupy slots #2–6 in the call-count list (~2M calls each) — almost all of them caused by this 5-second job.

**Fix:** reschedule to `* * * * *` (1 minute). `enqueue_email` already triggers `process-email-queue` instantly via `pg_net`, so the cron is just a safety net. Result: ~12× fewer wake-ups, ~12× fewer `cron.job_run_details` writes.

## 2. Realtime WAL reader is the #1 query in the database

The single highest-call query is the Realtime `apply_rls` WAL scan: **~10M calls, 58s total exec**. It runs continuously polling the WAL for every table in the `supabase_realtime` publication. Current publication includes 10 tables; one is unnecessary:

- `character_materials` — already written through batched RPCs and read on demand by `useMaterials`. It does not need WAL streaming.

**Fix:** drop `character_materials` from `supabase_realtime`. Reduces per-write WAL row decoding and shrinks the polling payload.

(Leave the other 9 — `characters`, `creatures`, `parties`, `party_members`, `party_combat_log`, `marketplace_listings`, `node_ground_loot`, `summon_requests`, `xp_boost` — they all drive live UI.)

## 3. Creature tick runs every 2 min even with nothing to do

`tick_creatures` is already gated by `world_is_awake()`, but when players ARE online it always runs `regen_creature_hp` + `respawn_creatures` — two full UPDATEs across the `creatures` table — even if no creature is wounded or dead. Stats: ~188k calls each.

**Fix:** add a cheap `EXISTS` pre-check inside each function so the UPDATE only fires when there's actual work:

```sql
-- regen_creature_hp: bail if no wounded creature
IF NOT EXISTS (SELECT 1 FROM creatures WHERE is_alive AND hp < max_hp) THEN RETURN; END IF;

-- respawn_creatures: bail if nothing due
IF NOT EXISTS (SELECT 1 FROM creatures WHERE NOT is_alive AND died_at + (respawn_seconds||' seconds')::interval <= now()) THEN RETURN; END IF;
```

Index-only scans, sub-millisecond when idle.

## What I will NOT change

- `prune_cron_history` (hourly) — already cheap and necessary.
- The 4 guarded gameplay crons — already `world_is_awake`-gated.
- Other Realtime tables — each drives visible UI.

## Migration plan (single file)

1. `cron.unschedule(17)` then `cron.schedule('process-email-queue', '* * * * *', <same body>)`.
2. `ALTER PUBLICATION supabase_realtime DROP TABLE public.character_materials`.
3. `CREATE OR REPLACE FUNCTION regen_creature_hp/respawn_creatures` with the `EXISTS` early-return.

## Expected impact

| Source | Before | After |
|---|---|---|
| Email cron ticks/day | 17,280 | 1,440 (12× less) |
| `cron.job_run_details` writes/day | ~86,400 | ~7,200 |
| Realtime WAL tables polled | 10 | 9 |
| Creature regen UPDATEs when idle | every 2 min, full scan | EXISTS check only |

The DB should drop to near-zero CPU when no one is online and stay measurably lower under load.
