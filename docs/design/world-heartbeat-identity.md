# World heartbeat identity

This note specifies the approved correlation contract for `ENG-HB-001` and records its authored source implementation. It does not claim that the contract is installed. Migration `20260929130000_combat2_world_heartbeat_identity.sql` and the updated dispatcher remain pending installation/deployment and live verification; the installed scheduler therefore still has the pre-heartbeat behavior described below.

## Current timing and identity map

| Path | Current timing source | Current identity / cursor | Authority and retry boundary |
|---|---|---|---|
| Scheduler invocation | pg_cron calls `combat2_dispatch_scheduler_fire()` every two seconds while configured | no durable fire identifier; `combat2_dispatch_schedule_state.request_id` is the outstanding `pg_net` request id, not a world tick | advisory lock and outstanding-request state refuse overlap; maintenance, sleep or missing secret disables scheduling |
| Dispatcher selection | one Edge invocation calls `combat2_due_nodes(10)` | the Edge handler creates a separate random diagnostic `invocationId` for each selected node | one invocation selects zero to ten due nodes and processes them sequentially, once each, without an internal retry loop |
| Encounter processing | `node_encounter.next_due_at <= now()` | `candidate_tick = node_encounter.tick + 1`; a random claim token and lease protect that candidate | claim captures an intent cutoff and snapshot; only a matching token, candidate tick, prior tick and state version may commit; commit advances only that encounter and schedules its next due time two seconds later |
| Resource settlement | the scheduler wrapper calls settlement on every fire; settlement phases itself with `date_bin('4 seconds', ...)` | locked singleton `character_resource_settlement_state.settled_bucket` | the bucket cursor prevents duplicate settlement; up to three short missed buckets are caught up, while longer downtime awards one current interval and advances the cursor |
| Immediate movement / entry | the authoritative request transaction runs when received, between scheduler fires if necessary | caller request UUID plus transition rows/state-version fences | it never waits for a scheduler fire; serialization with claims determines whether departure or the already-owned encounter commit completes first |
| Delivery | Realtime notification plus bounded `combat2_sync` recovery | encounter-local delivered tick / `after_tick` cursor | clients accept consecutive committed encounter batches only; this cursor is neither a scheduler fire nor a settlement phase |
| Bounded diagnostics | server timestamps and optional encounter tick | session-local sequence, request id, node/encounter ids, tick, outcome and elapsed time | five-minute opt-in session, at most 2,000 events, at most 32 events per server batch, retained for 24 hours |

One scheduler fire can therefore select several nodes, one node or no node. A selected node can still refuse a claim because another owner won the race. A node with no due active encounter contributes no encounter tick. An immediate transaction can commit after one scheduler fire and before the next without acquiring or inventing a heartbeat identity.

Maintenance and world sleep do not create gameplay work. Under the authored contract, an actual wrapper call still creates an `ineligible` run row; if pg_cron never invokes the wrapper, no row is fabricated. The settlement cursor advances while settlement is ineligible so downtime is not banked. An expired encounter lease may be reclaimed, but a failed or refused commit does not advance the encounter tick.

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

## Authored persistence and function contract

A schema change is required for a durable identity shared across the SQL scheduler wrapper, Edge dispatcher, worker diagnostics and settlement. In-memory Edge UUIDs cannot correlate a fire that selected no nodes, and the current `pg_net` request id describes transport rather than world time.

The authored implementation creates `public.world_heartbeat_run` with a generated `bigint` identity primary key and bounded scalar columns for timestamps, scheduler eligibility/outcome, settlement bucket/steps, dispatch counts/outcome, cleanup count and bounded classifications. RLS is enabled, browser roles have no table privileges, the table is not added to Realtime and there are no gameplay payload, character or credential columns. A nullable non-referencing `heartbeat_id` is added to bounded diagnostic server events.

