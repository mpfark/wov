# ENG-PROGRESSION-001G-C2-P1-A — Creation storage and identity contract

**DESIGN ONLY / IMPLEMENTATION NOT AUTHORIZED / INSTALLED GATES OPEN.**

Baseline: [committed C2 blueprint](progression-001G-C2-creation-blueprint.md),
[P0 local intake](../operations/progression-001G-C2-P0-evidence.md),
[operating contract](../operations/lovable-supabase-operating-contract.md).
HEAD/fetched origin/main `9489b991b3e4c4be5c443d2fa246d0382ca62c7e`;
P0's five documentation changes existed at intake and are preserved. Recovery
stash `0a5529d5227675319b166881b10f1c91edd7486b` unchanged. This document specifies
future storage, not a migration or permission to install it. Engine Resources,
Progression/provenance and Transactional authority rules remain unchanged.

## 1. Reconciliation and evidence boundary

S = inspected repository source; H1 = supplied C1 summary, approximately
2026-10-08 09:19–09:21 UTC; H2 = owner-supplied summary of read-only inspection
2026-10-08 15:41:37–15:42:25 UTC at HEAD9489b991; P = proposal. The full H2 report
is not present in this task's available messages/files. Only the summary supplied
in response to the evidence request is reconciled; no independent hosted inspection.

