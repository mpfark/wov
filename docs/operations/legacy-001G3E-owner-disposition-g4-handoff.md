# ENG-LEGACY-001G3E — Owner disposition and G4 handoff

2026-10-15; starting/fetched checkpoint `6c85cb4244281181c4779c18cf2496719ecbc994`. Documentation-only owner acceptance. **G3: INVESTIGATION COMPLETE WITH ACCEPTED LIMITATIONS.** Overall G and ENG-LEGACY-001 remain OPEN.

## Owner acceptance and precise meaning

The owner's G3E instruction explicitly accepts deferring the G3B production installation and the associated known idle-shutdown/session-activation race while continuing the legacy audit. This closes the bounded investigation, **not the defect, production correction or verification gates**. The known race remains unfixed in hosted production according to the available evidence; no occurrence in hosted gameplay is claimed.

[G3](legacy-001G3-world-lifecycle-scheduling.md) identified the boundary; [G3A](legacy-001G3A-idle-activation-serialization.md) established the source-permitted READ COMMITTED interleaving; [G3B](legacy-001G3B-idle-activation-readiness.md) prepared the one-lock correction and demonstrated the original race plus both corrected orderings in11 local native PostgreSQL18.6 tests. [G3C](legacy-001G3C-idle-activation-installation-gate.md) and [G3D](legacy-001G3D-hosted-verification-plan.md) prepared the evidence gate. No hosted installation or runtime verification of that correction has occurred. Prior evidence retains its dated source/local/operator/hosted distinction.

Unchanged SQL candidate: [legacy-001G3B-idle-activation-lock.sql](legacy-001G3B-idle-activation-lock.sql), exact SHA-256:

`ec2ddfc2458c28d8ecb291c8f405f5091a8364708fd7c6097716ba51c97f233c`

The candidate, harness, fixture, G3D SELECT payloads, historical migrations/journal/snapshots and deployment configuration are not modified by this task. Keeping a reviewed candidate does not create permission to run it later without the original gates and explicit installation authorization.

## Exact retained G3 limitations

| Limitation | Current disposition / evidence boundary |
|---|---|
| Source-proven idle/activation race | **OPEN deferred correction; owner accepts continued risk.** Idle can decide no qualifying presence exists, then apply shutdown after a concurrent successful activation commits fresh presence. Source/local reproduction, not evidence a hosted incident occurred. No production repair claimed. |
| Production correction and runtime verification | G3B remains local/prepared only, NOT INSTALLED; no hosted correction/concurrency/runtime verification. Local native tests use explicit READ COMMITTED and dependency doubles, not the full pg_cron/Vault/HTTP/trigger/publication/cleanup stack. |
| Actual caller isolation | Effective PostgREST RPC and pg_cron isolation/override chains remain unresolved. Metadata-connection READ COMMITTED, defaults or one local higher-isolation40001 result do not establish both caller contracts or universal safety. No isolation setting is changed. |
| G3D hosted verification route | **BLOCKED and NOT EXECUTED.** No explicitly approved permitted read-only route with transaction_read_only=on was established. Do not use sandbox_exec, rejected routes, read/write workaround, impersonation or gameplay calls to obtain evidence. Owner deferral does not unblock this gate. |
| Fresh installed parity and authority | Exact target/dependency definitions/settings, effective ACLs and actual cron/caller configuration remain subject to G3C/G3D evidence requirements. Repository source, native fixture and historical conditional metadata are not fresh installed attestation. |
| Scope of serialization guarantee | Proposed gate covers the two cooperating routines under the tested contract; it does not prove direct wake/admin/privileged/raw callers, lease-only heartbeats or asynchronous in-flight work are globally serialized/drained. External/dynamic callers and full dependency/lock composition remain uncertain. |
| Retained lifecycle/scheduling limitations | Legacy watchdog/effects rearming and maintenance error-handling/cleanup gaps retain their existing documented dispositions; no live competing clock or new hosted exploit is asserted. Local fixture deadlock detection is not global deadlock freedom. Existing Combat1 risk is not repaired. |
| Historical F10 observation | Empty active encounter/awake ticking followed by successful sleep remains compatible with independent encounter-completion and idle predicates. Not a demonstrated shutdown defect and not proof of full runtime quiescence. Creature HP/DoT/regeneration/encounter design remains a separate future direction. |

