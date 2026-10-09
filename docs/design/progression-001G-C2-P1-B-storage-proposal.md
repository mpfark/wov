# ENG-PROGRESSION-001G-C2-P1-B — Simplified storage proposal

**PROPOSAL COMPLETE / NOT IMPLEMENTED / INSTALLATION NOT AUTHORIZED.**

Recommend **two private tables**, one shared UPDATE guard, two guard triggers,
ordinary constraints and transaction-scoped advisory locks. This replaces the
four-table architecture proposed in [P1-A](progression-001G-C2-P1-A-storage-contract.md)
for prospective implementation; that historical document remains unchanged.
The owner approved the preferred [simplification review](progression-001G-C2-P1-A-simplification-review.md)
architecture and name/replay/privacy decisions in the P1-B request. This document
specifies their implementation; it grants no implementation or installation authority.

Baseline: [committed C2 blueprint](progression-001G-C2-creation-blueprint.md),
[P0 evidence](../operations/progression-001G-C2-P0-evidence.md), and
[operating contract](../operations/lovable-supabase-operating-contract.md).
HEAD and fetched origin/main: `9489b991b3e4c4be5c443d2fa246d0382ca62c7e`.
Recovery stash: `0a5529d5227675319b166881b10f1c91edd7486b`, unchanged.
Affected boundaries: Progression/provenance and Transactional authority;
ENG-PROGRESSION-001G. Approved gameplay rules and the shared heartbeat are preserved.

## 1. Facts versus proposals

