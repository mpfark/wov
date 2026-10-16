# ENG-LEGACY-001G4A19 — simplified Creature Admin implementation

Starting/synchronized checkpoint: `64f568ba9c7542d196f2543b18403bb79eecbb48`. **Local application implementation and tested SQL candidate; frontend activation OFF; NO-GO for hosted installation now.** Owner approves G4A18 replay amendment and replaces the60second/5%-per-minute rule with default2% maxHP per4eligible seconds. Canonical rules updated; historical reports retain their original results. ENG-LEGACY-001G4 remains OPEN.

## What changed

| Source | Actual change / boundary |
|---|---|
| [SQL candidate](legacy-001G4A19-admin-candidate.sql) | One public admin_creature_mutate(text,uuid,jsonb,jsonb) action RPC (save/create/move/delete); postgres-owned SECURITY DEFINER, fixed pg_catalog/public/pg_temp, existing nonnull actor and Steward/Overlord check. No arbitrary fields, current HP/stat/generation/accounting input or new ledger. Private cover/blocker/settlement/reference helpers, five creature accounting/config columns and narrow table/column browser DML denial with effective-permission assertions. No live grants changed. |
| [CreatureManager](../../src/components/admin/CreatureManager.tsx) | Config-only payload/dirty expected fields; no direct INSERT/UPDATE/DELETE or generated HP/stats input. Authored/base aggression is distinguished from engine-effective aggression. Stable create UUID and immutable pending command; uncertain failure retains it and prevents replacement. Metadata preserves untouched rich boss documents. Read authoritative HP/config after success; truthful separate reward refusal/unknown feedback. New2% per4seconds rate field/HP preview. Existing reward RPC/receipt code remains separate. |
| [Shared transport](../../src/components/admin/creature-admin.ts) | Small config diff/response decoder plus RPC call. CREATURE_ADMIN_ENABLED=false prevents contact with an incompatible backend; no fallback. Unknown outcomes require review/retry, never automatic fresh identity. This flag is a deployment gate, not authorization. |
| [NodeEditorPanel](../../src/components/admin/NodeEditorPanel.tsx) | Move/unassign calls the gated RPC with old node expectation; removed direct creature node writes. |
| [PopulatePanel](../../src/components/admin/PopulatePanel.tsx) | Stable per-proposal identity/immutable command, explicit per-row success/failure; no raw HP/stats/reward insert. Unsupported generated humanoid/legacy reward payloads refuse rather than silently changing loot semantics. Reapplying completed in-panel rows skips them. |
| [CreatureLootModesTab](../../src/components/admin/loot/CreatureLootModesTab.tsx) | Legacy single/bulk mode writes refuse without mutation; no invented mapping to canonical rewards. |
| [Existing harness extension](../../scripts/proofs/g4a15/admin-boundary.test.mjs), [harness](../../scripts/proofs/g4a15/postgres.test.mjs), [source loader](../../scripts/proofs/g4a15/source-adapters.mjs) | Reuse full G4A15 fixture, role helpers, reward/commit source and observed-blocking infrastructure. Historical Admin handlers are now explicitly loaded from pinned Git checkpoint d2b03318 when current source differs, hashes unchanged. New current-handler/DOM tests below inspect actual changed source. Added connection cleanup between cases, not higher server limits or relaxed assertions. |
| [Focused application tests](../../src/components/admin/__tests__/creature-admin.test.tsx) | Actual new handler initializers test metadata payload, partial reward refusal, stable create retry/blocked replacement and duplicate-click fence. Real component renders disabled4-second input/activation gate; pure diff/decoder tests. Synthetic closure/transport tests are not a real authenticated browser/backend. |

Candidate SHA-256: **`adb27d6dcb0b2334f53fc07a6d71e95fc6ca778e931681e80c2cc9ac7321ec8a`**. Kept under docs/operations, pinned LF via .gitattributes, outside automatic migrations. Existing Supabase/Drizzle files/journal/snapshots, Cloud types, reward/progression/Combat2 runtime SQL and Edge Functions unchanged.

