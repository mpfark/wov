# ENG-PROGRESSION-001G-D1 — local legacy admin containment

Source baseline f767a1ab9395c042875b0b212dfa9ff89ac140cf. Scope: existing B policy O2/O3/O5 and D admin authority/UI containment; engine progression authority and failure verification. Rules/grants unchanged; C2 COMPLETE with accepted limits and overall001G open.

## Implemented boundaries

After existing JWT/Admin role verification and before payload parsing/gameplay-table access, admin-users returns HTTP410/code legacy_progression_operation_retired for set-level, reset-stats and grant-respec, for either admin role and any method. Their reconstruction/read-modify-write implementations and unused formula imports/constants are removed. No replacement award authority introduced.

update-character rejects an entire payload containing ANY of the15 protected columns with HTTP403/code protected_progression_edit_denied before field filtering or UPDATE: STR/DEX/CON/INT/WIS/CHA, level, XP, class, classless flag, unspent points, respec points, Renown balance/trained ranks/lifetime. Mixed identity+protected edits do not partly apply. Existing allowed generic name/HP/maxHP/gold/AC/location/gender validation/writes remain. Unknown fields still reject; no database grants or SQL changed. Existing grant-xp HTTP503 pause remains unchanged.

AdminCharacterSheet level is read-only and CharacterEdits no longer accepts level. UserManager no longer calls set-level/reset-stats/grant-respec; obsolete reset/respec callbacks report unavailability. Reset/respec controls disabled with accurate messages. XP controls reflect its pre-existing pause. Name/gold/gender edits and item/material/gold/teleport/revive/account administration remain available under their existing boundaries. C2 lifecycle controls are unchanged.

## Validation and remaining scope

23 tests execute the actual transpiled Edge handler against isolated mock clients: both admin roles' retired requests, all15 mixed protected payloads, permitted generic update, unknown-field denial, auth/role denial and XP pause. Refused requests perform no mutation and no gameplay-table access; role lookup remains required.2 UI render tests verify read-only level, permitted name/gold edits, disabled reset/respec/XP and working gold callback. Existing C2 creation-client5/lifecycle UI4 tests pass. Total34 focused tests; project-state3 pass separately. App typecheck and production build pass; existing Vitest deprecation/large-bundle warnings retained. Build MCP-plugin side effect restored to original; no unrelated Edge output kept. These tests do not establish hosted deployment or real service privileges.

Remaining admin writers intentionally outside D1: permitted generic resource/identity edits, revive/fullHP, teleport, inventory give/remove, gold/material grants and role/account administration. Wider narrow-command/reason/audit/replay/approval work remains D. DB-protected routes are now explicitly refused in local Edge source; current hosted Edge revision is not verified or changed. Other sources/database-owner capability are not comprehensively inventoried by this bounded slice.

No owner policy decision blocks publication of D1 containment. Replacement awards still need the existing cap/repeat/RP/audit/respawn decisions. Later deployment requires separate authorization; no migration needed. Deploy corrected Edge before Mik's manual frontend publication; old clients get explicit refusals. Do not loosen DB grants or restore legacy writers to make old controls work. No publication/deployment authorized or executed here.

Changed11 files: admin-users/index.ts; AdminCharacterSheet.tsx; CharacterActionsColumn.tsx; UserManager.tsx; constants.ts; legacy-containment.test.ts; legacy-containment-ui.test.tsx; this handoff; project-state.json/generated.md; game-engine-roadmap.md.

Recovery stash and all four accepted F limitations preserved: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP. C2's accepted untested coverage remains nonblocking. No hosted mutation, character change, migration/history edit, commit/push, deployment or frontend publication.
