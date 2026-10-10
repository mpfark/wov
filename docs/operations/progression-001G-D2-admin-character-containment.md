# ENG-PROGRESSION-001G-D2 — Admin character containment

Local implementation only, based on D1 17971bf7d8c1712f7d9c915f04bca160abe05927. NOT COMMITTED / NOT DEPLOYED / FRONTEND NOT PUBLISHED. Overall 001G-D remains open. Owner approved temporary unavailability of legacy character convenience operations. Engine progression/authority and resource rules are preserved; no replacement authority is introduced.

## Containment

After existing JWT/Steward-or-Overlord authentication, admin-users returns HTTP410/code legacy_character_operation_retired for revive, teleport, give-item, remove-item, grant-gold, grant-salvage and grant-gem, before payload parsing or gameplay-table access. Their mutation branches are removed. D1 set-level/reset-stats/grant-respec410 and protected15 mixed-payload403 remain intact; XP remains503 paused.

Generic edits accept only name/gender. Other keys reject the entire request with403 before target access; protected15 retains its original code. Names preserve existing validation and database uniqueness. Gender permits male/female. Missing targets404; tombstones409. The UPDATE includes active-target filtering and returned-row validation, refusing no-row races instead of reporting success. Database lifecycle guards remain the final concurrent safety boundary.

Gold is read-only in the sheet. Character grants/removal, economy inputs/buttons, teleport and revive buttons are disabled with explanatory text. The teleport callback no longer invokes the RPC. Region/node/item/creature administration, C2 lifecycle controls, DB grants and migration history are untouched.

## Separate direct teleport containment proposal — no SQL authored

Exact signature public.admin_teleport(uuid,uuid). Definition: supabase/migrations/20260311115903_97fbb398-0421-4772-b723-bc8cd86859c6.sql:1. SECURITY DEFINER, public search_path; delegates role check to is_steward_or_overlord(), checks nodes, updates characters location. September ACL: supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql:142–143 grants authenticated/service_role. Location UPDATE also invokes applicable character triggers, including authoritative arrival and C2 lifecycle fencing; do not remove those triggers.

Repository search finds one runtime caller, UserManager, now locally disabled; generated types/test references are not runtime callers. No other named source delegate found. External/installed dependencies and effective ACL remain unverified locally.

Recommended separately authorized forward ACL-only containment: deny this exact function to PUBLIC/anon/authenticated/service_role and unintended inherited application principals, retain database-owner/internal authority only where dependencies require it, preserve body and unrelated travel RPCs. Verify actual effective privileges/dependencies before installation. Do not change global grants/default privileges. This task authors no migration or executable SQL. Edge/UI alone does NOT completely contain teleport.

## Validation and rollout

Focused executed-handler/UI/project-state tests, TypeScript, production build, state synchronization and whitespace checks are required before publication. Local mocks prove Edge ordering/no mutation, not hosted concurrency. Deployment remains separate: D1+D2 may share later admin-users deployment, followed by Mik manual frontend publication. Direct RPC containment needs separate authorization/installation.

C2 COMPLETE with accepted limitations remains. Preserve OPEN:
- HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
- NATURAL RUNTIME PATH NOT YET OBSERVED
- AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
- RP EARNING AUTHORITY GAP

Fresh local validation: 55 focused tests passed (50 Edge, 2 UI, 3 project-state); TypeScript passed. Production build passed with existing large-chunk warning; known MCP build-generated source change restored. Vitest sandbox realpath restriction required the normal local test escalation. No hosted proof inferred.
