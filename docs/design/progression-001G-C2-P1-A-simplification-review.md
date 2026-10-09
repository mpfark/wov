# ENG-PROGRESSION-001G-C2 — P1-A simplification review

**Recommendation only; P1-A remains unchanged. No implementation authorized.**

Use **two new private tables**, two transaction advisory locks and one shared
creation authority. Keep database uniqueness, private privileges, atomicity and
immutable origin; remove the lock table, separate receipt table, configuration
hash infrastructure and deferred cross-table validation framework.

Baseline: [P1-A contract](progression-001G-C2-P1-A-storage-contract.md),
[approved blueprint](progression-001G-C2-creation-blueprint.md),
[P0 evidence](../operations/progression-001G-C2-P0-evidence.md) and
[operating contract](../operations/lovable-supabase-operating-contract.md).
Source HEAD/fetched origin/main: `9489b991b3e4c4be5c443d2fa246d0382ca62c7e`.
Existing P0/P1-A documentation and recovery stash are preserved. This focused review
adds no installed facts, hosted requests or gameplay-policy changes. Affected
boundaries are Progression/provenance and Transactional authority, ENG-PROGRESSION-001G.

## Recommended B: minimal inventory

| Object | Responsibility / minimum fields |
|---|---|
| `character_creation_origin` | One immutable row per new character: character_id PK/FK to characters with DELETE RESTRICT; snapshot_schema_version; separate creation/race/class/formula version identities; one JSONB snapshot of actual applied inputs/starting values; created_at. No mutable-catalog FK or extra content/config hashes. Retain through soft deletion until controlled permanent purge. |
| `character_creation_log` | One row per committed intent: actor_id/request_id composite PK, target_account_id, mode, result_character_id UNIQUE, payload_version and one payload digest, created_at/expires_at, nullable detailed_receipt JSONB and nullable purged_at. This is the **separate creation receipt** and its surviving replay record, independent of origin and progression_receipt. No FK that cascades away its replay identity with the character/account. |
| Global name index | UNIQUE expression index on `(lower(btrim(name)) COLLATE "C")`, covering all retained characters. Keep original display capitalization and all existing name bytes; no generated key column or custom ICU collation. |
| Ordinary constraints | PKs, uniqueness, origin FK, NOT NULL, JSON object checks, nonempty version IDs, own-mode actor=target check, valid mode and digest length, UTC 12-calendar-month expiry consistency. No sequences or duplicate identity FKs. |
| One guard function / two UPDATE triggers | Reject every origin UPDATE. On log reject binding/result/version/timestamp changes; permit only expiry-time detailed_receipt→NULL and controlled one-way purged_at. No general JSON validator or deferred consistency triggers. DELETE remains private controlled purge/privacy work. |
| Later command functions | One creation RPC supporting own/delegated mode; server derives actor/role and shares all baseline logic. One private receipt-expiry function; an authorized admin-only history projection, with expiry filtering. Deletion integration stays in separate D. No generic lock, manifest registry or recovery framework. |

Both tables: postgres-owned, RLS enabled/no policies, no direct grants to PUBLIC,
anon, authenticated or service_role; explicit per-signature EXECUTE revocation on
new private functions. Only separately authorized entry/projection functions get
narrow grants. Fixed search_path and effective inherited privilege checks remain.
No table/column privilege expansion, role/default-grant redesign or new sequences.

## A versus B

