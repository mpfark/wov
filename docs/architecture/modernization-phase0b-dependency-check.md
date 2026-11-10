# Phase 0b — Legacy dependency check (2026-11-10)

Read-only check of the 123 remove/merge items: references from all public SQL function bodies, cron jobs, frontend and Edge source (tests/types excluded), with transitive closure.

## Unreachable — marked DEPRECATED (migration 0032, comments only, nothing dropped): 23
- `combat2_dispatch_scheduler_fire_without_heartbeat_identity`
- `combat2_due_nodes_without_canary_gate`
- `combat2_test_node_visible`
- `combat2_test_region_visible`
- `combat2_test_relocate`
- `combat2_test_session_access`
- `effects_catchup_credential_health`
- `effects_catchup_dispatch_one`
- `encounter_apply_character_damage`
- `encounter_apply_character_heal`
- `encounter_apply_character_resource`
- `encounter_apply_heal`
- `encounter_boss_fizzle_cast`
- `encounter_boss_resolve_cast`
- `encounter_boss_start_cast`
- `encounter_detach_creature`
- `encounter_disengage`
- `encounter_engage`
- `encounter_reconcile`
- `encounter_stored_power_add`
- `encounter_stored_power_consume`
- `encounter_stored_power_set_cap`
- `encounter_visible_to_caller`
## Still reachable — keep until the new engine replaces them
- All 28 remove/merge tables are referenced by live SQL functions or hold rows (e.g. combat_actions, combat_sessions, combat_config, combat2_test_arena_node).
- 72 remaining functions are called by live SQL (wrapper chains under combat2_depart, combat2_sync, combat2_respawn, combat_intent, node_tick_*, effects_due_dispatch) or by app code (combat2-test-arena admin tools, flee, legacy c3 orchestration).

Removal of anything here requires the new engine to be live first and a separate drop approval.
