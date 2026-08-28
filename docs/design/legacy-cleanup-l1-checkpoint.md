# Legacy cleanup L1 — retired combat mutators (privilege revocation)

Applied: 2026-08-28. Privilege-only migration. No function body was modified,
no function was dropped, no table, policy, data or configuration changed.

## Revoked from PUBLIC, anon and authenticated (bodies retained)

| Signature | service_role retained |
| --- | --- |
| `encounter_apply_damage(uuid,integer,uuid,text)` | yes |
| `encounter_apply_heal(uuid,integer,uuid,text)` | yes |
| `encounter_apply_character_damage(uuid,integer,text,uuid)` | yes |
| `encounter_apply_character_heal(uuid,integer,text)` | yes |
| `encounter_apply_character_resource(uuid,text,integer,text)` | yes |
| `encounter_stored_power_add(uuid,integer,text,uuid)` | yes |
| `encounter_stored_power_consume(uuid,text,numeric,integer)` | yes |
| `encounter_stored_power_set_cap(uuid,integer)` | yes |
| `encounter_boss_start_cast(uuid,uuid,uuid,text,text,integer,jsonb)` | pre-existing only, no new grant |
| `encounter_boss_resolve_cast(uuid)` | pre-existing only, no new grant |
| `encounter_boss_fizzle_cast(uuid)` | pre-existing only, no new grant |
| `award_party_member(uuid,integer,integer)` | yes |
| `award_party_member(uuid,integer,integer,integer,integer)` | yes |
| `degrade_party_member_equipment(uuid)` | yes |
| `update_party_member_hp(uuid,integer)` | pre-existing only, no new grant |

Deliberately untouched (live, non-combat or out-of-combat authority):
`damage_party_member`, `heal_party_member` (both overloads),
`grant_searched_item`, `respawn_creatures`, `apply_force_shield_regen`,
stance RPCs, movement/vendor/marketplace RPCs, and the authoritative path
(`encounter_snapshot_v2`, `encounter_state_digest`, `commit_encounter_tick_v2/v3`,
`catchup_scope_check`) which stays service-role-only.

## Follow-up checkpoint (do NOT auto-schedule)

1. Retain all fifteen bodies for one full release / observation interval.
2. Watch for `42501 permission denied for function <name>` naming any row above.
3. If no legitimate production dependency appears, a separate **L6** drop
   migration may then be considered as its own decision. L6 is not scheduled.

## Documented rollback (not applied)

`GRANT EXECUTE ON FUNCTION <exact signature> TO authenticated;` (and `anon`
where it previously held the grant). PUBLIC grants are deliberately not
restored under any rollback.

## Open authority gaps (separate phases, not fixed here)

- `characters` UPDATE policy lets a player update their own row directly,
  including combat-authoritative columns (hp/cp/mp/xp/renown). Direct-table
  bypass remains — state-ownership phase.
- `prune_ended_encounters(integer,integer)` is executable by anon/authenticated;
  maintenance RPC, should be server-only — later cleanup batch.
