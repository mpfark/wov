# ENG-PROGRESSION-001G-D — bounded closeout and owner-acceptance proposal

Review recorded 2026-10-11. D COMPLETE with explicitly accepted limitations (owner decision2026-10-11). Recommendation: GO under accepted staged scope; no new implementation defect found in the bounded review. This document does not approve an award, deployment or repair.

## Delivered scope and evidence

D1 rejects set-level/reset-stats/raw grant-respec after authentication; protected generic payloads refuse atomically. D2 retires revive, teleport, give/remove item, gold and salvage/gem grants; generic edits permit only name/gender with active-target checks. D3 revokes PUBLIC/anon/authenticated EXECUTE on admin_teleport while preserving service permission and ordinary movement. D4 provides service-only role-rechecked token awards, Steward1/Overlord5, Steward own-account refusal, Overlord self flag, active/fresh target, reason, atomic UUID/payload replay, canonical receipt/version and private12-month reason expiry. UI renders reason/new-award controls, bounded retry and authoritative refetch; other retired controls remain disabled.

Source evidence: [D1 handoff](progression-001G-D1-legacy-admin-containment.md), [D2 handoff](progression-001G-D2-admin-character-containment.md), [D3 SQL](progression-001G-D3-direct-teleport-containment.sql), [D4 handoff](progression-001G-D4-respec-token-handoff.md), [simplified policy](../design/progression-001G-D-simplified-admin-policy.md). Direct paths: admin-users/index.ts retirement checks and update-character/award-respec-token branches; UserManager.tsx and CharacterActionsColumn.tsx token flow; installed-source0016. Local tests support implementation, not live execution.

Owner reports D1/D2 Edge deployment, D3 installation, D4 SQL installation/Edge deployment and manual frontend publication. Owner saw D4 controls in Admin → Users. This is UI smoke evidence only: authenticated awards, live caps/self/refusal/replay and cron execution are NOT VERIFIED. Deployment revisions/execution timestamps and fresh hosted ACL readback were not supplied; no invented identifiers. C2 remains COMPLETE with accepted limitations.

## Known gaps and disposition

| Known gap | Classification for this proposal | Evidence / residual limit |
|---|---|---|
| Legacy protected and convenience Edge writers; mixed generic edits | Resolved at implementation and owner-reported rollout level | D1/D2 refusals; no new command or partial writes. Live per-route campaign remains unverified. |
| Browser direct teleport | Resolved at reviewed SQL and reported installation level | D3 effective-browser assertions; service RPC remains intentionally callable. Fresh hosted ACL readback unverified. |
| Canonical token award missing | Resolved at implementation and reported rollout level | D4 authority/receipt/UI delivered; no authenticated hosted token award demonstrated. |
| Token live caps/self/replay/rollback; permitted edit outcomes; scheduler retention | Accepted verification limitation | Local focused tests exist; visible controls do not prove server awards or scheduled expiry. No blanket PASS. |
| Privileged legacy delegation (commit_encounter_tick_v3→v2), remaining historical candidate/delegate reachability and class-bond reset dependencies | Accepted residual authority uncertainty | B execution plan retains UNKNOWN installed prerequisites/ACLs. Historical v3 definer is service-granted and delegates at line46; direct v2 revocation alone is insufficient. Raw progression fence exempts postgres, so it is not proof against owner-definer delegation. No exploit or live bypass demonstrated; no current browser admin caller identified for this path in this review. Retain a narrowly triggered follow-up if activated/called or new evidence appears; UNKNOWN is not DEAD. |
| Class-access, attribute/resource correction tools | Deferred, explicitly owner-approved | No delivery required for D; future invariant/evidence requirements retained. |
| Inventory/economy/teleport/full-HP convenience replacements and isolated Arena/equipment/economy dependencies | Deferred replacement work; existing domain behavior preserved | Contained Admin routes remain unavailable. No claim all server/domain mutation paths are disabled or newly verified. |
| XP award authority, RP/lifetime compensation, normal-semantic admin revive | Deferred | XP503 pause remains; decisions only before enabling relevant authority. RP earning gap stays open. |
| Creation/deletion/provenance history | Resolved under C2 accepted closure; E cases remain separate | Do not reopen accepted C2 tests or infer historical repair authority. |
| Proven new defect or missing mandatory narrow authority | No blocker identified | This bounded review is not a universal privilege or runtime certification. |

References for retained dependencies: [B execution plan](progression-001G-B-execution-plan.md) verified-input definer-delegation row and writer traceability; [historical inventory](progression-001G-A-writer-inventory.md) UNKNOWN v3 entry; supabase/migrations/20260818220917_581a61b1-6af0-41bb-b0c0-f3048c1f6f3a.sql:46, scripts/progression-001E-commands.sql:48 (postgres exception), drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql legacy revocations. D4 adds no arbitrary repair, broad UPDATE grant or shared framework.

## Owner acceptance recorded

