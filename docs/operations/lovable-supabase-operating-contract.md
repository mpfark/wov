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

## Role containment

Require private objects to retain the reviewed owner, ACLs, RLS and policy contract. Direct nonowner/PUBLIC table or column grants are leaks even when the grantee is an administrator. Independently reject effective access for gameplay/application roles and their members; those principals never receive an administrative exemption.

Use the established [001E-R1 pattern](progression-001E-R1-reconciliation.md): classify other roles by actual superuser/BYPASSRLS attributes or effective `pg_has_role(...,'USAGE')` inheritance of pg_read_all_data/pg_write_all_data. A hosted read/admin principal can inherit global object privileges without any object grant. Global data roles do not themselves bypass RLS; BYPASSRLS does not itself grant SELECT. Role names or a generic Supabase prefix do not establish authority. NOINHERIT membership alone is not effective USAGE. Ordinary/custom object grants or application-role inheritance remain subject to containment.

This classification is an assertion boundary, not a role redesign or a guarantee against database administrators. A custom principal with independently assigned global/BYPASSRLS authority is administratively privileged under the established policy; hosted review must verify the role graph and ensure application principals cannot inherit that exception. Supabase administration-group membership alone is not an additional exemption without established effective capabilities. Do not change hosted roles to make an assertion pass.

For the application-member exception, use actual transitive `pg_auth_members` edges. A superuser's `pg_has_role(...,'MEMBER')` result can report authority over every role without a membership edge; do not misclassify unrelated administrators as application members. Global-data classification still uses effective USAGE, not catalog membership alone.

## Platform limitations and secret handling

Known platform limitations: no native dry run; no disposable hosted database fixture; no reliable hosted concurrent-write test; no Edge revision ID or live bundle download. Lovable read roles may inherit global read/BYPASSRLS. Review exact SQL before authorized execution, verify installation afterward and describe unproved boundaries explicitly. A failed precondition with full rollback is an attempted operation, not an installed migration or surviving history entry.

Never ask Lovable to select, hash, prefix or print key material, Vault secrets, Deno.env, service-role keys, passwords or session tokens. Verify secrets only through metadata, ACL/RLS, existence and non-revealing behavior. Keep diagnostic output free of secret values; administrative ability to read a secret does not authorize doing so.
