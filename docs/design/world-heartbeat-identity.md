# World heartbeat identity

This note specifies the approved correlation contract for `ENG-HB-001`. It does not claim that the contract is installed. The current scheduler, encounter ticks, settlement cursor, request identifiers and delivery cursors remain independent authorities until a later migration implements and verifies the design.

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

Maintenance, world sleep and scheduler absence do not create gameplay work. The settlement cursor advances while settlement is ineligible so downtime is not banked. A missed cron invocation currently has no durable row. An expired encounter lease may be reclaimed, but a failed or refused commit does not advance the encounter tick.

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

## Persistence and schema consequence

A schema change is required for a durable identity shared across the SQL scheduler wrapper, Edge dispatcher, worker diagnostics and settlement. In-memory Edge UUIDs cannot correlate a fire that selected no nodes, and the current `pg_net` request id describes transport rather than world time.

The recommended implementation is a small `world_heartbeat_run` table with a generated `bigint` primary key and bounded scalar columns, plus nullable `heartbeat_id` correlation fields on the diagnostic/event surfaces that need them. A singleton-only counter would allocate ids but would not preserve zero-node fires or bounded outcomes; overloading `pg_net.request_id` would couple gameplay diagnostics to transport cleanup and is rejected.

Retention should be operationally bounded: keep a small recent window or fixed age, remove old run rows through an existing maintenance boundary, and retain only the heartbeat id on longer-lived committed encounter evidence if needed. Foreign keys from durable gameplay rows must not prevent retention; correlation ids may be intentionally non-referencing.

## Rollout and verification

1. Add the allocator/run record and optional diagnostic correlation without changing cadence or eligibility.
2. Thread the id through scheduler result, dispatcher request body, candidate diagnostics, claim/commit diagnostics and settlement result. Keep all new fields optional while old callers and stored events remain readable.
3. Label `heartbeat_id`, `encounter_tick`, `settlement_bucket`, `request_id` and `delivery_cursor` separately in diagnostics and admin presentation.
4. Verify installed definitions, ownership, grants, search paths, retention and absence from client-writable/Realtime surfaces.
5. In one bounded live diagnostic, observe a zero-node fire, a multi-node fire if safely available, a four-second settlement phase, one encounter commit and an immediate transaction between fires. Confirm retries do not double-settle or double-commit.

Backward compatibility requires nullable new fields and unchanged existing RPC result classifications during rollout. The dispatcher and worker must continue to function if a diagnostic sink is unavailable.

## Decisions requiring Mik

Two operational choices remain before implementation:

1. Whether ineligible scheduler calls (maintenance or sleeping world) should allocate a heartbeat id. Recommendation: yes, record them as `ineligible` attempts for observability, while making clear that no gameplay heartbeat occurred.
2. The retention bound for heartbeat-run rows. Recommendation: 24 hours, matching bounded diagnostic retention, unless operations needs a longer capacity-planning window.

No gameplay decision is required. Cadence, encounter order, settlement formulas, movement immediacy and client authority remain unchanged.
