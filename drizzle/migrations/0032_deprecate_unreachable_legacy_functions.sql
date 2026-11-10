DO $dep$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
           WHERE s.nspname='public' AND p.proname = ANY (ARRAY['combat2_dispatch_scheduler_fire_without_heartbeat_identity','combat2_due_nodes_without_canary_gate','combat2_test_node_visible','combat2_test_region_visible','combat2_test_relocate','combat2_test_session_access','effects_catchup_credential_health','effects_catchup_dispatch_one','encounter_apply_character_damage','encounter_apply_character_heal','encounter_apply_character_resource','encounter_apply_heal','encounter_boss_fizzle_cast','encounter_boss_resolve_cast','encounter_boss_start_cast','encounter_detach_creature','encounter_disengage','encounter_engage','encounter_reconcile','encounter_stored_power_add','encounter_stored_power_consume','encounter_stored_power_set_cap','encounter_visible_to_caller'])
  LOOP
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', r.sig, 'DEPRECATED (modernization 2026-11-10): unreachable from live SQL, cron, frontend and Edge code; retained until the new engine replaces Combat2, then removed with separate approval.');
  END LOOP;
END
$dep$;