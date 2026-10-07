# ENG-PROGRESSION-001E-R1 — Sidecar assertion reconciliation

**RECONCILED LOCALLY / READY FOR HOSTED INSTALL RETRY / NOT INSTALLED / NOT ACTIVE.**
Prepared 2026-10-07. task_start_sha and synchronized origin/main:
`06c888eb790ab9d1797d82f55cb4c2e216cdad6e`. Prior recorded baseline fc370869 is
a verified ancestor. No hosted access, Lovable contact, migration retry, installation,
deployment, activation, publication or F/G/H work occurred during R1.

Affected authority: ENG-PROGRESSION-001E, engine specification Progression and
rewards / resources and provenance / trainer / transactional authority. This is
an assertion repair, preserving all gameplay rules and the single world heartbeat;
no specification-rule or roadmap-scope change is required.

## Supplied hosted attempt and rollback evidence

Mik supplied one exact standard Lovable Drizzle attempt from reviewed checkpoint
06c888eb. All pre-install guards passed. The transaction reached the final $assert$
and raised `001E effective sidecar containment failed`, then fully rolled back.
The specific matching hosted role was **not inspected and remains unknown**.
The global-read membership explanation is plausible, not a proven hosted diagnosis.
No platform role name is encoded in the repair.

Historical attempted payload:

```text
docs/operations/progression-001E-cutover.sql
SHA-256 175d0c15c0f82a79c9682e0dca01c17f360eff88ab48fcf9fd0fedd650930266
40,840 UTF-8 bytes / 451 LF lines
```

Supplied rollback verification: both new tables and command/projection functions
absent; Drizzle remains exactly 0000/0001/0002; no migration file/journal entry,
Edge deployment or data mutation; repository unchanged at 06c888eb.

Supplied pre-attempt facts: 21 characters,17 bonds,70 inventory rows,7 node
encounters,50 encounters; progression sidecars0/0/0; world asleep,zero schedules,
zero live claims,all314 departures moved,combat_mode=open,combat_soak=off and no
automatic fight tick running. No operating control changed. These are historical
operator-reported facts, not Codex inspection or a current safe-window assertion.

## Assertion-design root cause and local evidence

The old effective check excluded rolsuper/postgres and names beginning pg_, then
rejected any other role with has_table_privilege. It conflated object-specific
application grants with intrinsic database-wide read/write privileges inherited
by a non-pg_ login. Owner-only ACLs and RLS do not make has_table_privilege report
false for such global membership. This is an over-broad security predicate, not
proof of an actual hosted gameplay leak or identification of a hosted role.

Repository evidence identifies PUBLIC, anon, authenticated and service_role as
ordinary browser/service principals and explicitly accounts for custom/default/
inherited roles. The historical [001B report](progression-001B-evidence-report.md)
records a platform read principal with global-read membership at that earlier
inspection. It supports modelling database-wide authority, but cannot identify
the role or memberships involved in this new attempted transaction.

