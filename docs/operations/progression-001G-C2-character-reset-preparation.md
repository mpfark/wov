# C2 one-time full character reset — locally prepared

Latest owner authorization: all existing player-character state is disposable test data; ALL node ground loot and obsolete detached/transit unique runtime are removed. Historical loot provenance is no longer an investigation or approval gate. Completed Arena administrative reports, account/Auth identities, Overlord permissions, permanent world/configuration and item definitions remain protected. This is preparation only, not destructive execution approval.

Current correction baseline: 5ee683b47a5978ec6ae9547f32458e5231ee1022, fetched origin/main and fast-forwarded normally; original reviewed checkpoint 4ff11691f913a4c15c89c02cb6b67788cd6428b3. Prior local C2 work and recovery stash retained. ENG-PROGRESSION-001G/C2 and engine sections Character creation and initialization; Engine principles and authority; Failure, diagnostics and verification preserve permanent rules. Clearing disposable test receipts/replay is a one-time owner-authorized reset exception, not a change to normal lifetime/12-month retention.

## Hosted23502 correction — local only

Owner reports the first combined installation failed with SQLSTATE23502 and rolled back completely. This is operator-reported, not an independently inspected hosted result. The published reset cleared character_name, but source DDL and generated Cloud types make that field NOT NULL. The earlier three-column fixture omitted that constraint and report content/status.

The only reset DML correction is UPDATE public.issue_reports SET character_id=NULL WHERE character_id IS NOT NULL. The two preservation snapshots now exclude only character_id, so character_name joins message/status/user_id/id/created_at and any other report fields in full equality assertions. Already-detached reports are left unchanged. No nullability/schema change, report deletion, default substitution or unrelated cutover change.

Evidence: supabase/migrations/20260303171955_64df7909-005f-4cd8-aa02-a30487f6e719.sql:1–9 defines all report columns, including nullable character_id with ON DELETE SET NULL and NOT NULL character_name/message/status/user_id; src/integrations/supabase/types.ts issue_reports Row/Update types agree. The reported hosted failure independently confirms the non-null name. No new hosted query.

Targeted review of the EXISTING reset mutations (not a new inventory):

| Mutation | Constraint review and focused evidence |
|---|---|
| Issue report unlink | Only nullable character_id changes. Exact source DDL replaces permissive fixture; linked and already-detached report names, content, status, timestamps, row/account IDs are compared completely. Old combined statement reproduces code23502/table issue_reports/column character_name and restores earlier recording-report deletes. |
| Other UPDATEs in reset | All other direct UPDATEs address temporary allowlist metadata only. No other persistent fields are nulled. |
| Holder DELETE side effects | Pinned source unique_holder_before_delete updates only registry location_kind=transit, location_id=id, updated_at=clock_timestamp(); these satisfy the known NOT NULL/CHECK/unique contract. Exact source registry DDL now exercises its NOT NULL columns, CHECK, item FK/unique and defaults. Existing deferred holder FKs/finalization and Shield Wall DELETE trigger remain exercised; unknown registry UPDATE triggers refuse. |
| Recording Arena DELETEs | Exact source run/batch/event DDL and one-recording index now exercise NOT NULL fields, status/completion CHECK, unique keys and parent/composite FKs; completed archives remain untouched and compared fully. Source:20260907110000_combat2_test_runs.sql:2–41. |
| Whole allowlisted DELETEs | DELETE itself does not null row fields. Actual FK leaves precede parents; unknown preserved incoming FK actions or enabled user DELETE triggers refuse, and final deferred checks/empty-table assertions run in the same transaction. Existing private origin/log/receipt immutability guards are BEFORE UPDATE only. No constraint disable/drop/cascade redesign. |

No additional concrete source blocker found. Other existing minimal dependency fixtures do not prove every hosted CHECK/FK/trigger; retain the already-required fresh installed metadata, recovery checkpoint and standard-tool transaction gates. Normal lifecycle purge SQL is unchanged; this owner decision applies to the one-time reset only.

The fetched source includes inactive support registration0012 at Lovable commit5ee683b4. Its source registration is preserved; source alone is not independent installation verification. Do not replay support if already installed. New reset/combined hashes below replace the failed identities; failed SQL hashes remain historical in checkpoint4ff11691. Correction/retry/publication is not authorized by this task.

## Prepared artifacts

