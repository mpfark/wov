# ENG-LEGACY-001C5A — exact legacy HP helper containment preparation

Local preparation at `08f815764df39f0718d24422e121012c98ae249b`, 2026-10-12. Owner C5A authorizes preparation of browser ACL containment; no installation or SQL execution. Source publication is now owner-authorized. Reuses [C5 disposition](legacy-001C5-resource-authority-disposition.md), [L1](../design/legacy-cleanup-l1-checkpoint.md) and [historical installed inventory](../design/combat2-legacy-sql-dependency-audit.md). Prior closures, all four open F limitations, v3→v2 uncertainty and recovery stash preserved.

## Exact identities / prerequisite fingerprints

All bodies are in `supabase/migrations/20260731184728_660b1bac-c685-45ae-8cf3-769f81061cbe.sql`, return scalar integer, plpgsql/volatile/SECURITY DEFINER, public search_path. Historical installed owner postgres and authenticated/service EXECUTE reported at 2026-10-02 18:14:37 UTC; current ACL/security parity unverified.

| Exact public signature | Source normalized prosrc SHA-256 |
|---|---|
| heal_party_member(uuid,uuid,integer) | `0760c5b00b30c473e1ebbe3f20cc87a26a3a6988d35dc2cd09112af867ad45c9` |
| heal_party_member(uuid,uuid,integer,integer) | `3e95e38ce52038b169c465bf82528cb3d742e7378da4577608b605d492b99e97` |
| damage_party_member(uuid,integer) | `642207a3714bac31f12c95edaec1c1a495b342ab5114a4f8a46ff38a4acff34b` |

The fourth heal parameter is `_effective_max_hp integer DEFAULT NULL::integer` in source: **integer, not numeric/bigint**. Historical installed matrix explicitly lists this four-integer-type signature. This resolves source and historical identity before authoring; current installed signature/default must still be read back. Three-argument heal/damage have no defaults. Fingerprints normalize CRLF → LF only, UTF-8 SHA-256 of prosrc, not function-definition MD5 or full-file hash.

L1 deliberately excluded these helpers from revocation. Batch C, C4 and known current source fences did not contain them; no new source assumption that they are denied. Helper CREATE OR REPLACE history does not prove current direct/default/inherited ACLs. The C5A preparation supersedes the recommendation to await owner permission to prepare this narrow denial, not the requirement for hosted preflight and separate installation authorization.

## Artifacts

- [SELECT-only preflight](legacy-001C5A-hp-helper-preflight.sql), SHA-256 `1d9a269ed3faa5ea115450bbebb92875e494e8dc20d029d4bf3a5e6956f3cef6`.
- [Guarded ACL correction](legacy-001C5A-hp-helper-containment.sql), SHA-256 `f7881885b89e4ae9bf48a589b15422e73d9ffc1c07c01dd7c5839cd84eb06fb2`.
- Static regression checks: `scripts/legacy-001C5A-hp-helper-static.test.mjs`. No database driver or SQL execution.

Correction is one transaction looping over fixed exact signatures: verify original bodies/security/default counts and existing postgres/service EXECUTE; capture full definition, owner and non-browser direct ACL entries (including grantor/options); REVOKE EXECUTE only from PUBLIC/anon/authenticated; assert PUBLIC/effective client denial, unchanged full definition/owner/body fingerprint and retained direct ACL/server rights. Any failure aborts the transaction. No CREATE OR REPLACE, GRANT, role change, CASCADE, new object or privilege change on unrelated functions. No service/postgres revoke or restoration grant.

Other direct non-browser grantees retain their exact entries. Existing downstream role memberships are unchanged. If service access relies only on PUBLIC or browser membership, the postcondition fails and rolls back rather than inventing a grant. A known custom server consumer relying solely on removed PUBLIC/browser rights is also a **STOP prerequisite**: identify it before installation; preserving all PUBLIC-derived execution while removing PUBLIC would be contradictory without separately approved grants. Unknown external dependencies remain REQUIRES EVIDENCE, not a promise of universal preservation.

## Preflight criteria / observation boundary

One intact SELECT returns three metadata rows sharing statement time/snapshot; full definitions, exact argument/defaults, owner/security/settings, direct ACL and effective named-role/direct-grantee EXECUTE. No player data, gameplay invocation, history query/repair or database-wide privilege scan. Run only after source publication and separately authorized hosted metadata inspection. If split or truncated, label independent observations and require missing evidence; inspection-role read authority is not gameplay EXECUTE.