PostgreSQL documents that pg_read_all_data/pg_write_all_data confer global object
privileges without object ACL entries, while neither inherently bypasses RLS.
pg_has_role(...,'USAGE') checks privileges available through effective inheritance,
unlike membership alone. Special superuser/BYPASSRLS attributes are checked on the
role itself, not inferred from names or membership. Sources:
[predefined roles](https://www.postgresql.org/docs/17/predefined-roles.html),
[role membership](https://www.postgresql.org/docs/17/role-membership.html),
[privilege inquiries](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE).

## Repaired invariant and exact predicate

Both new relations must remain postgres-owned, RLS-enabled and policy-free.
Direct/default table ACLs and column ACLs must contain no nonowner grantee at all,
including PUBLIC or platform-authority roles. PUBLIC requires no invented catalog
role: its ACL grantee is zero and therefore fails the owner-only check.

Effective table **or column** capability is forbidden for anon/authenticated/
service_role regardless of superuser/BYPASSRLS/global-read/write metadata. Service
role has no reviewed sidecar table capability; SQL commands remain its sole entry.

For other non-postgres roles, the effective-access scan includes ordinary roles
without superuser/BYPASSRLS attributes or effective USAGE of either predefined
global data role. This detects ordinary group inheritance and inherited ownership,
even with owner-only ACLs. Roles with actual database-wide authority are classified
outside this gameplay effective-access assertion. They still fail direct ACL checks.
No arbitrary pg_ prefix or Supabase role-name exception remains.

Exact runtime-role selection inside the unchanged final sidecar assertion is:

```sql
role.rolname <> 'postgres'
AND (role.rolname IN ('anon','authenticated','service_role') OR
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT EXISTS (
    SELECT 1 FROM pg_roles authority
    WHERE authority.rolname IN ('pg_read_all_data','pg_write_all_data')
      AND pg_has_role(role.oid, authority.oid, 'USAGE'))))
```

Selected roles fail if has_table_privilege covers any SELECT/INSERT/UPDATE/DELETE/
TRUNCATE/REFERENCES/TRIGGER or has_any_column_privilege covers SELECT/INSERT/UPDATE/
REFERENCES. Owner-only direct checks use aclexplode(relacl or acldefault) and
aclexplode(pg_attribute.attacl). No RLS-only substitute is used.

Metadata proves capabilities, not human/operator intent. A custom role inheriting
an ordinary grant remains ordinary and fails; a custom role with effective global
data authority is classified database-wide. Known gameplay principals never gain
that exception. Undocumented custom roles' intended runtime use cannot be inferred
locally: fresh authorized retry evidence should inventory any classified global
authority and investigate unintended global role grants separately. This repair
does not grant, remove, rename or change any database role or membership.

## SQL diff classification and release identities

There is one generated SQL hunk, entirely within the existing final sidecar
containment assertion. Ownership/RLS/no-policy checks, its error text, and disabled
command-control check are unchanged. All changed lines are classified as:

| Changed SQL lines | Classification |
|---|---|
| Removed pg_-prefix/non-superuser blanket effective scan and its comment | Remove over-broad authority classification |
| Added relacl/acldefault owner-only scan | Explicit/default/PUBLIC grant proof, including authority roles |
| Added attacl owner-only scan | Column-only nonowner grant proof |
| Added explanatory comments | Describe ACL/effective/database-wide distinction |
| Added always-checked three gameplay roles | Preserve strict runtime check regardless of authority attributes |
| Added rolsuper/rolbypassrls/effective pg_read_all_data or pg_write_all_data USAGE selection | Semantic authority classification without hosted-role assumption |
| Added has_any_column_privilege alongside unchanged table privilege list and closing parentheses | Reject effective column capability; syntactic completion |

An executable R5 regression compares old/new payloads after replacing only this
assertion region with a sentinel: every remaining byte is identical. It also
checks every previous release source hash except generator/payload. Command/XP/
milestone/lock/replay/resource/fence/Edge/browser/control-default behavior is
byte-semantically unchanged. No migration discovery/journal or historical SQL changed.

Current reviewed [SQL](progression-001E-cutover.sql):

```text
SHA-256 734e6a1934372b548003e0336b9207998f6da8de01057e66ad63ef5950569b40
41,673 UTF-8 bytes / 461 LF lines
```

Generator and [manifest](progression-001E-manifest.json) are regenerated. Only the
generator and payload artifact identities change in the manifest; all command
fragment, Edge/shared/config and browser identities remain exactly as reviewed.
The implementation report records current and attempted historical identities;
state records supplied rollback separately from local repair. This task's final
Git commit identity is reported in its delivery, avoiding a self-referential SHA.

## Local acceptance

The new `scripts/progression-001E-R1-assertion.test.mjs` executes the **exact generated
final predicate**, not a reimplemented approximation, on disposable PGlite0.3.14.
It models direct and transitive global-read/write membership and BYPASSRLS locally.
Old predicate reproducibly fails while repaired predicate passes for these analogues.
Global reader without BYPASSRLS sees zero private rows; a BYPASSRLS global reader
can see the fixture row, demonstrating the administrative boundary explicitly.

Regression coverage: direct ordinary grants; PUBLIC; multi-hop ordinary inheritance;
NOINHERIT explicit grants; bare ordinary roles; misleading role names; transitive
global reader/writer; BYPASSRLS with and without table privilege; NOINHERIT global
membership versus effective USAGE; explicit authority-role table/column grants;
ownership/RLS/policy faults; owner-role inheritance without nonowner ACL; column-only
runtime grants; and global membership assigned to each known gameplay role. Both
private relations are tested. The command default remains disabled.

| Acceptance | Result |
|---|---|
| Focused progression/reference/UI and Combat2 ownership/resource/lock regressions | 252 passed |
| R1 exact repaired assertion and R5 byte/source identity regressions | 11 passed |
| E full-payload SQL integration | 22 passed |
| E actual five-layer Combat2 chain integration | 11 passed |
| C SQL / D integration / D containment | 16 / 9 / 6 passed |
| Root/app/node/strict Edge typechecks | All passed |
| Production build | Passed |
| Full Vitest suite compared with starting E checkpoint | 2730 passed / 18 failed; identical 18 failure identities, no new failure |

Deterministic E/D manifest checks, generated state synchronization and whitespace
checks passed; project-state tests passed 3/3. Local PGlite topology
support does not establish the exact hosted role's behavior or true multi-session
contention. Retain **NATURAL RUNTIME PATH NOT YET OBSERVED** and
**HOSTED MULTI-SESSION BEHAVIOR UNPROVEN**.

## Handoff and stop boundary

R1 changed only the generator's final sidecar assertion, its generated payload/
manifest, required regression tests, and implementation/state/reconciliation docs.
No Edge/browser/gameplay semantics changed. Recovery stash
`0a5529d5227675319b166881b10f1c91edd7486b` is retained unchanged. Normal commit/push
to main is authorized after acceptance; final clean worktree/HEAD/origin/main are
reported in delivery.

Recommended next task, requiring **new explicit authorization**: retry the reviewed
R1 payload once through the standard Drizzle lane after exact release-hash/fresh
dependency/role/operational verification; verify preserved data/ledger/ACL/rollback
or successful installation evidence, then separately reviewed Edge deployment and
verification with fresh commands disabled. Activation/publication remain separate;
Mik alone publishes the frontend. R1 itself does not authorize any hosted retry.

**STOP. NOT INSTALLED / NOT ACTIVE.**
