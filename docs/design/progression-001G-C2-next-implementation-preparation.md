# ENG-PROGRESSION-001G-C2 — Next implementation preparation

**PLANNING ONLY / NO NEW SQL OR RPC / NOT ACTIVATED.**

Use the [approved C2 blueprint](progression-001G-C2-creation-blueprint.md) and
[P1-B contract](progression-001G-C2-P1-B-storage-proposal.md). Preserve its two-table
architecture and approved name, quota, deletion, replay and privacy rules. Affected
engine sections: Resources and attributes; Progression and rewards; transactional
authority. ENG-PROGRESSION-001G; no gameplay or heartbeat rule changed.

## Reconciled checkpoint and evidence

Local main fast-forwarded cleanly to `5ecc36c7107fe34b15262a30d9e52386fbe0294f`,
equal to fetched origin/main. Generated migration source:
`011a026db7ae17deeeaa8a3601b7f7517f422efb`. Mik explicitly reports successful
installation of `0007_progression_001g_c2_private_creation_storage`; record that as
**operator-reported**, not Codex hosted inspection. Execution time, fresh installed
ledger row/hash, current object ACLs and runtime behavior were not supplied here.

Source reconciliation proves:

- [Generated 0007](../../drizzle/migrations/0007_progression_001g_c2_private_creation_storage.sql)
  and [preserved reviewed input](../operations/progression-001G-C2-P1-B-reviewed-migration.sql)
  have identical committed bytes: SHA-256
  `6eb30eedfab8544b1d80745c4b4a844323c9ec538c0441e23f578863d90b76cb`, 11,371 bytes.
- Journal idx7/tag0007/when1791533074337/version7/breakpoints true; snapshot id
  `76477b02-3426-4e25-aebb-686c6a93c532` follows
  `84978a10-2def-4440-8bd0-ad02ce91344b`. Prior seven entries/snapshots are preserved.
  These are source identities; journal time is not a measured execution time.
- Generated types add origin/log declarations and the ordinary origin FK; they grant
  no browser permissions. Blank custom-SQL snapshot is not a full hosted-schema dump.
- Git history preserves reviewed-input copy `435d590c`, removal `2951f27f` and merge
  `99515b36` before generated commit011a026d/merge5ecc36c7. Filename collision is
  owner-reported; those commits corroborate its resolution, not database failure state.

