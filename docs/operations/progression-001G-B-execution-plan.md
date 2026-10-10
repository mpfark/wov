# ENG-PROGRESSION-001G-B — Phased plan, evidence and traceability

Current D policy precedence (2026-10-11): [simplified owner decision](../design/progression-001G-D-simplified-admin-policy.md) supersedes mandatory second-person/repeated-award approval and generalized audit/replay/notification framework requirements, and records owner-approved deferral (not cancellation) of disabled conveniences and class-access/attribute/resource correction tools. Earlier tables are historical where conflicting. Canonical authority, caps, self-reward restrictions,12-month detailed retention and existing protections remain; see the explicit mandatory/deferred D boundary.


**001G-B POLICY/CONTRACT PACKAGE COMPLETE. Documentation only. STOP before C.**

Starting source `e69047e47f9d4ec9c2d60bf4fc3cb56927d68bc1`; fetched origin/main
matches clean main and contains the earlier recorded baseline. Recovery stash
anchor remains `0a5529d5227675319b166881b10f1c91edd7486b`. No hosted access,
secret inspection, gameplay writes, migration/fixture generation, runtime edits,
deployment, activation or frontend publication in B.

Canonical [owner policy](../design/progression-001G-B-admin-policy.md) and
[narrow contracts](../design/progression-001G-B-command-contracts.md) supersede A's
unresolved O1–O14 questions only where explicitly approved. The [A audit](progression-001G-A-admin-creation-audit.md)
and [98-candidate writer inventory](progression-001G-A-writer-inventory.md) remain
historical source evidence; 12 admin action branches and98 named SQL candidates
overlap and are not a hosted live-writer count. No new installed identities or
runtime behavior are claimed.

## Verified source inputs; remaining evidence

