# ENG-LEGACY-001F11 — Party evidence and closure assessment

**Current status, F12 owner acceptance: ENG-LEGACY-001F COMPLETE WITH ACCEPTED LIMITATIONS.** The F12 decision below supersedes the historical conditional recommendation and pending-acceptance wording in this F11 assessment. Parent ENG-LEGACY-001 remains OPEN.

2026-10-14. Starting local46cbfb4a16fd91c55a5b563917bc83c34ed37d6c; synchronized to origin/main before this documentation change. Scope: ENG-LEGACY-001F, engine authority/character ownership and movement/Combat2 sections. No engine rule or application behavior changed. Parent ENG-LEGACY-001 OPEN.

## Evidence provenance and acceptance mapping

F10E/F10F/F10H below are **owner-supplied hosted results in the F11 request**, not independently observed by Codex. Raw call transcripts, actual six argument values, character/party UUIDs and separate observation timestamps were not supplied here; do not reconstruct them or claim one shared snapshot. F10H has the explicit observation time2026-10-14 16:00UTC. It is a historical observation, not a fresh safe-operation-window assertion.

The [approved domain scope](legacy-001A-authority-writer-map-scope.md) and [roadmap](../roadmap/game-engine-roadmap.md) require bounded writer classification/manual tracing; physical removals require separate approval. They do not require exhaustive hosted gameplay certification. [F1 writer map](legacy-001F1-parties-writer-map.md) establishes the inventory and named findings; [F9A](legacy-001F9A-installation-reconciliation.md) calls for supported acceptance/replay/combat-refusal smoke and separate F1 retry-weakness disposition before closure. The [F10 plan](legacy-001F10-runtime-smoke-plan.md) defines those bounded cases, evidence and cleanup.

| Criterion / case | Result and exact evidence scope |
|---|---|
| Writer/dependency classification and concrete serialization correction | Source inventory F1–F3; guarded correction F6;0022 INSTALLED AND METADATA-VERIFIED by F9A. Privileged bypass uncertainty retained. |
| Local independent-session serialization | [F6A](legacy-001F6A-native-verification.md): six executed PostgreSQL18.6 scenarios PASS, including original race and corrected blocking/refusal. Reduced isolated fixture; not hosted proof or every gameplay path. |
| Ordinary authenticated party create/invite/accept | F10E PASS as reported; ordinary player authority exercised, not service-role substitution. |
| Exact successful acceptance replay | F10E PASS: same six arguments and request UUID returned the same result, no duplicate membership. No claim about malformed responses, reload recovery or exhaustive private-ledger cardinality. |
| Combat refusal: accept, leave, kick, follow, stop_following, disband | F10E PASS: all six returned combat_active during authoritative Combat2 encounter. Sequential calls; not independently concurrent sessions. |
| Supported cleanup | F10F PASS: F10-Leader used ordinary combat2_respawn; pending invite cancelled; test party disbanded through authenticated player calls; no test-party memberships/invitations remain. Does not imply test characters, receipts or encounter history were deleted. |
| Idle shutdown despite empty encounter | F10H PASS at stated time: asleep, maintenance; dispatcher/idle-shutdown jobs removed. Stored encounter still active, receives no ticks while asleep; empty encounter did not block shutdown. Not awake encounter-completion proof. |

F10 cleanup evidence supersedes a hypothetical movement-only cleanup assumption: ordinary respawn was used. This record does not infer a cause of death, unaffected protected-character fingerprints, resource equality through combat, following/tank behavior, rewards, exact claim transitions or unsupplied raw UUIDs. Protected characters were excluded by plan; no new access performed here.

## Findings disposition / closure decision

| Finding | Disposition |
|---|---|
| Supported membership/Combat2 serialization gap | Corrected, installed/metadata verified; local independent-session regression PASS; bounded hosted sequential acceptance/refusal PASS. No exhaustive hosted concurrency claim. |
| F1/F-R3 malformed-response/retry UUID weakness | **Unresolved separate correction candidate.** UI can discard UUID after malformed committed response; actor/remount handling is not durable recovery. Successful exact replay does not fix this. Recommend explicit acceptance/deferred targeted client correction for bounded audit closure; owner acceptance is not inferred from F10 success. |
| Privileged raw/service/predecessor callers | Existing accepted installation limitation, not proven contained or exploited. No browser bypass inferred; unknown external/dynamic callers remain. |
| Legacy Combat1 lock-order risk | Previously owner-accepted unresolved risk; no repair or new safety claim. |
| Masked explicit ACLs, runtime isolation and hosted independent-session concurrency | Retained evidence limitations. Effective permission/installed metadata and local native tests are distinct evidence; no fabricated readback. |
| Party following, off-node runtime participation, tank/reward/bond behavior and broader branches | Source classifications retained from F1 and reused domains; not new runtime PASS. No exhaustive multiplayer acceptance requirement introduced. |
| Empty encounter lifecycle while awake | Separate unresolved Combat2 follow-up below; not evidence of failed Party mutation serialization or failed idle shutdown. |

**Recommendation: CONDITIONAL GO for ENG-LEGACY-001F COMPLETE WITH ACCEPTED LIMITATIONS.** No additional mandatory serialization implementation criterion is demonstrated missing. However, explicit closure acceptance/disposition of F1 retry weakness and remaining verification scope has not been supplied. Keep Parties **IN PROGRESS** pending that decision; parent OPEN regardless. Do not silently turn a recommendation into acceptance.

