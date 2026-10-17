# ENG-LEGACY-001G4A21 — public Creature HP transition wiring

Starting/synchronized SHA: `c342a3272bb5774dd702d2bd0876ffcbb4a0b4b5` (recorded baseline is an ancestor). **Public-source correction authored and locally executed; NOT INSTALLED/DEPLOYED. Frontend activation OFF.** G4/parent remain OPEN. No Cloud/gameplay operations, generated database types or migration-history changes. Recovery stash preserved.

## Implementation

[Consolidated SQL candidate](legacy-001G4A21-shared-hp-candidate.sql), SHA-256 **`91092a0013fb325f2100797fa1d07d655b8d0a793400b959be382aa882857e3f`**, replaces the uninstalled G4A19/G4A20 candidates; never apply sequentially. One transaction contains the previous Admin/accounting bootstrap, legacy-healer cutover and actual public function patches. It is outside automatic migrations. [Authoring tool](../../scripts/proofs/g4a15/prepare-public-hp.mjs) pins G4A20 and reuses complete source extraction; [shared hook fragment](legacy-001G4A21-shared-hp-hooks.sql) is assembled into that exact candidate, not a separate installation.

| Existing public function changed in the candidate | Change |
|---|---|
| `combat_enter(uuid,uuid)` | Early full coverage; settle before activation and reconcile after success. |
| `combat2_hostile_action(uuid,text,text,uuid,uuid)` | Same boundary around actual hostile-first-action transaction. |
| `combat2_depart(uuid,uuid,uuid)` | Origin/destination/member coverage before source movement and arrival. |
| `combat2_party_depart(uuid,uuid,uuid)` | Same, including accepted off-node members and pending invitees. |
| `combat2_arrive_after_relocation(uuid,uuid)` | Nested coverage assertion and accounting; naked post-row arrival fails40001 instead of acquiring unseen late node locks. |
| `node_tick_claim(uuid,integer)` | Settle before claim; successful lease immediately resets eligibility. Refusal rolls settlement back. |
| `node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)` | Discover proposal destinations and party dependencies before rows; origin lease untouched until original validation; reconcile after committed result only. Replay does not repeat settlement. |
| `node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)` | Persist optional generation/encounter-validated creature `engaged` proposal alongside existing HP/tank fields. Reward/progression code unchanged. |
| `respawn_creatures()` | Early coverage around complete ordinary source body; fence retained old-generation claims, initialize new generation without retroactive credit. |
| `regen_creature_hp()` / `heal_creatures_on_wake()` | Existing maintenance delegates to shared settlement; wake performs no instant healing or late node locking. Exact old-body guards and unchanged owner/security/settings/ACL assertions. |

Three private helpers introduced relative to G4A20: `creature_hp_discover(uuid[],uuid[])`, `creature_hp_cover(uuid[],uuid[])`, `creature_hp_account(jsonb)`. No new public RPC family, table, package, scheduler, heartbeat or receipt. Existing five proposed accounting columns/Admin action RPC are carried forward unchanged. Existing reward RPC remains separate. Legacy Combat1 encounter/session/effect exclusions are retained as additional blockers, without repairing Combat1.

Public patches read the original definition, verify normalized **body MD5 drift fingerprints** against pinned source, transform only actual RETURN statements into a labeled inner-block result, and wrap the existing body with shared coverage/accounting. They do not copy a second predecessor body or add cloned RPCs. Original return expressions evaluate once; original owner, SECURITY DEFINER setting, search_path and ACL must compare equal after replacement or the installation aborts. MD5 here is a source-drift guard, separate from the whole candidate's SHA-256 identity and fresh installed-parity requirement. A returned refusal rolls back accounting plus original body effects within the same subtransaction while preserving its JSON result; exceptions propagate/roll back normally. Existing inner bounded-failure/replay/stance behavior remains.

Coverage follows sorted node gates → party lifecycle → sorted encounters → projections/creatures → original character/member work. Party/member/location/generation/reference discovery is revalidated under locks; drift raises40001. Nested calls must stay within previously held node coverage. The transaction-local coverage value only restricts nesting; it never substitutes for acquiring or validating locks. No late new node discovery is accepted. Claims/version/generation gates and durable/projected HP parity remain mandatory; inconsistent retained HP refuses rather than restoring old projection HP or silently repairing history.

## No-fighter lifecycle works locally

The real [resolver](../../src/shared/combat2/resolver.ts) uses its existing living/present-participant definition. With none left, it preserves outstanding casts, nonexpired/nondeleted relevant effects, newly proposed effects, unconsumed events and unresolved captured intents. A due cast still follows existing no-target/ability-missing resolution; departure does not cancel it early. Only after pending work resolves does the resolver propose `engaged=false`, clear the creature tank reference and end the encounter. Death retires the dead caster's future cast/target state (dead casters already cannot act), preserving consequences resolved earlier in that tick. Party tank metadata/selection is unchanged.

The commit persists that transition under its existing encounter/generation/version validation, then starts the eligible interval. Regeneration guards were not weakened to heal active encounters. Durable wounds and same-generation projection HP stay synchronized. Re-entry settles completed quiet intervals, reactivates combat, and resets eligibility. Default2%/4seconds, first award at4seconds, fractional carry, old-rate settlement, no blocked-time credit and ordinary respawn are unchanged. [Canonical specification](../design/game-engine.md) records the implemented local lifecycle interpretation, not a hosted claim.

## Executed evidence