This owner decision accepts continuation with the documented G3 limitations. It does not retroactively authorize G2B's forbidden-role/read-only-off procedural deviation, make unknown callers safe, resolve E13, change any prior accepted limitation's disposition, or declare all world lifecycle behavior comprehensively audited.

## G4 handoff — creature authority/lifecycle, not started

Use the [G1 current audit index and creature families](legacy-001G1-world-creatures-quests-preparation.md), [B writer evidence](legacy-001B-combat2-writer-chain.md), [E reward inventory](legacy-001E1-economy-rewards-writer-map.md) and prior closure limitations. The next bounded investigation should map existing creature authored identity/configuration and node associations versus spawn/respawn/despawn, runtime HP/alive/death state, effects and encounter ownership; include only actual admin/server/trigger delegates and lock/authority overlaps needed for that lifecycle. Distinguish source evidence from installed/deployed/runtime proof and reuse existing completed chains.

Do not assume a future template/instance architecture already exists. Do not implement shared persistent HP, DoT/regen/sleep redesign, encounter-completion mechanics, duplicate display names, miniatures, contract/bounty redesign, rewards or balance. Do not reopen B–F without a concrete G4 dependency or silently investigate the G3 installation gates as part of G4.

Expected next deliverable: a bounded source writer/lifecycle map with exact owners/callers, evidence gaps and the smallest next disposition question. This task only identifies that next investigation; no G4 source tracing, runtime test or implementation begins here. Later G5/G6 scope remains in the existing index, with E13 still requiring explicit receiving disposition.

## Preserved statuses, rules and unresolved work

G2 remains COMPLETE WITH EXPLICIT LIMITATIONS, with no deployed Assassin completion/functionality claim. E13 contract/quest transfer remains OPEN, including the unlocated canonical completion producer, non-atomic re-roll, unbound completion helper and deployed/reward/caller uncertainty. G/ENG-LEGACY-001 stay OPEN. Prior B–F/progression closures, migration-history/runner restrictions, privileged v3→v2 uncertainty, Combat1 risk, C/D/E deferrals and other accepted risks remain unchanged.

OPEN deferred ENG-LEGACY-001F-R3-RETRY is not fixed or verified. All four progression F limitations remain OPEN: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

Administrative XP grants remain paused. Normal gameplay XP earning, including creature kill rewards, is not intentionally disabled by this policy. Its runtime behavior is not established by this disposition. Relevant [engine authority/heartbeat rules](../design/game-engine.md) and [ENG-LEGACY-001 roadmap](../roadmap/game-engine-roadmap.md) are preserved; no engine-rule or runtime change.

## Handoff and validation

- Files: this disposition/handoff, G3 report current-disposition notice, G1 current audit index, engine roadmap referential status note and authoritative project-state JSON/generated Markdown.
- State records distinguish source/local correction evidence from owner acceptance; the deferred race stays visibly OPEN. Next task becomes G4 bounded investigation, not an automatically started audit.
- No migrations authored/installed, SQL candidate/history edits, generated types, runtime/application/deployment changes, hosted/gameplay operations, scheduler changes or frontend publication. Recovery stash preserved.
- G3D execution remains BLOCKED; G3B production installation remains deferred, requiring the unchanged gates and separate authorization if resumed.
- Executed local validation:3 project-state tests PASS; JSON/generated Markdown synchronization PASS;147 repository links and3 anchors PASS; candidate SHA-256 and baseline ancestry PASS. Structural comparison confirms every earlier state/history/backlog record and unrelated state field is unchanged; only G3E acceptance/deferred-risk and next-task records are added/updated. Documentation-only diff and staged whitespace checked before commit. Prior native tests are reused, not rerun for a documentation-only disposition.
