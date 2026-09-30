# World heartbeat identity

This note specifies the approved correlation contract for `ENG-HB-001` and records its installed-source boundary. Migration `20260929130000_combat2_world_heartbeat_identity.sql` is recorded installed exactly once, official types are regenerated, and the sole affected Edge consumer `combat2-dispatch-once` is recorded deployed. Mik reports the frontend manually published, with the exact published revision unavailable. A bounded live window now verifies ordinary eligible-fire, settlement, selection and commit correlation; ineligible, failure, retry and catch-up cases remain live-unverified.

## Current timing and identity map

| Path | Current timing source | Current identity / cursor | Authority and retry boundary |
|---|---|---|---|
| Scheduler invocation | pg_cron calls `combat2_dispatch_scheduler_fire()` every two seconds while configured | database-generated durable `heartbeat_id`; `combat2_dispatch_schedule_state.request_id` remains the outstanding `pg_net` request id | every actual wrapper invocation gets a new id, including ineligible calls; no invocation creates no row; existing overlap and eligibility fences remain |
| Dispatcher selection | one Edge invocation calls `combat2_due_nodes(10)` | scheduler `heartbeat_id` is shared as correlation metadata; a separate random diagnostic `invocationId` remains per selected node | one invocation selects zero to ten due nodes and processes them sequentially, once each, without an internal retry loop |
| Encounter processing | `node_encounter.next_due_at <= now()` | `candidate_tick = node_encounter.tick + 1`; a random claim token and lease protect that candidate | claim captures an intent cutoff and snapshot; only a matching token, candidate tick, prior tick and state version may commit; commit advances only that encounter and schedules its next due time two seconds later |
| Resource settlement | the scheduler wrapper calls settlement on every fire; settlement phases itself with `date_bin('4 seconds', ...)` | locked singleton `character_resource_settlement_state.settled_bucket` | the bucket cursor prevents duplicate settlement; up to three short missed buckets are caught up, while longer downtime awards one current interval and advances the cursor |
| Immediate movement / entry | the authoritative request transaction runs when received, between scheduler fires if necessary | caller request UUID plus transition rows/state-version fences | it never waits for a scheduler fire; serialization with claims determines whether departure or the already-owned encounter commit completes first |
| Delivery | Realtime notification plus bounded `combat2_sync` recovery | encounter-local delivered tick / `after_tick` cursor | clients accept consecutive committed encounter batches only; this cursor is neither a scheduler fire nor a settlement phase |
| Bounded diagnostics | server timestamps, optional heartbeat id and optional encounter tick | session-local sequence, request id, node/encounter ids, heartbeat id, tick, outcome and elapsed time | five-minute opt-in session, at most 2,000 events, at most 32 events per server batch, retained for 24 hours |

One scheduler fire can therefore select several nodes, one node or no node. A selected node can still refuse a claim because another owner won the race. A node with no due active encounter contributes no encounter tick. An immediate transaction can commit after one scheduler fire and before the next without acquiring or inventing a heartbeat identity.

Maintenance and world sleep do not create gameplay work. Under the installed contract, an actual wrapper call still creates an `ineligible` run row; if pg_cron never invokes the wrapper, no row is fabricated. The installation itself invoked no scheduler branch and the table consequently contained zero rows afterward. The settlement cursor advances while settlement is ineligible so downtime is not banked. An expired encounter lease may be reclaimed, but a failed or refused commit does not advance the encounter tick.

## Approved minimal contract

Add a durable, database-issued `heartbeat_id` to each actual invocation of the scheduler wrapper. The identifier is correlation metadata, not a gameplay tick and not an idempotency key.

- `combat2_dispatch_scheduler_fire()` creates the identity before settlement and dispatch and passes the same identity through both branches.
- Use a PostgreSQL `bigint` identity/sequence. Values are strictly increasing but may have gaps after rollback, crash or administrative sequence use. They are not elapsed-time calculations.
- Persist a bounded heartbeat-run record containing only the id, server start/completion timestamps, eligibility/classification, settlement bucket/steps, selected/processed counts and bounded error classification. Never store secrets, authorization data, snapshots, proposals or unbounded payloads.
- A scheduler retry is a new invocation and receives a new `heartbeat_id`. The existing settlement bucket, encounter claim/commit fences and request UUIDs continue to provide idempotency. A heartbeat id must never be reused to pretend two attempts are exactly once.
- Zero, one or several selected nodes share the scheduler fire's `heartbeat_id`. Each node keeps its independent encounter id, candidate tick, claim token and committed tick.
- Claim and commit diagnostics carry the originating `heartbeat_id`. Durable encounter/tick evidence may retain the committed heartbeat id, but encounter progression remains `tick + 1` and never derives from the global id.
- Resource settlement records the same heartbeat id and its actual four-second bucket. Catch-up can apply one to three settlement steps during one heartbeat; those steps do not become extra heartbeat ids.
- Immediate movement, entry and hostile-initiation transactions remain immediate. For diagnostics they may record `observed_after_heartbeat_id`, read from the latest completed/started heartbeat state, together with their request UUID. They do not reserve the next id and do not wait for it.
- A missed fire has no synthetic heartbeat id. Operators infer missed opportunities from timestamps and id gaps only where an attempted allocation occurred; diagnostics must not fabricate gameplay work.
- The client may display a heartbeat id and server timestamp as read-only diagnostic context. It must never use the id to enable actions, predict an encounter tick, settle resources, order requests or infer success.

