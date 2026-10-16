# ENG-LEGACY-001G4A14 — local canonical reward/progression integration

Starting/synchronized checkpoint: `3e17bd6e1bc357a2eeff03f4bbe82a49b3a0509e`. **LOCAL / NON-DEPLOYABLE.** Source composition and regression demonstrated; production authoring/installation remains **NO-GO**. No new gameplay rule, authority policy, migration or runtime importer. This preserves [engine progression/transaction rules](../design/game-engine.md#progression-and-rewards), [creature ownership contract](../design/game-engine.md#creatures-targeting-and-initiation), roadmap ENG-LEGACY-001G4 and all earlier dispositions.

## Scope and evidence

Extends [G4A12](legacy-001G4A12-full-claim-commit-integration.md) and [G4A13](legacy-001G4A13-in-tick-departure-coverage.md) without changing either proof. Reuses the approved [G4A3 contract](legacy-001G4A3-creature-hp-contract-readiness.md), [G4A5 integration design](legacy-001G4A5-creature-hp-transition-integration.md) and completed [progression disposition](legacy-001-progression-domain-disposition.md). The new fixture drops the old progression spy/function/table and substitutes complete canonical source bodies, not a replacement calculation or success double.

- [Extractor and pinned dependency manifest](../../scripts/proofs/g4a14/source-adapters.mjs).
- [Reduced fixture extension](../../scripts/proofs/g4a14/fixture.sql).
- [Native harness](../../scripts/proofs/g4a14/postgres.test.mjs).
- [Executed PostgreSQL evidence](evidence/legacy-001G4A14-canonical-progression-postgres.txt): PostgreSQL18.6, Windows,17 PASS,8 observed independent-session blocking cases; disposable cluster stopped.

The evidence contains LF-normalized whole-file hashes and original/adapted definition hashes. These pin local composition; they are not new installed fingerprints. Existing G4A12 source graph pins25 unchanged runtime TypeScript/catalogue files. No historical migration is run as a migration: the extractor selects individual complete function/table definitions only, inside a guarded private disposable fixture.

## Exact dependency map

| Complete selected source / identity | Role and writes |
|---|---|
| [G4A12 source composer](../../scripts/proofs/g4a12/source-adapters.mjs): four `node_tick_claim` layers, five `node_tick_commit` layers, outer0017 stance guard | Actual snapshot, proposal validation, generation/fighter fences, transactional HP/effect/participation/claim/loot/batch/resource/durability/departure writes. G4A13 early multi-node coverage and commit adapter reused unchanged. |
| [0002](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql), lines71–85: `combat2_apply_claim_progression_internal(uuid,uuid)` | Locks the newly accepted reward claim; verifies encounter and nonnegative XP; requires null JWT actor; calls XP authority with reward-claim UUID/source metadata. Only committed/replayed results accepted. No separate XP writer. |
| [0004](../../drizzle/migrations/0004_progression_001e_r2_xp_body_repair.sql), lines26–113: `progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)` | Latest repaired full XP body. Character lock, same-event/payload receipt replay/conflict, configuration snapshot, canonical thresholds, level/stat/point/token updates, sidecar version, receipt and milestones. Earlier0001/0003 XP bodies are superseded. |
| [0001](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql), lines45–119: `progression_snapshot_internal(uuid)`, `progression_class_config_internal(text,boolean)`, `character_sync_derived_internal(uuid,boolean,boolean)` | Actual snapshots, six-stat class configuration/fingerprint and equipment-aware derived resources. Character lock is reentrant; class row acquired FOR SHARE. Living level-up refills HP; CP/MP clamp only. No-level XP does not refill resources. |
| 0001: `progression_character_state`, `progression_receipt`, `progression_respec_milestone`; [0003](../../drizzle/migrations/0003_progression_001e_command_authority.sql), lines103–143: growth table, `progression_verify_class_growth_internal()` and deferred binding | Actual PK/FK/check/deferred receipt consistency. Copied initial receipt operation CHECK is sufficient for this XP-only branch, not a claim that all later command operations/schema have been reproduced. |
| [0005](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql), lines423–432: latest `progression_refuse_raw_progression_write()`; original0003 binding | Complete protected-field invoker fence. Fixture runs as disposable postgres; owner bypass is expected. No browser/service grant test or privileged override authorization.0006 only changes unrelated service column privileges; it does not replace this body. |
| [F5 archive](legacy-001F5-party-parity-envelope.json), existing G4A9 extraction | Complete character/child lifecycle fences, restrict-party-leader, updated_at and encounter-lifecycle triggers already loaded. New proof adds complete `release_stances_on_death()` and its deferred HP-update binding. Living test branch returns without stance mutation. |
| [0013](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines752–781 | Pinned C2 child-trigger template additionally bound to inventory, stance/request, four progression tables, reward claims and participation. Child checks take character KEY SHARE and refuse soft-deleted dependencies. Other previously loaded bindings remain. |

Source lookup found no later replacement of these progression delegates in the retained Drizzle chain. Source owner/security/ACL intent remains in the original artifacts; the fixture changes namespace, Auth lookup, deterministic time, search_path and definer mode explicitly. It does **not** reproduce production RLS/grants or establish fresh hosted parity.

Actual execution chain:

`processNodeTickOnce → complete claim wrappers → decodeClaim → catalogue/boss adapter → resolveNodeTick → G4A13 early coverage → complete commit wrappers/core → new node_reward_claim → combat2_apply_claim_progression_internal → progression_apply_xp_internal → class/snapshot/derived helpers → receipt + milestones/deferred consistency → additive gold → death/ground loot → batch/encounter version → accounting reconcile`.

## Representative death and source fidelity

Synthetic fixture: one living40/100HP creature, generation1, a living Warrior and an attributable final DoT pulse. The fighter is absent, but the source resolver credits its attributable effect; this is a supported source reward qualification, not invented shared-node credit. An ordinary outsider receives neither XP nor gold. The actual configured catalogue/decoder/resolver and worker transport execute unchanged; successful damage, death, qualification, XP, gold and loot proposals are not hand-authored.

Effect installation itself is synthetic input, not a demonstrated player cast. Gold range3–3/chance1 and an ordinary world-pool item/chance1 are deterministic fixture configuration through existing source semantics, not production balance changes. The level1 creature produces **10 XP** through the real formula; no XP formula, proposed XP or reward validation is altered. Level2 XP199 and level9 XP4049 are separate coherent pre-award opaque-baseline fixtures near real thresholds, not modified kill rewards or historical reconstruction.

Verified whole transaction: durable/projected HP0, dead generation1, one accepted reward claim and canonical receipt, additive3gold, one ground item; ordinary no-level reward preserves10 current HP/CP/MP. Separate real awards cross L3 (STR/DEX+1, one point, deferred growth proof and actual derived maxima) and L10 (one token/milestone). Existing ordinary equipped-item stats and empty-object fallback are exercised by the derived resource SELECT; no item-policy change is inferred. Exact commit replay and direct canonical receipt replay preserve all character/reward/loot/milestone state. Conflicting receipt amount and wrong encounter are rejected.

Real invalid class configuration makes the XP authority refuse; its actual adapter raises, the bounded commit returns internal_failure, and HP/death, claim, receipt, character, loot and batch effects roll back. Restoring valid configuration permits the exact same claim/proposal retry. There is **no progression failure double**. A controlled contradictory growth record tests the real deferred trigger: commit fails and the whole explicit transaction rolls back. Unlike an in-body bounded refusal, a deferred error surfaces at transaction COMMIT; callers must not treat an earlier statement result as durable success.

Null JWT fixture transport models the owner-internal/server context required by the actual adapter. A nonnull actor is rejected atomically. Auth is a private GUC-backed lookup in this fixture, not a credential, production JWT-clearing change or proof of deployed Edge authentication. The complete restrict-party-leader trigger remains intact; changing its behavior to force a passing XP test was not needed or authorized.

## Locking and independently observed cases

Unchanged early coverage: discover → sorted node gates → party lifecycle → sorted existing encounters → discovered projection/creature rows → revalidate, without late node acquisition. Core then locks reward characters and equipment rows in source order. Reward insert creates/locks its claim, canonical XP reacquires its character, takes class FOR SHARE, writes sidecar/receipt/milestones; derived helper reacquires held character/class locks. C2 child checks take KEY SHARE on those characters; receipt FK/deferred checks add no new node gates. Progression helpers introduce no advisory node acquisition or encounter back-edge. No unresolved new inversion was found in this selected chain or observed cases; this is not proof of global deadlock freedom.

| Independent sessions; blocker confirmed with `pg_blocking_pids` plus ungranted `pg_locks` | Result |
|---|---|
| 1 Death/reward commit versus regeneration | Node gate blocks settlement; committed dead creature remains0 with no eligibility. |
| 2 Newer death versus expired old claim | Gate blocks old commit; replay/stale refusal cannot duplicate reward or restore HP. |
| 3 Progression versus lifecycle transition | Character transaction lock blocks tombstone write until reward transaction commits; receipt-validated lifecycle fence then accepts transition. |
| 4 Concurrent exact replay | Node gate blocks second commit; already_committed, one XP receipt/token/gold/loot outcome. |
| 5 Canonical refusal versus retry | Gate blocks retry while invalid-config refusal is held; restored config then allows one successful original request. |
| 6 Death/reward versus guarded ordinary respawn | Existing G4A7 guard waits on node gate; complete source respawn creates generation2 at due time. Old committed request replay cannot award again or overwrite generation2. |
| 7 Progression versus class config edit | Class transaction lock blocks writer until captured-config award commits; receipt/derived HP retain old24 base HP. |
| 8 Tombstone before reward | Character transaction lock blocks commit; real lifecycle fences cause atomic refusal after tombstone wins. No death/receipt/claim/loot persists. |

Cases3/8 deliberately insert a synthetic matching lifecycle receipt and issue its transition UPDATE through the complete fence; they do **not** execute the complete supported soft-delete RPC or prove all its dependencies. This isolates the directly relevant row/trigger boundary without bypassing it. All sessions explicitly use disposable READ COMMITTED, statement/lock/deadlock timeouts. Blocking is observed, not inferred from a sleep. Production caller isolation remains unknown.

Additional actual-source observation: unguarded ordinary respawn sees the pre-commit living row and **skips an uncommitted death**, rather than waiting. An initial test incorrectly expected blocking there; the final suite separates this MVCC behavior from the guarded serialization case. Once death commits, the later guarded ordinary pass respawns correctly. This is not a demonstrated hosted race or a production respawn fix. A development extractor also initially overmatched an inline search_path clause; only the new fixture extractor was corrected, with complete bodies retained and no production SQL change.

## Remaining boundaries and next recommendation

The reduced inherited tables, fixture scope/Auth/hidden-path/Combat1 catch-up dependencies, deterministic clock, fighter-HP cache and selected historical source composition remain explicit doubles/adaptations. Ordinary ground drops are tested; unique-item claim/pickup, Arena, scheduler, full lifecycle RPCs, character death with active stances, inventory destruction, all live trigger composition and every reward kind are not demonstrated. Salvage is disabled in this representative fixture; the accepted E13 salvage-channel discrepancy and Assassin contract completion/rewards remain unresolved. One eligible recipient does not establish multiplayer reward distribution. Historical F5/Progression parity evidence is not a fresh installed/deployed observation.

**Source integration demonstrated; NO-GO for production authoring/installation.** The canonical XP spy gap is closed only for this bounded local path. Remaining gates include guarded Admin DML/configuration and legacy healing composition, sleep/scheduler/installed caller isolation/parity, broader trigger composition and retained private queued-party support disposition. No old queued-party finalizer was restored. No deployment or runtime claim follows from these tests.

**Smallest recommended next separately authorized slice:** local full-source guarded creature Admin save/configuration integration, including maximum-HP/rate/node/delete entry points and their direct triggers under the existing coverage protocol. Reuse G4A8 and this real progression chain; test class/character/resource interactions without redesigning equipment or repairing unrelated authority. It is a proposed task, not current implementation authorization. Retained private queued-party support still needs explicit owner disposition before any corresponding production repair.

Preserve G4-R1/G4-R2/G4A9-R1/E13/G/parent OPEN; G4A11 installed-parity gate BLOCKED; G3 correction deferred/G3D BLOCKED. Prior B–F/progression closures, privileged v3→v2/external-caller uncertainty, Combat1 risk, deferred F1 retry UUID and all four OPEN progression F limitations remain. Administrative XP grants remain paused. Normal gameplay XP earning is not intentionally disabled; its hosted behavior is not established here.

## Validation and handoff

17 native tests PASS,8 observed independent-session cases;49 focused worker/roundtrip/Edge-packaging/project-state tests PASS. Final3 project-state tests rerun after documentation update PASS; JSON/Markdown synchronized.21 repository references/2 anchors valid; JavaScript syntax, baseline ancestry, source preservation and whitespace checks PASS. Earlier state records/statuses are unchanged, with only baseline/time, one operational evidence record and proposed next-task handoff updated. No production imports changed, so no application build/typecheck is needed for these private `.mjs`/fixture changes; actual runtime TS executes natively and Edge packaging parity passes.

Nine scoped files: three new proof files, native evidence, this report, G audit index, roadmap, JSON/generated state. No production source, old proofs/candidates/evidence, migration/journal/snapshot, generated database types, application runtime or grants changed. No hosted, real gameplay, scheduler, Lovable, deployment or frontend publication operations. Recovery stash preserved. Git push transports non-deployable local proof/evidence only.
