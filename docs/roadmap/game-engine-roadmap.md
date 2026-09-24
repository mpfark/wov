# Wayfarers of Varneth — Engine Roadmap

This is the canonical backlog for engine authority, correctness and stabilization. Rules live in the [engine specification](../design/game-engine.md); installation and verification evidence lives in [project state](../operations/project-state.md). Status vocabulary: `decision_needed`, `planned`, `ready`, `in_progress`, `implemented_source`, `installed`, `live_verification_pending`, `live_verified`, `blocked`, `deferred`.

## Now — engine stabilization

### ENG-MOVE-001 — Immediate serialized Combat2 departure

- **Engine area / status / priority:** movement/concurrency; `blocked`; 1.
- **Problem or decision:** approved semantics require combat departure/flee to resolve immediately, but current public SQL only queues an event; exit damage/effects live in the TypeScript resolver and relocation/MP/cleanup live in `node_tick_commit`.
- **Intended outcome:** one synchronous authoritative transition serialized with encounter processing: departure-first excludes the fighter from the next tick; tick-first commits then departure completes; opportunity, death/survival, MP, relocation and cleanup occur exactly once.
- **Dependencies:** choose one server-side orchestration boundary and prove a global lock order without SQL combat duplication, Edge callbacks inside SQL, browser authority or a second movement engine.
- **Evidence/current state:** [static audit](../design/combat2-movement-departure-audit.md) proves OOC movement is immediate and combat/party/flee paths wait for a worker tick. Installed/live parity is unverified.
- **Acceptance criteria:** executable departure-first/tick-first concurrency tests; replay/conflict/death/MP/destination/solo-party/encounter-end races; follower-first/leader-last; remaining participants continue; no duplicate event, charge, relocation, release, cleanup or completion; no catch-up burst; installed and bounded live verification.
- **Specification sections:** One authoritative world heartbeat; Movement and party movement; Combat resolution.

### ENG-COMBAT-001 — Targeting and combat-initiation audit

- **Engine area / status / priority:** targeting; `ready`; 1.
- **Problem or decision:** selected, queued, engaged and dead targets and first-action timing are not yet proven as one coherent contract; intermittent delay remains operator-reported.
- **Intended outcome:** one documented, stale-fenced initiation flow with expected heartbeat latency and multiplayer first-hit order.
- **Dependencies:** bounded diagnostics and preserved live evidence.
- **Evidence/current state:** aggressive and peaceful completion are operator-reported live; exact initiation timing remains unmeasured.
- **Acceptance criteria:** trace UI → RPC → entry/intent → heartbeat → presentation; answer every open question in the targeting section; focused source/installed/live evidence; no legacy fallback.
- **Specification sections:** Creatures, targeting and initiation; One authoritative world heartbeat.

### ENG-HB-001 — Explicit global heartbeat identity

- **Engine area / status / priority:** scheduling; `planned`; 2.
- **Problem or decision:** current two-second scheduler is semantically shared, but encounter ticks and settlement buckets lack a common observable heartbeat identity.
- **Intended outcome:** deterministic global heartbeat number/time boundary carried to phased systems without changing local encounter tick semantics.
- **Dependencies:** ENG-COMBAT-001 evidence; schema compatibility design.
- **Evidence/current state:** scheduler fire, four-second cursor and due encounters exist; no competing authoritative browser timer was found.
- **Acceptance criteria:** one identity survives retries; settlement runs on a defined phase; commits advance only local ticks; maintenance/sleep do not bank unbounded work; installed and diagnostic proof.
- **Specification sections:** One authoritative world heartbeat; Failure, diagnostics and verification.

### ENG-DIAG-001 — Limited latency and jitter measurement

- **Engine area / status / priority:** diagnostics; `ready`; 3.
- **Problem or decision:** small intermittent delay is operator-reported but not separated into scheduler, claim, commit, delivery and render latency.
- **Intended outcome:** bounded, sanitized measurements with no gameplay mutation beyond a controlled run.
- **Dependencies:** existing bounded diagnostics.
- **Evidence/current state:** prior automatic ticks and short sync transitions were operator-reported; current delay is not measured.
- **Acceptance criteria:** report distributions and outliers for each boundary; no credentials/fixture details; distinguish expected ≤heartbeat wait from defects.
- **Specification sections:** Failure, diagnostics and verification; Creatures, targeting and initiation.

### ENG-DIAG-002 — Distinguish world heartbeat and encounter tick

- **Engine area / status / priority:** diagnostics/presentation; `planned`; 4.
- **Problem or decision:** local tick labels can be mistaken for global scheduler time.
- **Intended outcome:** diagnostics and admin presentation label both concepts unambiguously.
- **Dependencies:** ENG-HB-001.
- **Evidence/current state:** encounter tick is committed locally; settlement has a separate cursor.
- **Acceptance criteria:** types, logs and UI cannot conflate the identifiers; reconnect preserves both; documentation examples match.
- **Specification sections:** One authoritative world heartbeat; Failure, diagnostics and verification.

### ENG-LEGACY-001 — Remaining gameplay-writer audit