## Installed persistence and function contract

A schema change is required for a durable identity shared across the SQL scheduler wrapper, Edge dispatcher, worker diagnostics and settlement. In-memory Edge UUIDs cannot correlate a fire that selected no nodes, and the current `pg_net` request id describes transport rather than world time.

The installed implementation creates `public.world_heartbeat_run` with a generated `bigint` identity primary key and bounded scalar columns for timestamps, scheduler eligibility/outcome, settlement bucket/steps, dispatch counts/outcome, cleanup count and bounded classifications. RLS is enabled, browser roles have no table privileges, the table is not added to Realtime and there are no gameplay payload, character or credential columns. A nullable non-referencing `heartbeat_id` is added to bounded diagnostic server events.

`combat2_dispatch_scheduler_fire()` inserts the run before eligibility work, sets its id as transaction-local scheduler context, calls settlement and dispatch through the preserved independently caught branches, and returns the id with their bounded outcomes. The preserved inner scheduler sends `{ "heartbeat_id": id }` to `combat2-dispatch-once`; an old/manual caller may still send `{}`. The Edge handler carries the id into per-node worker diagnostics and calls service-role-only `combat2_heartbeat_record_dispatch` after processing. Existing result classifications and gameplay functions are unchanged.

Retention is fixed at 24 hours, approximately 43,200 rows at a two-second cadence. Each wrapper invocation uses the indexed `started_at` predicate to delete at most 2,048 expired rows. Cleanup is best-effort and recorded; it creates no second scheduler and does not scan or block on an unbounded result set. Diagnostic correlation deliberately has no foreign key to the run table, so retention cannot be blocked by longer-lived evidence.

## Failure and rollback semantics

- Settlement and dispatch remain separate caught branches. A settlement exception records a bounded `settlement_error` and dispatch still runs; a dispatch exception records `dispatch_error` without undoing a successful settlement branch.
- Cleanup failure is caught and classified, and does not suppress settlement or dispatch.
- Because the run insert and SQL wrapper outcomes share one database transaction, their row survives when failures are caught. If the whole transaction is rolled back or the connection is lost before commit, the run row and its updates do not survive. PostgreSQL identity sequence allocation is non-transactional, so a gap can remain; a gap is evidence of allocation, not proof of gameplay work.
- Dispatcher processing and `combat2_heartbeat_record_dispatch` occur later through `pg_net`/Edge transactions. A transport failure, Edge crash or diagnostic-update failure can therefore leave a committed scheduler row without final dispatch counts. That absence is bounded operational evidence and never rolls back gameplay already committed by the worker.
- A retry is a new wrapper invocation and receives a new id. Settlement buckets, encounter claim/commit fences and request UUIDs—not `heartbeat_id`—continue to prevent duplicate gameplay effects.

## Installation evidence and remaining verification

Repository-backed Lovable evidence records the exact migration installed once, its separate ledger artifact, the guarded table/function/ACL contract, regenerated official types and deployment of only `combat2-dispatch-once`. The world remained asleep in maintenance with soak off and no schedules; installation invoked no scheduler, settlement, dispatcher, worker or gameplay path. The rollback-only practice run compiled through the wrapper rename and stopped deliberately; remaining statements first compiled during the successful atomic installation. These are Lovable-reported Cloud observations, not direct Cloud verification by the reconciliation task.

The remaining step is a separately authorized bounded observation: see an ineligible or zero-node invocation, a multi-node invocation if safely available, a four-second settlement phase, one encounter commit and an immediate transaction between fires. Confirm retries do not double-settle or double-commit and all labels remain distinct.

Backward compatibility requires nullable new fields and unchanged existing RPC result classifications during rollout. The dispatcher and worker must continue to function if a diagnostic sink is unavailable.

## Approved operational decisions

Every actual scheduler-wrapper invocation receives an id, including an invocation that proves maintenance or a sleeping world ineligible. No invocation means no row. Run rows are retained for 24 hours with indexed, bounded cleanup. These are observability decisions only: cadence, encounter order, settlement formulas, movement immediacy and client authority remain unchanged.

