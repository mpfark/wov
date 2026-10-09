# ENG-PROGRESSION-001G-C2-S2 — local name identity handoff

**LOCAL IMPLEMENTATION / NOT INSTALLED / NO CREATION RPC.**

Implements the approved [P1-B name contract](../design/progression-001G-C2-P1-B-storage-proposal.md#3-name-identity-without-icu-infrastructure)
and [next implementation plan](../design/progression-001G-C2-next-implementation-preparation.md).
Affected engine section: Progression and rewards / creation identity;
roadmap ENG-PROGRESSION-001G. Approved rules and the shared heartbeat are unchanged.

## Artifacts and exact boundary

- [Reviewed SQL](progression-001G-C2-S2-name-identity.sql), outside migration discovery.
  One `public.characters_creation_name_key_uq` unique B-tree expression index:
  `((lower(btrim(name))) COLLATE "C")`, every retained character, no WHERE predicate.
  Reviewed UTF8/LF bytes: SHA-256
  `d6c53867de0c1a0503ce8fc41f75acc73370908d1a66df9d8dc4ca36c5fbc510`, 2,213 bytes.
- [Prepared hosted checks](progression-001G-C2-S2-name-preflight.sql): read-only catalog,
  synthetic comparisons and aggregate counts only; **not executed on hosted data**.
- [Isolated tests](../../scripts/progression-001G-C2-S2-sql.test.mjs) execute the exact
  reviewed SQL in disposable PGlite 0.3.14/PostgreSQL17.5, not a production fixture.

No new table, persistent function, trigger, role, grant, generated column, custom
collation or key-normalization infrastructure. Existing case-sensitive indexes,
data, RLS and privileges remain. Existing rows are indexed without changing their
display capitalization, accents, resources or provenance. INSERT and name UPDATE
from any writer must satisfy the new index, including existing admin/legacy paths;
unique violations may require later UI error handling, not an index bypass.

Lower uses the installed name column's input collation; final C comparison preserves
accent distinctions. `btrim` removes only U+0020 edge spaces from the comparison key,
not the stored name. There is no Unicode normalization/accent stripping/universal
casefold claim. New-request trimming/input validation belongs to P2. NULL/blank
legacy rows stop installation for review; the index alone does not introduce future
NOT NULL/nonblank validation. Existing constraints and future authority own those.

## Read-only hosted evidence gate

On a **separately authorized** read-only inspection, first obtain the name column's
`input_collation` catalog identifier from the first two queries. Substitute only that
quoted identifier for `__ACTUAL_NAME_COLLATION__` in the comparison query before
executing the complete read-only transaction. The unresolved marker intentionally
cannot execute. Do not substitute a guessed locale or player-supplied text.

Require UTF8, deterministic input collation, expected case/accent/Nordic results,
no null/blank names, zero collision groups, and no object already occupying the
proposed index name. Inspect installed uniqueness definitions and provider/version
evidence; any collation version mismatch or unknown required comparison is a STOP.
Record dotted/dotless I, sigma, sharp S and composed/decomposed results as locale
semantics. If a required supported-name equivalence fails, owner review is needed;
do not impose ASCII-only names, add ICU, silently weaken policy or automatically
rename. No concrete hosted collision or collation blocker is established locally.

Return only counts and metadata, never a public list of character names. Collision
resolution, if necessary, needs explicit owner direction in a separate task.
No existing-data repair is included here.

## Future installation boundary

Follow the [B2 procedure](migration-baseline-strategy.md#sql-preparation-and-tool-owned-registration-0007-evidence).
No numbered migration, journal or snapshot is prepared locally. Before authorized
installation require a clean published source checkpoint, current installed Drizzle
prefix comparison, reviewed artifact SHA-256 match and the hosted evidence gate.
Lovable's standard tool creates the migration filename/journal/snapshot; do not
pre-create that filename, invoke another runner or repair Supabase history.

Execute the complete SQL atomically in **one transaction**. The explicit SHARE
table lock permits reads but blocks concurrent writes until commit/rollback; it
keeps collision checks stable. Ordinary CREATE UNIQUE INDEX is the final arbiter.
No CONCURRENTLY (outside-transaction lifecycle), IF NOT EXISTS (hides wrong objects),
drop/recreate, or data rewrite. Schedule this brief write-blocking operation in an
appropriate maintenance window; lock timeout/contention/unique failure means STOP
and rollback, not automatic retry with weakened checks. Actual duration is unknown.

After either success or failure inspect automatic source commits and actual installed
history separately. On success verify exact generated SQL/hash, appended journal and
snapshot, index expression/unique/valid/ready/no predicate and unchanged RLS/ACL/data.
No hosted gameplay probes are needed for this local deliverable. Runtime creation,
multi-session contention, quota, replay and deletion containment remain later gates.

## Validation and retained limits

10/10 isolated tests pass: byte-preserving legacy install and unchanged ACL/RLS;
case/trim/global uniqueness and UPDATE rejection; accent/Nordic comparison; collision,
null/blank and unsupported C-input refusal; conflicting object refusal; read-only
preflight aggregate results. Serial local fixtures do not prove hosted locale behavior
or multi-session locking. No build is necessary for SQL-only preparation.

Retain F CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED, with:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

Starting/synchronized/final source: `5ecc36c7107fe34b15262a30d9e52386fbe0294f`.
Recorded-baseline ancestry verified; existing uncommitted next-preparation documents
preserved. Recovery stash `0a5529d5227675319b166881b10f1c91edd7486b` unchanged.
0007 remains operator-reported installed; generated types/Edge/frontend state unchanged.
Cloud/gameplay operations: none. No installation, creation RPC, deployment, publication,
commit or push. STOP after local validation; next safe step is review and separately
authorized hosted read-only evidence, followed by separate installation authorization.