| Difference | Complexity removed | Guarantee and trade-off |
|---|---|---|
| A four tables → B two | Account-lock row lifecycle and receipt/request joins, redundant receipt-link FKs | Separate retention lifetimes **are required**; separate receipt and request tables are not. Keeping origin physically separate makes immutability simple. Log details can expire without losing the intent key. A single all-purpose table is possible but mixes origin purge and receipt expiry guards; two is easier to debug. |
| A account-lock table → B transaction advisory lock per target account | New lock rows/FK/generation counter and Auth cleanup coupling | Concurrent quota protection **is required**. Advisory locks are sufficient only when every accepted create/purge writer participates and raw INSERT is contained. Existing-row locking is also valid, but auth.users permissions/contention and missing profile rows add dependencies; recommend advisory locks. Neither mechanism by itself fences arbitrary service writers. |
| A custom ICU/NFC identity → B lower/trim unique expression index | Collation installation, ICU-specific equality contract and normalization pipeline | Database global case-insensitive uniqueness **is required**. P1-A's canonical Unicode equivalence/ignorable-form rules were proposals, not approved requirements. B preserves capitalization but uses the existing database locale's lower conversion and bytewise key equality; this semantic choice needs acceptance before the index slice. |
| A four version IDs plus multiple hashes → B four readable version IDs plus actual snapshot | Catalog fingerprint serialization, snapshot checksum and duplicated formula metadata infrastructure | Four separate version identities and actual applied values **are required**. Cryptographic configuration checksums are not required for immutability. Pin reviewed manifest revisions in the authority; catalog edits must not silently reuse a revision. Keep only the request digest needed after detailed payload expiry. |
| A separate detailed receipt table → B nullable detailed receipt in log | Third table, composite receipt FKs and cross-table expiry checks | Detailed admin-only history for12 months and replay thereafter **are required**. Clear only details, never delete the whole log at receipt expiry. Log bindings stay immutable; a small expiry function and guard replace the receipt lifecycle machinery. |
| A generic snapshot validator/deferred consistency triggers → B authority checks and plain constraints | Multiple validator signatures, JSON schema framework and post-expiry exceptions to deferred checks | Valid atomic creation **is required**. One private writer constructs/validates the snapshot and all linked rows in the same transaction; local rollback/linkage tests cover it. Direct private inserts remain denied. B loses redundant detection of programming errors in an additional owner-level writer; no such second application writer should exist. Keep the small immutability guard. |
| A separate storage/index sub-stages → B one storage proposal, later authority/cutover | Extra staging ceremony and premature framework installation | Forward-only reviewed migrations and safe rollout **are required**, a fixed number of stages is not. Combine the two tables/constraints/guards/ACLs in P1-B; include the name index only after its semantic/collision gates pass. Command/caller/deletion containment remain distinct because they change authority. |