Proposed owner wording: “I accept ENG-LEGACY-001F COMPLETE WITH ACCEPTED LIMITATIONS on the bounded F1–F11 evidence. I accept retaining the unresolved F1 malformed-response/retry-UUID weakness as a separately deferred correction candidate, the documented privileged-caller/Combat1/ACL uncertainties, and unverified hosted concurrency and broader multiplayer coverage. Exact replay and six refusals passed only at the reported scope. Empty-encounter lifecycle remains a separate Combat2 follow-up. This authorizes no implementation or hosted action.”

## Separate Combat2 follow-up — agreed direction, NOT IMPLEMENTED

Record the owner-provided future direction without treating it as current implementation or a completed rule change:

- Shared-world persistent creature HP.
- Combat-related DoTs suppress ordinary creature HP regeneration.
- Encounters can finish after active combat effects and pending actions resolve.
- Out-of-combat creature regeneration remains logically consistent across world sleep.
- Review DoT damage and regeneration balance together.

Receiving scope: planned World / Creatures / Quests domain, with a separately authorized narrow Combat2 encounter-lifecycle follow-up if needed. First distinguish awake empty-encounter completion from asleep tick suppression using existing evidence; no new audit or probe initiated. No HP reset, regeneration/DoT rule, balancing value or sleep catch-up algorithm is chosen here. Keep the single authoritative heartbeat invariant; any later implementation/design-rule change must reconcile engine specification and roadmap. World domain also retains E13's transferred unresolved contract/quest authority and rewards coverage.

## Preserved state and publication boundary

All earlier domain/progression closures, privileged v3→v2 uncertainty, existing accepted/deferred findings and recovery stash remain. Four ENG-PROGRESSION-001F limitations remain **OPEN**: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP. Narrow Party smoke does not close those progression limitations.

Administrative XP grants remain paused. Normal gameplay XP earning, including creature kill rewards, is not intentionally disabled by this policy. Its runtime behavior is not established by this closeout assessment.

Documentation only. No hosted calls, SQL/application/migration/history changes, deployment, frontend publication, fixes or runtime probes. Earlier local F10/F10A preparation is included as documentation dependency, with historical NOT EXECUTED wording scoped to those preparation tasks. Next safe action: explicit owner closure decision, then separately authorized World-domain preparation; no automatic investigation.

Local validation:3 project-state tests PASS; JSON/Markdown synchronized;75 documentation links valid across changed reports/state/roadmap; git diff whitespace check PASS.23-entry Drizzle journal remains unchanged; no SQL/migration modifications. No gameplay tests or native concurrency rerun needed for documentation changes. Recovery stash unchanged. Synchronization fast-forwarded unrelated upstream email commits to54bb1a51795845d951a9bd6ca1fe5bbdf9366456; these are not authored or included in the six-file F11 documentation commit.

## F12 — Explicit owner acceptance and closure

On2026-10-14 the owner explicitly approves **COMPLETE WITH ACCEPTED LIMITATIONS**, based on bounded F1–F11 evidence. The owner accepts/defer-tracks the unresolved F1 malformed-response/retry-UUID weakness, privileged/legacy caller uncertainty, existing Combat1 lock-order risk, masked explicit ACL evidence, unproven hosted independent-session concurrency and incomplete broader multiplayer runtime coverage. These are retained limitations, not fixes or verification results. Hosted exact six-argument replay and six combat_active refusals remain valid only at their documented sequential scope. Local native concurrency remains separate evidence.

Awake empty-encounter lifecycle and the future shared creature HP/DoT/regeneration/completion direction remain separate unresolved, NOT IMPLEMENTED Combat2 follow-ups. All prior accepted limitations, progression closures, four OPEN progression limitations, administrative-only XP-grant pause and parent OPEN status are unchanged. Closure authorizes no implementation or hosted action.

## OPEN deferred correction — F1 malformed-response/retry UUID

Tracking identity: **ENG-LEGACY-001F-R3-RETRY — OPEN / DEFERRED, NOT FIXED**. Original evidence: [F1 risk register F-R3](legacy-001F1-parties-writer-map.md), party-api malformed result lacks uncertain=true and the coordinator removes its UUID when !uncertain. A server-committed operation followed by malformed response can therefore lose its retry identity; remount/actor changes also do not provide durable request recovery. Successful exact manual replay does not resolve this client behavior; no live duplicate exploit is claimed.

F12 explicitly accepts deferral for bounded Party audit closure. This remains visibly listed in project-state product_backlog. Future separately authorized work should preserve the same UUID/immutable payload on uncertain outcomes and exercise actual caller state transitions, without broad party redesign. No correction, runtime validation or new retention policy is performed here.

## Next bounded preparation — World / Creatures / Quests

Proposed next task: **ENG-LEGACY-001G1 — World / Creatures / Quests scope and evidence reuse preparation**, following001A order7 (distinct from completed ENG-PROGRESSION-001G). Reuse existing inventories, identify persistent definitions/spawn configuration versus runtime writers, and explicitly carry E13's unresolved contract/quest completion/reward authority coverage and the separate encounter-lifecycle/design follow-ups. Establish a small source inventory/evidence plan before any investigation, implementation or hosted request. This task is identified only; not started or automatically authorized by F12 closure.