- **Engine area / status / priority:** authority boundaries; `planned`; 5.
- **Problem or decision:** legacy hooks and temporary rollout surfaces may still contain dormant mutation paths.
- **Intended outcome:** inventory of every HP/CP/MP/position/effect/reward writer, with active paths fenced to authoritative contracts.
- **Dependencies:** none.
- **Evidence/current state:** known browser regeneration writers were removed; no broad final audit is recorded.
- **Acceptance criteria:** static guard plus manual trace; every writer classified active/dormant/obsolete; removals separately approved.
- **Specification sections:** Engine principles and authority; Character ownership and lifecycle.

### ENG-VERIFY-001 — Complete installed-schema execution coverage

- **Engine area / status / priority:** verification; `planned`; 6.
- **Problem or decision:** static SQL tests do not prove installed functions, grants and deferred constraints execute together.
- **Intended outcome:** reproducible executable-schema and bounded installed verification for critical chains.
- **Dependencies:** safe non-production fixture policy.
- **Evidence/current state:** coverage varies by migration; project state records direct checks separately.
- **Acceptance criteria:** entry, tick, commit, release, settlement, movement and reward boundaries each have an executable level and named installed check.
- **Specification sections:** Failure, diagnostics and verification.

## Next — complete core ownership

### ENG-STANCE-001 — Character-scoped stance authority
- **Engine area / status / priority:** effects; `decision_needed`; 7.
- **Problem or decision:** stances and reservations are encounter-scoped, but desired persistence crosses encounters/movement.
- **Intended outcome:** one authoritative character lifecycle for stance effect plus reservation.
- **Dependencies:** ownership model and migration design.
- **Evidence/current state:** Holy Shield grouping and repeated-activation refusal work in encounters.
- **Acceptance criteria:** atomic activate/drop, no double reservation, movement/reconnect/death rules, migration and live proof.
- **Specification sections:** Effects and stances; Character ownership and lifecycle.

### ENG-STANCE-002 — Appropriate stance activation outside combat
- **Engine area / status / priority:** effects/UI; `planned`; 8.
- **Problem or decision:** eligible persistent stances cannot be safely prepared out of combat.
- **Intended outcome:** explicit per-stance eligibility using ENG-STANCE-001 authority.
- **Dependencies:** ENG-STANCE-001.
- **Evidence/current state:** not implemented.
- **Acceptance criteria:** fail-closed RPC, visible authoritative state, no browser reservation writes, combat entry preserves it.
- **Specification sections:** Effects and stances.

### ENG-FOOD-001 — Authoritative food effects
- **Engine area / status / priority:** resources/effects; `planned`; 9.
- **Problem or decision:** browser-local food lacks persistent amount and expiry and is excluded from settlement/Combat2.
- **Intended outcome:** durable server-owned food effect consumed consistently by both owners.
- **Dependencies:** effect ownership schema.
- **Evidence/current state:** deliberately excluded in current source.
- **Acceptance criteria:** amount/expiry persisted, no client writes, no double application, reconnect/expiry tests and installed proof.
- **Specification sections:** Resources and attributes; Effects and stances.

### ENG-PARTY-001 — Coordinated party movement release verification
- **Engine area / status / priority:** movement/party; `live_verification_pending`; 10.
- **Problem or decision:** source encodes follower-first/leader-last movement, but ordinary installed/live release evidence is incomplete.
- **Intended outcome:** prove per-member outcomes, lifecycle release and reconnect without changing semantics.
- **Dependencies:** safe bounded party scenario.
- **Evidence/current state:** source/migration contracts and focused tests exist; do not infer installation from Git.
- **Acceptance criteria:** installed definitions/grants verified; followers/leader ordering and dead/off-node/non-following outcomes observed; zero residue.
- **Specification sections:** Movement and party movement.

### ENG-REWARD-001 — Complete ADM-025B reward channels
- **Engine area / status / priority:** rewards; `blocked`; 11.
- **Problem or decision:** pending migration preflight conflicts with existing authored data; it is not installed.
- **Intended outcome:** exclusive item source, independent gold/salvage and exactly-once materialization without data loss.
- **Dependencies:** ENG-REWARD-002 decisions and explicit installation preflight.
- **Evidence/current state:** pending source exists; project state records the installation boundary.
- **Acceptance criteria:** compatible migration, resolver/commit/ground/pickup tests, unique identity proof, installed and bounded live verification.
- **Specification sections:** Rewards and unique items.

### ENG-REWARD-002 — Unique-item authoring decisions
- **Engine area / status / priority:** rewards/content contract; `decision_needed`; 12.
- **Problem or decision:** King Aldric needs key plus weapon/multiple unique candidates; Rusty Key is gate access and must not silently become global-unique.
- **Intended outcome:** explicit ordered multi-unique schema and authoring validation with no source fallback.
- **Dependencies:** product decision by Mik.
- **Evidence/current state:** unresolved; no installation authorized.
- **Acceptance criteria:** decisions recorded in specification, admin validation and runtime contract; existing items preserved; migration preflight reports conflicts.
- **Specification sections:** Rewards and unique items.

