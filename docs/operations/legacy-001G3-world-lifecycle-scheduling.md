# ENG-LEGACY-001G3 — World lifecycle, sleep/wake and scheduling

Local source/document review, 2026-10-15; source baseline `6292734adccc619a00943b6a047a277ace5db186`. No hosted access, SQL execution, gameplay probe or implementation change. ENG-LEGACY-001 and its G domain remain OPEN.

## Scope and evidence boundary

Reuse [G1 W1/W2](legacy-001G1-world-creatures-quests-preparation.md), [bounded B writer map](legacy-001B-combat2-writer-chain.md), [heartbeat identity](../design/world-heartbeat-identity.md), [legacy SQL dependencies](../design/combat2-legacy-sql-dependency-audit.md) and [Party F11 evidence](legacy-001F11-evidence-and-closure-assessment.md). G2 owner acceptance is recorded in the [G2D addendum](legacy-001G2D-contract-completion-delegate-trace.md#g3-owner-disposition--2026-10-15); E13 remains unresolved.

Relevant specification areas are [engine authority, world heartbeat, movement and diagnostics](../design/game-engine.md); roadmap references are [ENG-LEGACY-001, ENG-HB-001/003 and ENG-MOVE-001](../roadmap/game-engine-roadmap.md). This review preserves all rules and the one-authoritative-heartbeat decision. Historical Supabase SQL is definition evidence, not an authorized runner or proof of current installation. Drizzle history and installed artifacts remain unchanged.

Source reconstruction, dated hosted metadata, reported deployment and runtime observation are different evidence layers. No current world state, cron catalog, role membership, worker artifact or complete installed lifecycle definitions were observed here. Function names below denote public-schema identities unless stated otherwise.

## Writer and caller map

| Writer / exact caller boundary | State and authority established by source | Ownership / evidence limits |
|---|---|---|
| `combat2_session_access(uuid,uuid)` ← session-access client / ownership hook | Active owned character and matching node; Arena access where applicable. Transaction advisory lock `combat2-production-activation`; writes combat_mode=open, calls wake_world and scheduler_enable, then records ordinary/test presence. On scheduler refusal returns failed access after compensating maintenance/disable/shutdown. | Supported activation authority, SECURITY DEFINER; C2 replacement preserves prior ACLs. Not an arbitrary client mode setter. Current installed parity not freshly checked. |
| `combat2_presence_heartbeat(uuid)` / `combat2_test_presence_heartbeat(uuid,uuid)` ← GamePage | Owned-player / authorized-test presence leases; browser heartbeat every60seconds while session owned. | Presence is a keep-awake input, not the combat simulation clock. |
| `wake_world()` ← session access, retained environment-start workflow and CharacterSelect's useWorldState | Auth.uid required in inspected body; restores named jobs/triggers/publication membership, resumes simulation marker, updates world_state singleton awake/changed_at/changed_by. | SECURITY DEFINER public,cron; also calls retained creature/effects helpers. Direct wake alone does not perform the full canonical mode-open/dispatcher-enable sequence. Current effective ACLs require evidence. |
| `idle_shutdown_check()` ← named pg_cron idle-shutdown-check | Checks ordinary presence30minutes, valid test presence5minutes and unexpired encounter claims; then unique-item return, combat_mode=maintenance, canonical scheduler_disable, shutdown_world. | Source revokes PUBLIC/anon/authenticated and grants service_role. Does not require all encounters ended. Does not visibly take activation's transaction lock. |
| `shutdown_world()` ← idle shutdown, environment-close / failed activation | Final maintenance sweep; removes named legacy/maintenance jobs, disables specified triggers, removes selected realtime publication tables, suspends marker and sets singleton asleep. | SECURITY DEFINER public,cron. Named canonical dispatcher removal is the caller's separate scheduler_disable responsibility. Several maintenance/unschedule/trigger/publication failures are swallowed or warned. |
| `combat2_dispatch_scheduler_enable/disable/fire()` ← activation/idle/environment controls, cron | Private service scheduler authority. Enable/disable serialize on `combat2-dispatch-once-schedule`; exact named dispatcher every2seconds. Fire gates dispatch on awake AND open; bounded asynchronous HTTP to worker. | Source client EXECUTE revoked, service_role preserved. HTTP worker separately requires internal worker bearer; service-role key as bearer is rejected. No credentials inspected. |
| `combat2_test_environment_start(uuid,uuid)` / `combat2_test_environment_close(uuid,uuid)` | Retained admin-authorized, request-ledger-based Arena workflow; starts via open/wake/enable; guarded close can maintenance/disable/shutdown. | Delegated supported operations, not a second simulation owner. Fresh installed parity/external callers not established. |
| `world_watchdog()`, `record_world_state()`, `trg_wake_world_on_activity()` | Retained activity-based log/scheduler path; watchdog schedules or removes tick-creatures/effects-catchup through helpers. Activity trigger calls record_world_state, not full canonical activation. | Historical SECURITY DEFINER delegation; browser revocations do not prevent owner-internal calls. Existing B/retirement uncertainty retained. |
| Privileged/raw writers of world_state, combat_config or cron | Service/owner operations can differ from supported calls. Initial combat_config source grants authenticated SELECT, service_role ALL; Overlord RLS policy alone is not proof of a DML grant. | No general privilege scan; no successful direct browser DML or unrestricted current hosted authority demonstrated. |

Exact implementation anchors:

- [C2 session access replacement](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines326–357; [production presence/access/idle definitions and ACLs](../../supabase/migrations/20260913100000_combat2_production_cutover.sql), lines19–81. The later C2 source replaces session access, not idle_shutdown_check.
- [Client access and heartbeat RPCs](../../src/features/combat2/session-access.ts), [session ownership](../../src/features/combat2/useCombat2TestOwnership.ts), [GamePage heartbeat effect](../../src/pages/GamePage.tsx), [direct wake hook](../../src/hooks/useWorldState.ts), [CharacterSelect](../../src/pages/CharacterSelect.tsx). Session access mutates lifecycle state; its subsequent preflight is distinct.
- [Wake/shutdown/singleton and maintenance wrappers](../../supabase/migrations/20260824010343_58a2d74d-8e2d-41e2-adb0-a3e2576785ec.sql): world_state_is_awake lines5–16, shutdown118–167, wake170–263. No later named replacement located in the bounded sources.
- [Scheduler foundation](../../supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql), [runtime repair/fire and due nodes](../../supabase/migrations/20260911100000_combat2_test_arena_runtime_repair.sql), [OOC wrapper](../../supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql), [latest heartbeat composition](../../supabase/migrations/20260929130000_combat2_world_heartbeat_identity.sql).
- [Retained environment controls](../../supabase/migrations/20260906160000_combat2_test_environment_controls.sql), [combat mode helper](../../supabase/migrations/20260829222108_71c46f91-ec43-43d8-a5bb-dd1b124d6bbd.sql), [initial combat_config grants/RLS](../../supabase/migrations/20260812214305_2c2d8e09-35c4-4dab-9de9-edc8b6f94de7.sql).
- [Authenticated dispatcher boundary](../../supabase/functions/combat2-dispatch-once/handler.ts), [bounded dispatch orchestration](../../src/server/combat2/dispatch-node-ticks-once.ts). Dispatcher orchestration does not own mode or singleton transitions.

## State transitions and scheduling composition

```text
supported owned-character access
  activation transaction lock → mode open → wake_world → scheduler enable
  → successful access/presence → ordinary/test presence heartbeats

cron combat2-dispatch-once (2 seconds)
  → heartbeat fire → OOC settlement + eligibility-gated asynchronous dispatch
  → due nodes → worker claim/resolve/commit (existing B evidence)

idle check (named wake schedule: every30minutes)
  recent ordinary/test lease OR live claim → return without shutdown
  otherwise → mode maintenance → dispatcher disable → shutdown_world → asleep
```

These are separate columns/operations: awake does not by itself mean combat_mode=open or a dispatcher exists. The supported wrappers coordinate them; a direct wake/shutdown or privileged partial operation is not equivalent. SQL work within a call is transactional; HTTP delivery is asynchronous and is not cancelled merely by removing future cron firings.

The latest heartbeat outer fire records bounded heartbeat identity, settles OOC resources and invokes `combat2_dispatch_scheduler_fire_without_resource_settlement()`. It does not also call the retained OOC wrapper and settle twice. The preserved inner dispatcher checks eligibility, serializes scheduled work and tracks a pending HTTP request with timeout. If explicitly invoked while ineligible, the outer can still record an ineligible heartbeat; absent cron calls do not create synthetic heartbeat rows. This reuses B/heartbeat evidence, not a new resource/formula audit.

Wake's named maintenance jobs include watchdog5minutes, expiry15minutes, hourly log/unique-item maintenance, idle check30minutes, several cleanup jobs5minutes and staggered hourly pruners. The retained `schedule_tick_creatures()` uses `*/2 * * * *` (**two minutes**, not two seconds); effects-catchup uses `2 seconds`. Exact job presence/owners/schedule drift now is unknown. Other independent maintenance such as D4 receipt retention is outside this bounded scheduler ownership review.

## Canonical versus retained legacy lifecycle

[July activity helpers](../../supabase/migrations/20260712191947_723e9905-d3d4-4e2e-8f76-16c65c5f7e2d.sql) define world_is_awake from recent characters.last_online (5minutes) and record_world_state writes world_slumber_log and creature scheduling. This is not the explicit world_state singleton read by world_state_is_awake. [Activity trigger and creature scheduling](../../supabase/migrations/20260710214800_f6826731-75e8-40cb-a609-b4a2c938c7ff.sql) and [later watchdog/effects scheduling](../../supabase/migrations/20260817152132_f0017999-4605-4a17-a2a5-1ac6404f2ef9.sql) retain this distinction. Admin slumber display/history is not authoritative current singleton evidence.

The [G2B supplied metadata](legacy-001G2B-contract-hosted-parity.md) and [archived output2](legacy-001G2B-evidence/out2.json) observed characters_wake_world disabled, bound AFTER UPDATE OF last_online to trg_wake_world_on_activity. That observation is conditional October15 evidence with the documented execution deviation; it neither explains the disabled state nor proves the trigger is enabled now. Wake source attempts to enable it, shutdown attempts to disable it; exceptions can be swallowed. Do not extrapolate a current trigger state from either code or this dated observation.

Retained wake/watchdog can call schedule_effects_catchup, which delegates through historical effects dispatch toward retired combat-catchup. Prior [legacy runtime retirement evidence](../design/combat2-legacy-runtime-retirement-audit.md) records the refusal route and uncertainty. Source EXECUTE containment does not remove internal SECURITY DEFINER dependencies. This remains a possible rearming/ownership overlap, **not proof that a second live combat clock is running**. Creature helper calls are recorded as dependencies only; HP/DoT/regeneration and new encounter design remain excluded.

## Encounter lifecycle and F10 reconciliation

[Due-node SQL](../../supabase/migrations/20260911100000_combat2_test_arena_runtime_repair.sql), lines45–63, selects active, due, runtime-eligible encounters without a live blocking claim. It has no present-fighter requirement. Candidate selection alone does not prove a successful claim/commit. [Resolver lifecycle](../../src/shared/combat2/resolver.ts), lines1791–1796, ends a proposal when no living engaged creature and no qualifying nonexpired/nonreservation effect remain. Zero present fighters alone is not its end condition. No new rule is inferred about the particular F10 creature/effects snapshot.

Idle shutdown instead uses player/test presence and live claims. Encounter completion and world sleep are therefore **separate source-established decisions**: active encounters can persist in storage while scheduling stops; live claims can defer shutdown without requiring every encounter to finish. Maintenance sweeps can perform cleanup, but no universal end-all-active-encounters precondition is present in the inspected idle path.

| Observation / provenance | Bounded interpretation |
|---|---|
| Owner's G3 description: empty active encounter continued ticking while awake | Compatible with due-node and resolver predicates. No raw encounter snapshot/tick trace supplied here; not an independently reproduced or conclusively diagnosed defect. |
| F10H owner report, 2026-10-14 16:00UTC: asleep, maintenance, dispatcher/idle jobs removed; stored active encounter did not block shutdown | Matches the source separation above. Historical reported runtime observation, not a current catalog inspection or one snapshot shared with all F10 phases. |
| No further ticks reported after shutdown | Consistent with removed scheduler and eligibility gates; not universal proof of in-flight request draining or concurrent shutdown safety. |
| F10E sequential authenticated party smoke and local F6A independent-session tests | Retain their exact party-boundary scope. Neither verifies hosted lifecycle concurrency. |

The documented one-heartbeat/sleep design does not require active encounters to keep the world awake. F10 is consistent with the inspected implementation; its awake empty-encounter completion question remains a separate follow-up. Previously recorded shared persistent creature HP, DoT/regeneration and sleep-consistency directions remain unimplemented proposals and are not G3 corrections.

## Risks and evidence gaps

| Finding | Classification and disposition |
|---|---|
| Empty active encounter versus successful sleep | **No demonstrated ownership conflict.** Independent predicates explain compatibility; do not add a new shutdown-blocking rule. |
| Activation versus idle decision | **Concrete source interleaving candidate, hosted behavior unverified.** Idle has no visible shared activation lock or final presence recheck. After its three checks pass, another session_access can open/wake/enable, add fresh presence and commit; idle can then resume, set maintenance, disable and sleep based on its earlier decision. Configuration row locks serialize individual writes, not that decision. No two-session execution or fresh installed parity proves occurrence. Requires separate disposition; not silently accepted or fixed. |
| Wake/watchdog legacy schedule rearming | **Existing source overlap/evidence gap**, carried from B/dependency inventories. Actual named jobs, installed helper composition and effective privileges remain unverified; no demonstrated unauthorized hosted writer or live double clock. |
| Direct shutdown / swallowed maintenance exceptions | **Source limitation and parity gap.** Canonical caller disables dispatch separately; bare shutdown body does not. Error swallowing means intended job/trigger/publication cleanup is not proof all cleanup succeeded. No newly demonstrated runtime failure. |
| Shutdown versus pending asynchronous worker/live claim | **Evidence gap.** Idle checks claims once; no complete drain/quiescence protocol established by this bounded review. F10 supplies a bounded no-further-ticks observation, not concurrency proof. |
| Current ACLs, cron ownership, direct/external callers and deployed artifacts | **Requires evidence if needed for a correction.** Source grants and prior conditional metadata do not prove current effective access or successful gameplay authorization. No general privilege audit performed. |

No confirmed hosted exploit or new installed ownership conflict is established. The activation/idle interleaving is a specific source concern deserving a bounded follow-up, not authorization to repair it or a reason to reopen B–F.

## Recommended next step and preservation

Propose **G3A: idle-decision versus session-activation serialization evidence gate**, owner review first. Limit it to the two exact current function bodies and directly necessary wake/shutdown/scheduler dependencies; reuse archived metadata before requesting any fresh read-only installed definitions. Establish whether a shared lock/revalidation exists outside the inspected bodies, and design one focused independent-session regression if correction is later authorized. Do not execute a hosted query/probe or implement a lock change now. If owner accepts retention instead, record that explicitly. Broader G4 work is not started.

G2 is COMPLETE WITH EXPLICIT LIMITATIONS; E13 transferred finding, overall G and ENG-LEGACY-001 stay OPEN. Previous B–F/progression closures and privileged v3→v2/Combat1 uncertainties are unchanged. Preserve OPEN deferred ENG-LEGACY-001F-R3-RETRY and all four OPEN progression F limitations: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

Administrative XP grants remain paused. Normal gameplay XP earning, including creature kill rewards, is not intentionally disabled by this policy. Its runtime behavior is not established by this review. No source, migration, grant, gameplay, idea-register or engine-rule change; recovery stash preserved.

## Validation

Executed:35 tests PASS across six files (project-state3, production-cutover source5, scheduler source7, heartbeat source13, session-access3 and test-presence4). Project-state JSON/generated Markdown synchronization PASS;47 repository links and2 anchors across G2D/G3 PASS; scoped idle/access/resolver source assertions and whitespace PASS. Git ancestry from the prior state baseline verified. Only the G2D owner addendum, this G3 report and project-state JSON/generated Markdown change; recovery stash unchanged. Source/static tests establish repository consistency only; no SQL, hosted scheduler or lifecycle concurrency test is executed by this task.
