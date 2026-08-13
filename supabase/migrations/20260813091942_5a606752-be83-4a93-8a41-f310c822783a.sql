REVOKE ALL ON FUNCTION public.encounter_snapshot_v2(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_encounter_tick(uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_encounter_tick_batches(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.encounter_state_digest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.encounter_death_id(uuid, uuid, integer, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.encounter_snapshot_v2(uuid, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_encounter_tick(uuid, bigint, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_encounter_tick_batches(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.encounter_state_digest(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.encounter_death_id(uuid, uuid, integer, bigint) TO service_role;