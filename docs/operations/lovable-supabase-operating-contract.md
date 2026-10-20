# Lovable / Supabase operating contract

This contract records Mik's supplied Lovable platform operating information in ENG-PROGRESSION-001F-R1A (2026-10-07). It is project guidance, not fresh Cloud inspection or authorization for an operation. Apply it to future database/backend tasks alongside the [AI operating guide](ai-operating-guide.md), current project state and task-specific scope.

## Evidence and responsibilities

Local Codex can prove core PostgreSQL ACL semantics, table/column GRANT/REVOKE behavior, effective privilege assertions for fixture roles, deterministic artifact identity, SQL logic and single-session behavior. Embedded fixtures cannot prove the current hosted role graph or installed object identity.

Hosted Lovable must verify actual effective privileges for PUBLIC, anon, authenticated and service_role; hosted memberships and default privileges; installed migration byte identity and resulting prosrc/object identities; extensions and platform-schema behavior. PUBLIC is checked through ACL grantee zero and its effective impact, not as a catalog role. Compare reviewed SHA-256/bytes/encoding with installed SQL after the tool reproduces it as migration input; source identity alone is insufficient.

Hosted schema changes use only Lovable's standard Drizzle migration tool, with explicit scoped authorization. Edge deployment and authorized hosted data mutation also belong to Lovable. Codex prepares and validates local source; Git push does not install or deploy anything. Frontend publication remains Mik's manual action.