| Artifact | SHA-256 |
|---|---|
| [Explicit reset](progression-001G-C2-character-reset.sql) | 02da4e8aa9d884cf665456a3c32477b44a57e56705686f50c7b97151fd5f7122 |
| [ONE transaction reset + corrected B](progression-001G-C2-reset-and-cutover.sql) | c93fd93efb75dd9e2ab8478b8672678b2ecd40be846c46da62d19318cbc48b40 |
| [Targeted read-only metadata preflight](progression-001G-C2-character-reset-preflight.sql) | 8b1dc75451c135b30c90efb4cdd6967827b7f2bbb33e34075a9aeb045525b7c1 |
| Separate unchanged inactive support A | 5aa1c167bd59c239e94bdfd9e7a929f5ed060deda9ad3f754a68b83b8e01938c |
| Existing corrected B, byte-for-byte unchanged | 7df1c1cd143433878019628d40d2bff6695df317e43cdb25105c1db31edf4fae |

The reset component must NOT be installed alone. scripts/prepare-c2-reset-cutover.mjs concatenates its exact bytes before the existing corrected B, with component SHA-256 headers; --check validates composition. All reviewed SQL stays outside drizzle/migrations. No migration/journal/snapshot/history changes.

The standalone 203-row cleanup and its historical fingerprint/CSV remain evidence and are NOT part of this installation path. Full character_materials deletion includes those 203 rows and any other obsolete materials. The new full-reset owner authorization does not depend on unchanged historical balances, timestamps or fingerprint. Do not execute both cleanup and reset.

## Transaction, dependency and preservation boundary

Postgres only; ordinary RLS-complete visibility; origin trigger mode; 5-second lock and 120-second reset-statement timeouts. Resolve only explicit public allowlisted relations. Missing legacy candidates are visible in preflight, not dynamically discovered for deletion; required core dependencies cannot be absent. Partitioned/inherited targets refuse. Lock every existing target in lexical order with ACCESS EXCLUSIVE, retained through cutover and COMMIT. Locks may block readers during this one maintenance transaction. Lock timeout/deadlock aborts; no retries with weaker protection.

Incoming FKs from any unlisted/preserved relation into reset targets refuse regardless of CASCADE, SET NULL or NO ACTION. The sole narrow exception is issue_reports.character_id, explicitly nulled while preserving its rows/content/account link. New unlisted character sidecar columns refuse. Actual FK leaves precede parents; a cycle refuses and rolls back rather than dropping constraints. Stances precede shield inventory; runtime holders precede unique registry. Ordinary unique-holder DELETE/transit/deferred-finalization and stance equipment functions stay enabled with pinned LF-normalized body MD5/owner/security/search_path guards. Unknown/drifted DELETE triggers, registry UPDATE triggers reached by holder deletion, and already-attached lifecycle fences refuse. No trigger bypass or broad CASCADE reset.

Registry rows must use the four existing runtime location kinds: inventory, ground, marketplace, transit. A new persistent kind or configured-placement incoming FK is a concrete stop, not permission to delete it. No additional ground-loot provenance investigation is requested.

Delete only recording Arena runs/events/batches. Reject detached archive rows/unknown statuses. Snapshot every completed run/batch/event as full JSON rows and assert multiset equality after deletion; archived historical actor/target IDs need not resolve. Issue reports retain every field except cleared character_id; original historical character_name stays unchanged. Assert all 72 existing whole-table targets empty, including tombstones, private history/origin/replay and all materials. Empty characters proves zero occupied slots for every account and releases the installed name index; no account deletion/rename/index change.

No DML targets auth.users, profiles, user_roles, role memberships, secret tables, permanent world/configuration/catalogue data. Auth/profile snapshots read IDs only; never credentials. Known non-secret world/config/account-role rows and completed reports receive equality assertions. All other persistent relations remain outside DML and incoming-cascade paths. progression_renown_key is never read, hashed or exported by these scripts. Flush deferred constraints before final assertions. Any exception aborts the entire reset + B transaction, restoring data, privileges, functions, fences and scheduled-job changes.

The existing installed 0007/0011 immutable guards attach BEFORE UPDATE, not DELETE. Reset executes before B attaches lifecycle DELETE fences. Never forge expiry, call normal purge, disable fences or create an alternate deletion lifecycle. The October wrapper, September24 present-fighter fix and Force Shield regeneration stay exactly as corrected in B. Private A stays independently installable and inactive.

## Practical one-time recovery requirement

Prefer the existing provider's supported consistent database recovery checkpoint, captured immediately before the destructive transaction after inactive A, while the runtime is quiescent. Record its ID/time, source and migration prefix, target-table manifest/counts, preserved completed-report/account/world counts and provider restoration instructions. Keep the actual backup private outside Git; Codex needs only availability/coverage evidence, not its contents or Auth/key secrets.

