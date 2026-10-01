# Wayfarers of Varneth — Engine Roadmap

This is the canonical backlog for engine authority, correctness and stabilization. Rules live in the [engine specification](../design/game-engine.md); installation and verification evidence lives in [project state](../operations/project-state.md). Status vocabulary: `decision_needed`, `planned`, `ready`, `in_progress`, `implemented_source`, `installed`, `live_verification_pending`, `live_verified`, `blocked`, `deferred`.

## Now — engine stabilization

### ENG-COMBAT-003 — Present-fighter equipment fencing

- **Engine area / status / priority:** combat snapshot/commit; `implemented_source`; 1.
- **Problem or decision:** installed claims include current equipment for absent historical fighters while commit requires every fenced owner to be present, causing permanent `stale_equipment` refusals after equipped fighters depart.
- **Intended outcome:** project and derive equipment only for fighters present at the frozen claim boundary; retain the complete fence for any such fighter who later dies or departs in the same resolution; preserve historical participation, frozen offscreen effects and qualified rewards.
- **Dependencies:** install `20261001100000_combat2_present_equipment_fencing.sql`, regenerate official types only if the installed tool reports a type-surface change, deploy every proven Edge consumer of the regenerated resolver mirror, then perform bounded live recovery checks.
- **Evidence/current state:** Lovable's read-only investigation reports node `f974068d-c8e6-4224-a3c9-d7b066ae1b8d` / encounter `ca32f2fb-7d4c-4504-b889-ef5cd0e3d8c8` stuck at tick 48 plus the same symptom at node prefixes `f45a8b21` and `f7c5881a`. Source correction and focused tests are authored; no Cloud action or manual repair occurred.
- **Acceptance criteria:** rollback-only full migration compilation; installed claim projection/owner/security/search-path/ACL and wrapper-chain inspection; changed/forged/omitted present equipment still refuses; absent equipment no longer fences; normal processing recovers all three reported nodes without manual row repair; exactly-once tick/durability/resource/reward evidence; Test Arena parity.
- **Specification sections:** Combat resolution; Movement and party movement; Failure, diagnostics and verification.

### ENG-MOVE-001 — Immediate serialized Combat2 departure

- **Engine area / status / priority:** movement/concurrency; `live_verification_pending`; 1.
- **Problem or decision:** approved semantics require ordinary combat departure to resolve immediately without an exit attack or any combat tick.
- **Intended outcome:** one synchronous authoritative transition serialized with encounter processing: departure-first excludes the fighter from the next tick; tick-first commits then a surviving fighter departs; MP, relocation and non-damage cleanup occur exactly once.
- **Dependencies:** bounded solo/party race and live verification.
- **Evidence/current state:** repository migration SHA-256 `11b2778…77fdb` is recorded installed once as ledger version `20260929093442`; the exact Git artifact is retained separately. Installed-definition/grant/lock-order inspection passed. Mik reports the first frontend reconciliation published and confirms minimap movement is immediate and error-free. Source tracing found the remaining keyboard-only lag in an obsolete 500 ms browser cooldown, introduced historically only to prevent spam; it did not delay the first RPC but discarded a prompt next key press after an already completed move. The latest frontend correction removes that timer, rejects native held-key repeats and retains the shared authoritative single-flight lifecycle. It awaits Mik's manual publication. Keyboard, coordinated party movement, multiplayer races and the latest presentation corrections remain live-unverified. Server movement remains request-transaction work; destination-less `combat_flee` fails closed.
- **Acceptance criteria:** executable departure-first/tick-first concurrency tests; replay/conflict/death/MP/destination/solo-party/encounter-end races; follower-first/leader-last; remaining participants continue; no duplicate event, charge, relocation, release, cleanup or completion; no catch-up burst; installed and bounded live verification.
- **Specification sections:** One authoritative world heartbeat; Movement and party movement; Combat resolution.

### ENG-COMBAT-001 — Targeting and combat-initiation audit

