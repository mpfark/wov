# ENG-PROGRESSION-001E-R2 — Exact XP authority body reconciliation

**R2 PREPARED / READY FOR NARROW HOSTED XP BODY RECONCILIATION.**
**EDGE NOT DEPLOYED / TRAINER-ORDER COMMANDS PAUSED.**

Prepared 2026-10-07. Initial task_start_sha:
`daf38a44d30130dc60fa40ab8abd9dba72835879`.
Fetched and fast-forwarded source baseline / origin/main:
`26b7a9d8924159840d79ce40e15fc8d8f1767540`.
Recorded baseline `06c888eb790ab9d1797d82f55cb4c2e216cdad6e` is an ancestor.
Final commit/push identity is reported in delivery, avoiding a self-referential SHA.

Affected specification sections: Progression and rewards; Resources, provenance
and trainer; transactional authority; Failure, diagnostics and verification.
Roadmap ID ENG-PROGRESSION-001E. This is an exact-object-identity repair: all
progression rules, XP/growth/receipt/resource/lock behavior and the single world
heartbeat remain unchanged. Specification and roadmap scope do not change;
operational installation evidence belongs in project state.

## Supplied hosted evidence and preserved history

First attempt: historical payload SHA-256
`175d0c15c0f82a79c9682e0dca01c17f360eff88ab48fcf9fd0fedd650930266`
(40840 bytes / 451 LF lines), failed the final sidecar assertion and fully rolled
back. [R1 report](progression-001E-R1-reconciliation.md) remains unchanged history.

Second attempt: reviewed R1 payload SHA-256
`734e6a1934372b548003e0336b9207998f6da8de01057e66ad63ef5950569b40`
(41673 bytes / 461 LF lines) installed via standard Drizzle as
`0003_progression_001e_command_authority.sql`, entry 4 / index 3, with one extra
leading ASCII space on line 340, the first ineligible_source refusal line inside
progression_apply_xp_internal. Installed size reported: 41674 bytes / 461 lines.
Operator supplied installed migration SHA abbreviation `225cb43a…9968`.

The synchronized checked-in 0003 file and locally reconstructed one-space variant
are exactly equal, with full SHA-256:
`225cb43a26f63f8e9a5645bb60ab0b273847773a5c51310d75ac118721419968`.
That full value is locally derived repository/artifact evidence, matching the
supplied abbreviation; Codex has not independently read the full hosted ledger
hash or hosted function body. Neither 0003, journal, snapshot nor generated types
is rewritten by R2. A repository commit title is not evidence that the hosted
function has been corrected. Current checked-in 0003 still contains the deviation.

Operator reports all final R1 containment assertions passed: growth/control tables
installed, postgres-owned, owner-only ACLs, RLS enabled, no policies; enabled=false;
command service_role-only; projection authenticated-only; join/switch, bond,
Renown and crafting entries fenced; XP primitive owner-only; raw progression-write
fence installed; character fingerprint identical before/after. No Edge deployment,
runtime progression command or frontend publication occurred.

Supplied authority inventory identifies pg_read_all_data, pg_write_all_data,
supabase_read_only_user and supabase_etl_admin as database-wide authority, with no
role/membership change. This is operator-reported evidence, not local hosted
inspection. The old predicate's pg_ name exclusion means the two predefined roles
cannot themselves have matched that old scan; the supplied inventory does not
change that predicate fact. R1's semantic authority classification remains unchanged.

Current hosted state, **operator-reported**:
**INSTALLED / CONTAINMENT VERIFIED / XP BODY IDENTITY RECONCILIATION REQUIRED /
EDGE NOT DEPLOYED / TRAINER-ORDER COMMANDS PAUSED**. Do not describe E as fully
verified. The natural runtime path and hosted multi-session behavior remain unproven.

## Canonical function identity

Signature: `public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)`.
Exact definition is extracted from the unchanged reviewed R1 payload, not manually
reconstructed. Canonical guard convention is SHA-256 of UTF-8 prosrc after CRLF→LF
only. No trim, whitespace collapse or semantic approximation is introduced.

| Evidence layer | SHA-256 / value |
|---|---|
| Canonical normalized prosrc | `9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde` |
| Known one-space normalized prosrc | `962c01151256ab2eec3b30ed3dbd2ba449d59745cf5ca8cf760911c1f502561d` |
| Canonical pg_get_functiondef, local PGlite renderer | `aef765cf2e6432561035449883f23bde55bab494582047077cc79c4c36cd95a9` |
| Owner / language / security | postgres / plpgsql / SECURITY DEFINER |
| Fixed search_path | `pg_catalog, public` |
| Return / volatility / parallel | scalar jsonb / VOLATILE / UNSAFE |
| Arguments | `_character uuid, _event uuid, _source text, _offered numeric, _metadata jsonb DEFAULT '{}'::jsonb` |
| Strictness / leakproof / cost / rows / support | not strict / false / 100 / 0 / none |
| Intended ACL | postgres EXECUTE only; no nonowner direct/default/PUBLIC or ordinary effective EXECUTE |

pg_get_functiondef identity is a **local renderer diagnostic**, tested against the
exact canonical definition. It is not used as a cross-version hosted acceptance
hash. The actual guards check exact normalized prosrc plus complete signature,
default, language, owner, security, search_path, volatility and privilege metadata.
This proves the resulting authority without making migration-file SHA, prosrc SHA
and renderer SHA interchangeable.