| Finding | Evidence / consequence |
|---|---|
| Starting-material AFTER INSERT trigger, 40 salvage/six gems, conflict handling | H1/H2 and [source trigger:1](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1). Preserve it as sole starting-material writer; conflict handling alone does not prove exact values. |
| No automatic progression sidecar or creation request/origin/receipt storage | H2 confirms these absences as reported metadata. P1 storage is additive; P2 explicitly initializes version0. Exact prospective names/types still need namespace verification. |
| characters.user_id → account identity ON DELETE CASCADE | H2 agrees with [source FK:96](../../supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql#L96). New private proof must not inherit unreviewed account cascades. |
| character_materials character FK | H2 says absent from returned metadata, not proved absent from the database. [Initial table:24](../../supabase/migrations/20260511100538_ba7e2e71-28ff-4b13-b12e-c8f98448b8f7.sql#L24) has plain character_id UUID and a material_key FK only. [Generated types:1031](../../src/integrations/supabase/types.ts#L1031) list only material_key relationship. These do not prove installed absence or removal. Earlier claimed linkage is unverified; the narrow query below resolves it. No corrective migration inferred. |
| Materials anonymous/authenticated full direct grants, owner/Steward reads and service policy | H2 reports a pre-P1 privilege defect. Ordinary row access still depends on exact RLS; do not claim an anonymous HTTP exploit. RLS is not a substitute for removing inappropriate TRUNCATE/REFERENCES/TRIGGER rights. Separate bounded containment review required before activation. |
| Source creation/private resource/raw progression boundaries | C1/P0/blueprint retained: client-valued owner-definer creation; UPDATE-only raw fence; canonical resource helper rejects browser Auth context. New storage does not repair those boundaries. |

H2 summary does **not** supply exact name collation/index definitions, full effective
role graph, deletion body/ACLs, default grants, all triggers or server ICU/version
capabilities. P0 unknowns remain unknown where H2 has not answered them. Reuse the
original safe H2 output first; do not repeat baseline race/economy investigations.

## 2. Name identity (proposed v1; owner acceptance required)

Preserve `characters.name` as display text. For new requests trim **U+0020 outer
spaces only**, preserve capitalization/interior spaces; propose 1–24 PostgreSQL
characters after NFC normalization, without retroactive length enforcement.
Reject ASCII control characters in new input. Broader character restrictions and
whitespace folding are not inferred from the current client stripping whitespace.

Define the key as `normalize(btrim(name), NFC)` compared under a dedicated
`public.c2_character_name_ci_v1` ICU collation:
`provider=icu, locale='und-u-ks-level2', deterministic=false`.
Equality is locale-neutral ICU secondary-strength comparison: case-insensitive,
accent-sensitive, with canonical-equivalent Unicode forms comparing equal.
This is **collated equality**, not a lowercase byte string or PostgreSQL18 casefold
dependency. ICU may also equate ignorable/variant forms; approve the actual test
corpus rather than claiming simple ASCII-only equality. No accent stripping, NFKC,
confusable/transliteration rule or database-default collation fallback.

Add one global UNIQUE expression index on that exact key/collation, covering every
retained character including future tombstones. Keep the existing case-sensitive
constraint until dependency review permits retirement. No generated key column,
display-name UPDATE, legacy rename or partial new-character index. Rename/direct
service name writes must hit the same global index. Lookup equality must use the
same expression/collation; ILIKE/pattern search is not the identity authority.

UTF8/normalize/ICU support and the collation's actual provider version must be
verified before preparing executable SQL. Capture provider/locale/version in the
creation contract; detect version drift, pause affected creation/name writes and
repeat collision checks before separately authorized reindex/replacement. Never
silently refresh an immutable v1 contract. PostgreSQL documents normalization and
ICU nondeterministic equality in its [string functions](https://www.postgresql.org/docs/17/functions-string.html)
and [collation reference](https://www.postgresql.org/docs/17/collation.html).

Preflight (later read-only authorization): count total collision groups and rows
using GROUP BY the exact proposed expression/collation, including soft-deleted
rows; no names/account IDs in public output. Compare null/empty/invalid inputs and
index dependencies separately. Any collisions stop installation: owner resolves
specific cases separately; no automatic rename. Repeat under the eventual write
fence/installation lock; an earlier count alone cannot close the race. A regular
transactional unique-index build takes the necessary table lock; avoid an unreviewed
CONCURRENTLY workflow incompatible with the established hosted migration lane.

## 3. Exact proposed private storage

All objects below are in `public`, postgres-owned, explicitly private. UUIDs are
server-generated in the later authority; no serial/identity sequences are needed.
Every field is NOT NULL unless marked nullable; defaults are **none** unless stated.
These tables start empty; no existing-character backfill or normalization.

### character_creation_account_lock

| Column | Type / constraint |
|---|---|
| account_id | uuid PRIMARY KEY; FK to verified canonical Auth account PK, ON UPDATE RESTRICT / ON DELETE RESTRICT, immediate validated |
| generation | bigint DEFAULT0, CHECK >=0; increment with checked overflow on accepted create and controlled purge |
| created_at | timestamptz, server-captured |

This is a stable row for the first character as well as later ones. FK RESTRICT is
intentional account-deletion coordination, not modification of Auth schema. Future
account purge must remove eligible private records/lock only after required cleanup;
an uncoordinated Auth cascade must fail closed for accounts using this authority.
Existing accounts receive no rows during P1 installation.

### character_creation_request — minimal durable replay ledger

| Column | Type / constraint |
|---|---|
| actor_id, request_id | uuid; composite PRIMARY KEY(actor_id,request_id) |
| target_account_id | uuid |
| creation_id | uuid UNIQUE |
| result_character_id | uuid UNIQUE; never retargeted/reused |
| mode | text CHECK IN('own','overlord_delegated'); own requires actor_id=target_account_id |
| payload_version | integer CHECK =1 |
| payload_sha256 | bytea CHECK octet_length=32 |
| created_at | timestamptz |
| result_state | text DEFAULT'applied', CHECK IN('applied','purged') |
| purged_at | timestamptz nullable; nonnull iff state='purged', >=created_at |

Also declare UNIQUE(actor_id,request_id,creation_id) for the receipt's exact
composite FK; all uniqueness is immediate. Identifier/link fields and created_at
are immutable. No FK is implied merely by similarly named columns.

No Auth/character FK on identity/result UUIDs: deliberate survival of character
purge and separation from account cascades. The private authority verifies actor/
target existence before first application. These UUIDs/hashes remain private
pseudonymous personal linkage, **not anonymized data**. No request body, name,
reason, email, credential, IP address or catalog payload remains in this ledger.
Committed rows only: no durable 'pending' state; failed creation leaves no entry.
Immutable columns cannot be updated. Only controlled purge may make the one-way
applied→purged transition. Expiry/cleanup must never reset state to applied.

### character_creation_snapshot — immutable character-lifetime origin

| Column | Type / constraint |
|---|---|
| creation_id | uuid PRIMARY KEY |
| character_id | uuid UNIQUE; FK characters(id), ON UPDATE RESTRICT / ON DELETE RESTRICT, immediate validated |
| snapshot_schema_version | integer CHECK =1 |
| creation_version | text CHECK ='c2-creation-v1' |
| race_key, race_version | text nonempty each |
| class_key, class_version | text nonempty; class_key='classless' |
| formula_version | text CHECK ='c2-initial-resources-v1' |
| applied_at | timestamptz |
| applied_values, race_inputs, class_inputs, formula_inputs | jsonb; object type CHECK on each; required shape below enforced by private immutable validator and constraint trigger |
| content_sha256 | bytea CHECK length32; computed over schema/versions/inputs/values; corruption identity, not publication approval |

Race/class version identifiers are separate immutable semantic revisions, proposed
`sha256:<64 lowercase hex>` of canonical applied configuration. Store actual
configuration as well; row UUID/updated_at alone is not a revision. Creation/formula
identifiers identify reviewed rules independently of catalogs; capture exact formula
constants/rounding/caps and source revision in formula_inputs. Approved publication
authority must pin accepted revisions; a digest is not approval. No FK to mutable
catalog rows and no new catalog redesign. Future rule changes get new versions;
do not replace definitions backing v1 or rewrite old origins.
Race/class version columns CHECK `^sha256:[0-9a-f]{64}$`; their digest-to-input
equality is a P2 validation requirement. New creation/formula contracts require a
reviewed forward constraint change, never editing v1 semantics in place.

Required applied_values v1, no additional unrelated gameplay payload:
name/display and name-key contract identity; race/class/gender; base six attributes
and applied race deltas, final six integer attributes; L1/XP0/classless=true;
HP/maxHP, CP/maxCP, MP/maxMP with currents=maxima; base AC;
gold200; materials exactly salvage40 and garnet/topaz/emerald/sapphire/pearl/amethyst1;
inventory=[]/equipment=[]/family=null; discretionary pool0, six investments0,
respec tokens0, RP balance/lifetime0/ranks{}, empty earned growth/token milestones;
start-node identity and progression version0. Numeric values must fit their actual
character column types and canonical caps. The validator requires all keys/types,
integer representation and fixed baseline constants; SQL CHECKs use explicit
nonnull/IS TRUE semantics, never allow absent JSON keys through CHECK(NULL).
P2 verifies derived equality to pinned catalogs/formulas, not merely JSON shape.

Normative applied_values keys: `name` (text); `nameIdentity` (object with
contract/providerVersion/key text); `raceKey`, `classKey`, `gender` (text);
`attributesBase`, `raceDeltas`, `attributes` (each object with exactly six integer
str/dex/con/int/wis/cha keys); `level`, `xp`, `baseAc`, `gold`,
`unspentStatPoints`, `respecTokens`, `rpBalance`, `rpLifetime`, `progressionVersion`
(integers); `isClassless` (boolean); `resources` (exact integer hp/maxHp/cp/maxCp/
mp/maxMp keys); `materials` (exact seven integer keys above); `inventory`,
`equipment`, `growthMilestones`, `respecMilestones` (empty arrays); `family` (JSON
null); `investments` (exact six zero integer keys); `renownRanks` (empty object);
`startNodeId` (canonical UUID text). No absent-key defaults or extra audit fields.
race_inputs contains row identity/key, active/selectable state and actual six
deltas; class_inputs contains identity/key, active pre-class status, baseHP/baseAC
and relevant growth configuration. formula_inputs contains sourceSha, rounding/
modifier rule and exact HP/CP/MP caps/constants/AC derivation. Canonical serializer
for each hash has its own explicit version; no locale-dependent JSON formatting.

No actor/reason/request payload in origin. Immutable content cannot be UPDATEd,
including by an application definer. BEFORE UPDATE guard rejects changes; private
purge can DELETE the whole origin only at controlled permanent character purge.
Soft deletion/restoration preserves it. FK RESTRICT blocks accidental raw deletion;
origin retention ends at authorized permanent purge, not at 12-month receipt expiry.
No FK to replay ledger: account privacy cleanup must not destroy another account's
character-lifetime origin for a delegated creation.

### character_creation_receipt — detailed 12-month record

| Column | Type / constraint |
|---|---|
| actor_id, request_id | uuid composite PRIMARY KEY; FK request(actor_id,request_id), ON UPDATE/DELETE RESTRICT |
| creation_id | uuid UNIQUE; composite FK(actor_id,request_id,creation_id) to corresponding UNIQUE request columns, RESTRICT |
| schema_version | integer CHECK =1 |
| created_at, expires_at | timestamptz; expires_at equals created_at plus 12 **calendar months in UTC** |
| reason | text nullable for own; nonblank for delegated mode verified against request |
| normalized_request, applied_result, audit_context | jsonb object; exact versioned allowlist, no credentials/session data |

Creation timestamp must match its request/snapshot; deferred private consistency
trigger validates linkage/one receipt/one origin for each new applied request at
commit. It checks **new** creations, not historic requests after permitted expiry.
Receipt expiry removes the whole detailed row, not zeroing immutable origin.
No FK to characters/snapshot: controlled character purge may precede receipt expiry;
receipt retention continues within the approved 12-month audit window unless a
separately approved privacy erasure rule applies. No fabricated progression receipt.

No additional schema table is necessary for v1. If proposal names conflict with
installed objects, stop rather than CREATE IF NOT EXISTS against unknown schemas.
Trigger validators/purge/read helpers are functions and receive the same explicit
privilege treatment below; storage-only implementation must not expose commands.

## 4. Request binding, transaction and quota

Define payload_version1 canonical UTF8 serialization before hashing: a fixed-order
JSON array of contract version, mode, canonical lowercase UUID actor/target, NFC
trimmed **case-preserved display name**, race key, gender, nullable expected manifest
revision, and delegated reason/approval reference (null for own). Include no client
stats/resources/class/owner override. Strings use JSON escaping, no whitespace or
floating numbers. Domain prefix 'c2-creation-request-v1' separates this SHA256 from
snapshot hashes. Database authority alone constructs bytes; the exact serializer
gets local parity fixtures. Changed display spelling/case, target, reason or choices
under the same UUID conflicts even if the name identity collation considers them
equal. Keep serializer v1 available after receipt expiry; do not recalculate binding
from mutable catalogs. Never hash secret material.

Later P2 transaction, supported isolation READ COMMITTED; explicitly refuse other
isolation until separately proven. Authenticate nonnull actor and authorize mode
first. Acquire transaction advisory lock for(actor,requestUUID), with unambiguous
domain-separated encoding; hash collisions only over-serialize. Read request after
lock; same digest replays, different digest refuses. Replay never takes a new quota
slot or applies catalogs/materials. Recheck current ownership/Overlord read authority.

For a fresh intent: validate target, insert account-lock row ON CONFLICT DO NOTHING,
SELECT FOR UPDATE on that row, then count **all characters WHERE user_id=target**
in a separate statement after lock acquisition. Do not filter inactive/tombstones;
at count>=5 refuse with no changes. Increment lock generation only within the
successful transaction. P2 locks published race/class configuration consistently,
inserts character, lets existing material trigger run once, derives resources,
initializes progression state, then writes request/origin/receipt. Commit as one
transaction; deferred constraint failure rolls everything back. No visible provisional
character or durable in-progress request. UUID retry after uncertain transport is
the same intent, not a new UUID. Account-lock row insertion also rolls back on failure.

All creation writers must share the account lock. Controlled purge acquires required
encounter/lifecycle fences, then account lock before removing a retained row. It
must not acquire a request advisory lock after account lock: update already committed
ledger under the account lock instead. Replay reads completed ledger and does not
wait for account lock; READ COMMITTED rechecks the result before returning. No deadlock
cycle with create(request→account). Restore adds no row/slot and uses same account
boundary. Account deletion and delegated actor/target cleanup use sorted account
locks; review interaction with role/catalog locks before activating. No counter
that excludes legacy characters; count live table rows, no backfilled quota state.

Cross-table deferred consistency checks require request origin/receipt result IDs
to match on initial commit. Minimal ledger transitions after receipt/origin removal
are checked by separate maintenance/purge contracts, not a timeless 'receipt exists'
constraint. Ordinary storage callers cannot disable triggers or forge trusted flags.

## 5. Replay and retention lifecycle

| Event | Required behavior |
|---|---|
| Successful creation / uncertain response | Applied request survives commit; authorized retry returns the original result, no new grants/character. |
| Within12 months | Immutable receipt retains detailed reason/request/audit/result. Private projection returns authorized/redacted information; tables remain inaccessible. |
| At expires_at | Detailed lookup refuses as expired even if maintenance has not physically deleted row. Private bounded expiry deletes only receipt rows with expires_at<=captured UTC now. No UPDATE to origin/ledger, no extension from repeated reads. |
| After receipt expiry, character retained | Same UUID/digest returns minimal replay result/status; detailed response explicitly expired. Private origin still records actual creation values through character lifetime. No requirement to reconstruct an erased reason or return a new receipt. |
| Soft delete / restore | Both retain quota row count, origin and minimal ledger. Replay reports current authorized deleted/restored status without recreating/restoring. |
| Permanent character purge | D deletes origin within controlled transaction, updates result_state=purged, frees quota only after row removal; receipt survives to its own expiry unless approved privacy exception. Replay returns purged status; never creates another result. |
| Account privacy purge | Separate approved D/privacy procedure resolves receipts, replay linkage, origins owned by that account and lock row before Auth cascade. Delegated creators' account deletion must not purge recipients' origins. |

Recommended minimal replay retention: while the actor or target account remains
retained, keep actor/request/target/result identifiers, binding digest, mode, timestamps
and purged marker; no reasons/names/catalog bodies. Delete only through separately
approved account privacy purge after identity cannot be reused for fresh creation.
This duration/pseudonymous linkage needs explicit owner privacy acceptance; no
indefinite retention, legal basis or automatic account erasure decision is inferred.
If that acceptance is unavailable, storage FK/cleanup and activation remain blocked.
12-month detailed receipts and character-lifetime origin are requirements of this
task; they are no longer open duration choices. Maintenance scheduling/operations
are later separately authorized work, not a new world heartbeat or current job.

## 6. Privilege matrix and immutable guards

| Object / caller | postgres owner/private authority | PUBLIC, anon, authenticated, service_role and application members |
|---|---|---|
| Four tables / indexes | Implicit owner; explicit narrow private functions only | REVOKE ALL table privileges, plus enumerate/revoke any column grants; no direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER |
| All table RLS | ENABLE ROW LEVEL SECURITY; no policies; owner bypass follows established private-authority model, FORCE=false explicitly documented | Default deny; BYPASSRLS does not itself grant table privileges |
| New validators, immutable guards, lock/retention/read helpers | postgres-owned, explicit SECURITY INVOKER for pure helpers; definer only for authorized private writers/projections; fixed pg_catalog,public,pg_temp and fully qualified sensitive objects | REVOKE ALL ON each exact FUNCTION signature, before any intended GRANT; no application EXECUTE for P1 storage-only helpers |
| Sequences | None proposed; if implementation adds any, explicit owner and identity dependency needed | REVOKE ALL (USAGE/SELECT/UPDATE); no assumed table-grant propagation |
| Future owner/delegated RPC | Separate P2/P4 authorization; explicit authenticated entry permission only after validation, private authority stays inaccessible | No blanket service/default PUBLIC grant; service credential is not Overlord |
| Future receipt/origin projection | Narrow authorized wrapper and redaction, later scope | No private table grant; player own scope, support/admin approved scopes only |
| Name collation/expression | Pure database expression; no public SECURITY DEFINER naming helper | No new schema CREATE/object ownership ability; service name writers remain subject to unique index |

New-table schema CREATE privilege never goes to application roles. Object grants
must be explicit after creation within the same migration, including overloaded
function signatures; defaults may otherwise grant EXECUTE. Do not alter global
default privileges/roles as a shortcut. Inspect new objects' effective inherited
rights and PUBLIC ACL grantee0; compare actual transitive memberships. Reject direct
nonowner private grants and application inherited access; classify global platform
read authority under operating contract, not as gameplay permission. PostgreSQL's
[RLS reference](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) describes
default deny and operations outside row-policy enforcement.

P1 function signatures, each postgres-owned and EXECUTE revoked from all four
application principals/PUBLIC: `character_creation_validate_snapshot_v1(jsonb,
jsonb,jsonb,jsonb)` returns boolean, IMMUTABLE SECURITY INVOKER, fail-closed on
missing/null data; `character_creation_immutable_guard()` returns trigger,
VOLATILE INVOKER (origin/receipt UPDATE rejection);
`character_creation_request_guard()` returns trigger, VOLATILE INVOKER (immutable
binding and one-way purge marker; missing character required for purged status);
`character_creation_consistency_v1()` returns trigger, VOLATILE INVOKER (deferred
initial linkage/target ownership/timestamp/result/shape checks). Fixed search_path
as above, null handling reviewed per signature rather than blanket STRICT on
trigger functions. The snapshot validator's four arguments correspond to values,
race/class/formula inputs. No externally callable lock or retention function in
P1-B. Later mutation/projection signatures require their own explicit P2/D contract.

Immutable guards reject UPDATE to origin/receipt and ledger binding fields. Purge
and expiry are distinct private owner functions; receipt DELETE is allowed only by
expiry/privacy authority, origin DELETE only by controlled permanent purge. Trigger
and function ACLs cannot guarantee against a database administrator disabling them;
do not claim protection from postgres itself. No broad characters UPDATE grant.
Preserve service protected15 denied/unprotected38 allowed/no table UPDATE and browser6.

## 7. Trusted writers, single grants and version0

| Path | Classification and containment |
|---|---|
| Current character_create owner-definer | S+H1, browser and service EXECUTE reported; auth.uid-owned, client-valued. Not the future canonical writer. Fence old signature after callers reconciled in P4. |
| Service direct characters INSERT | H1 reported capability; no distinct ordinary service creation handler found by C1/P0. Service credential alone does not establish trusted purpose. Inventory external jobs/SQL/definers and revoke direct INSERT or route each reviewed writer through shared authority before activation. |
| Proposed delegated command | P only. Overlord identity and target/reason audit checked server-side; same lock/quota/name/baseline. Verified Edge/service transport may call narrow service-only boundary later; do not accept browser asserted actor/role. |
| Historical harness INSERTs | S dropped, E supplied absence retained. No general test/admin exemption; verify any new installed writer against approved role/purpose. No hosted fixtures. |
| grant_starting_materials | S+H1+H2 enabled AFTER INSERT. Preserve body/grant owner; exactly one trigger invocation for new character, no second material INSERT/additive grant in P2. Assert exact final seven material rows/counts, zero inventory rows before commit. ON CONFLICT DO NOTHING is not a repair of wrong existing counts. |
| Reported materials full browser grants | H2 preexisting defect; precise RLS/effective capabilities and bounded privilege containment must be reviewed separately before activation. No P1 grant expansion or FK repair. |
| Hard-delete RPC / direct DELETE / Auth cascade | P0 source bypasses, null-Auth hazard retained; H2 confirms account cascade only. Exact installed deletion bodies/ACLs still needed. D/containment prerequisite, not soft-delete implementation in P1. |

Canonical progression version0 is a **P2 dependency**: initialize one existing
progression_character_state with snapshot-compatible opaque_baseline and six invested
counters0/version0, no class-growth/respec earned rows and no progression receipt.
Do not rename opaque_baseline or relabel legacy characters. Separate creation
receipt is not an operation in progression_receipt. Existing [F continuity:257](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql#L257)
must accept the first later canonical XP event unchanged. Never call the private
resource helper by clearing Auth context or fake level gain; full creation fill
has its own reviewed adapter. P1 creates storage only, no sidecar rows.

## 8. Narrow character_materials constraint query (prepared, not executed)

Lovable: after separate read-only authorization, run only this catalog SELECT;
return timestamp/object identity and rows including empty result. It reads no
character/material/account data. Confirm table existence if empty. Do not repair
FKs/permissions or invoke the material trigger. This resolves the discrepancy,
not a request to repeat the completed H2 survey.

```sql
SELECT c.conname AS constraint_name, c.contype AS constraint_type,
       ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,n)
             JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid
               AND a.attnum=k.attnum ORDER BY k.n) AS referencing_columns,
       rn.nspname AS referenced_schema, r.relname AS referenced_table,
       ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(attnum,n)
             JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid
               AND a.attnum=k.attnum ORDER BY k.n) AS referenced_columns,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
       END AS on_delete,
       CASE c.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
       END AS on_update,
       c.condeferrable, c.condeferred, c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
FROM pg_catalog.pg_constraint c
LEFT JOIN pg_catalog.pg_class r ON r.oid=c.confrelid
LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace
WHERE c.conrelid=pg_catalog.to_regclass('public.character_materials')
ORDER BY c.contype, c.conname;
```

If character FK exists, use its exact validated/delete/deferral contract in P2/D.
If confirmed absent, retain existing behavior and record explicit material cleanup
dependency; any FK addition is a separate approved data/integrity change requiring
orphan preflight, never an automatic P1 fix. A missing/invalid table or incompatible
material-key/uniqueness contract stops affected initialization planning.

## 9. Forward sequence, preflights and acceptance

1. **P1-B first slice:** separately authorized local proposal for four empty private
   tables, keys/constraints/guards and explicit privileges. No public creation RPC,
   sidecars, retention execution, catalog publication, name rewrite or deletion.
   Gate on complete safe H2 output/remaining exact metadata, accepted retention/FK
   and naming/version contracts; no namespace conflicts. No journal number now.
2. **P1-C identity index:** after approved Unicode corpus/provider evidence and fresh
   aggregate collision preflight, propose versioned collation/global unique expression
   index. Write fencing/transactional install lock mandatory; collisions stop. No
   existing-character UPDATE or automatic cleanup; repair installed mistakes forward.
3. **P2 initialization / P3 family / P4 containment:** separately reviewed forward
   authority and caller cutover. Sole materials trigger; version0 adapter; shared
   family L1join/L10found; all direct/legacy creation and deletion bypasses contained.
4. **D/P5:** coordinated purge/privacy/retention operations and safe verification;
   no activation/publication until explicit authorization and gates passed.

Use only standard Lovable forward Drizzle lane after separate install authorization.
Supabase history, installed journal/snapshots and tooling remain untouched. P1-B
empty objects have no data backfill; recovery after installation is another reviewed
forward migration. Never restore unsafe grants/raw RPCs to recover convenience.

Preflights: exact server encoding/version/collation/provider versions; object-name
conflicts; characters account/name keys/index dependencies/ownership/RLS/ACLs;
account/proof/material FKs and creation/deletion triggers; current role/default
grant closure; approved future account purge lock contract; aggregate collisions
immediately before name-index installation. Over-quota counts are aggregate-only
later evidence; existing over-five accounts remain unchanged and new creation refuses.

Future tests/acceptance (local disposable fixtures, no hosted writes now):

- Unicode equivalence/case/accents/NFC vectors, Danish Æ/Ø/Å, Turkish I variants,
  sigma and sharp-s, whitespace/ignorable/width forms under exact ICU provider;
  existing display bytes unchanged, simultaneous names yield one winner.
- Two different intents at four retained characters create exactly one fifth;
  future tombstones count; over-five legacy accounts stay intact. Create/purge/
  restore/delegated actors share account lock and avoid cycles; unsupported isolation
  refuses, entire retry uses original UUID.
- Every transaction substep/deferred failure rolls back character, trigger materials,
  request/origin/receipt/version0; six races/fullresources/baseAC/noequipment vectors
  remain P2 parity tests, not new baseline research.
- Same UUID conflicts on any bound input; same payload after catalog change/receipt
  expiry/purge never grants twice. Concurrent replay/expiry/purge has authorized
  consistent result; absent result character fails closed, never recreates.
- UTC calendar-month boundary/leap-year tests; no details returned after expires_at;
  origin survives receipt expiry/soft delete, ends at controlled permanent purge;
  delegated actor account erasure cannot destroy target origin. Hashes are private.
- Direct/effective table/column/function/sequence rights denied for application roles;
  RLS default deny; immutable guards reject updates; missing JSON/NULL checks fail;
  required source service/browser partition preserved. Metadata checks are separate
  from runtime/concurrency proof; hosted multi-session fixture not required.
- Origin schema/config/value/version identifiers immutable; content digest/receipt
  linkage correct; first canonical XP accepts existing F version0 continuity.

**STOP gates:** incomplete H2 details for index/ACL/provider/namespace; materials FK
unverified for affected P2/D behavior; no approved Unicode/length/corpus, publication
version or minimal replay/privacy purge contract; collisions; uncontained direct
INSERT/DELETE/service/definer bypass; unknown mandatory trigger; unsafe lock ordering.
Material FK uncertainty does not justify a repair and does not by itself prevent
isolated empty private-table design. P1-B installation still needs exact constraints/
ACLs; P2/activation needs all applicable integration/containment evidence. No gate
is satisfied merely by a Git commit or design review.

F remains CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED. Preserve exactly:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP after documentation. No implementation/migration execution, hosted query,
gameplay/deployed privilege/frontend change, commit/push, item/socket/crafting work.
