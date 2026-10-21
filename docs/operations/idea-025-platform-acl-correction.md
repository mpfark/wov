# WOV-IDEA-025 — private-table platform-default ACL correction

2026-10-22. Based on repository f9481a7e3adcbb89dfca7fcf766a4a93ff112857, preserving incoming unrelated preview-auth changes. Owner authorized local SQL correction/testing/publication only. **NOT INSTALLED; no hosted permission, default-privilege, deployment, material or frontend change.**

## Supplied preflight evidence

Owner supplied Lovable's 2026-10-21 22:05–22:06 UTC read-only preflight summary: correct Cloud project, supabase_read_only_user, transaction_read_only=on; reviewed commit/six artifact hashes/SQL matched; seven catalogue keys, schema/defaults/PK/FKs, role policies and browser material DML denial passed. Craft/sale/consume/lifecycle definitions and character-lock/child KEY SHARE composition matched reused evidence. New tables/functions/job absent; pg_cron1.6.4 suitable and both existing postgres-owned jobs unchanged.27 Drizzle entries/hashes/timestamps matched through0026. Codex did not independently execute these checks or inspect raw outputs. No further hosted checks are performed here.

Reported blocker: postgres/public table defaults grant SELECT and INSERT to sandbox_exec and the project-scoped sandbox principal. Resolve the latter to exact previously documented **sandbox_exec_gpclaklkaolyzfnooajt**, not a wildcard or guessed new name; confirm that identity before installation. These table grants make the original private-table guard fail. This is not an OAuth/read-only execution-role failure: the supplied inspection route was permitted/read-only. Accepted0025/0026 function EXECUTE exceptions do not cover table access.

## Exact local correction

The [candidate](idea-025-admin-material-grant.sql) adds only this privilege change after creating its two new private tables:

```sql
REVOKE SELECT,INSERT ON public.admin_material_grant_replay,public.admin_material_grant_log
 FROM sandbox_exec,sandbox_exec_gpclaklkaolyzfnooajt;
```

Existing PUBLIC/anon/authenticated/service_role revocations remain. The final guard still rejects non-owner direct table grants and now checks effective table privileges (enumerated from the server's table ACL default) and effective column SELECT/INSERT/UPDATE/REFERENCES for those five named roles. PUBLIC is checked as ACL grantee0, never as a role. Missing exact roles or inherited access stops installation; it does not authorize broader membership/default changes.

**New SQL SHA-256:7a068b0823be493db75390096347c60246a104548a710dd3bf22df4e17b79d60.** Original candidate5cdca7630f0046849566ed37b789fe69999543c867e23ecad7406273fc14690e is superseded only as preparation, never as executed history. Both function bodies are byte-identical: grant prosrc dbc3ebacaa629839a3b91bbbe044e094f8f3ea9afe5369effeab22a31cf53c52; expiry prosrc2f98abe67a7a1a90981817134bea4600b671b1b5c36854f5747702a8b78e42bb. Ownership, RLS, caps, locks, receipt/result, audit expiry/job, application authority and Edge/frontend source are unchanged. No ALTER DEFAULT PRIVILEGES is added to the candidate.

## Separate function EXECUTE gate — owner decision still required

Anticipated postgres/public default EXECUTE to **sandbox_exec_gpclaklkaolyzfnooajt** remains untouched on both exact functions:

- public.admin_material_grant(uuid,uuid,uuid,text,integer,text): SECURITY DEFINER can award within actor/payload checks; application EXECUTE remains service_role only.
- public.admin_material_grant_log_expire_internal(): SECURITY DEFINER deletes expired detailed audit rows; application access remains owner-only, no browser/service_role EXECUTE.

Supplied preflight reused platform-only reachability evidence and found no application-role membership path. This supports a proposed scoped exception, not acceptance. **Owner must explicitly accept or reject each function's exact project-principal EXECUTE grant**, with identity/default origin/grantor/grant option/reachability reconciled. Neither table REVOKE authorization nor previous base-craft/gem exceptions accepts these functions. No generic sandbox_exec EXECUTE, new principal, grant option or expanded privilege is accepted here. Function ACL statements/guards remain unchanged. Never execute either function as a sandbox principal to test reachability.

## Local evidence and recommendation

Disposable PostgreSQL18.6 harness simulates the reported table defaults and anticipated project-principal function default. It reproduces the original guard failure and full rollback, then installs the correction locally. **19 tests PASS**, retaining17 operation/rollback/retention tests including7 independent-session cases. Added tests verify effective table/column denial, PUBLIC/no non-owner ACL, postgres ownership/RLS, unchanged defaults/control-table grants and unchanged anticipated function EXECUTE. A transactional pg_read_all_data membership fixture confirms inherited read access still aborts installation. These role/default fixtures exist only in the disposable local cluster; neither sandbox role is an execution identity. Reduced schema/auth/cron registration are not hosted scheduler proof.

**GO for local correction; NO-GO for hosted installation until both function EXECUTE dispositions are explicit.** Reuse successful supplied prerequisites. A separately authorized minimal read-only delta check should confirm new reviewed hash, exact two roles/default origin and no inherited table-wide access, new-object/job absence and unchanged27-entry history/dependencies. Missing visibility remains REQUIRES EVIDENCE; no sandbox_exec/read-write route.

After those gates and explicit installation approval, standard Lovable Drizzle installs exact new SQL in one managed transaction and generates history/types. Verify denied effective table access for both platform and application roles/PUBLIC, exact function bodies/settings/ACLs and explicitly accepted exceptions, intended retention job and unchanged prior history/other jobs. Guard failure means STOP/rollback, never platform-default/history repair. Edge, Mik manual Publish and runtime grants remain separate stages in the [handoff](idea-025-admin-material-grant-handoff.md). Prior closures, limitations, administrative XP pause and recovery stash are preserved.