Reviewed schema remains two private tables, one invoker guard/two UPDATE triggers,
ordinary identity/retention constraints and private ACL/RLS. No creation authority,
quota enforcement or name index was installed by this SQL. See the updated
[B2 procedure](../operations/migration-baseline-strategy.md#sql-preparation-and-tool-owned-registration-0007-evidence):
future reviewed SQL stays outside migrations until Lovable generates it.

## Recommend S2 name identity, then dormant P2-A authority

The smallest complete authority work is **one private transaction function** using
the installed storage, preceded by the independently gated name index. Prepare both
locally only after separate implementation authorization; install/cutover separately.
Do not add another table, quota counter, generic repair endpoint or catalog framework.

| Slice | Exact boundary and future database objects |
|---|---|
| S2 name identity | Prepare ordinary `characters_creation_name_key_uq`, unique expression `((lower(btrim(name))) COLLATE "C")`, all retained rows. Preserve display capitalization/accents; trim U+0020 edges only for new requests. No ICU/normalization machinery, rename, existing-row update or partial new-character-only index |
| P2-A private authority | New proposed `public.character_create_c2_internal(uuid,text,text,text,uuid,text,text) RETURNS jsonb`: request/name/race/gender/optional target/reason/expected creation revision. Derive actor from verified auth.uid(), never an actor parameter. postgres SECURITY DEFINER, fixed search_path, owner-only EXECUTE; revoke PUBLIC/anon/authenticated/service_role and effective inherited exposure. No public wrapper or enabled client caller in this slice |
| Later entry/cutover | Narrow own/delegated entry wrappers and client/admin choice-only adapters after authority verification and bypass/deletion containment. No automatic grant of the private function to service_role. Preserve the existing entry until a separately reviewed coordinated cutover |

S2 installation requires actual installed encoding/collation/lower behavior and
aggregate collisions under the exact expression. Check ordinary case, Æ/Ø/Å and
accent pairs; document special Unicode cases without claiming universal casefold.
Any collision or unsupported required comparison stops index installation. Never
rename automatically. Preserve existing server name validation (trimmed nonempty,
maximum40 in [legacy RPC:29](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L29));
the UI24 limit can remain a narrower input subset until later alignment. No new
length rule on historical names is needed for this slice.

## Private transaction contract

1. Require nonnull, existing authenticated actor. Own mode derives target=actor;
   another target requires authoritative Overlord membership and nonempty reason.
   Reject service-only identity, Steward delegation and malformed choices.
2. At READ COMMITTED acquire request namespace173201 lock(actor,request), then
   namespace173202 locks for actor/target, deduplicated and sorted by actual signed
   hashed lock key. Revalidate identities/role after locks; prove namespaces unused
   before implementation/installation. No account-lock table or Auth-row write.
3. Compute the P1-B payload-v1 SHA-256 server-side. Read actor/request log before
   catalog/quota checks: exact replay returns the original authorized status/result;
   changed payload conflicts. Purged never recreates; missing applied result refuses.
   Retired records cannot authenticate a deleted actor. Expired details are not rebuilt.
4. For a new intent validate target, then count **every retained** target character
   in a fresh statement after the account lock; reject >=5, including future soft-deleted
   rows. Existing over-quota accounts stay unchanged. Validate starting node/config
   and refuse unavailable/Test Arena destinations using the existing safety boundary.
5. Read/lock approved active selectable race and classless Wayfarer catalog inputs
   in a fixed order. Calculate **before character INSERT**, so one INSERT already
   has canonical stats, full HP/CP/MP, maxima and base AC; avoid protected-stat UPDATE
   shortcuts. Explicit level1/XP0/gold200/classless/family null, base8+race six stats,
   zero discretionary/tokens/Renown/ranks. No client-computed starting values accepted.
6. Existing AFTER INSERT material trigger is the **sole grant**: assert salvage40
   and one each of six gems, no additional material grant/upsert, inventory/equipment0.
   Unexpected initialization or quantities roll back the entire transaction.
7. INSERT compatible progression state version0 with the exact initial opaque
   projection and six zero investments; no earned growth/respec milestones or synthetic
   progression receipt. Construct the same canonical projection fields locally; do
   not call C helpers that reject nonnull Auth context, clear JWT identity or weaken
   existing guards. First ordinary progression event must pass current F continuity.
8. INSERT immutable origin (four independent version identities plus actual inputs
   and applied values) and separate applied log with digest, actor/target and detailed
   reason/audit, identical creation instant and twelve UTC calendar-month expiry.
   Commit character, trigger grants, sidecar, origin and log together. Any late failure
   raises/rolls back; never return success after swallowing partial errors.

Canonical calculations and six-race acceptance vectors remain
[blueprint section4](progression-001G-C2-creation-blueprint.md#4-transaction-calculation-and-replay-architecture-p).
No gear is necessary. Use the creation full-pool policy rather than existing clamp-only
sync; no changes to ordinary XP/resources/Renown, combat entry or unarmed d3 rules.

Pin four readable initial version labels in the reviewed server manifest; label strings
are engineering identities, not new product policy. Record actual applied values.
Validate actual catalog contents against that approved revision and refuse drift;
do not reuse a revision silently after edits. Initial labels can be constants in
the authority, with expected catalog vectors in its tests/review manifest. No new
version table, hashes or generic publication system is needed.

## Expected files in the next authorized implementation

| File | Purpose |
|---|---|
| `docs/operations/progression-001G-C2-S2-name-identity.sql` | Future reviewed index/preflight input outside migration discovery; not authored now |
| `docs/operations/progression-001G-C2-P2-A-creation-authority.sql` | Future private authority input; no locally numbered migration/journal/snapshot |
| `scripts/progression-001G-C2-P2-A-sql.test.mjs` | Future isolated exact-SQL tests; names, canonical vectors, replay, authorization, rollback and linkage |
| `docs/design/progression-001G-C2-P2-A-creation-manifest.md` | Pin version meanings and expected approved catalog/resource values |
| Existing project-state JSON/generated MD and roadmap | Record local versus installed/deployed/activated evidence |

Only later standard-tool installation creates the next numbered SQL/journal/snapshot
and regenerated Cloud types; exact numbering follows then-current prefix, not a local
claim that0008 is installed. Existing 0007, material trigger and storage guards do not
change. Frontend/Edge/admin adapter files remain outside S2/P2-A. Later callers include
CharacterCreation/useCharacter and admin creation entry, scoped at cutover.

## Blockers, owner decisions and verification

**Local preparation:** no storage redesign or new economy/delegation/retention decision
is needed. Separate implementation authorization remains required. Exact existing
catalog/trigger/identity definitions and approved initial manifest values must be pinned
when implementing; supplied summaries are not full installed dependencies.

**Installed/name/authority verification:** current name comparison/collisions, actual
role/default ACL graph, starting-node/gender/class representation, insert initialization
triggers, actual material FK and SHA-256 availability remain evidence gates. The
character_materials FK discrepancy stays unresolved; inspect before relying on cascade
behavior, never auto-repair it. Source namespace search found no173201/173202 use;
hosted absence is not established. No new hosted request/query is executed here.

**Genuine owner decision before release:** O13 catalog publication authority is still
open: who approves a new race/class creation revision when editable catalog values
change? Recommend owner/Overlord approval of a reviewed versioned source manifest;
until settled, keep the authority private and refuse catalog drift. Existing name
collision resolution requires an owner decision **only if collisions are detected**.
Do not reopen already approved name/accent, five-character, starting-value or privacy rules.

**Activation stops:** old character_create overloads, direct service INSERT/delegates
and exposed permanent deletion must be contained; no UI-only fence. Deletion/30-day
restore/account-purge implementation remains separate. Origin lifetime, delegated
recipient protection, actor-lifetime minimal replay and12-month detailed history remain
as installed; operational expiry/admin history and lifecycle integration must exist
before activation. Family joinL1/foundL10 and no-item combat integration remain their
existing scoped gates. No automatic existing-character normalization/backfill.

Required future local tests: canonical six-race vectors/empty gear; own/delegated
permission and spoof/absent account; fifth-slot and name contenders; replay after
catalog change/detail expiry/purge; changed payload; every-substep rollback; trigger-only
material grants; origin/log linkage; version0 first XP; inherited privilege refusal;
catalog drift and old characters unchanged. Use disposable local PostgreSQL to its
supported limits; do not claim serial fixtures prove hosted multi-session contention.

Retain F CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED and all four accepted limitations:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP after documentation/planning. No new SQL/RPC implementation, hosted operation,
Lovable request, migration execution, deployment, frontend publication, commit or push.