- **Engine area / status / priority:** targeting; `implemented_source`; 1.
- **Problem or decision:** selected, queued, engaged and dead targets and first-action timing are not yet proven as one coherent contract; intermittent delay remains operator-reported.
- **Intended outcome:** one documented, stale-fenced initiation flow with expected heartbeat latency and multiplayer first-hit order.
- **Dependencies:** bounded diagnostics and preserved live evidence.
- **Evidence/current state:** repository audit and matrix are recorded in `docs/design/combat2-targeting-initiation-audit.md`; Basic Attack engagement, target freezing/retargeting, action-slot ownership and resolver CP validation were source-proven. Spendable-CP client and public-RPC preflight corrections are authored but not installed/published. Exact live initiation timing remains unmeasured.
- **Acceptance criteria:** trace UI → RPC → entry/intent → heartbeat → presentation; answer every open question in the targeting section; focused source/installed/live evidence; no legacy fallback.
- **Specification sections:** Creatures, targeting and initiation; One authoritative world heartbeat.

### ENG-COMBAT-002 — Authoritative arrival and generic hostile first action

- **Engine area / status / priority:** entry/targeting/concurrency; `live_verification_pending`; 2.
- **Problem or decision:** the source and installed contract now cover authoritative arrival, generic hostile first action and newest-entry tank priority; bounded live behavior remains unverified.
- **Intended outcome:** solo and coordinated movement invoke one idempotent authoritative entry check in follower-first/leader-last order; reconnect attaches without duplication; one generic server-authored hostile-action boundary atomically enters and queues a validated hostile ability or Basic Attack; tank fallback becomes newest valid entry globally.
- **Dependencies:** bounded live arrival, hostile-initiation and multiplayer tank-order verification; preserve `ENG-MOVE-001` serialization.
- **Evidence/current state:** forward migration `20260928100000_combat2_authoritative_arrival_hostile_initiation.sql` authors movement-completion entry, generic server-classified hostile initiation, newest-entry-only tank order and one documented lock order. Project state records direct installation evidence, and Mik reports the dependent frontend manually published. Arrival, hostile initiation and multiplayer tank order remain live-unverified.
- **Acceptance criteria:** executable solo/party/reconnect concurrency tests, action-payload replay conflict tests, invalid-first-action rollback, follower-first/leader-last entry generations, unrelated newcomer tank, no duplicate encounter/fighter/intent/reward qualification, installed and bounded live proof.
- **Specification sections:** Creatures, targeting and initiation; Movement and party movement; Combat resolution.

### ENG-HB-001 — Explicit global heartbeat identity

- **Engine area / status / priority:** scheduling; `live_verification_pending`; 2.
- **Problem or decision:** current two-second scheduler is semantically shared, but encounter ticks and settlement buckets lack a common observable heartbeat identity.
- **Intended outcome:** a durable monotonic scheduler-invocation identity carried as correlation metadata to settlement, selected nodes, claims, commits and bounded diagnostics without changing local encounter tick semantics or delaying immediate transactions.
- **Dependencies:** bounded observation of the remaining ineligible, retry, failure and catch-up branches; no further source implementation dependency.
- **Evidence/current state:** [the approved design note](../design/world-heartbeat-identity.md) maps the distinct identities. Project state records migration `20260929130000_combat2_world_heartbeat_identity.sql` installed exactly once, official types regenerated, only `combat2-dispatch-once` deployed and Mik's frontend publication as operator-reported. Lovable's bounded read-only window correlated heartbeats 94–106 with settlement, dispatch and encounter ticks 526–531; it did not exercise every acceptance branch. Encounter ticks, settlement buckets, request UUIDs and delivery cursors remain independent.
- **Acceptance criteria:** strictly increasing durable ids with documented gaps; one fire can correlate zero/many nodes and zero/many settlement steps; retries get new ids while existing domain fences prevent duplicate effects; commits advance only local ticks; immediate transactions remain immediate; maintenance/sleep do not bank work; fields and retention are bounded; installed and diagnostic proof.
- **Specification sections:** One authoritative world heartbeat; Failure, diagnostics and verification.

### ENG-HB-003 — Two-second encounter schedule phase correction

