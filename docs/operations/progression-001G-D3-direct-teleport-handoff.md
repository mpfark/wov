# ENG-PROGRESSION-001G-D3 — Direct teleport RPC containment

Local reviewed forward SQL only, NOT INSTALLED. Source baseline 6628e8a2e1c2cf8550b054007611bb8c9a23a02f. D1/D2 remain NOT DEPLOYED and frontend NOT PUBLISHED. 001G-D remains open. Engine authority and movement rules unchanged.

## Source grants and dependencies

Definition: supabase/migrations/20260311115903_97fbb398-0421-4772-b723-bc8cd86859c6.sql:1; public.admin_teleport(uuid,uuid), void, SECURITY DEFINER, public search_path. Calls is_steward_or_overlord(), checks nodes and updates characters.current_node_id. Applicable location/arrival and lifecycle triggers still run; none is changed.

Latest explicit source ACL: supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql:142–143 revokes PUBLIC/anon/authenticated/service_role then grants authenticated and service_role. Owner retains implicit authority. Actual installed owner, effective role inheritance and grants are UNKNOWN without hosted metadata. No claim of current hosted role permissions.

Full exact-name search across src, supabase and drizzle finds no server-side delegate or ordinary movement caller. UserManager's sole runtime RPC call was removed in D2; generated types and archival location-authority tests are references only. Ordinary movement uses its own functions; do not revoke those. External consumers/dynamic SQL remain unverified. Item/node/region/creature administration is unaffected.

## Narrow decision

Revoke EXECUTE only on this exact function from PUBLIC, anon and authenticated. Retain existing service_role/owner/internal access to preserve server capability; this supersedes D2's broader tentative service-role denial proposal. No new grant, role change, body replacement, data change, or trigger change. This closes browser execution, not all privileged teleport capability. D2 closes the legacy Edge route after separately authorized deployment.

Transaction asserts exact signature and void return type, no PUBLIC grant, effective browser denial, unchanged effective service execution. If browser inheritance keeps access or service depends solely on removed browser/PUBLIC permissions, abort and roll back; review exact dependencies instead of broadening revokes/grants. Other custom direct grants are outside this bounded change and must not be described as universally contained.

## Artifact and installation boundary

Reviewed SQL: docs/operations/progression-001G-D3-direct-teleport-containment.sql
SHA-256: 17146742ea890efa3437f07ba7f28518a704bb98cce2ac58c163612a0ca19509

Prepared outside drizzle/migrations per B2. No journal/snapshot registration or historical SQL changes. Proposed tool-generated suffix: progression_001g_d3_direct_teleport_containment; numeric prefix assigned by Lovable from then-current journal. No installation authorization in this task.

Later minimal authorized pre-install metadata: verify this exact signature/owner/ACL, effective anon/authenticated/service_role EXECUTE and memberships affecting them, and direct dependents/external server usage. No gameplay invocation or secrets. If inconsistent with source scope, STOP. Install exact hashed SQL transactionally via standard Drizzle tool only; inspect success/failure automatic commits. Verify installed SQL/hash/journal/history, browser effective denial, unchanged service permission/body/owner/search_path and unrelated travel privileges. Do not repair Supabase history. Deployment and Mik manual frontend publication remain separate.

## Local validation

Five isolated PGlite tests pass: browser denial; PUBLIC removal with explicit service grant; inherited browser leak atomic rollback; missing signature refusal; service-only-PUBLIC dependency safe rollback. Definition and ordinary movement privilege preservation are checked. Local fixtures do not prove hosted role graph, concurrency or runtime. Migration-chain/preservation, project-state and whitespace checks accompany this handoff.

No new owner policy decision blocks source publication. Hosted dependency/privilege verification remains an installation gate. D3 ready for review/commit authorization, not installed containment.

Retain C2 COMPLETE with accepted limits and all four F limitations OPEN:
- HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
- NATURAL RUNTIME PATH NOT YET OBSERVED
- AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
- RP EARNING AUTHORITY GAP