| Check | PASS | FAIL / REQUIRES EVIDENCE |
|---|---|---|
| Identity/body/security readiness | Exact signatures/defaults/fingerprints above; postgres/scalar integer/plpgsql/volatile/definer/search_path public. | Visible mismatch = FAIL/STOP for reconciliation, no hash substitution. Missing visibility = REQUIRES EVIDENCE. |
| Server preservation readiness | Postgres/service effective EXECUTE true; enumerate all actual other direct grantees and known server consumers. Those rights can remain after browser/PUBLIC removal. | Absent expected server access or known server-only dependency on removed grants = STOP; incomplete consumer/grant evidence = REQUIRES EVIDENCE. Do not add grants or revoke unrelated memberships. |
| Current browser authority | PUBLIC absent and effective anon/authenticated false = boundary PASS, potentially no new migration needed. | PUBLIC or effective client access = boundary FAIL / containment needed, **not** evidence of a demonstrated exploit. Compare with readiness independently. Missing role/ACL visibility = REQUIRES EVIDENCE. |
| Runtime dependencies | Current supported GamePage does not require client EXECUTE in inspected source; bodies retained. | New supported caller requiring these signatures needs disposition before install; external/dynamic consumers unknown. Do not deny all server capability to solve uncertainty. |

Public ACL is evaluated as grantee0, not a fictitious PUBLIC role passed to has_function_privilege. No recursive reversed role-membership test that treats privileged owners as browser principals. Browser inheritance can leave execution despite direct revocation; correction asserts effective denial and stops on such a path.

## Dependencies / minimal next step

C5 establishes legacy heal callback is execution-fenced in GamePage, and ordinary movement returns through authoritative departure before legacy damage. Four-argument runtime caller is not established. Combat2/OOC/respawn are distinct authorities; bodies, types, migration history and restricted compatibility dependencies remain retained. Server predicates still depend on auth.uid/ownership; service EXECUTE does not by itself guarantee any arbitrary service invocation succeeds.

Next: use the owner-authorized reviewed source checkpoint, then obtain only the separately authorized exact three-signature metadata above and any specifically identified server-consumer evidence. If already denied, record that rather than install needless SQL. If needed and prerequisites pass, obtain separate installation authorization; use only standard Lovable custom-SQL Drizzle registration, exact artifact bytes, transaction and tool-owned numbered SQL/journal/snapshot. Do not place this file in automatic migrations, hand-register or modify historical records. Inspect automatic source commits/history after success/failure. Post-install metadata: bodies/security/owner/server ACL unchanged, PUBLIC and effective browser EXECUTE denied. No gameplay probe or deployment.

## Validation / remaining blockers

Eight static regression tests PASS: exact signatures, source fingerprints, SELECT-only scope, narrow revocation, drift/readiness guards, inherited-access postconditions, direct ACL/grant-option/body preservation assertions and existing migration-chain compatibility. These tests inspect SQL text; **no SQL was parsed/executed in PostgreSQL**, no rollback/inherited-ACL runtime result or multi-session behavior is claimed. That limit follows this task's explicit no-SQL-execution boundary.

Project-state/source consistency, links, hashes and whitespace checked separately. Existing Windows bash ENOENT and the C5 stale historical-status test remain baseline limitations, not changed or implicitly resolved. C remains open until helper authority disposition and later owner acceptance of limits/deferrals. No AC/equipment/formula change or broad audit. This checkpoint authorizes source publication only, not installed containment.

## Exact read-only Lovable preflight prompt

> ENG-LEGACY-001C5A metadata preflight only. Confirm the published source checkpoint contains this handoff, the referenced C5 disposition, and `docs/operations/legacy-001C5A-hp-helper-preflight.sql` (SHA-256 `1d9a269ed3faa5ea115450bbebb92875e494e8dc20d029d4bf3a5e6956f3cef6`). The correction artifact must remain SHA-256 `f7881885b89e4ae9bf48a589b15422e73d9ffc1c07c01dd7c5839cd84eb06fb2`; do not execute it.
>
> Using the existing read-only connection, execute only the preflight SELECT as one intact statement. Return all three rows, full definitions/defaults, source fingerprints, owner/security/search_path, direct ACLs and effective anon/authenticated/service_role/postgres and direct-grantee EXECUTE, with observation role/time/snapshot. Verify exactly `public.heal_party_member(uuid,uuid,integer)`, `public.heal_party_member(uuid,uuid,integer,integer)` and `public.damage_party_member(uuid,integer)`. Missing visibility or truncated/separately observed output is REQUIRES EVIDENCE, not proof of denial; label separate observations explicitly.
>
> Compare with the handoff criteria and expected source fingerprints. Report identity/security/server-preservation readiness separately from current browser authority: exposed browser EXECUTE means containment needed, not a proven exploit. Identify any known server consumer relying only on PUBLIC/browser-derived rights; if preservation cannot be established, STOP for review without adding grants. Do not assume historical ACLs are current or reverse role membership to treat privileged owners as browser principals.
>
> Do not inspect player data or secrets, invoke any gameplay/helper/resource-sync function, execute the correction, install migrations, repair history, change privileges, deploy or run probes. Return PASS/FAIL/REQUIRES EVIDENCE per check and exact mismatches/gaps. No installation or C closure is authorized by this read-only preflight.