## Narrow forward artifact and fail-closed acceptance

[Repair SQL](progression-001E-R2-xp-body-repair.sql), outside migration discovery:

```text
SHA-256 22c46ca442e625e67cf44c97c8f81dd8bba831ad3a7a45e73c4f5dcf5aa0452b
11776 UTF-8 bytes / 137 LF lines
```

[Manifest](progression-001E-R2-manifest.json) separately records the reviewed R1
source, modeled installed migration, both body identities, local rendered identity
and exact repair/generator release identities. .gitattributes pins R2 release LF.

Only one existing database object may change: the above XP function. The script:

1. Requires the known one-space body or already-canonical body, exact metadata,
   one overload and owner-only direct/effective function ACL. Any other drift aborts.
2. CREATE OR REPLACEs the exact reviewed R1 definition, retaining the existing OID.
3. Explicitly reasserts postgres owner, SECURITY DEFINER, fixed search_path and
   owner-only EXECUTE; no other object or privilege changes.
4. Requires the canonical body hash and same complete security/signature/ACL checks.

Known gameplay principals are checked even if assigned superuser authority;
ordinary inherited EXECUTE, including inherited postgres ownership, also refuses.
Existing custom grants are refused, not silently revoked. Already-canonical replay
is accepted only with exact metadata/ACL, avoiding overwrite of unknown drift.

No table, command control, command/projection, growth relation, trigger/raw fence,
legacy/crafting/admin/Combat2 function, character or gameplay behavior can be altered
by this artifact. Transaction ownership belongs to a future standard Drizzle tool
invocation; an unexpected precondition or final assertion must roll back everything.
No full E replay, rollback of E or additional migration lane is prepared.

## Text migration limitation and future handoff

Three evidence layers stay separate: A reviewed repair intent/artifact; B installed
migration ledger/file identity; C canonical resulting database object identity.
C is the critical acceptance boundary. Text formatting outside the function may
make A/B file hashes differ; record that accurately, never fabricate equality.
Any body transcription deviation (including a space) fails the final body guard.
Do not adjust expected hashes to fit a newly transcribed body.

A future **separately authorized** standard Drizzle task must read this exact
artifact and manifest, freshly inspect the known deviated/canonical body and
security metadata, prove commands remain paused and dependencies/operational state
appropriate, install the narrow repair once, and recover ledger evidence plus
post-install canonical prosrc/security/ACL and untouched-object/data/control proof.
Use the same SQL SHA expression as the guards, not a whitespace-collapsing hash.
A differing migration-file hash alone cannot prove or disprove canonical authority;
inspect its difference and prove C exactly. Unknown drift is a STOP, not overwrite
permission. No installation, Edge deployment or activation is authorized by R2.

## Local acceptance and preservation evidence

| Check | Result |
|---|---|
| New exact-artifact R2 SQL regressions | 8 passed |
| Focused progression/reference/UI and Combat2 ownership/resource tests | 252 passed |
| E full-payload SQL / actual Combat2 chain | 22 / 11 passed |
| D integration / containment | 9 / 6 passed |
| Root / app / node / strict Edge typechecks | All passed |
| Production build | Passed |
| Full Vitest against established R1 baseline | 2730 passed / 18 failed; identical 18 failure identities, no new failure |

The R2 tests model the exact known deviation, unknown semantic/whitespace bodies,
owner/security/search_path/volatility/default/direct/PUBLIC/service and inherited
ACL drift, exact canonical result, safe repeated application, final-guard rollback
of an injected transcription error and CRLF-only normalization. Public function,
relation, trigger, policy and constraint catalogs plus all public table rows are
compared before/after; control remains false and a real character is unchanged.
Known deviated and repaired bodies yield identical XP receipts and durable data in
rollback-only local transactions. The R1 payload and every R1 manifest source hash
remain unchanged. These are disposable PGlite0.3.14 tests, not hosted or true
multi-session proof.

Deterministic R2/R1/D manifest checks, state synchronization and whitespace checks
passed. Project-state tests passed 3/3. Build/test generated MCP
bundle and two snapshots are restored to synchronized source, not included in R2.

## Handoff and stopping point

Migrations authored: R2 operations artifact only; no discovery/journal registration.
Migration installed: E 0003 per supplied operator evidence; R2 **not installed**.
Generated types: remote operator-generated change retained; no local type regeneration.
Edge: progression-command undeployed per operator; no local deployment.
Frontend: operator reports no publication for E; no local publication.
Cloud/gameplay operations: none; local fixtures only. F/G/H untouched.
Recovery stash `0a5529d5227675319b166881b10f1c91edd7486b` preserved unchanged.
Normal commit/push authorized after acceptance; final clean state reported in delivery.

**HOSTED MULTI-SESSION BEHAVIOR UNPROVEN.**
**NATURAL RUNTIME PATH NOT YET OBSERVED.**

**ENG-PROGRESSION-001E-R2 PREPARED**
**READY FOR NARROW HOSTED XP BODY RECONCILIATION**
**EDGE NOT DEPLOYED / COMMANDS PAUSED**

STOP. Installation needs new explicit authorization; Edge deployment remains gated
on successful exact XP authority reconciliation and its own authorization.
Activation/publication remain separate; Mik alone publishes the frontend.
