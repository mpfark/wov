# WOV-IDEA-025 — Edge deployed / verification BLOCKED

## Reviewed source and scope

Mik's uploaded authorization at 2026-10-21 23:14 UTC permitted only the reviewed `admin-users` deployment and non-mutating checks. Implementation checkpoint: `aaf3cd533304a7b56df5b44fbed287567130dece`; ACL correction: `fb4c3ff7fcc73b82c9f204d02c0287becc550bbb`. Starting HEAD and freshly inspected remote main both `ed9d351ef608aa29db9fb0e7d918af91180bbab2`; both reviewed checkpoints and project-state base are ancestors. No Git fetch/reset/push performed; remote tip was checked with ls-remote against the already matching local reference. Unrelated source preserved. This deployment preserves reviewed rules; no engine rule/specification change.

| Artifact | SHA-256 |
|---|---|
| `supabase/functions/admin-users/index.ts` | `967a1400d6f6b265f86d0dcf3f730115092c13a17e6276e91ef2305154f9315f` |
| `supabase/functions/_shared/admin-material-grant.ts` | `4c99c97b1ec4687c25407c2f5f3aaa5b5ce4260e238aacc44b0d3d8143be5bd6` |
| `supabase/config.toml` | `e4572cad21bc4698c9e42581499b671ef57063e2ebdf0f35ad3180627ab2123f` |
| Reviewed SQL and installed migration 0027 | `7a068b0823be493db75390096347c60246a104548a710dd3bf22df4e17b79d60` |
| Tool-submitted files/settings manifest | `a4fb18b548ed28d24c82251c96b6f3bc3ddfc80e051c7f03f4b849dafa788203` |

Both Edge files/config match implementation review byte-exactly. Only local import is the shared handler; it has no further imports. External Supabase JS import unchanged. Existing `verify_jwt=false` and required managed runtime variable names `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` preserved. No secret values inspected or settings changed; managed-variable existence is not independently attested by source alone.

## Minimal SQL prerequisite confirmation

Correct live Lovable Cloud binding confirmed by project-info. Read route observed `supabase_read_only_user`, `transaction_read_only=on`, 2026-10-21 23:15:18–23:15:31 UTC. No player rows or gameplay functions queried/executed.

- Both installed function full-definition/body hashes, signatures, owners, language, volatility, SECURITY DEFINER and fixed search_path match [0027 installation evidence](idea-025-sql-installation-result.md).
- Grant RPC service_role EXECUTE true; PUBLIC/anon/authenticated/generic sandbox denied. Expiry helper service_role denied. Only the two exact accepted direct/non-grantable postgres-granted project-principal EXECUTE entries remain. No permission changes.
- History remains 28 entries, latest id28/hash exact approved SQL/created_at1792622346172; prior27 aggregate `4a4e07fbb00729f353b3516ea0233d2c75ad9855d298f27308bb61e02b801159` unchanged.
- Private-table/role-graph/catalogue/trigger/lock/dependency/retention checks reused from the successful installation; no repeated broad audit.

## Deployment and bounded response evidence

Supported deploy tool returned **Successfully deployed edge functions: admin-users**, with the submitted manifest above. No independent revision ID or live bundle export returned: live byte identity remains unverified, not inferred from submission hash.

| Check | UTC observation | Actual result |
|---|---|---|
| Direct HTTP OPTIONS, award-material | 23:16:13.543077 | 200, empty body; origin `*`, allowed headers `authorization, x-client-info, apikey, content-type` |
| Direct HTTP unauthenticated GET, award-material | 23:16:14.245802 | 401 `Unauthorized`, expected CORS |
| Direct HTTP authenticated owner-session GET, award-material | 23:16:15.236049 | **403 `Forbidden`, expected 405: STOP** |
| Preferred tool unauthenticated POST with query in path | deployment-check window | Tool returned gateway 404 `NOT_FOUND`; not evidence of handler POST refusal. No retry |

A requesting-owner session was minted using `lovable auth-session --json --self`, solely for the authorized non-mutating admin checks. The authenticated GET did not pass `verifyAdmin`; no request body, target character or grant UUID supplied, and no material RPC executed. Cause of 403 is **unresolved**: no assumption about role absence, token shape or backend failure. Investigation/repair needs separate authorization; no permissions or credentials altered.

Remaining authenticated checks were **not run** after STOP: PUT405, retired grant-salvage/grant-gem410, paused-XP refusal. Unauthenticated POST401 remains unverified. No blind redeployment/retry.

## Source compatibility / limitations / next action

Source confirms award-material routes to the reviewed handler; retired grant-salvage/grant-gem return410 after admin verification and before body parsing/gameplay access. Versus the implementation parent, index changes only the import and new dispatch; all unrelated actions are preserved. This is source proof, not authenticated live verification. No unrelated mutating admin actions exercised.

All three frontend handoff hashes match current source: material panel `29392fa8496e172a55f5ff3cc6b08edd1d7f76b3c8b5dd29f1d921f38aa684c2`, UserManager `95b5c24e8baf7d39ec971f3748cb02a515f7b4e64912fd29314d4dbef57db5c8`, CharacterActionsColumn `e0f21b8fc2e6c058fba3154006e292283d724039749f003e4a768c089c8a3298`. Existing focused local evidence reused; no tests rerun. Automated preview build reported OK at23:15:39UTC. Frontend source is compatible, but **NO-GO for manual Publish recommendation until authenticated refusal checks are resolved/completed**.

**Overall BLOCKED; deployment itself succeeded.** Next approval: focused read-only investigation of the requesting-owner admin-auth refusal and routing discrepancy, followed by separately scoped non-mutating refusal checks. Do not redeploy or modify roles automatically. Mik alone publishes after verification; runtime grant/replay/conflict/concurrency acceptance remains separately authorized and unverified.

No SQL, migrations, ACLs, secrets, frontend code/publication, material grants, authenticated gameplay mutations, world controls, legacy XP writers or unrelated Edge Functions changed. Only operational documentation/state updated. Session mint is disclosed separately from gameplay mutations.