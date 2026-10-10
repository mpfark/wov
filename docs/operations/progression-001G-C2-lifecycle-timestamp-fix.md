# C2 lifecycle timestamp drift — local correction

ENG-PROGRESSION-001G/C2; Character creation and initialization / Failure, diagnostics and verification. No gameplay-policy change or C2 completion claim.

Owner reports hosted canary creation/exact replay/duplicate prevention PASS; soft-delete refused lifecycle_character_drift/P0001 with version0 and no receipt. Canaryone5097e553-83d8-4e14-8eae-23162b945dfc remains active; Calikon1d738976-eef4-40cf-94fa-99132ed2ee3d is protected. No hosted rows or installed bodies were inspected in this task.

## Cause and narrow correction

0011 character_lifecycle_command compares full pre/post character JSON after excluding only deleted_at, restore_until and lifecycle_version. Historical20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql:189–201 installs update_characters_updated_at BEFORE UPDATE;20260329162528_51bddc3f-74f8-43ba-ab35-e353c458988c.sql:72–83 pins update_updated_at to NEW.updated_at=now(). This automatic change triggers the remaining JSON inequality. The earlier lifecycle fixture omitted this trigger/column. Exact source trigger body reproduces the reported failure and full rollback locally. This confirms the source-level mechanism; the supplied hosted symptom is consistent, not independent proof of installed body equality.

Prepared SQL: progression-001G-C2-lifecycle-timestamp-fix.sql; SHA-256 **8d329d18d1a1004551331104d49d89857b4d2906c896dcfe150c04e03b9a6608**. Kept outside drizzle/migrations pending authorized standard Lovable installation. No historical SQL, reset or cutover regenerated/edited.

Patch only the existing command definition: add updated_at to BOTH equality projections, then separately require updated_at=transaction_timestamp() in the existing final-state assertion. This accepts exactly the known now()-managed value, not arbitrary timestamp drift. Every other character column remains in full comparison, while lifecycle fields retain explicit expected-value checks. The generic comment about other data changes remains accurate because timestamp is explicitly checked separately.

The migration refuses command SHA/body/owner/security/search-path drift or missing/changed timestamp trigger/body. It uses pg_get_functiondef to preserve the signature and all authority branches, replaces exactly two projections and one state assertion, and requires complete pg_proc metadata/ACL equality after replacement. No grants, trigger modifications or character DML. Existing authenticated bridge privilege retained; no new PUBLIC/anon/service_role privileges. Hash guard uses LF-normalized source body SHA-25661e8aaf923fd454c194d0630497d75d0982fb28cd01f3e143c0c127c8ca88709.

Other source triggers for last_online, hp/location, reserved_buffs and class are UPDATE OF specific gameplay columns; this lifecycle statement targets none of those. Raw/progression/lifecycle fences validate or reject rather than legitimately rewrite gameplay values. No evidence supports exempting any additional character field. Unknown installed trigger behavior remains subject to strict full-row comparison and rollback; do not broaden exemptions on installation refusal.

## Focused validation and handoff

64 existing/extended isolated SQL tests PASS (57 retained plus7 timestamp regressions). New tests reproduce original failure with earlier timestamp, verify delete/restore with actual source timestamp trigger, preserve identity/resources/materials/private origin, retain creation exact replay and tombstone quota, refuse non-Overlord restore, reject injected gold/HP/name/arbitrary timestamp mutations, and roll back all rows/timestamps/receipts on late deferred receipt failure. Disposable PGlite only; local fixture role/cron behavior is not hosted independent-session or scheduler evidence.

GO for separately authorized publication. Installation is NOT authorized here. Minimal later Lovable task: pin published source and SQL hash, read command/timestamp definitions and trigger metadata against the executable guards, use standard Drizzle ONE transaction for this patch only, inspect automatic source commits and generated artifacts, verify unchanged metadata/ACLs and patched guard. Stop on any drift; never rerun0013/reset, directly repair characters, or modify Calikon/Canaryone in installation. Subsequent canary owner soft-delete/Overlord restore/unauthorized checks require separate runtime authorization and exact current lifecycle version; keep Calikon excluded. Remaining hosted lifecycle tests have not run and C2 remains incomplete. All four accepted F limitations retained.