`combat2_dispatch_scheduler_fire()` inserts the run before eligibility work, sets its id as transaction-local scheduler context, calls settlement and dispatch through the preserved independently caught branches, and returns the id with their bounded outcomes. The preserved inner scheduler sends `{ "heartbeat_id": id }` to `combat2-dispatch-once`; an old/manual caller may still send `{}`. The Edge handler carries the id into per-node worker diagnostics and calls service-role-only `combat2_heartbeat_record_dispatch` after processing. Existing result classifications and gameplay functions are unchanged.

Retention is fixed at 24 hours, approximately 43,200 rows at a two-second cadence. Each wrapper invocation uses the indexed `started_at` predicate to delete at most 2,048 expired rows. Cleanup is best-effort and recorded; it creates no second scheduler and does not scan or block on an unbounded result set. Diagnostic correlation deliberately has no foreign key to the run table, so retention cannot be blocked by longer-lived evidence.

## Failure and rollback semantics

- Settlement and dispatch remain separate caught branches. A settlement exception records a bounded `settlement_error` and dispatch still runs; a dispatch exception records `dispatch_error` without undoing a successful settlement branch.
- Cleanup failure is caught and classified, and does not suppress settlement or dispatch.
- Because the run insert and SQL wrapper outcomes share one database transaction, their row survives when failures are caught. If the whole transaction is rolled back or the connection is lost before commit, the run row and its updates do not survive. PostgreSQL identity sequence allocation is non-transactional, so a gap can remain; a gap is evidence of allocation, not proof of gameplay work.
- Dispatcher processing and `combat2_heartbeat_record_dispatch` occur later through `pg_net`/Edge transactions. A transport failure, Edge crash or diagnostic-update failure can therefore leave a committed scheduler row without final dispatch counts. That absence is bounded operational evidence and never rolls back gameplay already committed by the worker.
- A retry is a new wrapper invocation and receives a new id. Settlement buckets, encounter claim/commit fences and request UUIDs—not `heartbeat_id`—continue to prevent duplicate gameplay effects.

## Rollout and post-install verification

1. Install the exact repository migration once and record its ledger artifact/hash; do not invoke scheduler or gameplay as part of installation.
2. Verify `world_heartbeat_run` has a generated `bigint` identity, the declared constraints and `started_at` index, RLS enabled, no policies or browser privileges, and no Realtime publication membership.
3. Verify the new/replaced functions are postgres-owned, `SECURITY DEFINER`, volatile, retain their guarded search paths/ACLs, and that only service-role server paths can update heartbeat evidence. Verify the renamed predecessor and wrapper composition remain intact.
4. Verify the installed wrapper allocates before eligibility, retains independent settlement/dispatch exception branches, uses indexed 24-hour cleanup capped at 2,048 rows, and the inner scheduler sends the id in the Edge request body. Confirm scheduler cadence/configuration was not changed and no new cron job exists.
5. Verify diagnostic `heartbeat_id` is nullable, non-referencing and bounded; existing events and `{}` dispatcher callers remain readable. Regenerate official Supabase types from the installed schema.
6. Deploy only the changed transitive Edge consumer, `combat2-dispatch-once`; no shared Combat2 mirror changed. Do not deploy another function unless a fresh dependency trace proves it imports the changed handler.
7. In separately authorized bounded observation, see an ineligible or zero-node invocation, a multi-node invocation if safely available, a four-second settlement phase, one encounter commit and an immediate transaction between fires. Confirm retries do not double-settle or double-commit and all labels remain distinct.

Backward compatibility requires nullable new fields and unchanged existing RPC result classifications during rollout. The dispatcher and worker must continue to function if a diagnostic sink is unavailable.

## Approved operational decisions

Every actual scheduler-wrapper invocation receives an id, including an invocation that proves maintenance or a sleeping world ineligible. No invocation means no row. Run rows are retained for 24 hours with indexed, bounded cleanup. These are observability decisions only: cadence, encounter order, settlement formulas, movement immediacy and client authority remain unchanged.