- **Engine area / status / priority:** combat timing; `live_verification_pending`; 3.
- **Problem or decision:** commit-time `next_due_at` progression drifts behind the two-second scheduler and currently makes an encounter resolve on roughly every second fire by accident.
- **Intended outcome:** preserve one encounter tick per eligible two-second heartbeat by advancing from the previous authoritative server deadline, while skipping obsolete opportunities after delays and never replaying combat debt.
- **Dependencies:** bounded live verification; no gameplay decision or further source dependency remains.
- **Evidence/current state:** Lovable's earlier read-only 10:13:03–10:13:59 UTC window found healthy ~2.016-second heartbeats but ticks 526–531 only on alternating fires. Source proved `greatest(now(), next_due_at) + 2 seconds` plus dispatch latency as the cause. Lovable reports migration `20260930130000_combat2_encounter_schedule_drift.sql` installed exactly once from source `c5c2e0de…`; rollback compilation and installed definition/owner/ACL/wrapper inspection passed, protected gameplay fingerprints were unchanged, and no types were regenerated. Live consecutive-fire behavior remains unverified. Heartbeat id remains correlation-only, and all CP/effect/boss timing is unchanged.
- **Acceptance criteria:** 2.016-second fire/0.4–0.5-second latency reproduction; consecutive eligible commits after correction; varied latency without drift; delayed/missed fires skip debt; failed/retried/duplicate claims commit once; even-tick CP unchanged; entry/reactivation, completion, immediate departure and Test Arena parity; rollback compile, installed contract inspection and bounded live proof.
- **Specification sections:** One authoritative world heartbeat; Resources and attributes; Effects and stances; Combat resolution.

### ENG-DIAG-001 — Limited latency and jitter measurement

- **Engine area / status / priority:** diagnostics; `ready`; 4.
- **Problem or decision:** small intermittent delay is operator-reported but not separated into scheduler, claim, commit, delivery and render latency.
- **Intended outcome:** bounded, sanitized measurements with no gameplay mutation beyond a controlled run.
- **Dependencies:** existing bounded diagnostics.
- **Evidence/current state:** prior automatic ticks and short sync transitions were operator-reported; current delay is not measured.
- **Acceptance criteria:** report distributions and outliers for each boundary; no credentials/fixture details; distinguish expected ≤heartbeat wait from defects.
- **Specification sections:** Failure, diagnostics and verification; Creatures, targeting and initiation.

### ENG-DIAG-002 — Distinguish world heartbeat and encounter tick

- **Engine area / status / priority:** diagnostics/presentation; `planned`; 5.
- **Problem or decision:** local tick labels can be mistaken for global scheduler time.
- **Intended outcome:** diagnostics and admin presentation label both concepts unambiguously.
- **Dependencies:** ENG-HB-001.
- **Evidence/current state:** encounter tick is committed locally; settlement has a separate cursor.
- **Acceptance criteria:** types, logs and UI cannot conflate the identifiers; reconnect preserves both; documentation examples match.
- **Specification sections:** One authoritative world heartbeat; Failure, diagnostics and verification.

### ENG-LEGACY-001 — Remaining gameplay-writer audit

- **Engine area / status / priority:** authority boundaries; `planned`; 6.
- **Problem or decision:** legacy hooks and temporary rollout surfaces may still contain dormant mutation paths.
- **Intended outcome:** inventory of every HP/CP/MP/position/effect/reward writer, with active paths fenced to authoritative contracts.
- **Dependencies:** none.
- **Evidence/current state:** known browser regeneration writers were removed; no broad final audit is recorded.
- **Acceptance criteria:** static guard plus manual trace; every writer classified active/dormant/obsolete; removals separately approved.
- **Specification sections:** Engine principles and authority; Character ownership and lifecycle.

### ENG-VERIFY-001 — Complete installed-schema execution coverage

- **Engine area / status / priority:** verification; `planned`; 7.
- **Problem or decision:** static SQL tests do not prove installed functions, grants and deferred constraints execute together.
- **Intended outcome:** reproducible executable-schema and bounded installed verification for critical chains.
- **Dependencies:** safe non-production fixture policy.
- **Evidence/current state:** coverage varies by migration; project state records direct checks separately.
- **Acceptance criteria:** entry, tick, commit, release, settlement, movement and reward boundaries each have an executable level and named installed check.
- **Specification sections:** Failure, diagnostics and verification.