| Topic | Exact source evidence | Contract consequence / retained unknown |
|---|---|---|
| Race attributes | [calculateStats](../../src/lib/game-data.ts) uses base8 plus race modifiers and zero classless class bonus; [registry](../../src/hooks/useRaceRegistry.ts) loads races once/session; [seed](../../supabase/migrations/20260809195546_5964d9fa-3b48-4be2-bdcd-4668d0b5a18c.sql#L46) defines human(1,1,1,1,1,1), elf(-1,2,-1,2,3,0), dwarf(2,-1,4,0,1,-2), halfling(-2,3,1,0,1,2), edain(1,0,3,1,1,1), half_elf(0,1,0,1,2,3), ordered STR/DEX/CON/INT/WIS/CHA. | These are verified **local historical seed/code values**, not approved current hosted catalog values. Server must capture the reviewed current selectable revision; no fallback-table authority. |
| Creation INSERT | [RPC frozen definition](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L18), [creation page](../../src/pages/CharacterCreation.tsx#L98), [hook](../../src/features/character/hooks/useCharacter.ts#L356) | Client stats/class/HP/AC trusted in old path; CP omitted by hook/SQL; removed enum cast likely regression. Installed full body/type/trigger identities still unknown. Raw UPDATE fence does not protect INSERT. |
| Starting goods | [starting materials trigger](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1) gives salvage40 and1 each of six primary gems; [gold default](../../supabase/migrations/20260624095137_39c3be11-82fa-4bd0-8384-7004403b09e8.sql#L1) sets200; page summary says gold100/salvage42. | Conflicting evidence, **no exact approved current starting amounts**. Do not choose silently. Trigger is part of INSERT transaction; new creation must not double-grant it. |
| Starter gear | [explicit removal](../../supabase/migrations/20260730085821_18900070-315c-4ac1-8fec-fe778a52ca2d.sql#L1) drops grant_starting_gear and both starting-gear tables. No current grant in reviewed creation path. | O7 now requires atomic gear. Exact items, slots, durability and catalog ownership need an approved manifest; old gear cannot be revived by replaying history. |
| Creation resources | [shared resources](../../src/shared/formulas/resources.ts), [canonical C authority](progression-001C-authority.sql), [current ordinary sync](../../supabase/migrations/20260922112544_a2d63b3d-4f07-4641-a911-f6cf25ee1b45.sql#L4) | Current formulas derive HP from class base/CON/level/equipment, CP from level/INT/WIS, MP from DEX/level, caps10000/5000/5000. Historical defaults CP100/MP100 do not establish approved L1 fill. Gear-before-final-calculation, initial fill/AC and selected catalog must be pinned and reviewed in C. |
| Normal respawn | [normal implementation](../../supabase/migrations/20260907105429_656d5fe4-3405-40f5-8ece-66802dd61dd2.sql#L80): seed delay3000ms, restoredHP1, lossrate0.10 atL24; HP=min(configHP,maxHP), gold loss=floor(nonnegative gold×rate), configured destination. Cleans intents/effects/pending events/departures/fighter/claim state; character UPDATE atL138 changes HP/gold/node only. [canary wrapper](../../supabase/migrations/20260909220525_d15f854b-107c-4813-b8c6-be58bc5b8c1d.sql#L142) requires destination runtime eligibility and delegates. | Source **preserves CP/MP**. Seeds are not fresh installed config. Existing helper checks owner, so service credentials alone cannot make it an admin revive entry. Review full current wrapper/config/lock chain before adapting; no active-state bypass or Test Arena refill reuse. |
| Service ACL repair | [installed-source0006](../../drizzle/migrations/0006_progression_001f_r1_restore_unprotected_service_updates.sql#L166), [F closure](progression-001F-closure.md) | Preserve protected15 denied/unprotected38 allowed/no table UPDATE; browser six preferences. Local source and retained operator evidence, not new hosted verification. |
| Definer delegation | [v3](../../supabase/migrations/20260818220917_581a61b1-6af0-41bb-b0c0-f3048c1f6f3a.sql#L46) delegates to legacy v2 while explicitly service-granted; [D0002](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql) fences direct legacy XP entries. | Source capability risk persists even when v2 direct EXECUTE is revoked; installed owner/overload/effective ACL/call prerequisites UNKNOWN. Must inspect before choosing containment. No new exploit/runtime claim; F closure is preserved. |
| Deletion | [cascade delete](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql#L1), [hook](../../src/features/character/hooks/useCharacter.ts#L340) | Hard deletion/cascading progression proof conflicts with new O8 prospective policy. No restore authority found. Full installed FK/dependency graph needed. |

Source values above are evidence, not invented creation rules or new hosted facts.
The full A inventory remains the authority for writer/navigation coverage; B does
not reclassify unknown installed definitions as safe or unreachable.

## Phase order and ownership

B → C → D → E → F. C review may identify a prerequisite containment task in D;
if so stop and obtain a separately scoped reorder/authorization. Do not ship an
unsafe creation authority merely to preserve the nominal phase order. Each phase
requires owner acceptance of its concrete scope and another task authorization.

| Phase | Exact scope and ownership | Migration requirement | Tests and hosted evidence | Stop / containment / owner gate |
|---|---|---|---|---|
| **001G-C creation safety** | Codex prepares one authoritative choice-only creation transaction, versioned approved baseline, resources/gear/materials, explicit creation provenance/sidecars and UUID replay; UI adapter/accurate outcomes. Review player/admin parity, optional family recovery and raw INSERT exposure. No legacy backfill or general admin repair. | Expected forward Drizzle schema/function/ACL/receipt/catalog work; exact requirement determined after installed-body metadata. Codex proposals only under separate C authorization; Lovable standard installation only if later explicitly authorized. | Local disposable transaction rollback at each substep, custom/invalid race, spoofed computed input/owner/class, duplicate/replay conflict, lost response, derived caps after gear, trigger double-grant, constraints, sidecar/milestone zero baseline, family failure. Later Lovable metadata: actual RPC/types/defaults/triggers/FKs/catalog/ACL. Safe hosted runtime probe only separately approved; no production test characters. | Stop for unknown baseline/catalog/gear/AC/family policy or unknown installed creation body. Fail closed rather than default-filled partial character. Preserve old evidence; installation rollback only via reviewed forward compensation, never edit installed files. Owner must approve manifest/delegation and C scope. |
| **001G-D admin authority/UI containment** | Codex prepares narrow O1/O3–O6/O9/O12 commands/role matrix/approval receipts/notifications; retire set-level/reset reconstruction and generic protected edits; accurate paused/unavailable UI, stable IDs/refetch fences. Inventory/teleport/economy convenience gets explicit containment or deferred scope, not arbitrary expansion. Resolve v3/legacy delegated capability after dependencies. O8 delete/restore lifecycle and retention schema require reviewed scoped work here or explicit split before E. | Expected new narrow domain entries, explicit ACLs, approval/audit/outbox and tombstone support; preserve service partition. No generic UPDATE. Existing history frozen. | Local role/self/repeat/cap/approval races represented by lock/rollback fixtures; request conflict/no-row/HTTP200 refusal; XP milestones/mixed growth/dead pools; tokens; RP coherence; class bond/growth preservation; redacted notifications/audit, delete exclusions/restore boundary, UI target switching. Hosted metadata for every new entry and legacy definer chain; deployment/safe refusal probes separately approved. | Stop if OverlordXP/repeat approval/RP model/retention/respawn/catalog permissions unresolved for affected entry; keep it disabled. No broad ACL rollback; containment is narrow revoke/pause reviewed against callers. No hosted multi-session fixture required. Owner reviews proposal semantics, exact per-entry rollout and any O8 split. |
| **001G-E detection and bounded repair** | Read-only classifier A proven/B unambiguously derivable/C historical-opaque/D contradictory/E missing evidence. Report scoped cases across receipts/growth/counters/XP/tokens/Renown/resources/admin history. Implement only individually approved narrow repair types; separately authorize each data execution. | Detection may need read projection; repair schema/function only for accepted exact cases. No normalize/backfill migration or default historical reconstruction. | Local canonical/opaque/missing/contradictory fixtures, evidence provenance, untouched opaque state, stale/dependent repair refusal, compensation links, privacy/restore conflicts. Hosted metadata and read-only detection require separate authorization; any write is its own reviewed case. | Stop on missing history, ambiguity, irreversible damage or later dependent actions. Prefer report/containment. No current-class history inference, guessed refund or HMAC reroll. Owner approves evidence sufficiency, executor, exact fields and compensation per case. |
| **001G-F final verification/closure** | Codex reconciles all reviewed source/docs/test evidence and retained limits; Lovable only authorized metadata/install/deploy verification. Closure against accepted staged criteria, not claims of universal live proof. | None inherently; any corrective migration returns to separately approved phase, never bundled into closure. | Local focused suites and source identity/privilege checks; hosted installed metadata and safe refusals only within explicit scope. Compare histories/sidecars/controls using permitted non-secret evidence. Document partial-failure/replay and remaining concurrency/natural/runtime limitations. | Stop on contradictory ledger/identities, unexpected writes, extra grants, unsafe lifecycle, unapproved activation or incomplete accepted scope. Owner accepts retained limitations/closure. Activation and Mik manual frontend publication remain separate. |

Rollback strategy across phases: SQL failure rolls back atomically before a
receipt; committed corrections use new linked compensation after fresh state
validation. Contain with reviewed command pause/narrow capability revoke; do not
rewind character snapshots over later progression, reinstate raw writes or revert
installed history. Frontend disablement alone cannot contain a callable API.

## Precise 001G-C entry gate

**B completion authorizes no C implementation.** To start C, Mik must explicitly
authorize the bounded local phase. Its intake must pin the authoritative installed
creation body/overloads, enum/text types, defaults, constraints, triggers/FKs and
effective privilege/dependency metadata, supplied from a separately authorized
Lovable read-only inspection where local history cannot prove it. No production
character data or secret values are needed for that metadata intake.

Before implementation fixes baseline values, the owner must approve a reconciled
creation manifest: valid selectable race/classless catalogs and version capture,
initial attributes/resources/AC, gold/material amounts, exact starter gear,
sidecar initialization, family behavior and any delegated admin creation permission.
Missing catalog is a blocker, not permission to reuse removed starting gear.
Installed-state safety/dependency findings must be resolved or scoped as reviewed
preconditions. C planning can record unknowns, but cannot invent them in code.
No Overlord XP/repeated-award decision is required to inspect creation metadata;
those unresolved D award gates do not unnecessarily block independent C planning.

## O-decision traceability

| Owner decision | A evidence / writer | Owning phase | Acceptance evidence and remaining unknown |
|---|---|---|---|
| O1 | A1/A5; admin-users:158/331, private XP/Combat2 claim | D | Canonical multi-level atomic receipt/caps/replay; Overlord cap and O10 pending. |
| O2 | A1 set-level, A8 reset, generic whitelist | D/E | Direct level-set routes remain unavailable; individually authorized repair only. No UI convenience override. |
| O3 | A2/A8; opaque six stats/counters/growth | D/E | Distinct approved adjustment provenance; no counter reclassification/guessing; per-case proof unresolved. |
| O4 | Order/bond functions and classes config | D | OnlyOverlord bypass; normal bond reset, retained mixed growth, unsafe refusal; exact installed reset chain unknown. |
| O5 | A12 raw respec; C milestone uniqueness/F respec | D | 1/5 caps, independent grant source, replay/consumed compensation; repeat model pending. |
| O6 | Renown private F, old award/v2, RP gap | D/E | 25/100 caps, balance/lifetime/rank/stat separation, no reroll; lifetime model and correction case pending. |
| O7 | Creation INSERT/material trigger/removed gear/family | C | Choice-only atomic receipt+baseline+gear+resources+sidecars; exact installed body/manifest pending. |
| O8 | delete_character_cascade, cascade FKs/no restore | D/E | Tombstone/exclusion,30day restore Overlord, collision/refusal, justified proof; permissions/retention/clock pending. |
| O9 | A6 revive vs normal respawn/wrapper | D | Lifecycle-aware admin respawn, captured HP/CP/MP semantics; complete config/adapter approval pending. |
| O10 | Common admin_users role check; no receipts/IDs/self rule | D | Server roles/ownership, self flag, fixedcaps, sensitive confirmation, race-safe repeated approval; policy parameters pending. |
| O11 | A absent admin audit; receipt FK cascade | D/E/F | 12month detailed history, redacted reads/notifications, justified minimum evidence; lawful implementation pending. |
| O12 | A6/A8 resources, sync helper, private resource authority | C/D/E | Clamp-only corrections/no revival; separate approved compensation. Initial creation fills are separately manifest-defined. |
| O13 | RaceManager/ClassConfigManager, growth fingerprints | C/D | Applied race/growth version and concrete values; prospective changes; publisher permission pending. |
| O14 | A implementation phases; operating contract | B–F | Separate authorization per phase/hosted operation; no RP earning/equipment repair silently added. |

## Finding and writer disposition traceability

| A finding / inventory scope | Planned disposition and phase | Acceptance / retained risk |
|---|---|---|
| A1 set-level / A8 reset-stats | D retire reconstruction; O2/E technical cases only | Never reopen protected UPDATE; no inferred refunds. |
| A2 update-character | D replace protected/generic mutation; narrow identity edits separately reviewed | Mixed protected payload/no-row feedback/partial level+identity requests tested. |
| A3 give-item / A7 remove-item | D contain or explicitly scoped inventory authority; equipment repair separate | UUID/count/domain lock/derived consequence gap recorded; no newly invented reward limits. |
| A4 HTTP teleport + admin_teleport UI | D one reviewed location authority; retire duplicate after caller proof | Pending combat/departure/arena states refuse; no location-only privilege bypass. |
| A5 grant-xp503 / A12 grant-respec fenced | D approved narrow grant entries; UI unavailable until installed scope | Correct caps/role/replay/receipts; no broad grant recovery. |
| A6 bare-hp revive | D replace with O9 | Respawn source/evidence reviewed; no unconditional maxHP. |
| A9 salvage / A10 gems / A11 gold+sheet edit | D explicit contain/defer or separate economy grant scope | Integer/error/count/replay/lost-update risks tracked; progression policy does not approve generic economy grants. |
| Creation enum/resource/provenance omission; misleading goods/family summary | C | Installed body verified; atomic initialization/rollback and honest UI; old metadata remains unknown. |
| v3→v2 delegated owner writes; all98 candidate/delegate signatures | D dependencies and effective ACL inspection before containment | Each reachable protected bypass resolved/fenced or expressly retained with reason; UNKNOWN not DEAD; external callers remain limited evidence. |
| Catalogs/XP boost/items/abilities/status config | C/D version/publisher containment; broader balance separate | Applied history preserved/current derived formulas; validated roles not inferred from legacy RLS. |
| Canonical trainer/Order/F and accepted Combat2 XP | C/D preserve integration; F verify | Commands stay paused; atomic rewards/receipt/growth invariants unchanged; RP earning gap explicit. |
| Test Arena reset/admin controls/read diagnostics | D preserve isolated domain; UI wording/audit scope reviewed | Not restoration/normalrespawn; keep arena replay/lifecycle guards; hosted live status unknown. |
| Unique cleanup/marketplace/durability/forge strip and other inventory delegates | D dependency containment report; deferred equipment/economy work | No standalone safety claim; state/resource sync and serialization gaps remain unless separately authorized. |
| Hard delete, restored/damaged characters | D tombstone contract/E bounded cases | Proof not erased by unreviewed cascade; opaque state remains opaque. |
| Missing endpoint/INSERT/admin/notification/retention tests | C/D/E local contracts; F bounded verification | Test coverage is source/fixture proof; hosted concurrency and natural paths not inferred. |

For every named candidate in the A appendix, use its exact signature, composed
latest definition, delegates, caller and fields during D intake. The row groups
above assign all inventory families without claiming B reverified98 installed
objects. Any extra writer found expands the evidence inventory before authority
implementation; it does not expand permission automatically.

## Validation and evidence levels

LOCAL TESTABLE: normalized replay/conflict, role/caps/self checks, approval budget
rollback, creation INSERT/trigger atomicity, derived synchronization, opaque
classification, redacted DTOs, restore/refusal and UI outcome logic in disposable
local fixtures. B creates no fixtures or runtime tests; future tests require
authorized implementation scope.

HOSTED METADATA VERIFIABLE: installed function bodies/signatures/owners/search_path,
effective ACLs/default privileges/memberships/RLS, creation defaults/triggers/FKs,
catalog/version and migration identity, no secret values. HOSTED RUNTIME PROBE
REQUIRED: safe authenticated paused/refusal behavior and deployed admin adapter
responses, only when explicitly approved. CURRENTLY UNPROVABLE: reliable hosted
multi-session races under platform constraints; no unsafe multi-session gameplay
fixture is a gate invented by this plan.

B checks: documentation-only diff, relative links/anchors, O1–O14 coverage and
role-cap consistency, state generator/check and existing project-state tests;
current F-R2 deterministic preservation check. No build/typecheck or gameplay
suite rerun needed for docs-only changes. A's217passes/1 archival R1 baseline
failure remain **historical A results**, not fresh B passes. The archival failure
is not repaired or relabeled. No hosted metadata/live test performed in B.

Fresh B results: project-state generation and synchronization passed;
`node node_modules/vitest/vitest.mjs run src/server/project-state.test.ts`
passed all3 existing tests; `node scripts/progression-001F-R2-check.mjs --check`
passed without artifact generation. Vitest reports an existing configuration
deprecation warning, not a failed test. The link check found an incorrect A
section anchor in the draft; it was corrected before final validation. No
baseline product failure was established by these limited B checks.

Retain F **CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED**. Retain exactly:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

Commit/push documentation normally after validation; verify HEAD=origin/main,
clean worktree and unchanged stash. STOP. No C or Lovable task begins from B.