## Implemented local semantics

Metadata only locks the creature row and writes name/description, never HP/max/accounting. Touched-field stale checks ignore unrelated HP/tick changes; already-desired returns already_matches without settlement. Protected operations take early sorted node gates → party lifecycle → encounter rows → dependent rows, then revalidate; no late node locks. Concurrent same-ID creation uses one identity mutex before coverage; a duplicate returns identity_exists and requires explicit reconciliation, not historical replay. No new receipt or retention/cleanup infrastructure. Delete missing returns already_absent, not proof of original execution. Known FK (including cascade/set-null) and documented non-FK references refuse deletion/unassignment; no history cleanup. Noncooperating external writers and full installed reference coverage remain gates.

Server formula mirrors generateCreatureStats for level/rarity; tested all three rarities against the real source formula and missingHP floor; rich boss catalogue validation remains a release dependency. Max edits settle completed old-max intervals, preserve absolute missing HP/living floor1; dead state is not revived. Rate edits settle completed old-rate intervals, discard fractional remainder per retained rate-edit policy and reset accounting cursor to edit time. Unfinished portions of an interval are not awarded at edit; no new rate/max is retroactively applied. Max edits also start a fresh cursor to avoid crediting the new maximum over old elapsed time. Desired-value no-ops do none of this again.

Private creature_regen_settle uses elapsed **completed4second intervals**, exact numeric fractional HP, same-generation projection synchronization/version fencing and generation initialization.75maxHP/2%:1HP at4s,2more at8s. Active encounter (even no visible fighters), effects, pending actions/intents/events or uncleared claims block; re-entry observation resets eligibility/fraction, next quiet observation starts a new interval. Existing wounds/new generations receive no retrospective credit; dead creatures do not regenerate. Eligible sleep time can be accounted later. No scheduler, trigger or second heartbeat is installed.

**Important limitation:** the new helper is not yet wired into every real entry/claim/commit/departure/respawn/settlement transition. Tests invoke the new helper at explicit transitions; historical full-chain cases still execute their original timing model. A blocked period that is never observed cannot be inferred later from timestamps. Therefore this helper is not safe to activate alongside independent legacy healers or without the required transition calls. No claim that full-engine new timing is already integrated.

## Fail-closed gaps, not silent implementation claims

- Protected save/config with retained projections returns integration_required; active encounter/blockers refuse. Move/unassign/delete conservatively refuse retained references. Approved safe-ended projected reassignment is still not supported by this candidate. Do not relax guards to make the UI succeed.
- Changed/new nonnull rich boss_cast returns unsupported_boss until the real validator/catalogue contract is integrated server-side. Metadata can preserve an unchanged document. No guessed validation or boss balance change.
- Browser raw DML is denied in the candidate; legacy SECURITY DEFINER helpers may still expose writes depending on installed ACLs. Table denial alone does not prove exclusive HP authority. Fresh scoped parity/effective rights/reference/trigger and actual caller-isolation evidence remain required, through a permitted route only.
- Pending create/config intents are held in the mounted editor, not durable storage/history. Reload closes that evidence; reconcile actual state before another create, never infer a missing identity authorizes automatic recreation. Populate identity_exists/unknown results need manual reconciliation; no silent success claim. No cross-tab recovery or consumed-ID guarantee.
- Existing reward transactions are unchanged and separate; no combined atomic save promise. If configuration succeeds and reward fails, configuration remains. No administrative XP grant implementation.

## Validation and source fidelity

**37 native PostgreSQL18.6 tests PASS**:25 historical G4A15 cases plus12 new candidate tests.10 observed independent-session cases overall:8 historical compositions plus new metadata-row versus real damage commit and regeneration versus protected-max update. Sessions explicitly READ COMMITTED with real pg_locks/pg_blocking_pids observations; this is not hosted concurrency or global deadlock proof. New candidate executes complete SQL bodies, definer ownership and browser/service ACL checks in the reduced private schema; namespace, Auth lookup and deterministic clock substitutions are explicit. Real source role helpers/reward validator/selected claim/commit/progression/ordinary respawn are reused. Full production trigger/RLS/FK/scheduler/Arena composition is not proved. [Native output](evidence/legacy-001G4A19-admin-postgres.txt).

