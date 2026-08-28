-- Legacy cleanup L1: privilege-only revocation of retired combat mutators.
-- Bodies are retained for one release. Rollback SQL is documented at the end
-- (NOT applied).
--
-- Idempotent: REVOKE/GRANT are naturally idempotent.

-- ── creature / character state mutators ────────────────────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_heal(uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_heal(uuid, integer, uuid, text) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_heal(uuid, integer, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_apply_heal(uuid, integer, uuid, text) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_damage(uuid, integer, text, uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_damage(uuid, integer, text, uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_damage(uuid, integer, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_damage(uuid, integer, text, uuid) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_heal(uuid, integer, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_heal(uuid, integer, text) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_heal(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_heal(uuid, integer, text) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_resource(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_resource(uuid, text, integer, text) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_apply_character_resource(uuid, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_apply_character_resource(uuid, text, integer, text) TO service_role;

-- ── stored power ──────────────────────────────────────────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_add(uuid, integer, text, uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_add(uuid, integer, text, uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_add(uuid, integer, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_stored_power_add(uuid, integer, text, uuid) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_consume(uuid, text, numeric, integer) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_consume(uuid, text, numeric, integer) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_consume(uuid, text, numeric, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_stored_power_consume(uuid, text, numeric, integer) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_set_cap(uuid, integer) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_set_cap(uuid, integer) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_stored_power_set_cap(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_stored_power_set_cap(uuid, integer) TO service_role;

-- ── retired boss-cast trio (authoritative resolver owns the lifecycle) ─
-- No service_role grant: the current commit path never calls these.
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_start_cast(uuid, uuid, uuid, text, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_start_cast(uuid, uuid, uuid, text, text, integer, jsonb) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_start_cast(uuid, uuid, uuid, text, text, integer, jsonb) FROM authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_resolve_cast(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_resolve_cast(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_resolve_cast(uuid) FROM authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_fizzle_cast(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_fizzle_cast(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.encounter_boss_fizzle_cast(uuid) FROM authenticated;

-- ── party reward / durability mutators (both overloads) ────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.award_party_member(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.award_party_member(uuid, integer, integer) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.award_party_member(uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_party_member(uuid, integer, integer) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.award_party_member(uuid, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.award_party_member(uuid, integer, integer, integer, integer) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.award_party_member(uuid, integer, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_party_member(uuid, integer, integer, integer, integer) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.degrade_party_member_equipment(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.degrade_party_member_equipment(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.degrade_party_member_equipment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.degrade_party_member_equipment(uuid) TO service_role;

-- ── direct party HP setter (superseded by authoritative HP authority) ──
-- No service_role grant: nothing server-side calls it.
REVOKE ALL PRIVILEGES ON FUNCTION public.update_party_member_hp(uuid, integer) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_party_member_hp(uuid, integer) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_party_member_hp(uuid, integer) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (documented, NOT applied):
--   GRANT EXECUTE ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_apply_heal(uuid, integer, uuid, text) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_apply_character_damage(uuid, integer, text, uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_apply_character_heal(uuid, integer, text) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_apply_character_resource(uuid, text, integer, text) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_stored_power_add(uuid, integer, text, uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_stored_power_consume(uuid, text, numeric, integer) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_stored_power_set_cap(uuid, integer) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_boss_start_cast(uuid, uuid, uuid, text, text, integer, jsonb) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_boss_resolve_cast(uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.encounter_boss_fizzle_cast(uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.award_party_member(uuid, integer, integer) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.award_party_member(uuid, integer, integer, integer, integer) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.degrade_party_member_equipment(uuid) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.update_party_member_hp(uuid, integer) TO authenticated;
--   (PUBLIC grants deliberately NOT restored.)