## Next — complete core ownership

### ENG-STANCE-001 — Character-scoped stance authority
- **Engine area / status / priority:** effects; `implemented_source`; 8.
- **Problem or decision:** stances and reservations are encounter-scoped, but desired persistence crosses encounters/movement.
- **Intended outcome:** one authoritative character lifecycle for stance effect plus reservation.
- **Dependencies:** migration installation, official type regeneration, affected Edge deployment, Mik's manual publication and bounded live verification.
- **Evidence/current state:** source migration `20261001130000_combat2_character_persistent_stances.sql`, claim/resolver/commit integration and frontend projection/RPC routing implement the approved eight-stance character authority. Installation and live behavior are not claimed.
- **Installation policy:** Mik approved one-time reset of exactly identified old stance mechanics/reservations/ward state, with empty new authority and no raw-resource refund. Unknown state fails closed; aggregate bounded cleanup and protected-state checks share the installation transaction. Full PostgreSQL compilation and injected-failure rollback proof remain installation gates; runtime rules/deployment requirements are unchanged.
- **Acceptance criteria:** atomic activate/drop, no double reservation, movement/reconnect/death rules, migration and live proof.
- **Specification sections:** Effects and stances; Character ownership and lifecycle.

### ENG-STANCE-002 — Appropriate stance activation outside combat
- **Engine area / status / priority:** effects/UI; `implemented_source`; 9.
- **Problem or decision:** eligible persistent stances cannot be safely prepared out of combat.
- **Intended outcome:** explicit per-stance eligibility using ENG-STANCE-001 authority.
- **Dependencies:** ENG-STANCE-001 and its approved lifecycle decisions; ability matrix in [combat2-ability-availability-and-persistent-stances.md](../design/combat2-ability-availability-and-persistent-stances.md).
- **Evidence/current state:** source routes the eight stances through the authenticated character projection/change RPC outside combat; installation, publication and live verification remain pending.
- **Acceptance criteria:** fail-closed RPC, visible authoritative state, no browser reservation writes, combat entry preserves it.
- **Specification sections:** Effects and stances.

### ENG-XP-001 — Max-level XP award verification and correction
- **Engine area / status / priority:** progression/rewards; `planned`; 10.
- **Problem or decision:** Mik reports that a maximum-level Warrior appeared to receive XP from a kill. It is unknown whether this was only a combat-log/presentation message or persisted XP growth.
- **Intended outcome:** characters at the configured maximum level receive no additional persisted XP, and presentation accurately reflects the authoritative result.
- **Dependencies:** separately authorized read-only evidence distinguishing emitted log data from the persisted character row; no reward change is part of the stance design.
- **Evidence/current state:** operator report only; cause and affected boundary are uninvestigated.
- **Acceptance criteria:** source path traced, persisted-versus-presented result proven, focused cap/replay/reward tests, guarded correction if required and bounded installed/live verification.
- **Specification sections:** Progression and rewards; Failure, diagnostics and verification.

### ENG-FOOD-001 — Authoritative food effects
- **Engine area / status / priority:** resources/effects; `planned`; 10.
- **Problem or decision:** browser-local food lacks persistent amount and expiry and is excluded from settlement/Combat2.
- **Intended outcome:** durable server-owned food effect consumed consistently by both owners.
- **Dependencies:** effect ownership schema.
- **Evidence/current state:** deliberately excluded in current source.
- **Acceptance criteria:** amount/expiry persisted, no client writes, no double application, reconnect/expiry tests and installed proof.
- **Specification sections:** Resources and attributes; Effects and stances.

