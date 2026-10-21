# WOV-IDEA-025 — SQL installation PASS

## Reviewed source and authorization

- Mik's uploaded scoped acceptance/installation authorization, 2026-10-21 22:36 UTC, permits exactly one SQL installation and essential verification; no Edge, publication or gameplay execution.
- Reviewed source and freshly inspected origin/main: `fb4c3ff7fcc73b82c9f204d02c0287becc550bbb`. Project-state base `f9481a7e3adcbb89dfca7fcf766a4a93ff112857` is an ancestor. Source worktree was clean before recording this task.
- Approved candidate `docs/operations/idea-025-admin-material-grant.sql` and generated `drizzle/migrations/0027_idea_025_admin_material_grant.sql` are byte-identical, 10,285 bytes, SHA-256 `7a068b0823be493db75390096347c60246a104548a710dd3bf22df4e17b79d60`.
- Reused successful 22:05–22:06 prerequisite and 22:24–22:25 delta evidence; no repeated local tests or broad audit. Engine rules unchanged; this installs the reviewed WOV-IDEA-025 admin contract, not gameplay acceptance.

## Installation and hosted verification

Read-only checks observed 2026-10-21 22:37:45–22:39:23 UTC using `supabase_read_only_user`, session-observed `transaction_read_only=on`, correct managed project. No sandbox execution route or individual player rows used.

The standard custom-SQL Drizzle tool installed the approved SQL **once**, in its managed transaction, without outer BEGIN/COMMIT or weakened guards. All installer, object-absence, catalogue, browser-write and effective ACL guards passed. No retry.

- Hosted history: **27 → 28**, only appended row **28**, exact approved hash, `created_at=1792622346172`. Local journal only appended idx **27**, tag `0027_idea_025_admin_material_grant`, matching `when`. Prior 27 IDs/hashes/timestamps, journal prefix, old SQL and snapshots are unchanged; historical Supabase files untouched. Timestamp is journal metadata, not independently recovered execution time.
- Grant RPC: exact six named arguments and scalar jsonb; postgres-owned, volatile PL/pgSQL, SECURITY DEFINER, `search_path=pg_catalog, public, pg_temp`. Body SHA-256 `dbc3ebacaa629839a3b91bbbe044e094f8f3ea9afe5369effeab22a31cf53c52`; full definition SHA-256 `6d9e093763970c918486c2f9fb7a7f16495b890306a17bd8bba53c5b06b07cc2`.
- Expiry helper: no arguments, void, postgres-owned, volatile SQL, SECURITY DEFINER, same fixed search path. Body SHA-256 `2f98abe67a7a1a90981817134bea4600b671b1b5c36854f5747702a8b78e42bb`; full definition SHA-256 `fe0813ece0514de37bf38f31d812ffc3cf25981daa416c124b58e0dc93a7af73`.
- Both private tables postgres-owned, RLS enabled, zero policies, zero nonowner/PUBLIC table ACL entries and zero column grants. Effective table privileges (including MAINTAIN) and column SELECT/INSERT/UPDATE/REFERENCES denied to anon, authenticated, service_role, sandbox_exec and the project-scoped sandbox role. PUBLIC has no direct grant and cannot add effective authority. Exact reviewed SELECT/INSERT revocation on the two new tables applied; no defaults changed.
- Retention job exists exactly once: job **1350**, `wov-admin-material-reason-retention`, active, schedule `20 3 * * *`, command `SELECT public.admin_material_grant_log_expire_internal()`, database/username postgres. Existing jobs **1209** and **1226** unchanged. pg_cron **1.6.4** unchanged. No expiry invocation; actual future retention execution unverified.

## Exact owner-accepted function ACL exceptions

For **each** of `public.admin_material_grant(uuid,uuid,uuid,text,integer,text)` and `public.admin_material_grant_log_expire_internal()`, the only additional platform ACL is direct EXECUTE to **sandbox_exec_gpclaklkaolyzfnooajt**, OID **58832**, grantor **postgres**, grant option **false**. It matches the verified postgres/public function defaults, which are unchanged.

Mik explicitly accepted both exact grants at 22:36 UTC. Grant RPC application execution is service_role-only; expiry application execution is owner-only (service_role denied). PUBLIC/anon/authenticated and generic sandbox_exec EXECUTE remain denied. No wildcard/function/principal/default/table-access exception or weaker future verification is authorized.

Fresh role evidence: generic sandbox role OID63487 and project role OID58832 have no effective pg_read_all_data/pg_write_all_data inheritance; both are privileged BYPASSRLS platform roles, not application identities. Zero transitive membership paths from anon/authenticated/service_role/authenticator to either sandbox role. Reused established platform-only browser/API/Edge reachability evidence; Edge application credentials use service_role. Neither function was executed under any principal.

## Preservation evidence

The following bounded catalogue aggregates are identical before and after installation; no gameplay rows contribute to these hashes:

| Metadata group | SHA-256 |
|---|---|
| Required function definitions, ownership and ACLs, including trigger functions | `a08bb213118e2a2573a701035488bc1ded40079a00717f757eb90c32f48ba8c6` |
| Trigger bindings/enabled state | `c38981c4edee958ac1e2e8d491dc5f2e9e7f0d77a5c56f7eeb7a8e2c1ee032b2` |
| Existing relevant table ownership/ACL/RLS | `7224006b970aafed7d8efecd14caa1bdd18e762249c3c43bed10898529882a46` |
| Existing policies | `63327f4da0c4b60cf3502ed90df2b72e3121a8e43a52103d3e35d68f295e9d9a` |
| Existing constraints/FKs | `cd4c0e6c24465c8911bb6a55d8c23ab760045b79a6a7c06d2c9c891e6ffab805` |
| postgres/public default ACLs | `f2b75da6be9205db6de26e4124432fc14b41e68c9a8a42e31d04be87774c9311` |
| Prior scheduled jobs | `e0c427ca03a28185a580ad127aad3afc5a98fe944dc68cb49e1d78c877960b75` |
| Prior 27 hosted history entries | `4a4e07fbb00729f353b3516ea0233d2c75ad9855d298f27308bb61e02b801159` |

Canonical XP body `9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde`, derived-resource body `08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d`, base-craft, sale, consumption and lifecycle bodies/settings/ACLs match reused evidence and remain unchanged. Character-first NO KEY UPDATE / child KEY SHARE lock composition preserved; no new existing-table trigger. Seven material keys/schema/PK/FKs and browser DML denial reconfirmed.

Tool regenerated Cloud types: only the two new private-table shapes/FK and two RPC signatures added; prior types preserved. File SHA-256 `51f7a930ad45db283d078d20cd847b686db8734e8630ac59364ea2303b1c0af5`. Managed source checkpoint after migration `9fcbd73c98512f33835491bbc5c5347ef7010f13`; not frontend publication. Preview's automated build reports OK. Documentation state generation/check performed separately; no gameplay/local regression tests rerun.

## Next safe action

**SQL PASS; GO for separate approval of matching `admin-users` Edge deployment and its reviewed `_shared/admin-material-grant.ts` dependency.** This is not deployment authorization. Frontend publication remains Mik's later manual step after backend confirmation. Runtime grant/replay/conflict/refusal and hosted concurrency acceptance remain unverified and separately authorized.

No Edge deployment, frontend edits/publication, material grant, gameplay test, world wake, legacy XP activation, unrelated permission change or history rewrite occurred. Only the reviewed retention job was added.