# WOV-IDEA-033 — SQL installation and scoped ACL disposition

## Reviewed source and scope

- Reviewed implementation: `a57df3a54c80c79fdfedcd307b9f0cc391bc226f`; starting checkout `16d7d832dfa73f35a8f23c2c91045c42551992c8` is a verified descendant. Candidate, handoff and original migration prefix were unchanged. A fresh remote branch-tip observation was unavailable because `origin/main` was absent; no Git fetch or history mutation was performed.
- Owner authorized one exact SQL installation and accepted only the gem function's exact platform ACL exception at 2026-10-20 23:20 UTC. Edge deployment, frontend publication, gameplay tests and unrelated changes were prohibited.
- Reused [reviewed handoff](idea-033-gem-application-handoff.md), prior 23:15–23:16 UTC bounded read-only inspection, local test evidence and [operating contract](lovable-supabase-operating-contract.md).
- Preserves engine rules: Character ownership and lifecycle; Resources and attributes; Progression and rewards; Combat resolution; Effects and stances. Relevant IDs: WOV-IDEA-033, ENG-PROGRESSION-001 and ENG-LEGACY-001. No rule, heartbeat, scheduler or broader release change.

## Installation identity

| Artifact | SHA-256 |
|---|---|
| `docs/operations/idea-033-gem-application.sql` | `93a9136796b798f0e4e76ac9d3acab5c79b934a0620a1ccaa4de2f113423001f` |
| `drizzle/migrations/0026_idea_033_gem_application.sql` | `93a9136796b798f0e4e76ac9d3acab5c79b934a0620a1ccaa4de2f113423001f` |
| Installed gem function LF-normalized prosrc | `15e7099bd20ec76bd64bfcc90c8fb6939a1b8e7790ade8874182a77f95b75384` |
| Regenerated `src/integrations/supabase/types.ts` | `72c733e81305f4b48359722438fc363e4572afa3793e772f1847f614dd2dea6f` |

Standard Lovable custom-SQL Drizzle tool executed the reviewed SQL once in its managed transaction. No outer transaction statements, guard edits, retries or alternate runner. Tool reported success and regenerated types. Generated SQL is byte-identical: 13,478 bytes, including final newline. Types delta adds only the new RPC signature.

## Essential hosted verification — PASS

Read-only checks ran on the confirmed live Lovable Cloud instance/database `postgres`, using `supabase_read_only_user`, `transaction_read_only=on`. Route evidence is session-observed, not platform-attested. Pre-install observation: 2026-10-20 23:21:10 UTC; post-install ledger observation: 2026-10-20 23:22:36.262203 UTC.

- Pre-install prerequisites unchanged: exact private dependency bodies/settings/ACLs; new gem identity absent; schema, receipt/ledger keys and private browser-denied authority compatible. Relevant entry/claim/commit/resource functions and bound trigger fingerprints were unchanged from the preceding focused inspection; no new composition or late-lock issue found. Existing local/runtime/concurrency limitations remain.
- Installed `public.gem_application_internal(uuid,uuid,uuid,text,uuid)` has exactly the reviewed body and named arguments; scalar JSONB, volatile PL/pgSQL, postgres-owned SECURITY DEFINER, `search_path=pg_catalog, public, pg_temp`.
- Direct ACL contains only postgres, service_role and the explicitly accepted project principal; all EXECUTE, grantor postgres, not grantable. PUBLIC has no EXECUTE ACL; anon/authenticated effective EXECUTE false; service_role true. No unexpected grant found.
- Private `progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)` body remains `9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde`; `character_sync_derived_internal(uuid,boolean,boolean)` remains `08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d`. Both retain postgres ownership, SECURITY DEFINER, scalar JSONB, `pg_catalog, public` path, owner-only direct ACL and denied anon/authenticated/service/platform EXECUTE.
- Hosted history increased from 26 to **27** entries. Original IDs/hashes/timestamps unchanged. New row: id **27**, hash matching approved SQL, `created_at=1792538540124`. Local journal: idx **26**, same `when`, tag `0026_idea_033_gem_application`. Original journal prefix and all prior 26 SQL artifacts remain byte-identical to reviewed source. No historical repair or replay.

## Exact owner-accepted platform exception

Principal `sandbox_exec_gpclaklkaolyzfnooajt`, OID **58832**, reconfirmed unchanged. Its new direct, non-grantable EXECUTE derives from the existing postgres/public function default ACL, not an added statement in the reviewed payload. Default privileges were not modified.

Fresh actual membership-edge inspection found zero transitive paths from anon, authenticated, service_role or authenticator to this principal; its sole observed incoming membership was postgres, granted by supabase_admin. It is an internal login-capable, BYPASSRLS principal, not a browser-auth principal. The previously documented platform access boundary is reused; catalog memberships alone do not independently attest every platform access mechanism.

Mik's acceptance covers only this exact principal, default-ACL origin, established non-reachability and `gem_application_internal` identity. Application execution remains service_role-only. This is not a wildcard, another-function acceptance, permission expansion, weakened future ACL verification or authorization to execute gameplay as the sandbox principal. Additional unexpected grants require separate disposition. The 0025 exception remains separately scoped.

## Ordered next action and STOP

**GO for requesting separate Edge approval**, not authorization to deploy: only `forge-apply-gem` and `_shared/gem-application.ts` from the reviewed commit, after reconfirming source parity. Expected safe checks are OPTIONS 200, GET 405 and unauthenticated POST 401; live-bundle identity remains a separate evidence boundary.

SQL installed/verified; Edge **not deployed**; matching frontend **not published**; gameplay **not tested**. Mik's manual publication follows backend verification. Runtime acceptance requires separate approval. No authenticated craft, player-row inspection, world wake, settings change, secret inspection or unrelated object mutation was performed. The SQL defines DML for future authorized RPC execution but does not execute that gameplay DML during installation. No data fingerprint or gameplay safety claim beyond the reviewed non-execution path is asserted.

Existing parent closures, administrative XP pause, four progression limitations, recovery stash and other unresolved findings remain unchanged. No migration or ACL blocker remains for this scoped stage.