### ENG-PARTY-001 — Coordinated party movement release verification
- **Engine area / status / priority:** movement/party; `live_verification_pending`; 11.
- **Problem or decision:** source encodes follower-first/leader-last movement, but ordinary installed/live release evidence is incomplete.
- **Intended outcome:** prove per-member outcomes, lifecycle release and reconnect without changing semantics.
- **Dependencies:** safe bounded party scenario.
- **Evidence/current state:** source/migration contracts and focused tests exist; do not infer installation from Git.
- **Acceptance criteria:** installed definitions/grants verified; followers/leader ordering and dead/off-node/non-following outcomes observed; zero residue.
- **Specification sections:** Movement and party movement.

### ENG-REWARD-001 — Complete ADM-025B reward channels
- **Engine area / status / priority:** rewards; `blocked`; 12.
- **Problem or decision:** pending migration preflight conflicts with existing authored data; it is not installed.
- **Intended outcome:** exclusive item source, independent gold/salvage and exactly-once materialization without data loss.
- **Dependencies:** ENG-REWARD-002 decisions and explicit installation preflight.
- **Evidence/current state:** pending source exists; project state records the installation boundary.
- **Acceptance criteria:** compatible migration, resolver/commit/ground/pickup tests, unique identity proof, installed and bounded live verification.
- **Specification sections:** Rewards and unique items.

### ENG-REWARD-002 — Unique-item authoring decisions
- **Engine area / status / priority:** rewards/content contract; `decision_needed`; 13.
- **Problem or decision:** King Aldric needs key plus weapon/multiple unique candidates; Rusty Key is gate access and must not silently become global-unique.
- **Intended outcome:** explicit ordered multi-unique schema and authoring validation with no source fallback.
- **Dependencies:** product decision by Mik.
- **Evidence/current state:** unresolved; no installation authorized.
- **Acceptance criteria:** decisions recorded in specification, admin validation and runtime contract; existing items preserved; migration preflight reports conflicts.
- **Specification sections:** Rewards and unique items.

### ENG-LIFECYCLE-001 — Inactive-character return-home
- **Engine area / status / priority:** lifecycle/movement; `decision_needed`; 14.
- **Problem or decision:** inactive characters should return to a verified default city/start node, not an assumed literal coordinate.
- **Intended outcome:** idempotent authoritative transition after the same configured inactivity duration used by unique-item policy, with future bind-point extension.
- **Dependencies:** authoritative activity evidence; verified destination; party/transaction rules.
- **Evidence/current state:** backlog request only.
- **Acceptance criteria:** no reset during claims, encounters, departures or transactions; party safe; no browser-presence inference; replay safe; installed/live proof.
- **Specification sections:** Character ownership and lifecycle; Movement and party movement.

## Later — refinement

### ENG-HB-002 — Heartbeat performance and scaling
- **Engine area / status / priority:** scheduling; `deferred`; 15.
- **Problem or decision:** future load must not turn one heartbeat into an all-world scan.
- **Intended outcome:** measured bounded due-work scaling while retaining one authority.
- **Dependencies:** ENG-HB-001 and production metrics.
- **Evidence/current state:** dispatcher is bounded to due nodes.
- **Acceptance criteria:** load targets, backpressure policy, fairness and catch-up bounds proven without competing timers.
- **Specification sections:** One authoritative world heartbeat.

### ENG-DELIVERY-001 — Reduce fallback polling
- **Engine area / status / priority:** delivery; `deferred`; 16.
- **Problem or decision:** fallback polling adds load/latency but protects against unproven Realtime gaps.
- **Intended outcome:** reduce it only after reliability evidence.
- **Dependencies:** measured Realtime recovery and gap visibility.
- **Evidence/current state:** delivery works without tab switching by operator report; intermittent delay remains.
- **Acceptance criteria:** gap/reconnect SLO, no stale overwrite, safe fallback retained.
- **Specification sections:** Failure, diagnostics and verification.

### ENG-UX-001 — Combat feedback refinement
- **Engine area / status / priority:** presentation; `deferred`; 17.
- **Problem or decision:** queued/live/sync/historical feedback can be clearer without inventing authority.
- **Intended outcome:** concise state and timing feedback grounded in projections.
- **Dependencies:** ENG-COMBAT-001, ENG-DIAG-002.
- **Evidence/current state:** core logs/resources are delivered.
- **Acceptance criteria:** accessible states, no flicker/duplicate lines, authoritative wording and focused UI tests.
- **Specification sections:** Creatures, targeting and initiation; Failure, diagnostics and verification.

