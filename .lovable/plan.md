# Automatic Combat2 Dispatch Every 2 Seconds

Goal: the already-proven `combat2-dispatch-once` worker runs itself every 2 seconds while the world is awake and combat is open, and stops itself otherwise. No new combat system, no behaviour change inside Combat2.

The scheduler foundation already installed does almost all of this. Only two things are missing: the shared secret it authenticates with, and the hooks that turn scheduling on and off with wake/sleep and open/maintenance.

## 1. How the scheduler authenticates

The database scheduler calls the dispatcher over HTTP and presents a bearer token. The dispatcher already compares that token, in constant time, against its own `COMBAT2_WORKER_SECRET` and rejects anything else with 401. Nothing else changes: no anon key, no service-role key, no user JWT is used as HTTP authorization, and the token never appears in SQL text, logs, or returned payloads.

## 2. Is Database Vault actually necessary?

Not strictly — it is one of two acceptable stores. Vault is, however, already what the installed `combat2_dispatch_scheduler_fire()` reads, it keeps the value encrypted at rest, and it is reachable through Lovable's managed SQL operation (`vault.create_secret`). The Lovable UI does not expose Vault, but the managed SQL path does, so no "secret-copy bridge", extra function, or extra table is needed.

Recommended approach: rotate the worker secret once, in lockstep, to a freshly generated value.

- Generate a new high-entropy value with Lovable's secret generator.
- Store it as the Lovable Secret `COMBAT2_WORKER_SECRET` (this is what the dispatcher reads at runtime).
- Store the same value in Database Vault under the same name, via one managed SQL statement — not a migration, because it carries project-specific secret material.
- The old value is simply replaced; nobody has to read or reveal the current one.

Alternative, if you would rather no secret value ever be handled outside the database: the token could be generated inside Postgres and the dispatcher changed to validate the presented bearer against the database instead of its env var. That removes the handoff entirely but requires editing the dispatcher handler and adds one database read per fire. Not recommended as the first step — it changes proven code for no security gain.

## 3. How wake/open starts scheduling

`combat2_dispatch_scheduler_enable()` already exists, is idempotent, is `service_role`-only, and refuses to enable while ineligible or while the secret is missing. It needs to be called from the paths that make the world eligible:

- `wake_world()` — call enable at the end of a successful wake.
- the combat-mode control path, when `combat_mode` is set to `open`.

Both calls are safe on repeat: enable returns `already_enabled` when the single correct job is present, and returns `ineligible` (removing any job) when the other gate is still closed. So whichever of wake/open happens second is what actually starts the beat.

## 4. How sleep/maintenance stops scheduling

Three independent stops, in order of preference:

1. Explicit: `combat2_dispatch_scheduler_disable()` is called from the sleep path and from the combat-mode path when mode leaves `open`. The job is unscheduled immediately.
2. Self-healing: every `fire()` re-checks `world_state_is_awake() AND combat_mode_is_open()` before any HTTP call and unschedules itself when ineligible. So even an unexpected sleep route stops the beat within one tick.
3. Fail-closed: if the Vault secret is missing or empty, `fire()` unschedules itself rather than calling the dispatcher unauthenticated.

Maintenance therefore remains the kill switch it has always been, and the dispatcher's own `combat2_due_nodes` refusal stays as the final backstop.

## 5. How duplicate and overlapping ticks stay prevented

Unchanged from what is already installed and proven:

- Exactly one cron job named `combat2-dispatch-once`; enable unschedules any duplicate before creating it.
- `pg_advisory_xact_lock` around enable/disable; `pg_try_advisory_xact_lock` in `fire()` — a second concurrent fire returns `overlap_refused` instead of posting.
- Single in-flight request tracked in `combat2_dispatch_schedule_state`: a new post is refused while the previous request has neither completed nor aged past 15 seconds.
- At most one `net.http_post` per fire, with a 12-second timeout.
- Inside the dispatcher, per-node `node_tick_claim` leases, `state_version` fencing, and the claimed-versus-committed tick lifecycle already make a repeated dispatch a no-op rather than a double tick.

## 6. Smallest implementation and deployment steps

1. Provision the rotated worker secret: generate value, set Lovable Secret `COMBAT2_WORKER_SECRET`, insert the same value into Vault under that name via one managed SQL statement. Verify by name and presence only.
2. One small migration that adds the enable/disable calls to the existing wake, sleep, and combat-mode control functions. No new tables, no new RPCs, no new Edge Functions.
3. No Edge deployment needed — `combat2-dispatch-once` is already deployed and unchanged.
4. Controlled activation, still owner-approved and reversible: keep maintenance on and world asleep, then open combat and wake the world, confirm exactly one cron job exists, watch a handful of fires for `queued` classifications and dispatcher 200s, then put the world back to sleep and confirm the job is removed and zero jobs remain.
5. Rollback at any moment: set `combat_mode = maintenance` or send the world to sleep — the next fire unschedules itself; or call disable directly.

## Notes on cost and cadence

A 2-second cron beat means the database is doing scheduled work continuously whenever the world is awake, which keeps the instance active and does have a recurring cost. That cadence is the authoritative Combat2 tick rate agreed for this engine, and it is bounded by the eligibility gates: while the world sleeps or combat is closed, no job exists at all and nothing runs.