If no supported checkpoint is available, use one ordinary consistent data-only export of the 72 reset tables plus all three Arena report tables and issue_reports, together with their schema/FK/function/trigger/ACL metadata and preserved definition dependencies. A single scoped pg_dump with repeated --table arguments, --data-only and --column-inserts is an export option only if the operator already has a supported private connection and isolated restore route; no new credential request or alternate production migration runner. Export whole report tables for simplicity, even though completed rows are preserved. Do not build backup tables, reconstruct histories, or create a permanent backup system. A materials CSV or schema snapshot alone is insufficient.

Before execution verify the checkpoint/export completed, is privately retrievable and covers the entire affected graph. Rehearse restoration in an authorized isolated environment where the provider supports it; compare affected row identities/values, holder consistency, completed archives, account IDs and preserved configuration. Recovery after a committed reset needs fresh authorization and containment of any later canary/player data; it must not replay the reset or rewrite migration history.

**Local isolated restoration demonstrated:** the synthetic PostgreSQL fixture is committed, exported using PGlite's existing physical data-directory checkpoint, loaded into an independent instance, reset, then restored afresh from the same checkpoint. Every affected table/report, configured placement, item, node, profile, role and Auth identity is compared to its original values. No permanent backup code/service or real player credentials are involved.

**Actual hosted checkpoint/provider restoration remains unverified.** No real checkpoint or restoration result was supplied. This is reported separately; it does not prevent local SQL preparation. Execution remains NO-GO without the practical checkpoint and explicit reset/cutover approval. Local physical restoration is not proof of managed Supabase restoration or hosted concurrency.

## Focused validation

- C2 lifecycle/settlement/integration SQL suite: 57 passed, zero failed, including eleven reset/recovery scenarios. Reset covers every allowlisted target, 203 supplied CSV orphans plus extra obsolete material, tombstones, ALL ground loot, transit/escrow, canonical progression receipts and immutable creation storage.
- Preservation: completed Arena JSON reports/identities, item definitions/configured placements, Auth IDs, profiles and Overlord role; post-reset reused name creates through canonical authority with seven starting-material rows.
- Refusal/rollback: new persistent incoming FK (character and unique registry), unlisted quest sidecar, unknown DELETE trigger, already-active lifecycle fence, new persistent registry kind, injected final reset assertion and late cutover scheduler collision. Late cutover failure restores old characters/materials/runtime/reports before a successful retry.
- Existing targeted metadata preflight: four tests passed. Project-state: three tests passed; JSON/generated Markdown consistency, both byte-composition checks and git diff --check passed. Total: 64 focused tests passed (57 + 4 + 3). Real scheduler launches, independent-session lock contention, actual Cloud restore and runtime activation are NOT established by local fixtures; pg_cron is a declared local API/catalog mock.

## Minimal coordinated Lovable sequence / stop conditions

No Lovable action is authorized by this preparation task.

1. After separately authorized publication, pin the exact reviewed source/SQL hashes. Run existing integrated and reset metadata preflights read-only, using actual postgres installer requirements (not read-only inspector privilege as a substitute). Review the SAME 91-candidate relation/column map, incoming FK closure, three guarded DELETE bodies, relevant ACLs/cron job collision, installed 0007–0012 source prefix and any later suffix. Stop on unexpected dependencies, already-active fences, body drift, missing core tables, visibility gaps or schema changes. No loot-provenance query needed; old loot-evidence artifact is historical only.
2. Separately authorize/install unchanged inactive private A via standard Lovable Drizzle, one transaction. Verify its private ownership/ACLs and absence of activation/Auth hook/new job. Inspect generated SQL/journal/snapshot and automatic commits after success or failure. Do not replay if already installed.
3. Establish a quiet maintenance window with existing runtime writers/DDL quiescent and a practical one-time recovery checkpoint. Retain checkpoint identification privately and report actual restoration availability separately. Obtain explicit approval for BOTH full reset and activation of exact combined SQL. If the standard migration tool cannot guarantee ONE transaction for the full combined artifact, STOP; never split reset from B.
4. Install ONLY reset-and-cutover.sql as one forward standard-tool transaction: reset first under retained locks, then unchanged corrected B validates materials FK, contains legacy/direct creation/delete, attaches lifecycle authority/Auth hook and schedules receipt expiry. No standalone orphan cleanup, separate lifecycle/runtime cutover or direct SQL fallback. Any assertion/timeout/deadlock rolls back everything; inspect source commits even on failure.
5. Read-only post-install verification: zero characters/material/inventory/origin/history/runtime, no recording reports, identical completed reports/account IDs/Overlord/world/config/definitions, validated materials FK, exact function/ACL/fence/cron metadata and Drizzle generated SQL hash/prefix. Stop on unexpected differences. No unsafe gameplay or multi-session fixtures. Bounded fresh-creation/lifecycle/Auth/scheduler/unarmed/Realtime verification, Edge/browser integration and Mik's manual frontend publication remain separately authorized later steps.

