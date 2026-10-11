# ENG-LEGACY-001A — Authority / Writer Map scope proposal

Prepared2026-10-11 against6d108344d5988bbaef0a7e45fd0ffa2f47ab9172. OWNER APPROVAL REQUIRED before investigation. This is scope/evidence planning for existing [ENG-LEGACY-001](../roadmap/game-engine-roadmap.md#eng-legacy-001--remaining-gameplay-writer-audit), not a new audit result or code-change authorization. Its existing static-guard/manual-trace and active/dormant/obsolete classification requirements remain; source-level implemented_source status reflects prior bounded work, not completion of this proposed broader map.

## Scope and exclusions

Map gameplay mutation ownership from request/client or scheduled event to Edge/RPC/definer/trigger/writer, durable fields and returned event/projection. Include direct UPDATE/INSERT/DELETE and delegated/trigger writers relevant to the domains below, plus admin/config entry points only where they can affect the same state. Use existing candidate records first; do not launch a full-repository automated scan from this planning task. Batch each investigation by domain and stop after its source map and narrow unresolved-evidence list.

Exclude unrelated infrastructure/security/secret inventories, migration-history cleanup, catalog balancing, UX redesign, physical retirement, fixes, gameplay probes and exhaustive re-testing. Accepted progression phases remain closed; a new concrete finding is a separately scoped follow-up, not automatic reopening. Immutable history and official generated types are evidence, not editable cleanup targets. No new generic audit/replay framework.

## Standard evidence record

One row per mutation path; use exact overload/route/trigger identity rather than name-only aggregation. Separate multiple paths modifying the same fields.

| Field | Required content |
|---|---|
| Domain / path ID / source checkpoint | Stable navigation key and inspected commit/date; reused evidence checkpoint and reason for refresh if needed. |
| Data touched | Tables and exact field set; INSERT/UPDATE/DELETE; direct versus delegated/trigger effect; resources/sidecars/events affected together. |
| Intended canonical writer | Existing engine/spec authority and source reference; unresolved intent stays UNKNOWN, not invented policy. |
| Actual writers and callers | Entry/caller → command → authority/domain checks → SQL/trigger writer → result/event → projection/UI; static/dynamic calls and generator/mirror/test dependencies distinguished. |
| Execution authority | Browser/client, Edge service, scheduler or internal owner; auth/ownership/role validation; SECURITY DEFINER owner/search_path, direct/effective grants/RLS and their evidence level. Service access is not global nonreachability. No secrets. |
| Mutation guarantees | Known transaction/locks, expected version, retry/receipt, error/partial-failure behavior and derived synchronization, if relevant; absent evidence labeled unknown, no redesign. |
| Containment / retirement | Existing pause/revoke/fence/refusal and its exact source/release record; source retirement classification from H1 retained separately. |
| Reachability and evidence | Source ACTIVE/DORMANT/OBSOLETE/UNKNOWN with reason; hosted VERIFIED with timestamp/operator/exact check, OPERATOR-REPORTED historical observation, or UNVERIFIED. No-reference search is not proof of non-use; type declarations are not grants. |
| Overlap / next evidence | Which other path touches the same fields, known guard boundary, factual conflict or uncertainty; smallest domain-specific follow-up, never speculative repair. |

Attach a compact overlap matrix: field group → intended writer → actual path IDs → containment/evidence gaps. Reuse exact source references; never relabel old hosted metadata as current. Preserve administrative read authority versus gameplay access distinction. Hosted effective ACLs/membership/default grants, installed trigger/definer body parity, schedules and external integrations need actual hosted evidence if decisive.

## Proposed domain order

| Order / domain | Bounded ownership focus | Reuse first / likely remaining evidence |
|---|---|---|
|1 Combat and encounter | Claim/resolve/commit, fighter/encounter/action/effect state, scheduled settlement and legacy execution fences; trace known chains, not all abilities. | Runtime retirement, SQL dependency, movement/targeting audits; local caller/trigger/overlap refresh. Hosted installed wrapper/scheduler identities only where stale/unknown. |
|2 Character resources, stats and equipment | HP/CP/MP/caps/AC, stance/OOC settlement, death/respawn and equipment-derived synchronization; share combat rows rather than repeat them. | Stance and retirement records, canonical formulas/source guards. Hosted body/trigger parity or narrow state evidence for a demonstrated overlap. |
|3 Progression, XP/RP, class and bonds | Canonical XP/progression receipts/growth/milestones, Order/Renown and admin grants; include known v3→v2 and bond dependencies without re-auditing all98 names. |001G-A inventory, C/E/F authority maps, accepted G/H records. Keep v3 uncertainty explicit; hosted exact delegate/overload/ACL/preconditions if needed, no mutating reward probe. |
|4 Inventory, items and crafting | Ownership/equip/unique instances, craft/forge/material mutations and synchronization; definitions versus runtime instances separated. | G writer references/H1 concrete forge/jewelcrafter callers; identify domain-specific gaps locally before hosted requests. No item/socket/crafting implementation. |
|5 Economy and rewards | Gold/material/item/RP award ownership and kill/party reward transaction; link earlier progression/inventory paths, not duplicate scans. | Existing reward/canonical XP cutover and admin containment. Installed reward helper parity only for unresolved actual overlap. |
|6 Parties and cooperative state | Membership/leader/departure/party reward and bond interactions; reuse movement/reward paths. | Movement/targeting and party delegate records. Hosted dependency questions only after direct source tracing. |
|7 World, creatures and quests | Persistent definitions/spawns versus encounter/creature runtime, quest progress/rewards and relevant world-admin mutation boundaries. | Existing engine/project map; this domain has less progression-inventory coverage, so scoped source mapping may require more work. Avoid investigating unrelated UI or authoring content. |

These are investigation batches, not new mandatory feature-delivery requirements. Domain grouping may merge if shared authority makes a second trace redundant. Proposed prioritization starts with existing strong evidence and mutation overlap, not the assumption every legacy function is unsafe.

## Reusable evidence index

- [Runtime retirement audit](../design/combat2-legacy-runtime-retirement-audit.md): source ownership fences, shared module/test/generator imports, conditional writers and historical schedule consumers.
- [SQL dependency audit](../design/combat2-legacy-sql-dependency-audit.md), [L1 checkpoint](../design/legacy-cleanup-l1-checkpoint.md), [movement](../design/combat2-movement-departure-audit.md) and [targeting](../design/combat2-targeting-initiation-audit.md): predecessor/wrapper/RPC chains and historical ACL assumptions, refresh only changed or incomplete parts.
- [001G writer inventory](progression-001G-A-writer-inventory.md), [admin/creation audit](progression-001G-A-admin-creation-audit.md), [001E audit](progression-001E-audit.md), [Renown/respec audit](../design/progression-001F-renown-respec-audit.md): named SQL/admin candidates and canonical progression invariants.
- [H1 dependency inventory](progression-001H1-legacy-dependency-inventory.md) and [001G final record](progression-001G-F-closure-checklist.md): accepted retention/deferred policy and evidence boundaries. No deletion prerequisite introduced.
- [Project state](project-state.md), official Drizzle source/journal and generated types: distinct source/installation/deployment/publication checkpoints, not current hosted authority proof. [B2 strategy](migration-baseline-strategy.md) and [operating contract](lovable-supabase-operating-contract.md) preserve runner/history and hosted responsibility boundaries.

## Smallest first investigation and hosted estimate

After owner approval, conduct one local-only Combat2 writer-chain refresh using existing runtime/SQL records: current node_tick claim/commit plus OOC settlement entry points, their direct callers and trigger/delegate field groups, with legacy refusal/fence references alongside them. Produce first evidence rows and overlap matrix; record exact hosted gaps. No full combat module scan, reward-runtime test or installed SQL execution. This tests the evidence format before expanding into the remaining domains.

Most caller/field/validation/import/transaction mapping is locally testable by source inspection. Hosted verification is conditional, metadata-only and batched by exact unresolved object identities. Expect a compact request after each source batch or one consolidated request when cheaper; do not estimate credits or assert platform capacity. Scheduling/external callers/effective role inheritance and current deployed parity cannot be proved locally. Runtime/concurrency verification is outside scope unless separately justified and authorized. Avoid repeating historical Calikon/E2/canary checks without a concrete reason.

Decision requested: approve this scope, row format and order, with the first local Combat2 chain refresh only. No policy blocker is identified; scope approval is the sole immediate gate. Later metadata or implementation needs are separate requests.

Progression closure statuses remain COMPLETE with accepted limits. Four F limitations remain OPEN; privileged v3→v2 neither proven contained nor exploitable; retained restricted paths and deferred functionality unchanged. Administrative XP grants remain paused. Normal gameplay XP earning, including creature kill rewards, is not intentionally disabled by this policy. Its runtime behavior is not established by this closeout.

Owner scope acceptance (2026-10-11): scope, evidence format, order and exclusions approved; only first local Combat2 claim/commit/OOC investigation authorized as001B. No general audit, hosted probe, fix or retirement authorization.
