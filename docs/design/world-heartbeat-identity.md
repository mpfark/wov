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

## Pending deliberate encounter cadence (`ENG-HB-003`)

Mik considers the observed pace comfortable and accepts a deliberate four-second encounter cadence as the recommended candidate if it is stable and explicit. This section is a proposal awaiting approval, not implemented or installed behavior.

### Timing dependency audit

| Concern | Current source contract | Effect of merely making commits every four seconds | Proposed treatment |
|---|---|---|---|
| Ordinary attacks and queued intents | one player action slot and creature action per successful candidate tick; claim captures the intent cutoff | actions resolve every four seconds | keep one action slot per encounter tick |
| First resolution | entry/reactivation writes `next_due_at = now()` | normally selected by the next scheduler fire | retain next-actual-heartbeat first resolution, then establish the encounter's phase |
| Passive CP regeneration | every even candidate tick; comment defines this as one four-second opportunity | becomes every eight seconds | change to every encounter tick if four seconds is approved |
| Inspire and other regeneration effects | pulse timing is stored as tick offsets; authored 2,000 ms intervals map to one tick | one-tick pulses become four-second pulses | define four seconds as the minimum pulse quantum; rederive tick counts from authored milliseconds |
| DoT and off-screen effects | tick-fenced, at most one pulse per tick; missed pulses are skipped, never stacked; a departed source can still qualify its DoT | real-time duration and pulse spacing double if counts are unchanged | preserve skip-not-stack; convert authored durations/intervals to the new four-second quantum and explicitly accept that sub-four-second intervals quantize upward |
| Effect and stance duration | `activated_at_tick`, `expires_after_tick`, `interval_ticks` and `next_pulse_tick` are encounter-local | unchanged counts last twice as long | preserve tick authority but recalculate new activations from a four-second quantum; decide separately whether existing live effects require compatibility handling |
| Boss windups, telegraphs and cooldowns | milliseconds become ticks with `ceil(ms / 2000)`; resolution/cooldown compare encounter ticks | all real durations double if untouched | use `ceil(ms / 4000)` for new snapshots; telegraph starts on one tick and resolves no earlier than the next eligible phased tick |
| Intent cutoff and queued UI | claim freezes the maximum pending sequence; browser acknowledgement means queued, not resolved | longer bounded wait, no authority change | keep cutoff and request-id fences; UI may state “queued for the next combat beat” but must not predict success |
| Claims, leases, retries and catch-up | default lease is 5 seconds; retry reclaims the same candidate tick; no combat catch-up burst | a 5-second lease overlaps the next nominal 4-second phase | lease must be reviewed/raised above worst-case processing; retry keeps the candidate tick but gets the retry heartbeat id; at most one commit per encounter per heartbeat and missed phases are skipped |
| Completion and reactivation | completion is a committed tick; reactivation clears claim/cutoff and sets due now | cadence remains implicit | completion stays tick-owned; reactivation resolves on the next actual heartbeat and establishes a fresh phase |
| Test Arena | uses the same resolver, claim/commit and scheduler paths with explicit lifecycle controls | inherits any production cadence | no arena-only cadence; focused tests and controlled observation must prove the shared contract |
| Diagnostics and display | heartbeat id, encounter tick, settlement bucket, request id and delivery cursor are distinct | accidental “tick = heartbeat” wording becomes more tempting | display both ids only as diagnostics; show configured encounter period/phase separately; never derive readiness from heartbeat id |

The current two-second assumptions are source facts in `src/shared/combat2/time.ts`, `resolver.ts`, boss catalogue conversion and their Edge mirrors. A cadence change is therefore a gameplay-timing change, not a scheduler-only optimization.

### Recommended phase contract

Use an explicit server-owned heartbeat phase, not transaction timestamps:

1. Entry or reactivation remains immediate and marks the encounter ready for its first resolution on the next actual eligible heartbeat. That successful claim records the encounter's phase anchor.
2. After a successful commit, the next ordinary candidate is the first actual heartbeat whose id is at least `committed_heartbeat_id + 2`. Different encounters may anchor on different odd/even phases; they need not synchronize their attacks with one another.
3. A failed claim or commit does not advance the encounter tick or phase. A retry receives a new heartbeat id, reuses the same candidate tick under existing fences and may commit at the next eligible fire.
4. A missed scheduler fire creates no heartbeat id and no combat debt. A delayed dispatcher may commit once; it schedules from the heartbeat that actually committed, not from the old wall-clock deadline. Never burst multiple encounter ticks to catch up.
5. Immediate movement, entry and hostile initiation remain immediate transactions between heartbeats. They may observe a heartbeat id but do not own or reserve it.
6. Four-second settlement keeps its independent bucket cursor. It can correlate to the same heartbeat without becoming an encounter tick.

This requires persistent encounter phase metadata (for example a nullable `next_due_heartbeat_id` plus the last committed heartbeat correlation) and guarded due-node/claim/commit changes. A schema change is therefore expected. Deriving phase from `heartbeat_id % 2` alone is insufficient because first resolution must be the next heartbeat and different encounters may begin on either phase.

### Alternatives and decisions

Continuing wall-clock due-time progression from the prior deadline (`next_due_at + 4 seconds`) removes commit-latency drift but still depends on timestamp comparison, can become immediately overdue after delays and needs a separate catch-up rule. Progression from commit time deliberately skips debt but remains phase-shifted by transport latency. The explicit heartbeat phase above makes cadence observable and deterministic while retaining one-commit fences, and is recommended.

Approval is still required for the gameplay consequences: four seconds as the encounter-tick duration; CP regeneration on every tick; upward quantization of sub-four-second periodic effects; conversion/rebaseline of boss windups, cooldowns and effect durations; handling of effects already live during rollout; and the revised lease budget. Until those decisions are approved, the current two-second authored tick contract and observed accidental ~four-second pace remain unchanged.

### Smallest safe implementation sequence

1. Approve the timing decisions above and inventory authored milliseconds/tick expectations with golden compatibility cases.
2. Add one guarded forward migration for encounter heartbeat-phase metadata and due/claim/commit composition; do not alter the scheduler's two-second cadence.
3. Change the canonical time conversion, CP phase and boss/effect adapters; regenerate Edge mirrors through the checked-in generator.
4. Add deterministic model tests for both anchor parities, simultaneous encounters, first resolution, retry, delayed/missed fires, no burst catch-up, completion/reactivation and settlement independence.
5. Install while asleep/maintenance, deploy only proven transitive Edge consumers, then perform one bounded diagnostic observation before opening normal gameplay.