### ENG-LIFECYCLE-001 — Inactive-character return-home
- **Engine area / status / priority:** lifecycle/movement; `decision_needed`; 13.
- **Problem or decision:** inactive characters should return to a verified default city/start node, not an assumed literal coordinate.
- **Intended outcome:** idempotent authoritative transition after the same configured inactivity duration used by unique-item policy, with future bind-point extension.
- **Dependencies:** authoritative activity evidence; verified destination; party/transaction rules.
- **Evidence/current state:** backlog request only.
- **Acceptance criteria:** no reset during claims, encounters, departures or transactions; party safe; no browser-presence inference; replay safe; installed/live proof.
- **Specification sections:** Character ownership and lifecycle; Movement and party movement.

## Later — refinement

### ENG-HB-002 — Heartbeat performance and scaling
- **Engine area / status / priority:** scheduling; `deferred`; 14.
- **Problem or decision:** future load must not turn one heartbeat into an all-world scan.
- **Intended outcome:** measured bounded due-work scaling while retaining one authority.
- **Dependencies:** ENG-HB-001 and production metrics.
- **Evidence/current state:** dispatcher is bounded to due nodes.
- **Acceptance criteria:** load targets, backpressure policy, fairness and catch-up bounds proven without competing timers.
- **Specification sections:** One authoritative world heartbeat.

### ENG-DELIVERY-001 — Reduce fallback polling
- **Engine area / status / priority:** delivery; `deferred`; 15.
- **Problem or decision:** fallback polling adds load/latency but protects against unproven Realtime gaps.
- **Intended outcome:** reduce it only after reliability evidence.
- **Dependencies:** measured Realtime recovery and gap visibility.
- **Evidence/current state:** delivery works without tab switching by operator report; intermittent delay remains.
- **Acceptance criteria:** gap/reconnect SLO, no stale overwrite, safe fallback retained.
- **Specification sections:** Failure, diagnostics and verification.

### ENG-UX-001 — Combat feedback refinement
- **Engine area / status / priority:** presentation; `deferred`; 16.
- **Problem or decision:** queued/live/sync/historical feedback can be clearer without inventing authority.
- **Intended outcome:** concise state and timing feedback grounded in projections.
- **Dependencies:** ENG-COMBAT-001, ENG-DIAG-002.
- **Evidence/current state:** core logs/resources are delivered.
- **Acceptance criteria:** accessible states, no flicker/duplicate lines, authoritative wording and focused UI tests.
- **Specification sections:** Creatures, targeting and initiation; Failure, diagnostics and verification.

### ENG-BALANCE-001 — Broader ability and balance audit
- **Engine area / status / priority:** combat/content; `deferred`; 17.
- **Problem or decision:** formula correctness precedes balance changes.
- **Intended outcome:** evidence-based review without mixing engine repairs and tuning.
- **Dependencies:** stabilized heartbeat/targeting/rewards.
- **Evidence/current state:** deterministic catalogues exist; no broad audit authorized.
- **Acceptance criteria:** each proposed change names formula, content and regression fixtures; specification updated for rule changes.
- **Specification sections:** Combat resolution; Effects and stances.

### ENG-ADMIN-001 — Admin Roadmap presentation integration
- **Engine area / status / priority:** admin governance; `planned`; 18.
- **Problem or decision:** Admin Roadmap is Cloud `roadmap_items` CRUD and would duplicate this backlog.
- **Intended outcome:** read-only build/import presentation keyed by stable ENG IDs while preserving product/content items.
- **Dependencies:** source/Cloud schema and publication design.
- **Evidence/current state:** `RoadmapManager.tsx` directly reads/mutates Cloud rows; no integration made.
- **Acceptance criteria:** this file remains canonical; no manual dual entry; filters preserve existing items; operational/security detail remains admin-only.
- **Specification sections:** Information layers.

### ENG-MANUAL-001 — Admin Game Manual integration
- **Engine area / status / priority:** admin documentation; `planned`; 19.
- **Problem or decision:** hard-coded React prose can drift from engine rules.
- **Intended outcome:** present selected repository-backed specification sections with revision/date; keep authoring guidance distinct.
- **Dependencies:** safe build-time content pipeline and admin access review.
- **Evidence/current state:** `GameManual.tsx` is independently maintained.
- **Acceptance criteria:** no second editable rules source; status comes from roadmap/project state; sensitive operational detail remains admin-only.
- **Specification sections:** Information layers.

### ENG-LEGACY-002 — Remove obsolete legacy runtime surfaces
- **Engine area / status / priority:** authority cleanup; `deferred`; 20.
- **Problem or decision:** obsolete surfaces increase ambiguity after authoritative coverage is proven.
- **Intended outcome:** remove only paths proven unreferenced and superseded.
- **Dependencies:** ENG-LEGACY-001 and installed/live parity.
- **Evidence/current state:** removal scope not yet proven.
- **Acceptance criteria:** reference audit, rollback plan, focused/full boundary tests and no loss of content/admin functionality.
- **Specification sections:** Engine principles and authority.
