# Modernization Phase 0 — Inventory (draft for review)

Generated 2026-11-09 from repository types and source references (`src/`, `supabase/functions/`). Database-only callers (triggers, other SQL functions, cron) are NOT counted, so `review` items need a catalog dependency check before any removal. Tags are proposals; nothing is changed.

Tags: `keep` · `remove/merge` (C1/legacy/wrapper/catch-up family) · `merge->command_inbox` (per-action request/receipt) · `review` (no app references).

| Kind | Name | App refs | Proposed |
|---|---|---|---|
| function | `ability_config_version` | 3 | keep |
| function | `accept_party_invite` | 3 | keep |
| function | `accept_summon` | 2 | keep |
| function | `activate_cheat_xp_boost` | 1 | keep |
| function | `activate_stance` | 5 | keep |
| function | `add_material` | 2 | keep |
| function | `admin_area_type_rename` | 2 | keep |
| function | `admin_cancel_listing` | 1 | keep |
| function | `admin_create_adjacent_node` | 2 | keep |
| function | `admin_create_region_with_initial_node` | 2 | keep |
| function | `admin_creature_mutate` | 1 | keep |
| function | `admin_material_grant` | 2 | keep |
| function | `admin_mutate_loot_table` | 2 | keep |
| function | `admin_mutate_nodes_batch` | 2 | keep |
| function | `admin_mutate_reciprocal_node_connection` | 2 | keep |
| function | `admin_respec_award` | 2 | keep |
| function | `admin_teleport` | 2 | keep |
| function | `apply_force_shield_regen` | 4 | keep |
| function | `area_type_placeholder_url` | 1 | keep |
| function | `arm_effects_catchup_for_node` | 1 | keep |
| function | `assassin_abandon_contract` | 2 | keep |
| function | `assassin_take_contract` | 1 | keep |
| function | `award_class_bond_for_kill` | 2 | keep |
| function | `award_party_member` | 1 | keep |
| function | `base_craft_internal` | 1 | keep |
| function | `buy_unique_listing` | 1 | keep |
| function | `buy_vendor_item` | 2 | keep |
| function | `change_family_at_heraldry` | 1 | keep |
| function | `character_create` | 1 | keep |
| function | `character_create_c2` | 2 | keep |
| function | `character_creation_capacity` | 2 | keep |
| function | `character_inventory_action` | 3 | keep |
| function | `character_lifecycle_command` | 4 | keep |
| function | `character_repair` | 3 | keep |
| function | `character_special_travel` | 4 | keep |
| function | `character_waymark_state` | 1 | keep |
| function | `check_family_name` | 1 | keep |
| function | `claim_encounter_tick` | 10 | keep |
| function | `cleanup_ground_loot` | 2 | keep |
| function | `clear_stances` | 3 | keep |
| function | `collect_marketplace_payouts` | 1 | keep |
| function | `combat2_arrive_after_relocation` | 1 | keep |
| function | `combat2_change_stance` | 4 | keep |
| function | `combat2_character_stances` | 3 | keep |
| function | `combat2_delivery_authorized` | 1 | keep |
| function | `combat2_delivery_visible` | 1 | keep |
| function | `combat2_depart` | 12 | keep |
| function | `combat2_departure_state` | 5 | keep |
| function | `combat2_diagnostic_export` | 1 | keep |
| function | `combat2_diagnostic_record_server_event` | 1 | keep |
| function | `combat2_diagnostic_record_server_event_with_heartbeat` | 1 | keep |
| function | `combat2_diagnostic_record_server_events` | 3 | keep |
| function | `combat2_diagnostic_sessions_for_candidates` | 2 | keep |
| function | `combat2_diagnostic_start` | 3 | keep |
| function | `combat2_diagnostic_stop` | 3 | keep |
| function | `combat2_dispatch_scheduler_disable` | 6 | keep |
| function | `combat2_dispatch_scheduler_eligible` | 2 | keep |
| function | `combat2_dispatch_scheduler_enable` | 6 | keep |
| function | `combat2_dispatch_scheduler_fire` | 6 | keep |
| function | `combat2_due_nodes` | 7 | keep |
| function | `combat2_engage` | 4 | keep |
| function | `combat2_finish_immediate_departure` | 1 | keep |
| function | `combat2_finish_immediate_party_departure` | 1 | keep |
| function | `combat2_heartbeat_record_dispatch` | 3 | keep |
| function | `combat2_hostile_action` | 6 | keep |
| function | `combat2_movement_scope_eligible` | 2 | keep |
| function | `combat2_node_runtime_eligible` | 3 | keep |
| function | `combat2_party_depart` | 10 | keep |
| function | `combat2_party_departure_state` | 1 | keep |
| function | `combat2_party_preflight` | 4 | keep |
| function | `combat2_presence_heartbeat` | 2 | keep |
| function | `combat2_provision_worker_secret` | 1 | keep |
| function | `combat2_refresh_tanks` | 2 | keep |
| function | `combat2_regenerate_force_shields` | 2 | keep |
| function | `combat2_respawn` | 6 | keep |
| function | `combat2_restore_arena_stances` | 2 | keep |
| function | `combat2_seed_spawns` | 2 | keep |
| function | `combat2_session_access` | 3 | keep |
| function | `combat2_special_transition_conflict` | 1 | keep |
| function | `combat2_stance_reserved_cp` | 1 | keep |
| function | `combat2_sync` | 10 | keep |
| function | `commit_encounter_tick_v2` | 14 | keep |
| function | `commit_encounter_tick_v3` | 4 | keep |
| function | `consume_maps_for_node` | 1 | keep |
| function | `consume_material` | 2 | keep |
| function | `creature_hp_cover` | 1 | keep |
| function | `damage_party_member` | 3 | keep |
| function | `decline_summon` | 1 | keep |
| function | `drop_item_to_ground` | 1 | keep |
| function | `drop_stance` | 4 | keep |
| function | `effects_due_dispatch` | 2 | keep |
| function | `effects_scope_grant_check` | 1 | keep |
| function | `effects_scope_revalidate` | 1 | keep |
| function | `expire_marketplace_listings` | 2 | keep |
| function | `find_character_id_by_name` | 1 | keep |
| function | `forge_soulring` | 1 | keep |
| function | `gem_application_internal` | 1 | keep |
| function | `get_character_name` | 2 | keep |
| function | `get_my_admin_role` | 1 | keep |
| function | `get_order_roster` | 1 | keep |
| function | `get_renown_leaderboard` | 1 | keep |
| function | `get_renown_rank` | 1 | keep |
| function | `grant_npc_gift` | 2 | keep |
| function | `grant_searched_item` | 1 | keep |
| function | `has_role` | 1 | keep |
| function | `heal_party_member` | 5 | keep |
| function | `hidden_connection_is_open` | 1 | keep |
| function | `hidden_path_openings` | 2 | keep |
| function | `hidden_path_search` | 3 | keep |
| function | `idle_shutdown_check` | 2 | keep |
| function | `inspect_character_equipment` | 1 | keep |
| function | `is_party_member` | 1 | keep |
| function | `is_steward_or_overlord` | 8 | keep |
| function | `join_encounter_engagement` | 4 | keep |
| function | `leave_encounter_engagements` | 1 | keep |
| function | `leave_family` | 1 | keep |
| function | `list_unique_item` | 1 | keep |
| function | `material_sale_internal` | 1 | keep |
| function | `move_follower` | 2 | keep |
| function | `node_creature_roster` | 3 | keep |
| function | `node_tick_claim` | 19 | keep |
| function | `node_tick_commit` | 16 | keep |
| function | `owns_character` | 8 | keep |
| function | `party_can_view` | 1 | keep |
| function | `party_combat_mutation_blocked` | 3 | keep |
| function | `party_mutate` | 5 | keep |
| function | `party_operation_finish` | 1 | keep |
| function | `party_state` | 3 | keep |
| function | `pickup_ground_loot` | 1 | keep |
| function | `player_world_nodes` | 2 | keep |
| function | `progression_command` | 1 | keep |
| function | `progression_command_projection` | 3 | keep |
| function | `record_effects_catchup_result` | 1 | keep |
| function | `record_world_state` | 1 | keep |
| function | `release_encounter_tick` | 4 | keep |
| function | `request_family_membership` | 1 | keep |
| function | `respawn_creatures` | 1 | keep |
| function | `return_unique_items` | 2 | keep |
| function | `revoke_family_membership` | 1 | keep |
| function | `schedule_effects_catchup` | 1 | keep |
| function | `schedule_tick_creatures` | 1 | keep |
| function | `sell_item` | 1 | keep |
| function | `set_ability_loadout` | 1 | keep |
| function | `set_assignment_default` | 1 | keep |
| function | `set_character_combat_trace` | 1 | keep |
| function | `set_party_tank` | 4 | keep |
| function | `settle_out_of_combat_resources` | 4 | keep |
| function | `shutdown_world` | 6 | keep |
| function | `simulation_pause_boundary` | 2 | keep |
| function | `status_config_problems` | 1 | keep |
| function | `submit_combat_action` | 4 | keep |
| function | `sync_character_resources` | 14 | keep |
| function | `tick_creatures` | 1 | keep |
| function | `unschedule_tick_creatures` | 1 | keep |
| function | `world_watchdog` | 2 | keep |
| table | `abilities` | 141 | keep |
| table | `active_effects` | 35 | keep |
| table | `ai_credit_drain_item_log` | 1 | keep |
| table | `ai_credit_drain_log` | 2 | keep |
| table | `app_secrets` | 2 | keep |
| table | `applied_statuses` | 19 | keep |
| table | `area_types` | 4 | keep |
| table | `areas` | 35 | keep |
| table | `base_abilities` | 19 | keep |
| table | `boss_ability` | 3 | keep |
| table | `character_ability_loadout` | 4 | keep |
| table | `character_class_bonds` | 5 | keep |
| table | `character_guide_reads` | 1 | keep |
| table | `character_inventory` | 24 | keep |
| table | `character_materials` | 7 | keep |
| table | `character_stance` | 2 | keep |
| table | `character_visited_nodes` | 6 | keep |
| table | `character_waymark` | 1 | keep |
| table | `characters` | 147 | keep |
| table | `class_ability_assignments` | 34 | keep |
| table | `class_ability_roles` | 11 | keep |
| table | `classes` | 67 | keep |
| table | `combat2_canary_node` | 2 | keep |
| table | `combat2_diagnostic_server_event` | 1 | keep |
| table | `combat2_dispatch_schedule_state` | 1 | keep |
| table | `combat2_party_departure_member` | 3 | keep |
| table | `combat2_player_presence` | 1 | keep |
| table | `combat2_respawn_config` | 1 | keep |
| table | `combat2_tick_notification` | 5 | keep |
| table | `creatures` | 177 | keep |
| table | `encounters` | 14 | keep |
| table | `families` | 3 | keep |
| table | `family_members` | 1 | keep |
| table | `family_requests` | 1 | keep |
| table | `guide_categories` | 2 | keep |
| table | `guide_entries` | 2 | keep |
| table | `hidden_connection_opening` | 1 | keep |
| table | `issue_reports` | 4 | keep |
| table | `items` | 204 | keep |
| table | `loot_pool_config` | 3 | keep |
| table | `loot_table_entries` | 23 | keep |
| table | `loot_tables` | 7 | keep |
| table | `marketplace_listings` | 5 | keep |
| table | `materials` | 23 | keep |
| table | `node_arrival_group` | 3 | keep |
| table | `node_boss_ability_cooldown` | 1 | keep |
| table | `node_creature` | 6 | keep |
| table | `node_death_loot` | 1 | keep |
| table | `node_effect` | 10 | keep |
| table | `node_encounter` | 21 | keep |
| table | `node_fighter` | 8 | keep |
| table | `node_ground_loot` | 10 | keep |
| table | `node_intent` | 9 | keep |
| table | `node_participation` | 7 | keep |
| table | `node_pending_event` | 5 | keep |
| table | `node_reward_claim` | 5 | keep |
| table | `node_tick_batch` | 4 | keep |
| table | `node_tick_log` | 2 | keep |
| table | `nodes` | 68 | keep |
| table | `npcs` | 15 | keep |
| table | `parties` | 15 | keep |
| table | `party_combat_log` | 3 | keep |
| table | `party_members` | 7 | keep |
| table | `profiles` | 9 | keep |
| table | `races` | 12 | keep |
| table | `regions` | 37 | keep |
| table | `roadmap_items` | 2 | keep |
| table | `summon_requests` | 3 | keep |
| table | `unique_item_instance` | 1 | keep |
| table | `user_roles` | 7 | keep |
| table | `vendor_inventory` | 4 | keep |
| table | `weapon_progression_config` | 4 | keep |
| table | `world_heartbeat_run` | 1 | keep |
| table | `world_state` | 9 | keep |
| table | `xp_boost` | 5 | keep |
| function | `cancel_family_request` | 1 | merge->command_inbox |
| function | `character_creation_expire_receipts_internal` | 0 | merge->command_inbox |
| function | `character_lifecycle_expire_receipts_internal` | 0 | merge->command_inbox |
| function | `character_receipt_maintenance_internal` | 0 | merge->command_inbox |
| function | `resolve_family_request` | 1 | merge->command_inbox |
| table | `admin_adjacent_node_request` | 1 | merge->command_inbox |
| table | `admin_area_type_rename_request` | 0 | merge->command_inbox |
| table | `admin_batch_node_request` | 0 | merge->command_inbox |
| table | `admin_loot_table_request` | 1 | merge->command_inbox |
| table | `admin_material_grant_replay` | 0 | merge->command_inbox |
| table | `admin_node_connection_request` | 1 | merge->command_inbox |
| table | `admin_region_creation_request` | 1 | merge->command_inbox |
| table | `character_inventory_action_request` | 1 | merge->command_inbox |
| table | `character_lifecycle_receipt` | 0 | merge->command_inbox |
| table | `character_special_travel_request` | 1 | merge->command_inbox |
| table | `character_stance_request` | 1 | merge->command_inbox |
| table | `combat2_departure_request` | 7 | merge->command_inbox |
| table | `combat2_party_departure_request` | 2 | merge->command_inbox |
| table | `combat2_respawn_request` | 1 | merge->command_inbox |
| table | `hidden_path_search_request` | 1 | merge->command_inbox |
| table | `party_operation_request` | 1 | merge->command_inbox |
| table | `progression_receipt` | 0 | merge->command_inbox |
| function | `combat2_depart_without_canary_gate` | 1 | remove/merge |
| function | `combat2_depart_without_immediate_transition` | 1 | remove/merge |
| function | `combat2_dispatch_scheduler_fire_without_heartbeat_identity` | 0 | remove/merge |
| function | `combat2_dispatch_scheduler_fire_without_resource_settlement` | 2 | remove/merge |
| function | `combat2_due_nodes_without_canary_gate` | 2 | remove/merge |
| function | `combat2_party_depart_without_canary_gate` | 1 | remove/merge |
| function | `combat2_party_depart_without_immediate_transition` | 1 | remove/merge |
| function | `combat2_respawn_without_canary_gate` | 1 | remove/merge |
| function | `combat2_sync_without_allies` | 1 | remove/merge |
| function | `combat2_sync_without_autoattack` | 0 | remove/merge |
| function | `combat2_sync_without_dynamic_boss_casts` | 0 | remove/merge |
| function | `combat2_test_admin_allowed` | 4 | remove/merge |
| function | `combat2_test_admin_relocate` | 3 | remove/merge |
| function | `combat2_test_arena_access_allowed` | 4 | remove/merge |
| function | `combat2_test_emergency_shutdown` | 2 | remove/merge |
| function | `combat2_test_environment_close` | 5 | remove/merge |
| function | `combat2_test_environment_start` | 6 | remove/merge |
| function | `combat2_test_finalize_pending_events` | 1 | remove/merge |
| function | `combat2_test_grant` | 4 | remove/merge |
| function | `combat2_test_node_visible` | 1 | remove/merge |
| function | `combat2_test_presence_heartbeat` | 3 | remove/merge |
| function | `combat2_test_region_visible` | 1 | remove/merge |
| function | `combat2_test_relocate` | 1 | remove/merge |
| function | `combat2_test_reset` | 9 | remove/merge |
| function | `combat2_test_reset_without_character_stances` | 1 | remove/merge |
| function | `combat2_test_reset_without_presence_gate` | 0 | remove/merge |
| function | `combat2_test_revoke` | 3 | remove/merge |
| function | `combat2_test_run_report` | 3 | remove/merge |
| function | `combat2_test_run_start` | 4 | remove/merge |
| function | `combat2_test_run_stop` | 5 | remove/merge |
| function | `combat2_test_runtime_status` | 3 | remove/merge |
| function | `combat2_test_safe_event` | 1 | remove/merge |
| function | `combat2_test_session_access` | 1 | remove/merge |
| function | `combat2_test_status` | 3 | remove/merge |
| function | `combat2_test_stop` | 8 | remove/merge |
| function | `combat2_test_stop_without_character_stances` | 1 | remove/merge |
| function | `combat2_test_stop_without_event_finalization` | 1 | remove/merge |
| function | `combat_enter` | 15 | remove/merge |
| function | `combat_enter_without_canary_gate` | 1 | remove/merge |
| function | `combat_enter_without_engagement_gate` | 2 | remove/merge |
| function | `combat_flee` | 9 | remove/merge |
| function | `combat_intent` | 10 | remove/merge |
| function | `combat_intent_without_ability_support_gate` | 3 | remove/merge |
| function | `combat_intent_without_basic_attack` | 0 | remove/merge |
| function | `combat_intent_without_character_stances` | 1 | remove/merge |
| function | `combat_intent_without_global_lock_order` | 0 | remove/merge |
| function | `combat_intent_without_spendable_cp_preflight` | 1 | remove/merge |
| function | `combat_mode_is_open` | 3 | remove/merge |
| function | `combat_soak_access_check` | 5 | remove/merge |
| function | `effects_catchup_credential_health` | 1 | remove/merge |
| function | `effects_catchup_dispatch_one` | 1 | remove/merge |
| function | `effects_catchup_reconcile` | 2 | remove/merge |
| function | `effects_catchup_send` | 2 | remove/merge |
| function | `encounter_apply_character_damage` | 1 | remove/merge |
| function | `encounter_apply_character_heal` | 1 | remove/merge |
| function | `encounter_apply_character_resource` | 1 | remove/merge |
| function | `encounter_apply_damage` | 2 | remove/merge |
| function | `encounter_apply_heal` | 1 | remove/merge |
| function | `encounter_attribution_roster` | 3 | remove/merge |
| function | `encounter_boss_fizzle_cast` | 0 | remove/merge |
| function | `encounter_boss_resolve_cast` | 0 | remove/merge |
| function | `encounter_boss_start_cast` | 0 | remove/merge |
| function | `encounter_death_id` | 3 | remove/merge |
| function | `encounter_detach_creature` | 0 | remove/merge |
| function | `encounter_disengage` | 0 | remove/merge |
| function | `encounter_end` | 2 | remove/merge |
| function | `encounter_end_participation` | 1 | remove/merge |
| function | `encounter_engage` | 1 | remove/merge |
| function | `encounter_ensure_for_character` | 0 | remove/merge |
| function | `encounter_ensure_for_creature` | 0 | remove/merge |
| function | `encounter_for_node` | 5 | remove/merge |
| function | `encounter_has_pending_work` | 1 | remove/merge |
| function | `encounter_intake` | 9 | remove/merge |
| function | `encounter_live_owner_active` | 0 | remove/merge |
| function | `encounter_lock_key` | 2 | remove/merge |
| function | `encounter_reconcile` | 0 | remove/merge |
| function | `encounter_resync_snapshot` | 2 | remove/merge |
| function | `encounter_snapshot_v2` | 9 | remove/merge |
| function | `encounter_state_digest` | 0 | remove/merge |
| function | `encounter_stored_power_add` | 1 | remove/merge |
| function | `encounter_stored_power_consume` | 1 | remove/merge |
| function | `encounter_stored_power_set_cap` | 0 | remove/merge |
| function | `encounter_visible_to_caller` | 0 | remove/merge |
| function | `heal_creatures_on_wake` | 0 | remove/merge |
| function | `node_tick_claim_without_boss_timing` | 2 | remove/merge |
| function | `node_tick_claim_without_canary_gate` | 4 | remove/merge |
| function | `node_tick_claim_without_character_stances` | 1 | remove/merge |
| function | `node_tick_commit_without_authoritative_arrival` | 1 | remove/merge |
| function | `node_tick_commit_without_boss_timing` | 1 | remove/merge |
| function | `node_tick_commit_without_bounded_failure` | 2 | remove/merge |
| function | `node_tick_commit_without_character_stances` | 2 | remove/merge |
| function | `settle_out_of_combat_resources_without_character_stances` | 1 | remove/merge |
| function | `wake_world` | 9 | remove/merge |
| function | `world_is_awake` | 2 | remove/merge |
| function | `world_state_is_awake` | 3 | remove/merge |
| table | `combat2_test_arena` | 3 | remove/merge |
| table | `combat2_test_arena_access` | 3 | remove/merge |
| table | `combat2_test_arena_creature` | 1 | remove/merge |
| table | `combat2_test_arena_node` | 5 | remove/merge |
| table | `combat2_test_arena_request` | 1 | remove/merge |
| table | `combat2_test_arena_stance_snapshot` | 1 | remove/merge |
| table | `combat2_test_arena_stance_snapshot_header` | 0 | remove/merge |
| table | `combat2_test_presence` | 1 | remove/merge |
| table | `combat2_test_run` | 4 | remove/merge |
| table | `combat2_test_run_batch` | 1 | remove/merge |
| table | `combat2_test_run_event` | 1 | remove/merge |
| table | `combat_actions` | 9 | remove/merge |
| table | `combat_audit_log` | 1 | remove/merge |
| table | `combat_config` | 9 | remove/merge |
| table | `combat_sessions` | 5 | remove/merge |
| table | `combat_soak_access` | 0 | remove/merge |
| table | `combat_soak_scopes` | 0 | remove/merge |
| table | `effects_catchup_dispatch` | 0 | remove/merge |
| table | `effects_catchup_log` | 0 | remove/merge |
| table | `encounter_access_grants` | 1 | remove/merge |
| table | `encounter_cast_events` | 4 | remove/merge |
| table | `encounter_creatures` | 0 | remove/merge |
| table | `encounter_death_loot` | 2 | remove/merge |
| table | `encounter_engagements` | 2 | remove/merge |
| table | `encounter_kill_awards` | 2 | remove/merge |
| table | `encounter_participants` | 5 | remove/merge |
| table | `encounter_tick_batches` | 7 | remove/merge |
| table | `world_slumber_log` | 1 | remove/merge |
| function | `_family_name_is_reserved` | 0 | review (no app callers) |
| function | `ability_damage_type_keys` | 0 | review (no app callers) |
| function | `ability_damaging_mechanics` | 0 | review (no app callers) |
| function | `ability_key_is_stance` | 0 | review (no app callers) |
| function | `ability_mechanic_params` | 0 | review (no app callers) |
| function | `ability_roll_based_mechanics` | 0 | review (no app callers) |
| function | `admin_material_grant_log_expire_internal` | 0 | review (no app callers) |
| function | `admin_respec_award_internal` | 0 | review (no app callers) |
| function | `admin_respec_award_log_expire_internal` | 0 | review (no app callers) |
| function | `apply_contract_complete` | 0 | review (no app callers) |
| function | `apply_crafting_xp` | 0 | review (no app callers) |
| function | `apply_family_to_character` | 0 | review (no app callers) |
| function | `assert_loadout_swap_allowed` | 0 | review (no app callers) |
| function | `award_class_bond` | 0 | review (no app callers) |
| function | `cancel_combat_action` | 0 | review (no app callers) |
| function | `cancel_unique_listing` | 0 | review (no app callers) |
| function | `catchup_scope_check` | 0 | review (no app callers) |
| function | `character_can_use_ability` | 0 | review (no app callers) |
| function | `character_create_c2_internal` | 0 | review (no app callers) |
| function | `character_lifecycle_purge_internal` | 0 | review (no app callers) |
| function | `character_lifecycle_quiescent_internal` | 0 | review (no app callers) |
| function | `character_purge_preflight_internal` | 0 | review (no app callers) |
| function | `character_sync_derived_internal` | 0 | review (no app callers) |
| function | `clear_ability_loadout` | 0 | review (no app callers) |
| function | `combat2_apply_claim_progression_internal` | 0 | review (no app callers) |
| function | `combat2_party_departure_result` | 0 | review (no app callers) |
| function | `creature_admin_boss_valid` | 0 | review (no app callers) |
| function | `creature_admin_cover` | 0 | review (no app callers) |
| function | `creature_admin_referenced` | 0 | review (no app callers) |
| function | `creature_hp_account` | 0 | review (no app callers) |
| function | `creature_hp_discover` | 0 | review (no app callers) |
| function | `creature_hp_maintain` | 0 | review (no app callers) |
| function | `creature_regen_blocked` | 0 | review (no app callers) |
| function | `creature_regen_settle` | 0 | review (no app callers) |
| function | `crown_king_slayer` | 0 | review (no app callers) |
| function | `degrade_party_member_equipment` | 0 | review (no app callers) |
| function | `delete_character_cascade` | 0 | review (no app callers) |
| function | `effects_dispatch_token_check` | 0 | review (no app callers) |
| function | `effects_due_scopes` | 0 | review (no app callers) |
| function | `effects_transport_snapshot` | 0 | review (no app callers) |
| function | `expire_king_slayer` | 0 | review (no app callers) |
| function | `final_maintenance_sweep` | 0 | review (no app callers) |
| function | `get_app_secret` | 0 | review (no app callers) |
| function | `guarded_cleanup_ground_loot` | 0 | review (no app callers) |
| function | `guarded_expire_king_slayer` | 0 | review (no app callers) |
| function | `guarded_expire_marketplace_listings` | 0 | review (no app callers) |
| function | `guarded_expire_timed_state` | 0 | review (no app callers) |
| function | `guarded_prune_combat_audit_log` | 0 | review (no app callers) |
| function | `guarded_prune_effects_catchup_log` | 0 | review (no app callers) |
| function | `guarded_prune_encounter_access_grants` | 0 | review (no app callers) |
| function | `guarded_prune_encounter_tick_batches` | 0 | review (no app callers) |
| function | `guarded_prune_terminal_combat_actions` | 0 | review (no app callers) |
| function | `guarded_return_unique_items` | 0 | review (no app callers) |
| function | `guarded_sweep_stranded_encounters` | 0 | review (no app callers) |
| function | `harness_cron_snapshot` | 0 | review (no app callers) |
| function | `harness_fail_closed` | 0 | review (no app callers) |
| function | `harness_teardown` | 0 | review (no app callers) |
| function | `is_overlord` | 0 | review (no app callers) |
| function | `is_party_mate` | 0 | review (no app callers) |
| function | `join_order` | 0 | review (no app callers) |
| function | `node_encounter_bump_version` | 0 | review (no app callers) |
| function | `node_pending_event_record` | 0 | review (no app callers) |
| function | `progression_apply_f_internal` | 0 | review (no app callers) |
| function | `progression_apply_permanent_delta_internal` | 0 | review (no app callers) |
| function | `progression_apply_xp_internal` | 0 | review (no app callers) |
| function | `progression_class_config_internal` | 0 | review (no app callers) |
| function | `progression_command_projection_internal` | 0 | review (no app callers) |
| function | `progression_renown_draw_internal` | 0 | review (no app callers) |
| function | `progression_snapshot_internal` | 0 | review (no app callers) |
| function | `progression_validate_fresh_internal` | 0 | review (no app callers) |
| function | `prune_combat_audit_log` | 0 | review (no app callers) |
| function | `prune_cron_history` | 0 | review (no app callers) |
| function | `prune_effects_catchup_log` | 0 | review (no app callers) |
| function | `prune_encounter_access_grants` | 0 | review (no app callers) |
| function | `prune_encounter_tick_batches` | 0 | review (no app callers) |
| function | `prune_ended_encounters` | 0 | review (no app callers) |
| function | `prune_terminal_combat_actions` | 0 | review (no app callers) |
| function | `purge_creature_engagements` | 0 | review (no app callers) |
| function | `redact_transport_text` | 0 | review (no app callers) |
| function | `regen_creature_hp` | 0 | review (no app callers) |
| function | `renew_encounter_tick_lease` | 0 | review (no app callers) |
| function | `sim_note_progress` | 0 | review (no app callers) |
| function | `sim_note_resume` | 0 | review (no app callers) |
| function | `sim_note_suspend` | 0 | review (no app callers) |
| function | `stonebinder_commit_fuse` | 0 | review (no app callers) |
| function | `sweep_stranded_encounters` | 0 | review (no app callers) |
| function | `switch_order` | 0 | review (no app callers) |
| function | `train_renown_stat` | 0 | review (no app callers) |
| function | `try_acquire_unique_item` | 0 | review (no app callers) |
| function | `unschedule_effects_catchup` | 0 | review (no app callers) |
| function | `update_party_member_hp` | 0 | review (no app callers) |
| function | `validate_ability_calc` | 0 | review (no app callers) |
| function | `waymark_live_session` | 0 | review (no app callers) |
| table | `admin_material_grant_log` | 0 | review (no app callers) |
| table | `admin_respec_award_log` | 0 | review (no app callers) |
| table | `appearance_entries` | 0 | review (no app callers) |
| table | `character_creation_log` | 0 | review (no app callers) |
| table | `character_creation_origin` | 0 | review (no app callers) |
| table | `character_npc_gifts` | 0 | review (no app callers) |
| table | `character_resource_settlement_state` | 0 | review (no app callers) |
| table | `combat2_diagnostic_session` | 0 | review (no app callers) |
| table | `email_send_log` | 0 | review (no app callers) |
| table | `email_send_state` | 0 | review (no app callers) |
| table | `email_unsubscribe_tokens` | 0 | review (no app callers) |
| table | `harness_run_registry` | 0 | review (no app callers) |
| table | `progression_character_state` | 0 | review (no app callers) |
| table | `progression_class_growth_milestone` | 0 | review (no app callers) |
| table | `progression_command_control` | 0 | review (no app callers) |
| table | `progression_renown_key` | 0 | review (no app callers) |
| table | `progression_respec_milestone` | 0 | review (no app callers) |
| table | `simulation_pause_state` | 0 | review (no app callers) |
| table | `suppressed_emails` | 0 | review (no app callers) |