## Observed encounter cadence (2026-09-30, read-only evidence)

Lovable's read-only investigation of diagnostic session `3d23c6a3-b8b8-41aa-b41f-93fc5686839a` and encounter `68b73567-113e-4528-bc26-b811240ec268` covered 10:13:03–10:13:59 UTC. Heartbeats 94–106 were all eligible and queued, and every dispatch completed. Their starts were spaced by about 2.016 seconds. Encounter ticks 526–531 nevertheless committed only on heartbeats 95, 97, 99, 101, 103 and 105; the intervening fires either found no due node or processed another encounter. There were no live claims, refusals, overlap or failures. Per-node commit-log rows were unavailable for the window and scheduled-job rows were not permission-visible, so those cases are not inferred.

The source explains the observation: due-node selection requires `next_due_at <= now()`, while commit sets `next_due_at = greatest(now(), next_due_at) + interval '2 seconds'`. Here `now()` is the commit transaction's start, about 0.4–0.5 seconds after the scheduler fire because dispatch crosses `pg_net` and Edge. The next fire arrives before that shifted due time, so the encounter is selected on the following fire. This is phase drift caused by commit latency, not a scheduler gap or a stable four-second contract.

Mik separately operator-reports that deliberate peaceful initiation works and that out-of-combat regeneration resumes after release. Those observations remain operator evidence (`directly_verified: false`), not proof of the cadence model or its rare branches.

## Authored two-second phase correction (`ENG-HB-003`)

The approved gameplay cadence remains one encounter tick per eligible two-second scheduler opportunity. CP regeneration remains every second committed encounter tick; effect pulse/expiry rules and boss windup/cooldown conversion remain based on the existing two-second encounter tick. A deliberate three- or four-second cadence remains an unapproved future option.

Migration `20260930130000_combat2_encounter_schedule_drift.sql` is authored but not installed. It patches only the effective inner atomic commit function, `node_tick_commit_without_bounded_failure(...)`. After a successful commit it advances from the encounter's **previous scheduled deadline**, not from worker transaction time:

```text
elapsed slots = floor(max(0, commit_transaction_start - previous_due) / 2 seconds)
next due      = previous_due + (elapsed slots + 1) × 2 seconds
```

During healthy execution, a commit 0.4–0.5 seconds after its due opportunity therefore advances from `04.000` to `06.000`, allowing the `06.1` scheduler fire to select it. Latency does not accumulate into the schedule. If processing is delayed past one or more deadlines, the expression chooses the first phase-aligned deadline strictly after the commit transaction start. Obsolete opportunities are skipped; no backlog of attacks is replayed.

Entry and reactivation continue to set `next_due_at = now()`, so the first resolution remains eligible on the next scheduler invocation. A failed/refused commit never reaches the deadline update. An expired lease may reclaim the same candidate tick; exactly-once tick/state/token fences still allow only one successful commit. Completion retains the existing status transition. Maintenance, sleep or missing scheduler calls create no combat work; after reopening, the first successful overdue commit skips old phases. Immediate movement continues to serialize independently between heartbeats and can invalidate an old claim through the existing fences.

`heartbeat_id` is unchanged correlation metadata. Its value, parity and numeric gaps are not used as a clock or gameplay ordering rule. The due-node selector, scheduler wrapper, claim functions, public commit wrappers, resolver and Edge code are unchanged.

### Mandatory Lovable installation and live checks

Before installation, while the world is asleep and Combat2 is in maintenance, verify read-only that:

- the migration is absent from the ledger and its repository SHA-256 matches the authorized handoff;
- `node_tick_commit_without_bounded_failure(...)` is postgres-owned, `SECURITY DEFINER`, volatile, `search_path=public`, service-role-only, and contains exactly one guarded old due-time assignment;
- the public/arrival/boss/bounded-failure wrapper chain and `combat2_due_nodes` definitions match their recorded predecessors;
- there are no live claims, active Test Arena processing or queued gameplay work that installation could disturb.

Run the migration first in a rollback-only transaction against the installed schema and compile every statement. After the atomic install, verify the patched assignment exactly once; unchanged owner/security/volatility/search path/ACL; unchanged wrappers, claim signature, due selector, lock order and resolver contracts; no gameplay-row mutation; and no generated type diff (the migration changes no schema or signature).

The bounded live test must observe one ordinary encounter for at least six eligible heartbeats. Require consecutive committed encounter ticks near the two-second cadence, no claim/commit refusals, no duplicate tick per dispatcher invocation, unchanged even-tick CP regeneration, normal completion/release and operator-visible post-combat regeneration. Record heartbeat and encounter tick as separate fields. Do not infer success from HTTP 200 or from heartbeat-id arithmetic.
