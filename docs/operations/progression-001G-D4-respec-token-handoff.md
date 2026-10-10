# ENG-PROGRESSION-001G-D4 — Canonical admin token award

Local source implementation only, baseline fe327e3379371b6c817b2f5ac033c071434b79cc. NOT INSTALLED / NOT DEPLOYED / FRONTEND NOT PUBLISHED for D4. D1–D3 rollout unchanged. F/C2 protections and XP pause preserved. Owner simplified policy authorizes no approval queue/general framework.

## Inventory

- docs/operations/progression-001G-D4-respec-token-award.sql
- scripts/progression-001G-D4-sql.test.mjs
- supabase/functions/admin-users/index.ts
- src/components/admin/users/UserManager.tsx
- src/components/admin/users/CharacterActionsColumn.tsx
- src/components/admin/users/legacy-containment.test.ts
- src/components/admin/users/legacy-containment-ui.test.tsx
- this handoff
- docs/operations/project-state.json and generated project-state.md
- docs/roadmap/game-engine-roadmap.md

## Authority and storage

New postgres-owned private admin_respec_award_internal(uuid,uuid,uuid,integer,text), service-only admin_respec_award with same signature. Existing admin-users authenticates then derives actor; database rechecks persisted role under share lock. Steward1, Overlord1..5; Steward own-account targets refused, Overlord own awards flagged. Active target, existing provenance, fresh-state validator and relevant lifecycle/dead/combat/stance/pending transition gates; no trainer requirement for a token award. No inferred legacy baseline. Checked balance overflow. Only token balance and progression version change; resources/stats/milestones remain.

Request advisory lock first, then existing combat_enter_node advisory lock, character/version locks, location revalidation. Global partial unique event index for admin_respec_token; same actor/target/amount/normalized reason digest returns prior receipt, changed reuse refuses. Role and active-target validation still run on replay. Uses existing progression_receipt with new admin_token operation, before/after/version proof. Existing five-operation constraint is guarded before forward extension; no historical SQL modified. New index touches existing receipt metadata only, no character backfill.

One small private admin_respec_award_log retains reason, actor/target/amount/time for12months. No sequences, no browser/service table grants or RLS policies; revoke custom default grants only on newly created objects. Reason SHA256 is in retained canonical request proof; full reason is not in progression history. Postgres-only expiry routine deletes expired detail. One daily existing pg_cron job calls it; job metadata/scheduling must be verified hosted after separately authorized install. This does not invent long-lived detailed history or a notification framework. Existing progression proof/lifecycle retention is preserved. C2 purge cascades canonical receipt proof under its existing rules; independent unexpired detailed log finishes its12-month clock, with no FK that can block purge. No account-deletion implementation added.

Edge new action award-respec-token validates exact payload, role cap and reason; _actor never comes from browser. Domain refusals are non-success409. Retired grant-respec remains410. UI enables only reasoned capped token award; retains UUID after success/error so repeat clicks confirm the original award. New token award explicitly starts another intent; changing bound choices starts another request. UUID retention is bounded to current mounted Admin session, not persistent browser storage. All other disabled tools remain disabled. No target mutation in local application tests.

## Validation

Nine exact-SQL PGlite tests use existing C/E fixtures, actual C snapshot/raw fence and F fresh validator; cron.schedule is a fixture stub, not real scheduler proof. Role/caps/self/invalid target/reason/replay/conflict/rollback, expired detail, privilege/default grants, canonical continuity and existing milestone preservation are covered. Focused Edge/UI/state tests, TypeScript, build, state generation, journal/SQL/snapshot presence and whitespace checks accompany completion. Fixtures do not prove installed trigger graph or hosted concurrency/scheduling.

## Installation handoff — not dispatched

Reviewed SQL SHA256: 6fffef744a6213d27cd93f0c7b60e9c7580b64d035ca414d6f029a8e184acdaf
Keep SQL outside drizzle/migrations. After source publication and separate hosted authorization: verify0001/0005 canonical definitions/raw fence, current five-operation receipt constraint, current C2 lifecycle guards, postgres ownership/installer privileges, role table, new object absence and pg_cron scheduling authority/job-name absence. Unknown/drift stops installation, not broad grants. Standard Lovable Drizzle tool registers exact reviewed SQL transactionally; no historical Supabase repair. Verify generated SQL/hash/history/journal/snapshot, effective new-object ACLs including inheritance, unchanged character/milestone data and scheduler job owner/command. D4 is a new service capability, not browser write access.

Then separately authorize admin-users deployment, followed by Mik manual frontend publication. Bounded runtime token canary requires separate mutation authorization; no Calikon/Canaryone modification here. No generalized runtime campaign required. Missing cron dependency/permissions or canonical constraint drift is an installation blocker; no local policy blocker. Not a claim D COMPLETE: acceptance/known-gap review still follows.

OPEN: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

Fresh completion validation: 9 SQL tests and59 Vitest tests passed; root TypeScript, production build, project-state synchronization,16 registered SQL/snapshot pairs and whitespace checks passed. Existing Vitest deprecation/build large-chunk warnings remain. MCP source generated by build was restored; no unrelated file retained.

UI correction review: reason and New token award controls now rendered. Actual UserManager tests type reasons and amounts, check Steward1/Overlord5, pending double-click protection, same-UUID retries, fresh UUID after explicit reset, refresh and success/refusal/network feedback. All other retired controls stay disabled. Local only; SQL unchanged.