**GO for corrected local package review. NO-GO for an unauthorized hosted retry:** publish the corrected checkpoint only when authorized; reconfirm installed metadata/recovery checkpoint and standard-runner transaction before any authorized attempt. First-attempt execution authorization is not inferred to authorize this retry. Actual restoration, concurrency and scheduler/runtime behavior remain unproven. No unresolved gameplay or loot-ownership owner decision is invented. All four F limitations remain: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

## Source candidate inventory

The existing 91 candidates are retained. Class 1 = reset completely, including orphans; Class 2 = selective active-report removal/account-report unlink; Class 3 = preserve. The latest owner decision resolves all ground/transit provenance policy questions. Actual installed existence and graph still require the same targeted metadata preflight; legacy source tables may be absent. The executable allowlist contains 72 whole-table targets plus four selective targets; the other 15 candidates are preserved. No broad re-audit.

| Table / candidate group | Classification / action | Source evidence |
|---|---|---|
| characters, character_materials, character_inventory, character_class_bonds, character_visited_nodes, character_stance, character_stance_request, character_ability_loadout, character_inventory_action_request, character_special_travel_request, character_waymark, character_npc_gifts, character_guide_reads, hidden_path_search_request, character_creation_origin, character_creation_log, character_lifecycle_receipt, progression_character_state, progression_receipt, progression_respec_milestone, progression_class_growth_milestone | 1; full player state/origins/replay/history removal is part of this one-time owner-approved reset exception. No account deletion. | 0007/0009/0011; P2-C owned list; generated types |
| combat2_player_presence, combat2_test_presence, combat_sessions, party_members, parties, party_operation_request, party_combat_log, combat2_departure_request, combat2_party_departure_member, combat2_party_departure_request, combat_actions, combat_audit_log, combat_soak_access, combat2_respawn_request, combat2_test_arena_access, combat2_test_arena_stance_snapshot_header, combat2_test_arena_stance_snapshot, combat2_diagnostic_session, combat2_diagnostic_server_event, encounter_access_grants, encounter_engagements, encounter_participants, encounter_contributions, encounter_kill_awards, node_fighter, node_intent, node_reward_claim, node_participation, summon_requests | 1; character/party-owned requests, participation, diagnostics and bonds, including orphans. Legacy encounter_contributions exists in source even if absent from latest generated types. | P2-C owned list and migrations; generated types |
| active_effects, node_effect | 1; all permitted temporary effects, including creature-only and orphan effects | effects and Combat2 definitions |
| marketplace_listings | 1; character escrow and history; existing unique holder triggers must run | ADM-025 holder authority |
| node_ground_loot, unique_item_instance | 1 delete ALL ground loot and the obsolete inventory/ground/marketplace/transit registry. Item definitions and configured placements survive; unexpected persistent registry locations/incoming placement FKs refuse execution | ground loot source |
| issue_reports | 3 preserve account report rows; proposed 2 unlink character_id only; preserve original character_name, message, status, account link and all other fields | existing P2-C purge unlink behavior |
| node_encounter, node_creature, node_arrival_group, node_pending_event, node_death_loot, node_boss_ability_cooldown, node_tick_batch, node_tick_log, combat2_tick_notification, encounters, encounter_creatures, encounter_cast_events, encounter_death_loot, encounter_tick_batches, effects_catchup_dispatch, effects_catchup_log, combat_soak_scopes, combat2_test_run, combat2_test_run_batch, combat2_test_run_event, combat2_test_arena_request | 1 for temporary combat/effect/encounter/catchup/soak runtime; 2 for test_run/batch/event active-run subsets, preserving every completed archive; 3 for account administrative arena-request replay. Installed FK graph must confirm preservation | generated types, existing runtime migrations |
| character_resource_settlement_state, progression_command_control, progression_renown_key, combat_config, combat2_respawn_config, combat2_dispatch_schedule_state, combat2_canary_node, combat2_test_arena, combat2_test_arena_node, combat2_test_arena_creature, families, family_members, family_requests, world_slumber_log | 3; global state/configuration, Arena definitions and account-owned families survive. Settlement singleton cursor is not a character sidecar. Never read/hash renown key material. | source ownership/columns; singleton tables |
| auth.users, profiles, user_roles, pg_roles/pg_auth_members, world/regions/areas/nodes/connections, creatures/NPCs, items/catalogues, abilities/classes/races, guides/quests/loot/vendor definitions, private manifest and operating configuration | 3; no account/role/world/catalogue deletion or broad cascade | user mandate; Auth ownership and definitions |
| Character quests/contracts | active_contract and contracts_completed are characters columns; source does not establish a separate installed quest table. Discover any installed character-owned quest tables before claiming completeness. Character class bonds reset; account family membership survives. | 20260629080249 contract migration; generated characters types |