0007 follow-up: Mik reports that the standard tool creates its own SQL file,
journal entry and snapshot; a pre-existing intended filename caused a collision.
Prepare reviewed SQL outside the migration directory, preserve its SHA-256, and let
the standard tool register it. Inspect automatic commits after both successful and
failed operations; verify generated SQL, installed history, journal/snapshot and
derived types separately. See the [B2 preparation procedure](migration-baseline-strategy.md#sql-preparation-and-tool-owned-registration-0007-evidence).

## Delivery conventions

Use the [delivery handoff template](handoff-template.md) for exact commit/artifact identity, local evidence, minimal hosted checks, authorization boundaries and STOP/recovery decisions. Keep extensive task evidence in linked reports. Reuse valid checks; repeat only when source/assumptions changed or a concrete gap requires it.

The standard custom-SQL Drizzle tool owns the outer migration transaction: hand it SQL without top-level BEGIN/COMMIT. PL/pgSQL BEGIN/END blocks remain intact. If a reviewed artifact has outer transaction statements, prepare and separately review/hash a runner-compatible derivative; do not strip or reformat approved bytes silently. Stop if transaction/rollback semantics are uncertain. The G4A24 [runner-compatible artifact](legacy-001G4A24-shared-hp-candidate-no-txn.sql) and [subsequent delivery record](legacy-001G4A24-edge-deployment-handoff.md) illustrate the distinction; they are historical evidence, not fresh authorization.

Codex prepares reviewed SQL outside automatic migrations; Lovable alone generates/registers the migration SQL, journal/snapshot and schema-derived types through the standard lane. Do not pre-generate that history, infer schema from the blank Drizzle placeholder, modify an executed prefix or create a second runner. Reconcile tool-generated Git changes after success or failure before retrying.

Verify required SQL before deploying the named matching Edge Functions, including their shared imports, RPC contracts and existing auth/configuration. Do not expose secret values or assume old Edge/SQL combinations are compatible. Record deployment evidence and live-identity limits. Frontend activation follows compatible backend verification under its own approval; Mik alone manually publishes. Git push and preview/build success never substitute for any of these stages or for separately authorized gameplay acceptance.

## Role containment

Require private objects to retain the reviewed owner, ACLs, RLS and policy contract. Direct nonowner/PUBLIC table or column grants are leaks even when the grantee is an administrator. Independently reject effective access for gameplay/application roles and their members; those principals never receive an administrative exemption.

Use the established [001E-R1 pattern](progression-001E-R1-reconciliation.md): classify other roles by actual superuser/BYPASSRLS attributes or effective `pg_has_role(...,'USAGE')` inheritance of pg_read_all_data/pg_write_all_data. A hosted read/admin principal can inherit global object privileges without any object grant. Global data roles do not themselves bypass RLS; BYPASSRLS does not itself grant SELECT. Role names or a generic Supabase prefix do not establish authority. NOINHERIT membership alone is not effective USAGE. Ordinary/custom object grants or application-role inheritance remain subject to containment.

This classification is an assertion boundary, not a role redesign or a guarantee against database administrators. A custom principal with independently assigned global/BYPASSRLS authority is administratively privileged under the established policy; hosted review must verify the role graph and ensure application principals cannot inherit that exception. Supabase administration-group membership alone is not an additional exemption without established effective capabilities. Do not change hosted roles to make an assertion pass.

For the application-member exception, use actual transitive `pg_auth_members` edges. A superuser's `pg_has_role(...,'MEMBER')` result can report authority over every role without a membership edge; do not misclassify unrelated administrators as application members. Global-data classification still uses effective USAGE, not catalog membership alone.

### Project-scoped platform EXECUTE exception — WOV-IDEA-015 / 0025

The [0025 installation record](idea-015-sql-installation-result.md) and [subsequent investigation and owner disposition](idea-015-acl-exception-disposition.md) document Lovable's platform-managed default privileges: new postgres-owned public functions can automatically receive an EXECUTE grant to the project-scoped sandbox principal. The verified principal for this project is `sandbox_exec_gpclaklkaolyzfnooajt`; on `public.base_craft_internal(uuid,uuid,uuid,uuid)` the grant was direct, from postgres, and not grantable. The supplied platform investigation established that this internal principal is not reachable through normal browser/PostgREST authentication or application Edge credentials. This is reported hosted evidence, not a fresh Codex inspection or proof about other projects.

SQL installation verification may recognize this narrowly documented platform exception only after all of the following checks:

- Resolve the **exact principal** in the target project and record its identity, grantor, privilege and grant option. Establish platform-managed origin through the applicable postgres/public function default ACL (`pg_default_acl`) and platform evidence; a matching `sandbox_exec_*` name alone is never sufficient.
- Verify its role graph and platform access boundary: ordinary browser/PostgREST and application Edge principals must not inherit, assume or otherwise reach it. Use actual membership edges as above, not role-name or superuser membership shortcuts. Missing visibility or uncertain origin/reachability means STOP / REQUIRES EVIDENCE, not an automatic exemption.
- Continue denying PUBLIC, anon and authenticated direct/effective EXECUTE on private RPCs, including access through memberships. Preserve each function's reviewed application/server execution contract; this exception does not grant service_role access to owner-only primitives.
- Match the grant to its explicitly reviewed scope. The 0025 owner acceptance covers **only this principal's grant on base_craft_internal**. Any other unexpected principal, function grant, grant option or privilege expansion requires explicit review and disposition before acceptance; do not extend this precedent automatically.

This exception concerns verified platform EXECUTE only, not table/column access, ownership, RLS or arbitrary sandbox-like roles. Do not change default privileges or hosted permissions to make verification pass. Existing drift guards, artifact/hash checks, migration transaction/history ownership, authorization and SQL → Edge → Mik publication gates remain binding. An unexpected grant still stops activation until resolved; an accepted grant does not authorize execution as that principal, use of `sandbox_exec`, or a non-read-only verification route. Earlier procedural deviations retain their recorded dispositions.

## Platform limitations and secret handling

Known platform limitations: no native dry run; no disposable hosted database fixture; no reliable hosted concurrent-write test; no Edge revision ID or live bundle download. Lovable read roles may inherit global read/BYPASSRLS. Review exact SQL before authorized execution, verify installation afterward and describe unproved boundaries explicitly. A failed precondition with full rollback is an attempted operation, not an installed migration or surviving history entry.

Never ask Lovable to select, hash, prefix or print key material, Vault secrets, Deno.env, service-role keys, passwords or session tokens. Verify secrets only through metadata, ACL/RLS, existence and non-revealing behavior. Keep diagnostic output free of secret values; administrative ability to read a secret does not authorize doing so.
