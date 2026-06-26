## What I found

Total DB size is **4.49 GB**, and **4.46 GB of that is a single table: `cron.job_run_details`** (Postgres' built-in log of every cron job execution).

- 1,900,459 rows, oldest from **Feb 12, 2026** — never pruned.
- Your `public` schema (all gameplay data) is only **4.3 MB**.
- A daily prune job (`jobid 9`, runs 03:00 UTC, keeps 3 days) exists, but its last 4 runs **all failed** — so nothing has been deleted since it was set up. Likely it now times out because the table is too big to scan in one DELETE.

So this is pure log bloat from cron itself (every 2-min creature tick, every 1-min email check, etc., logged forever).

## The fix

### 1. One-time cleanup (instant ~4.4 GB reclaim)
`TRUNCATE cron.job_run_details` inside a migration. TRUNCATE is O(1), bypasses the timeout that's killing the DELETE, and immediately returns the disk to Postgres (no VACUUM FULL needed). The cron history is purely diagnostic — losing it is fine.

### 2. Replace the broken prune job with a smaller, faster one
Drop `jobid 9` and re-create it as:
- Runs **hourly** instead of daily (smaller batches → never times out again).
- Keeps **1 day** of history instead of 3 (we only ever need recent runs for debugging).
- Wrapped in a tiny SECURITY DEFINER helper `public.prune_cron_history()` so failures surface in logs and we can call it manually if needed.

### 3. Bonus: shrink `net._http_response` (1.4 MB, also bloated to 0 live rows)
Add it to the same hourly prune (delete rows older than 1 hour). Tiny gain today but it grows the same way over time.

## Why this won't affect gameplay

- `cron.job_run_details` is only used to see whether a cron job ran successfully. No app code reads it.
- `net._http_response` stores responses from `pg_net` HTTP calls (the email cron uses this). It's a debugging artifact; the email flow doesn't read it back.
- No public-schema table, RLS policy, or edge function changes.

## Deliverable

A single migration that:
1. `TRUNCATE cron.job_run_details;`
2. `TRUNCATE net._http_response;` (if accessible)
3. `SELECT cron.unschedule(9);` then `cron.schedule('prune-logs','0 * * * *', ...)` calling the new helper.
4. Creates `public.prune_cron_history()` (SECURITY DEFINER, owned by postgres) that deletes rows older than 1 day from both tables.

Expected result: DB size drops from ~4.5 GB to ~25 MB and stays there.