[Native output](evidence/legacy-001G4A21-public-hp-postgres.txt): **51 tests PASS**, PostgreSQL18.6, disposable cluster stopped.37 reused cases plus14 new public-source cases. Four new observed independent-session cases: commit versus maintenance, claim versus maintenance, maintenance versus re-entry, and identical reward commit/replay. Together with ten reused cases this suite has14 observed blocking cases; historical cases retain their documented accounting/fixture boundaries. pg_locks/pg_blocking_pids observations and explicit READ COMMITTED; no global deadlock or hosted concurrency claim.

[Native tests](../../scripts/proofs/g4a15/public-hp.test.mjs) execute the **entire consolidated SQL transaction**, including drift/metadata guards, against complete original entry/hostile/movement/arrival/claim/commit/ordinary-respawn definitions in the existing reduced schema. Calls go directly to the patched function identities, not G4A9/G4A12/G4A13 accounting wrappers. Worker decoder/catalogue/resolver and canonical XP/receipt/milestone delegates are real source. Explicit fixture substitutions: namespace `public`→`g4a6`, Auth identity, deterministic clock, fixture search_path and INVOKER execution; drift hashes are recalculated solely for those substitutions. Existing reduced schemas, selected trigger bindings, Combat1/Arena/scheduler doubles and isolated G4A10 party-result qualification remain. This does not prove full production RLS/FK/security/Arena/scheduler composition or installed parity. Newly modified runtime graph is explicitly repinned; archived earlier manifests/evidence remain unchanged.

Covered: solo/final-party departure, pending telegraph through due no-target resolution, surviving DoT/expiry, wounds before4seconds and healing at4/8/20eligible seconds, interruption/re-entry, actual queued in-tick movement/arrival, stale projection refusal, death/respawn generation, source drift rolling back bootstrap, legacy blockers, and canonical class-config failure rolling back death/gold/loot before concurrent exact retry pays once. Reward fixtures use the unchanged reward RPC; character fixture seeding respects actual lifecycle/protection triggers. No reward values/formulas were changed to obtain passing results.

The current G4A20 compatibility suite also passes49 tests; its old retained-engagement assertion is updated to the now-correct resolver outcome. Its archived original evidence remains unchanged. Combat2/application/state tests:257 PASS; typecheck and production build PASS (existing large-chunk warning). Four migration-inventory tests,23-entry journal/snapshot chain,184 local references, JSON/Markdown synchronization, prior-state preservation and whitespace PASS. The build-generated unrelated MCP bundle was restored to its original blob and excluded. No build is deployment or frontend publication.

## Remaining deployment gates and disabled paths

- **NO-GO for installation now:** fresh permitted source/owner/settings/effective-ACL/trigger/caller-isolation parity and exact forward review/recovery remain outstanding. G3D/G4A11 blocked routes stay BLOCKED; no workaround is authorized. G4A9-R1 remains OPEN: party tests still use the explicitly isolated SQL qualification, not proof that installed party movement is corrected.
- Standalone post-relocation arrival without early coverage is deliberately refused. Existing supported solo/party/in-tick movement is covered; unknown teleport/raw-table/privileged callers require disposition before activation. No new browser grant or fallback.
- Noncooperating legacy/external writers are not made safe by cooperative node locks. Legacy blockers are observed conservatively; an entirely unobserved external combat interval cannot be reconstructed. Retained mismatches require separate evidence/disposition, never automatic repair. Full production trigger/Combat1 lock composition, bulk-maintenance scale and actual caller isolation remain limitations; bounded tests do not prove global deadlock freedom.
- Database-first cutover is mandatory: candidate install/reconciliation under separate authorization; then deploy the matching resolver Edge source; only after compatible backend verification deliberately enable the existing Admin gate and Mik manually publishes. SQL with the old resolver remains conservative/blocked after departure; do not deploy the new resolver ahead of the matching database handling and healer cutover. No installation/deployment/publication happened here.
- Recovery must preserve wounds, generations, receipts and history. Keep incompatible operations disabled; do not revert by re-enabling independent full-heal writers or replay historical migrations. Exact installed before/after definitions/ACLs and a separately reviewed forward recovery artifact are required for installation authorization.

G4-R1/G4-R2/E13/G/parent OPEN, G3 deferred, G3D/G4A11 BLOCKED; all earlier closures, four progression F limitations, Combat1/privileged delegation uncertainties and deferred F1 retry correction preserved. Administrative XP grants remain paused; normal gameplay XP is not intentionally paused or newly hosted-verified.

## Complexity and next action

Publication delta (standalone consolidated SQL counted as runtime; it carries forward uninstalled bootstrap; evidence is documentation) is recorded after staging below. Three new private runtime helpers; eleven existing SQL identities patched/replaced; resolver/type and generated Edge mirrors changed. Zero new tables/dependencies; no cloned predecessor bodies or second accounting implementation. Native harness/extraction is reused.

| Category | Added | Deleted | Net |
|---|---:|---:|---:|
| Runtime SQL/TypeScript including Edge mirrors | 900 | 10 | +890 |
| Tests/extraction fixtures | 183 | 6 | +177 |
| Documentation/state/evidence | 176 | 11 | +165 |
| Tooling/configuration | 77 | 0 | +77 |

Smallest next action: a bounded review of this exact consolidated candidate and its source/ACL/lock prerequisites, followed by preparation of permitted installed-parity evidence when an approved read-only route exists. No further architecture/proof hierarchy and no automatic installation. Frontend remains gated until separately authorized matching backend verification.