### ENG-BALANCE-001 — Broader ability and balance audit
- **Engine area / status / priority:** combat/content; `deferred`; 18.
- **Problem or decision:** formula correctness precedes balance changes.
- **Intended outcome:** evidence-based review without mixing engine repairs and tuning.
- **Dependencies:** stabilized heartbeat/targeting/rewards.
- **Evidence/current state:** deterministic catalogues exist; no broad audit authorized.
- **Acceptance criteria:** each proposed change names formula, content and regression fixtures; specification updated for rule changes.
- **Specification sections:** Combat resolution; Effects and stances.

### ENG-ADMIN-001 — Admin Roadmap presentation integration
- **Engine area / status / priority:** admin governance; `planned`; 19.
- **Problem or decision:** Admin Roadmap is Cloud `roadmap_items` CRUD and would duplicate this backlog.
- **Intended outcome:** read-only build/import presentation keyed by stable ENG IDs while preserving product/content items.
- **Dependencies:** source/Cloud schema and publication design.
- **Evidence/current state:** `RoadmapManager.tsx` directly reads/mutates Cloud rows; no integration made.
- **Acceptance criteria:** this file remains canonical; no manual dual entry; filters preserve existing items; operational/security detail remains admin-only.
- **Specification sections:** Information layers.

### ENG-MANUAL-001 — Admin Game Manual integration
- **Engine area / status / priority:** admin documentation; `planned`; 20.
- **Problem or decision:** hard-coded React prose can drift from engine rules.
- **Intended outcome:** present selected repository-backed specification sections with revision/date; keep authoring guidance distinct.
- **Dependencies:** safe build-time content pipeline and admin access review.
- **Evidence/current state:** `GameManual.tsx` is independently maintained.
- **Acceptance criteria:** no second editable rules source; status comes from roadmap/project state; sensitive operational detail remains admin-only.
- **Specification sections:** Information layers.

### ENG-LEGACY-002 — Remove obsolete legacy runtime surfaces
- **Engine area / status / priority:** authority cleanup; `deferred`; 21.
- **Problem or decision:** obsolete surfaces increase ambiguity after authoritative coverage is proven.
- **Intended outcome:** remove only paths proven unreferenced and superseded.
- **Dependencies:** ENG-LEGACY-001 and installed/live parity.
- **Evidence/current state:** removal scope not yet proven.
- **Acceptance criteria:** reference audit, rollback plan, focused/full boundary tests and no loss of content/admin functionality.
- **Specification sections:** Engine principles and authority.

### ENG-ADMIN-002 — Single-creature reset and despawn controls

- **Engine area / status / priority:** admin/lifecycle; `planned`; 22.
- **Problem or decision:** administrators need bounded recovery controls for one unstartable creature without simulating a kill or disturbing the rest of a node/encounter.
- **Intended outcome:** separately named reset and despawn operations with server-derived admin authorization, transactional claim/state-version fencing, explicit creature effect/target/engagement handling, and durable audit evidence. Reset restores an approved lifecycle state; despawn removes the active instance under a separately specified contract. Neither grants kill credit, XP, loot or death effects.
- **Dependencies:** read-only investigation of supported source/installed states; product decision defining reset versus despawn and allowed encounter conditions; concurrency design preserving unrelated creatures, characters, participation and reward history.
- **Evidence/current state:** request recorded only. Mik reports one unstartable creature at node prefix `f974068d` / encounter prefix `ca32f2fb`; full identities and cause are unknown and await a separately authorized read-only Cloud investigation. No repair or mutation is authorized here.
- **Acceptance criteria:** explicit supported/refused states; admin identity derived server-side; deterministic locks/fences and replay; no rewards/death side effects; effects, targets and engagement resolved explicitly; unrelated state preserved; auditable result; focused installed and bounded live proof.
- **Specification sections:** Engine principles and authority; Creatures, targeting and initiation; Failure, diagnostics and verification.