“I accept ENG-PROGRESSION-001G-D COMPLETE for the delivered D1–D4 scope under the simplified policy. I accept that authenticated hosted token awards, live refusals/replay/rollback, effective ACL readback and scheduler expiry have not all been demonstrated. I expressly retain the documented privileged legacy/delegated-writer uncertainty as a nonblocking residual risk, not a verified containment claim. Deferred class-access, attribute/resource, inventory/economy/teleport, XP/RP and revive tools remain deferred, not cancelled. This acceptance authorizes no runtime mutation or new feature. C2 completion and all four F limitations remain unchanged; E detection/bounded individually approved repair and F final001G closure remain open.”

Owner explicitly accepts the documented residual uncertainty and verification limitations. No further D audit or runtime campaign is a prerequisite for E. A later broader review may be considered separately; new concrete evidence can trigger a narrow follow-up without retrospectively claiming accepted behavior passed.

## Next roadmap work

After D acceptance: ENG-PROGRESSION-001G-E, beginning with a read-only classifier using current canonical evidence, retaining opaque history and never reconstructing class growth from current class. The one-time test-character reset reduces historical cases but does not prove there are no opaque/current cases; no hosted scan performed here. Repairs require individual evidence/owner approval, and may be unnecessary. F then reconciles final001G scope/evidence and owner acceptance, without claiming universal runtime proof.

Preserve OPEN: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

## Explicit owner decision — 2026-10-11

Mik explicitly accepts D closure with the remaining verification limitations and delegated-authority uncertainty documented. D is COMPLETE with accepted limitations; overall001G stays OPEN. Authenticated token awards/refusals/UUID replay, hosted ACL readback and actual cron expiry remain unverified. Privileged v3→v2 delegation is neither proven contained nor exploitable. All approved admin/correction deferrals, C2 COMPLETE with accepted limits and the four OPEN F limitations are preserved. No repair, hosted action or broader audit is authorized by acceptance.

## E kickoff — bounded read-only classification plan

Existing scope is the E phase in the B execution plan: classify current state using canonical evidence, then consider only individually approved repairs. C2 reset SQL explicitly removed all player characters and old creation/progression runtime sidecars; successful reset/cutover is historical operator evidence, not proof of today's population. Calikon and Canaryone are documented post-C2 examples, not an exhaustive census. Completed administrative reports survive as historical evidence and need not resolve to surviving characters. Do not reconstruct the obsolete population or infer that every historical report/receipt difference requires repair.

Smallest first task: prepare a narrow read-only E inventory/projection specification from existing characters, creation origins/logs, progression_character_state/receipts/respec milestones and lifecycle records. First establish whether any current character lacks C2 origin/progression initialization or falls outside canonical evidence; summarize counts and exceptional identifiers only, without private reasons or unnecessary account data. No hosted query is authorized here; a future scoped Lovable read is separately authorized. Only investigate an anomaly's relevant receipts/catalog snapshot after the initial classification indicates a need.

| Outcome | Required evidence / treatment |
|---|---|
| No issue | Active or deleted identity links, valid origin versions/applied baseline, canonical receipt/version continuity and token milestone consistency where supported. Current stats/resources may differ legitimately after gameplay; do not compare them blindly with level1 values. |
| Accepted historical state | Historical reports, intentionally retained receipts and opaque growth/investment/admin history without a demonstrated violated invariant. Preserve; no automatic normalization. |
| Requires further evidence | Missing origin/sidecar, incomplete receipt chain, unexplained XP/level/token/Renown/resource mismatch or catalog ambiguity. Missing evidence is not itself proven corruption. Use approved applied versions, not current mutable catalogs; current class does not reconstruct historical growth. |
| Candidate for individually approved repair | A reproducible violated canonical invariant with unambiguous expected value, identified cause and dependency/lifecycle consequences. Specify exact character/fields, stale-state refusal and compensation/rollback before asking approval. No repair is necessary merely to finish E. |

Map to original A–E evidence classes: proven canonical/unambiguously derivable can support No issue; historical/opaque supports Accepted historical state; contradictory or missing evidence first requires further evidence, and only an unambiguous proven contradiction becomes a repair candidate. Cover XP/level, six attributes, growth/discretionary investments, token milestones/awards, Renown and derived resources only where present evidence supports interpretation. Preserve administrative XP grant pause and RP earning gap.

Actual current legacy rows and correction need remain unknown without a scoped read; no concrete repair case is established locally. No unresolved policy decision blocks preparing that read-only inventory. Owner must separately authorize any hosted read and every eventual repair; no generic repair permission or security campaign is required. F remains final001G evidence/accepted-scope closure after E, not a new implementation bundle.

Final001G closure superseding phase checkpoint status (2026-10-11): overall001G/F COMPLETE with explicit owner acceptance; this phase and its limits/deferrals unchanged. Administrative XP grants remain paused. Normal gameplay XP earning, including creature kill rewards, is not intentionally disabled by this policy. Its runtime behavior is not established by this closeout. See [final consolidated record](progression-001G-F-closure-checklist.md).