Read-only source column candidates (88 tables) for targeted metadata reconciliation:

- active_effects: source_id, target_id
- character_ability_loadout: character_id
- character_class_bonds: character_id
- character_creation_log: payload_digest, payload_version, result_character_id
- character_creation_origin: applied_snapshot, character_id, snapshot_schema_version
- character_guide_reads: character_id
- character_inventory: character_id
- character_inventory_action_request: character_id, result
- character_lifecycle_receipt: character_id, result
- character_materials: character_id
- character_npc_gifts: character_id
- character_resource_settlement_state:
- character_special_travel_request: character_id
- character_stance: character_id, state
- character_stance_request: character_id, encounter_id, result
- character_visited_nodes: character_id
- character_waymark: character_id
- combat_actions: character_id, encounter_id, target_character_id
- combat_audit_log: character_id, character_name, payload
- combat_config:
- combat_sessions: character_id, party_id
- combat_soak_access: character_id
- combat_soak_scopes: character_ids, encounter_id
- combat2_canary_node:
- combat2_departure_request: character_id, encounter_id, fighter_entry_seq, fighter_id
- combat2_diagnostic_server_event: encounter_id
- combat2_diagnostic_session: character_id, encounter_id
- combat2_dispatch_schedule_state:
- combat2_party_departure_member: character_id, encounter_id, fighter_entry_seq, fighter_id
- combat2_party_departure_request: leader_character_id, party_id, result
- combat2_player_presence: character_id
- combat2_respawn_config:
- combat2_respawn_request: character_id
- combat2_test_arena:
- combat2_test_arena_access: character_id
- combat2_test_arena_creature:
- combat2_test_arena_node:
- combat2_test_arena_request: result
- combat2_test_arena_stance_snapshot: character_id, state
- combat2_test_arena_stance_snapshot_header: character_id
- combat2_test_presence: character_id
- combat2_test_run:
- combat2_test_run_batch: encounter_id
- combat2_test_run_event:
- combat2_tick_notification: encounter_id
- effects_catchup_dispatch: encounter_id
- effects_catchup_log: encounter_id
- encounter_access_grants: character_id, encounter_id
- encounter_cast_events: encounter_id, payload
- encounter_creatures: encounter_id
- encounter_death_loot: encounter_id
- encounter_engagements: character_id, encounter_id, party_id_at_join
- encounter_kill_awards: character_id, encounter_id
- encounter_participants: character_id, encounter_id
- encounter_tick_batches: encounter_id, payload
- encounters: encounter_key, state, stored_power_source_id, tick_state
- families:
- family_members:
- family_requests:
- hidden_path_search_request: character_id, result
- issue_reports: character_id, character_name
- marketplace_listings: buyer_character_id, item_snapshot, seller_character_id
- node_arrival_group: encounter_id, party_id
- node_boss_ability_cooldown: encounter_id
- node_creature: encounter_id, tank_fighter_id
- node_death_loot: encounter_id
- node_effect: encounter_id, source_character_id, target_character_id
- node_encounter: state_version
- node_fighter: character_id, encounter_id, party_id_at_entry
- node_ground_loot: dropped_by
- node_intent: character_id, encounter_id, target_character_id, target_fighter_id
- node_participation: character_id, encounter_id, party_id_at_qualification
- node_pending_event: actor_character_id, encounter_id, payload, target_character_id
- node_reward_claim: character_id, encounter_id
- node_tick_batch: encounter_id, events
- node_tick_log: encounter_id, result_kind
- parties:
- party_combat_log: character_name, party_id
- party_members: character_id, party_id
- party_operation_request: actor_character_id, party_id, result, target_character_id
- progression_character_state: character_id
- progression_class_growth_milestone: character_id
- progression_command_control:
- progression_receipt: character_id
- progression_renown_key:
- progression_respec_milestone: character_id
- unique_item_instance: location_id, location_kind
- world_slumber_log: awake_characters, state