Run: node --experimental-strip-types scripts/proofs/g4a15/admin-boundary.test.mjs "C:\Program Files\PostgreSQL\18\bin". Disposable cluster is stopped after tests. Initial sandbox initdb WAL rename permission failure required an approved local unsandboxed run, not a hosted route. Development runs exposed duplicate fixture-column setup, retained test-client exhaustion and a SQL text-edit/parser defect; these were corrected without weakening tests. Final output records the passing candidate, not the failed iterations.

Application validation includes24 focused tests (9 new boundary/handler/DOM,5 reward,7 boss form,3 state), typecheck and production build. Build emits the existing large-chunk warning. The Vite test/build MCP plugin regenerated an unrelated local Edge bundle; that generated change was restored to the starting blob and excluded. No application build is deployment or frontend publication. Documentation links/sync/history/whitespace and final hash checked before publication.

## Exact cutover and next action

**Next smallest action: finish existing shared HP transition integration and server boss/projected-config compatibility locally using G4A7–15 code—not another redesign or new proof hierarchy.** Candidate is partial, so do not install it as a completed HP fix. Keep all Admin writes gated until supported operations/compatibility are reviewed.

Then obtain fresh permitted scoped installed parity, caller isolation, trigger/reference and effective writer permissions. Review final exact forward SQL and recovery under the established Drizzle lane; no historical edits/replay. Only after separate authorization: database install/reconciliation first, affected Edge deployment only if actually changed, then deliberately enable the client gate for the compatible backend and Mik manually publishes frontend. Any unresolved operation remains explicitly disabled. Legacy regen/wake cutover must accompany shared HP activation, never dual independent healers. Recovery preserves wounds/history and fails closed; do not regrant raw HP writes. Disposable live acceptance is separately authorized.

G4-R1/G4-R2/G4A9-R1/E13/G/parent remain OPEN; G4A11/G3D BLOCKED; G3 correction deferred. Previous B–F/progression closures, four OPEN progression F limitations, Combat1/privileged-delegation/external-caller uncertainties and deferred F1 correction preserved. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled. No hosted operation, migration application, deployment, scheduler action, Lovable call or frontend publication. Recovery stash preserved.

Final documentation/preservation checks PASS:23 scoped files,76 local references/3 anchors (including preserved historical canonical anchors),2 Mermaid diagrams structurally checked (34 nodes; no renderer claim), JSON/Markdown synchronized, prior state records/statuses and history/reward/Edge/generated-type sources preserved, recovery stash unchanged. Whitespace checked before commit.

## Exact scoped file inventory

```text
.gitattributes
docs/architecture/README.md
docs/architecture/creature-admin-authority.md
docs/architecture/creature-hp-readiness.md
docs/architecture/wov-ownership.md
docs/design/game-engine.md
docs/operations/evidence/legacy-001G4A19-admin-postgres.txt
docs/operations/legacy-001G1-world-creatures-quests-preparation.md
docs/operations/legacy-001G4A19-admin-candidate.sql
docs/operations/legacy-001G4A19-simplified-admin-implementation.md
docs/operations/project-state.json
docs/operations/project-state.md
docs/roadmap/game-engine-roadmap.md
docs/roadmap/game-ideas.md
scripts/proofs/g4a15/admin-boundary.test.mjs
scripts/proofs/g4a15/postgres.test.mjs
scripts/proofs/g4a15/source-adapters.mjs
src/components/admin/CreatureManager.tsx
src/components/admin/NodeEditorPanel.tsx
src/components/admin/PopulatePanel.tsx
src/components/admin/__tests__/creature-admin.test.tsx
src/components/admin/creature-admin.ts
src/components/admin/loot/CreatureLootModesTab.tsx
```