Expression-index uniqueness and transaction advisory locks are ordinary PostgreSQL
facilities: [expression indexes](https://www.postgresql.org/docs/17/indexes-expressional.html),
[transaction locks](https://www.postgresql.org/docs/17/explicit-locking.html).
Locks coordinate cooperating writers; permissions/cutover still contain bypasses.

## Transaction, provenance and retention

At READ COMMITTED: authenticate nonnull actor → authorize own/Overlord delegated
mode/reason → transaction advisory lock(actor,requestUUID) → compare existing log
binding → replay or refuse conflict → transaction advisory lock(target account) →
fresh count of **all** target character rows → refuse at five → pin approved server
configuration → insert character → existing materials trigger only → calculate
canonical full resources/AC → insert compatible progression version0 and origin/log
→ commit. Two lock namespaces use unambiguous keys; hash collisions merely serialize
unrelated requests. Any error rolls back character, trigger grants and all sidecars.
Count must occur after the account lock in a fresh statement. Do not support other
isolation modes without proof; retry transaction failures with the same UUID.

The same actor/request with a different target/payload conflicts before account
locking; changed display spelling/case also conflicts. Define the one request
digest inside the server using its normalized JSONB request representation and
payload_version; do not add a client/server canonicalization protocol. Retain that
version's comparison algorithm for old requests. A private digest is pseudonymous
data, not anonymous, and must not contain secrets. Purge coordinates account locks
and marks the result; it must not reverse the request→account lock order.

Origin captures four independent approved version labels, actual race/class/formula
inputs and all applied baseline values. Human-readable revisions are enough if
their meanings are fixed by reviewed server configuration; mutable row IDs or
timestamps alone are insufficient. No origin UPDATE, automatic legacy origin or
synthetic XP receipt. Initial progression state remains version0/opaque_baseline/
six zero investments, with no earned milestones; first canonical progression
receipt follows existing F continuity unchanged.

At twelve UTC calendar months, admin detail reads return expired and the private
maintenance function clears detailed_receipt (reason/request/audit/result details).
An actual expiry operation must be arranged before activation; read filtering alone
does not physically remove personal details. Origin remains for character lifetime.
The log retains only actor/request/target/result IDs, mode, digest/version,
timestamps and purged marker; replay returns minimal authorized status, never grants
again or reconstructs an expired receipt. Origin deletion is restricted to controlled
permanent character purge. Receipt details can still finish their12-month retention
after that purge; character purge must not delete the log.

Account privacy cleanup and minimal replay duration retain P1-A's genuine open
contract: do not assume indefinite identifying retention or erase another account's
origin when a delegated creator's account disappears. Missing result without a
controlled purge marker fails closed, not a fresh creation or assumed successful
purge. Origin FK protection and deletion containment remain necessary before activation.

All approved starting behavior is preserved: classless L1/XP0, canonical attributes,
full HP/CP/MP and AC, gold200, trigger-only salvage40/six gems, empty inventory/equipment,
no family; Overlord-only delegated reason/audit, same quota, no existing-character
edits. Family L1 joining/L10 founding remains P3; no staff/socket/crafting work.

## Conflicts and implementation-blocking questions

**No approved behavior requires four tables or ICU infrastructure.** B is a proposed
replacement architecture, not an amendment to P1-A or permission to implement it.
It would conflict with approved behavior if expiry deleted replay keys, origins
were mutable, service writers bypassed the lock, or literal lowercase conversion
were silently presented as universal Unicode casefold. Those shortcuts are rejected.

Only these decisions/evidence block the relevant implementation slice:

1. Accept B and the proposed name equivalence: lower under the installed database
   locale, trim U+0020 edges, bytewise resulting key; no NFC or accent/compatibility
   folding. Confirm conversion of supported Unicode names (including Æ/Ø/Å), new
   name length and collision preflight using existing evidence/authorized later
   validation. Canonically equivalent spellings/Greek sigma variants may differ;
   do not impose ASCII-only names. If stronger equivalence is intended, keep the
   required Unicode machinery rather than weakening uniqueness. No new request now.
2. Approve minimal replay/account-erasure retention and pin the initial four manifest
   version identities before P2. Durations already decided: detailed history12 months,
   origin character lifetime. These durations are not reopened.
3. For P1-B: exact proposed-name conflicts, new-object privilege/default closure and
   origin FK/deletion interaction must be resolved from available metadata. For the
   name index: zero collisions and accepted locale semantics. Materials FK discrepancy,
   raw creation/deletion and reported material grants are P2/activation gates, not
   reasons to add storage machinery. No hosted access or further Lovable request here.

## Smallest P1-B slice

After architectural acceptance, prepare a **local forward-migration proposal** for
two empty private tables, ordinary constraints, one shared UPDATE guard/two triggers
and exact ACL/RLS assertions. No public creation command, expiry execution, sidecar
initialization, catalog system, quota counter, account table or existing-data write.
Add the name index to the same proposal only if its policy/preflight gates are ready;
otherwise leave it for authority preparation. No fixed additional migration stages.
Later creation tests must prove concurrent fifth-slot/name winners, same-UUID replay/
conflict, full rollback and single materials grant, immutable origin, version0
continuity, receipt expiry and replay after purge. Local fixtures only when separately
authorized; hosted runtime remains independently unproven.

Existing service protected15 denied/unprotected38 allowed/no table UPDATE/browser6
and standard Lovable forward Drizzle safeguards remain unchanged. F remains CLOSED /
INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED / FRONTEND NOT PUBLISHED:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP after review. No implementation/migration, database write/access, additional
Lovable request, deployment/publication, commit/push or P1-A rewrite.