**Local source:** creation currently accepts client starting values
([RPC:18](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L18));
the starting-material trigger grants 40 salvage and six gems with conflict handling
([trigger:1](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1)).
Progression version 0 is an opaque baseline with its own state/receipt schema
([C:6](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L6));
first-command continuity is checked by
[F:257](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql#L257).
The legacy hard-delete authority exists in
[source:1](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql#L1).
These references do not establish installed definitions or runtime reachability.

**Reported hosted observations:** owner-supplied inspection summary, 2026-10-08
15:41:37–15:42:25 UTC, at the same HEAD: starting-material trigger enabled; no
automatic progression sidecar or creation request/origin/receipt storage;
characters.user_id has an account-identity ON DELETE CASCADE FK; character_materials
has reported broad anonymous/authenticated grants and restrictive row policies.
The material-to-character FK was **absent from the returned metadata**, not proved
absent from the database. It remains unresolved. No automatic FK repair is proposed;
the existing narrow constraint query in P1-A remains unexecuted. No new Lovable request.

Everything below is **proposed**, including exact object names, guards and ACLs.
It adds no independently verified hosted fact.

## 2. Exact storage inventory

Use `public` for these ordinary postgres-owned tables, with private ACLs/RLS, rather
than adding a schema. UUIDs are supplied by the trusted authority; no sequence,
identity generator or new extension is needed for storage. All columns have **no
default** unless explicitly stated below; authority supplies values explicitly.
Constraints are immediate, validated and not deferrable.

### public.character_creation_origin

| Column | Type / nullability | Meaning |
|---|---|---|
| character_id | uuid NOT NULL | PRIMARY KEY; FK public.characters(id), ON DELETE RESTRICT, ON UPDATE RESTRICT |
| snapshot_schema_version | smallint NOT NULL | CHECK = 1; future format requires a reviewed forward change |
| creation_version | text NOT NULL | Approved creation-policy revision |
| race_version | text NOT NULL | Approved race-catalog revision |
| class_version | text NOT NULL | Approved classless/class-catalog revision |
| formula_version | text NOT NULL | Approved calculation revision |
| applied_snapshot | jsonb NOT NULL | CHECK jsonb_typeof(...) = 'object'; actual inputs and starting values |
| created_at | timestamptz NOT NULL | Server creation instant |

Each version has `CHECK (btrim(version_column) <> '')`. No mutable-catalog FK,
checksum, actor account FK or deletion cascade. The PK is its only required index.
No existing character receives an origin row or changes values during storage setup.

Snapshot v1 has these fixed sections, constructed by one trusted creation writer:

- `choices`: preserved display name, race identifier and permitted gender choice.
- `inputs`: base attribute vector, applied race deltas, classless catalog identifier,
  class base HP/AC, and actual formula parameters/caps. All six attributes explicit.
- `initial`: level 1, XP 0, classless Wayfarer, final six attributes, gold 200,
  HP/CP/MP current and maximum, base AC and other persisted derived starting fields;
  discretionary points, respec tokens, Renown/lifetime points 0 and ranks `{}`;
  family null, equipment `[]`, inventory `[]`, materials salvage 40 and each of
  garnet/topaz/emerald/sapphire/pearl/amethyst 1.
- `progression`: version 0, exact initial opaque baseline, six invested counters 0,
  no earned class-growth/token milestones and no synthetic progression receipt.

Four top-level version columns identify meanings frozen by approved server revisions;
the snapshot records applied values even if catalogs later change. Do not use only
mutable catalog IDs or updated_at as version identities. Initial labels and the
server manifest are pinned during P2 authority review, not required to create empty
storage. No delegated actor/reason, request payload, IP, token or unrelated account
identity is placed in lifetime origin data. Character ownership remains in characters.
Renames or progression never UPDATE this creation-time snapshot.

### public.character_creation_log

This is the **separate creation receipt**, also retaining minimal replay data after
receipt expiry. Its independent primary key allows the two lifecycles below.

| Column | Type / nullability | Meaning |
|---|---|---|
| log_id | uuid NOT NULL | PRIMARY KEY; server-supplied opaque row identity |
| actor_id | uuid NULL | Verified authenticated account owning the replay key |
| request_id | uuid NULL | Actor-scoped creation intent UUID |
| target_account_id | uuid NULL | Requested character owner; necessary delegated binding |
| result_character_id | uuid NULL | Committed result UUID, survives character purge |
| payload_version | smallint NULL | CHECK NULL or = 1; retained digest algorithm identity |
| payload_digest | bytea NULL | CHECK NULL or octet_length(...) = 32; SHA-256 request binding |
| replay_status | text NOT NULL | CHECK IN ('applied','purged','retired') |
| created_at | timestamptz NOT NULL | Server creation instant; same as origin |
| details_expires_at | timestamptz NOT NULL | Twelve UTC calendar months after created_at |
| detailed_receipt | jsonb NULL | CHECK NULL or jsonb_typeof(...) = 'object'; private detailed audit |

Exact additional constraints:

- UNIQUE `(actor_id, request_id)` using ordinary NULL-distinct uniqueness.
- UNIQUE `(result_character_id)` using ordinary NULL-distinct uniqueness.
- CHECK: status applied/purged requires all six nullable replay fields nonnull;
  status retired requires **all six null**. Enumerate each IS NULL/IS NOT NULL;
  do not rely on a CHECK expression that can pass as SQL NULL.
- CHECK `details_expires_at = (((created_at AT TIME ZONE 'UTC') +
  interval '12 months') AT TIME ZONE 'UTC')`. UTC calendar arithmetic is independent
  of session TimeZone. No retention interval configurable by callers.

No FK from the log to characters or either account: a cascade would destroy replay
or history prematurely, and RESTRICT would unnecessarily prevent controlled purge.
The authority verifies live identities/result linkage at INSERT. No failed/in-flight
ledger row is committed: validation failures roll back, and successful INSERT has
status applied and nonnull details. Replay after purge is an explicit terminal result.

Additional index: `(details_expires_at)` WHERE detailed_receipt IS NOT NULL for expiry.
No separate actor index (covered by actor/request uniqueness), target lookup index,
status index or JSON index initially. Controlled account cleanup is infrequent and
can scan this small log; add an index only on measured need. No redundant receipt table.

Detailed receipt v1 records actor/target/mode, delegated reason (required for another
account), normalized choices and accepted revision, digest version, result UUID,
version identities, applied outcome and authorization/audit context sufficient for
debugging. It contains no credentials or unrelated personal data. Audit is retained
only here for 12 months, not copied into lifetime origin. After expiry replay returns
only authorized minimal result/status; it does not reconstruct an expired receipt.

## 3. Name identity without ICU infrastructure

Proposed unique index name: `characters_creation_name_key_uq`, expression
`((lower(btrim(name))) COLLATE "C")`, **no WHERE clause**. Lower conversion uses the
name expression's actual installed locale; final C comparison distinguishes bytes
and therefore accents. Display capitalization is unchanged. New commands trim only
U+0020 edge spaces before storing the display name; preflight applies the expression
to existing names without rewriting them. No NFC, accent stripping, compatibility
folding, custom collation or generated key column. Existing case-sensitive constraint
can remain; it is redundant but harmless. Name changes must obey the same index.

This is PostgreSQL locale-aware lowercase equivalence, **not a claim of universal
Unicode casefolding**. Before index installation validate actual comparison behavior:
ASCII case; Æ/æ, Ø/ø, Å/å; É/é equal but e/é distinct; representative permitted Unicode
case pairs; dotted/dotless I, sigma and ß/SS documented edge cases; composed/decomposed
accents and space-only names. Test on the actual installed encoding/collation/provider,
not a guessed local locale. If supported-name case pairs are not case-insensitive,
stop that index installation; do not silently weaken the approved requirement.
No automatic rename and no ASCII-only fallback. Name length/UI alignment is P2 input
validation work; no unapproved length restriction is added to existing rows.

Immediately before installation: aggregate collision-group counts using the **same
expression**, null/blank-name counts and relevant index/constraint inspection. Any
collision or unknown behavior stops the index stage for owner-directed resolution;
report no public character names. A transactionally created ordinary unique index
is the final concurrency arbiter. It changes no existing name bytes, but intentionally
changes future name-write validation; keep this separately gated from empty storage.

PostgreSQL documents [expression uniqueness](https://www.postgresql.org/docs/17/indexes-expressional.html)
and [locale-aware lower conversion](https://www.postgresql.org/docs/17/functions-string.html).

## 4. Atomic authority and lock order

Later P2 implements one shared private creation authority behind narrow owner and
Overlord entry checks. Authentication must prove a nonnull **existing** actor account;
a stale JWT alone is insufficient after permanent account deletion. Recheck authoritative
Overlord role/reason for delegation; service credentials alone confer no delegation.
Server derives actor, classless baseline and all protected values. No user-supplied
stats, resources, family, class, items or quota exemption.

At READ COMMITTED, acquire `pg_advisory_xact_lock(integer, integer)` in this order:

1. Request namespace `173201`: second key = `hashtext(actor_uuid::text || ':' ||
   request_uuid::text)`. UUID canonical text and delimiter make the input unambiguous.
2. Account namespace `173202`: second keys = `hashtext(account_uuid::text)` for actor
   and target, **deduplicate and sort actual signed integer lock keys ascending**.
   Own creation takes one account lock; delegation takes at most two. Sorting hashed
   keys avoids reversing order even in the unlikely event of a hash collision.
3. Only then acquire log/character/catalog row locks needed by this command.

Reserve/check these two namespace numbers against existing source/installed lock
users before implementation/installation. No lock-helper function or lock table.
Hash collisions serialize unrelated work; they cannot authorize or merge requests,
which are still compared by real UUIDs/digests. Avoid session-level advisory locks.
Transaction locks release on commit/rollback as
[PostgreSQL documents](https://www.postgresql.org/docs/17/explicit-locking.html).

After locking, revalidate actor existence and authorization in fresh statements.
Read actor/request log; matching digest/version/target returns original authorized
result, including explicit purged status, without grants or quota recount. Any changed
payload refuses. An applied result inexplicably missing its character fails closed.
Retired rows have no replay key and cannot authenticate a deleted actor. Soft deletion
does not create again or restore; replay respects the later lifecycle projection.

For a new intent, validate target existence, then count **all** target characters after acquiring the account lock,
in a fresh READ COMMITTED statement, without any soft-delete filter. Reject at >=5;
legacy over-quota accounts stay unchanged. Insert explicit canonical character,
let the existing starting-material trigger grant once, assert exact materials and
zero inventory/equipment, calculate/fill canonical HP/CP/MP and AC, insert compatible
progression version 0, immutable origin and applied log, then commit together.
Any failure rolls back the character, trigger writes and every sidecar. Do not call
the existing C resource sync as an initial-fill shortcut: it rejects nonnull Auth
and clamps pools rather than implementing creation fill (blueprint section 4).

Payload v1: server constructs a fixed JSONB object containing mode, target UUID,
trimmed display name (case preserved), race, gender, expected revision or JSON null,
and delegated reason or JSON null. Hash UTF-8 bytes of its PostgreSQL JSONB text
representation with SHA-256, including a fixed `wov.creation.payload.v1:` prefix.
Actor/request are the independently checked key. Keep v1 serialization/comparison
for old keys across upgrades and prove fixture parity before upgrades; do not hash
secrets or mutable catalog state. P2 verifies available SHA-256 support or supplies
an ordinary supported implementation; storage needs only bytea, not an extension.

Permanent character/account purge must take the same sorted account locks before
row writes and mark result purged in the **same transaction** that removes origin
and character. It never subsequently acquires request locks; this prevents account→
request cycles. Actor-account deletion also retires that actor's replay fields.
Receipt expiry takes only log row locks and never waits for account/request locks.
Other cooperating writers must obey this order. Raw INSERT and exposed hard-delete
bypasses still need containment; advisory locking alone cannot fence them.

## 5. Retention, immutability and the two-table adjustment

Relevant account for a replay key is its **authenticated actor**: only that identity
can retry `(actor, request)`. Target permanent deletion marks the result purged but
does not erase a still-existing actor's replay protection. Controlled permanent actor
deletion clears the six replay fields and sets status retired, while any unexpired
detailed receipt finishes its approved 12 months. Recipient origin is unaffected
when a delegated creator disappears. Account UUIDs are never reused as a new identity.

The simplification review's literal composite actor/request PK cannot be cleared
independently of its receipt. That is a concrete incompatibility with removing replay
records at account deletion **while retaining unexpired history**. The surrogate
log_id plus nullable, constrained replay group resolves it within two tables. This
is an implementation adjustment, not shortened audit retention or a reopened policy.
The detailed admin audit may still identify the actor until its separate expiry;
minimal replay removal does not mean immediate erasure of approved 12-month history.

At details_expires_at, all authorized history projections filter details as expired;
a private maintenance operation physically sets detailed_receipt NULL. Live-actor
rows retain only necessary UUIDs, digest/version, status and lifecycle timestamps;
they are private pseudonymous data, not anonymous. Retired rows with expired/cleared
details are deleted. Missing maintenance is an activation stop, not justification to
retain details indefinitely. No scheduler infrastructure is proposed in P1-B.

One `public.character_creation_storage_guard() RETURNS trigger`, postgres-owned,
SECURITY INVOKER, fixed `search_path = pg_catalog`, with schema-qualified references;
attach one BEFORE UPDATE FOR EACH ROW trigger to each new table:

- Origin: reject every UPDATE, including no-op updates. DELETE is only a private
  controlled character-purge operation; FK RESTRICT blocks unrelated character
  deletion until that origin is deliberately removed.
- Log: log_id, created_at, expiry never change. Details may only remain identical or
  become NULL at/after expiry, using statement_timestamp(); no additions/replacements.
- Replay fields never change while live. Allow applied→purged only with identical
  replay fields and no remaining result character. No purged→applied transition.
- Allow applied/purged→retired only when the old actor no longer exists in auth.users
  and all six fields become NULL. No retired→live transition. Account cleanup performs
  this after removing the actor within its transaction. No Auth write is part of the
  guard. Reject any other field/status change; NULL-safe comparisons required.

No INSERT trigger, generic JSON-schema validators, deferred cross-table validators,
origin digest or mutable update timestamp. The sole owner-private authority constructs
INSERTs and asserts semantic linkage; constraints/guards reject malformed shapes and
later mutation. Owner/admin superusers remain a trusted operational boundary, not
an application caller. DELETE/TRUNCATE cannot be granted to application roles.

## 6. Explicit privilege matrix

| Principal | Two tables / columns | Guard EXECUTE | Later functions |
|---|---|---|---|
| postgres owner | Owner rights; trusted reviewed internal operations | Owner rights | Owns fixed-path authority/expiry/purge/projection functions |
| PUBLIC, anon, authenticated | None, including SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER | Explicitly REVOKE | No private primitive access; authenticated gets only separately approved public entry/history wrapper signatures |
| service_role | None; BYPASSRLS is not a table grant | Explicitly REVOKE | No new private access or delegation; any maintenance entry requires later narrow approval |
| Other inherited application/platform principals | Effective application mutation/read of these private tables denied | Effective private EXECUTE denied | Inspect actual capability/membership; platform administrative read is distinct from gameplay access |

In the future storage migration: ALTER OWNER postgres; ENABLE ROW LEVEL SECURITY
on both tables, no policies, FORCE RLS false so owner-private authority can operate;
explicit REVOKE ALL PRIVILEGES ON each table FROM PUBLIC/anon/authenticated/service_role
and discovered application grantees; also revoke any effective column grants.
Explicit REVOKE ALL PRIVILEGES ON FUNCTION guard() from those callers immediately
after definition. Creating the owner-attached trigger does not expose a callable RPC.
Assert owners, RLS, empty policies, table/column ACLs, inherited access and exact
function grants after installation. Unexpected default/inherited grants stop it;
do not solve them with broad global default-privilege changes or PUBLIC schema changes.
No sequences: no sequence grants. No new application role memberships or existing
table grants are changed by empty storage.

Preserve service protected15 denied / unprotected38 allowed / **no table UPDATE**,
and authenticated six preference columns. Later trusted creation must explicitly
contain raw service-role character/inventory INSERT, old creation overloads and
definer/delegate bypasses; do not remove service writers without dependency evidence.
The reported material privileges and raw deletion authority remain separate containment
gates. No gameplay access follows from platform administrative read authority.

## 7. Minimum forward-only sequence and tests

| Stage | Proposed change | Gate / local acceptance |
|---|---|---|
| S1: empty private storage | One forward Drizzle migration containing two tables/constraints/indexes, one guard/two triggers, owner/RLS/REVOKEs and ACL assertions. No creation function, initializer, grants to public wrappers, backfill or existing character UPDATE | Verify installed public.characters(id) type/unique target, auth.users identity, namespace/object-name conflicts and effective privilege assumptions before installation. Local disposable PostgreSQL compilation/behavior tests after separate implementation authorization |
| S2: name index | Separate forward migration for the ordinary expression unique index, once comparison/collision gates pass | Actual database locale/case/accent tests and fresh aggregate preflight; stop on collisions. Ordinary transactional index; no migration-history edits or concurrent-index runner machinery |
| Later P2/D/P4 | Shared creation authority and version-0 initializer; private expiry/admin projection; separately scoped deletion/actor cleanup and legacy writer containment; callers/cutover | Requires S1/S2 plus exact installed dependencies, canonical vectors, rollback/replay/permission tests. No activation without deletion containment and operational retention cleanup |

S2 may be combined with S1 only if all its independent gates are already satisfied;
the **smallest next executable implementation slice** is S1 local SQL preparation
and isolated tests, after explicit authorization. Assign the next migration number
only against the then-current Drizzle journal. Preserve executed Supabase/Drizzle
SQL, journal, snapshots and ledgers; installation uses the established separately
authorized Lovable forward lane, never a local production runner or history rewrite.

Future S1 tests: compile constraints/guard/UTC month arithmetic (leap/end-of-month),
malformed/null combinations, UUID uniqueness, immutable origin, forbidden log changes,
expiry before/at deadline, active replay after expiry, purge terminal status, account
retirement with unexpired detail, receipt completion after retirement, delegated
creator deletion preserving recipient origin, FK RESTRICT, all application ACL/RLS
denials including inherited/default grants, zero sequences, existing rows unchanged.

Future P2 tests: same UUID lost response/different payload/changed catalogs; concurrent
same-intent requests, fifth-slot and name contenders; count tombstones; injected
failure at every substep; single material grant; no gear/inventory/family; gold200;
six-race full resources/AC; version0 and first canonical receipt continuity;
nonnull/absent/spoofed actor, non-Overlord/service-only delegation, missing reason;
account-purge/replay races and hashed lock collisions. Use disposable local fixtures,
never hosted gameplay writes or required hosted multi-session fixtures. Storage tests
alone do not prove these command behaviors. None were executed in this proposal task.

## 8. Stop/go gates and retained limits

**Local S1 preparation:** no remaining owner policy decision blocks writing a reviewed
local migration/test proposal. Exact schema above resolves the two retention lifetimes.
Implementation itself still needs new authorization. Installation requires exact
object-name/type/privilege/lock-namespace confirmation; source is not installed proof.

**S2 installation:** actual locale/name comparisons and collision preflight remain
unverified. These are evidence gates, not reopened name policy. No automatic rename.

**P2 / eventual activation:** exact material/dependency/FK and initialization metadata,
version labels/manifest publication, available digest support, version0 parity,
raw service/legacy writer containment, deletion/account-purge integration, authorized
physical expiry execution, family L1 joining/L10 founding, and no-item combat snapshot
integration must be settled in their scoped packages. The material FK discrepancy is
not a reason to block empty-table preparation or automatically alter old constraints.
No new owner decisions are invented; contradictory later evidence stops only its
affected package. Soft deletion/restore implementation remains separate D.

F remains **CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED**, with all four accepted limitations:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP. Documentation proposal only: no migration file, runtime implementation, hosted
access/request, gameplay write, deployed privilege change, commit/push, installation,
activation, deployment, frontend publication or item/socket/crafting work.
