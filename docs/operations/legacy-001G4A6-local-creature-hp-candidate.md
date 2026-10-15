# ENG-LEGACY-001G4A6 — Local creature HP authority candidate

2026-10-16. Starting/fetched source: `dc6c01834897d5fb7e8811e710e685925b9bb48e`.

**LOCAL CANDIDATE EXERCISED; NOT production-integrated or installation-ready.** G4-R1 remains OPEN. No production runtime, UI, Edge, SQL definition, schema/migration history or hosted state changed. The authorized SQL runs only in fresh disposable local databases, not Supabase. No new scheduler or service.

## Artifacts and exact scope

- [candidate.sql](../../scripts/proofs/g4a6/candidate.sql): isolated accounting/guards and reduced integration functions. SHA-256 `c2dd470dc8776724d82035487f1f6089f8bbfbfe687690791dcd86f073126d9b`.
- [fixture.sql](../../scripts/proofs/g4a6/fixture.sql): reduced encounter, creature, projection, fighter, effect/intent/event tables; SHA-256 `56515f801679377e2912414d12f322577b8927197d7d38236e86f6f22762cb78`.
- [postgres.test.mjs](../../scripts/proofs/g4a6/postgres.test.mjs): launches its own loopback-only temporary cluster; accepts a PostgreSQL binary directory, **no database URL**. Databases named `g4a6_fixture_*`; candidate refuses other databases or a missing fixture marker before creating functions. Objects use `g4a6`, not `public`; never copy/register this file as a production migration.
- [Final native run output](evidence/legacy-001G4A6-local-postgres.txt):26 PASS, zero failures/skips, including4 independent-session cases. Server automatically stopped after tests. Temp fixture files retained outside the repository; no recursive deletion or existing database access.

Function bodies are **new local implementations**, not replacements/copies of the complete installed Combat2 chain. Entry/hostile admission, seed, claim, commit, departure, reassignment and respawn paths are explicit reduced integration doubles. They exercise real SQL transactions, constraints, rollback and advisory/row locks around the candidate arithmetic, not Auth, party machinery, cron, world DDL, reward delegates, lifecycle triggers or the full resolver. Invoker functions run as the disposable owner; PUBLIC EXECUTE is revoked on these fixture functions. No production security/owner/grant change or effective hosted authority is inferred.

## Approved contract now represented

Reuse [G4A3](legacy-001G4A3-creature-hp-contract-readiness.md), [G4A4](legacy-001G4A4-creature-regen-accounting-proof.md) and [G4A5 source hook design](legacy-001G4A5-creature-hp-transition-integration.md). Owner now selects **at most two decimal percentage places**, combat-entry fractional reset, wounded maxHP preserving missingHP, and safe ended-encounter reassignment. Earlier four-place/absolute-HP/inactive-reassignment-deferral proposals are historical and superseded where these decisions apply; they are not implementation evidence.

Unchanged approved rules: durable `creatures.hp`, coherent same-generation projection, stale-claim fences, persistent living wounds, relevant combat/DoT/pending blockers,60 seconds uninterrupted OOC eligibility, default5% for new/existing creatures without historical credit, rate0–100% inclusive, zero disables regeneration only, fractional credit between eligible settlements, eligible sleep credit without continuous ticks, ordinary dead respawn, active-attachment rate/reassignment refusal.

## Exact accounting and transitions

Rate is integer hundredths of a percentage point per minute,0–10000 (5%=500). Parser accepts canonical decimal text up to two fractional places, rejects negative/out-of-range/exponent/NULL inputs and excess precision including `5.000`; there is no silent rounding. Text length ≤6. This technical input grammar can be normalized in a future UI, but server bounds remain authoritative.

Credit is an integer numerator with fixed denominator **600,000,000,000**: `max_hp × rate_bps × eligible_elapsed_microseconds + previous_credit`. Whole HP is floor(total/denominator), remainder persists; cap at maxHP discards surplus credit. Products use exact SQL numeric, while rate/remainder/HP have bounded native storage. MaxHP uses a positive PostgreSQL integer fixture bound. No floating-point division or per-missed-tick loop. PostgreSQL timestamps retain microseconds; repeated exact cutoff is idempotent; nonfinite/backwards cutoffs refuse.

Proposed minimal persistence remains four conceptual values on the durable creature: rate, nullable eligible_since, accounted_through and fractional numerator, scoped/reset by existing spawn_seq. The fixture adds these on its own reduced table only. No new HP authority/table is proposed for production.

- Initialization sets the cursor at the supplied cutover and quiet eligibility no earlier than that cutoff, without healing old wounds. Blocked/unknown historical time is never inferred. Existing rate defaults5; an ordinary new life retains its individual rate.
- Eligibility settles only after eligible_since+60seconds. Source-shaped `engaged` plus present living fighters blocks; empty/ended encounter status alone does not. DoTs/source effects, relevant aura, pending cast, pending intent and unconsumed event block using the conservative G4A4 adapter. Effects are resolved explicitly; wall-clock expiry alone does not release blockers during sleep. Stale-generation target fences do not address a new spawn.
- Entry settles previously proved OOC time, preserves whole HP, discards fractional credit and closes eligibility. Release starts a new full delay only after the last blocker is gone. A live passive claim defers maintenance without moving its cursor; authoritative entry retains its existing right to invalidate a claim before changing combat state.
- Eligible sleep is just elapsed time at the next settlement, not a wake heal or a new timer. Repeated wake/cutoff earns nothing twice. FullHP has no banked healing; dead creatures receive none.
- **Rate-edit fraction policy remains proposed:** settle old rate to edit cutoff, preserve already-earned fraction and quiet history, then apply new rate to future time only. Active attachments refuse, including empty active encounters. Preserving credit across disabling/re-enabling needs owner confirmation; it is not covered by the new combat-interruption discard decision.

## MaxHP and reassignment guards

For a living wounded creature, candidate settles old parameters, calculates old_missing = old_max−old_hp, then new_hp = new_max−old_missing. Increase100→120 at40HP gives60HP; decrease120→80 gives20HP, preserving60 missingHP. No generic full refill. Dead HP remains0. Active-attachment max edits are conservatively refused in the candidate; this stricter policy remains a proposed production guard.

If new_max−old_missing≤0, default behavior is **refuse and roll back the entire edit/settlement**. An explicitly test-only `allow_floor=true` branch evaluates the proposed floor1. Example:20/80→max30 would become−30; floor1 forgives31 damage and leaves29 missingHP, so exact missingHP preservation is impossible. The owner must choose refusal versus this exception. The candidate does not silently approve the floor, kill a living creature, revive a dead one or expose an approved client override.

Reassignment holds sorted old/new node gates and encounter coverage. Refuse active attachment, relevant effects, pending cast/intent/event or any outstanding claim token, even an expired uncleared one. A safely ended origin can transfer the same runtime-row identity/generation to an existing ended destination encounter, synchronize HP and fence both encounter versions. No new generation, duplicate projection or automatic effect deletion. The fixture tests this approved quiet transfer.

**Unresolved production transfer composition:** current source has global UNIQUE(creature_id,spawn_seq); archived event/effect references, deletion/FK behavior and actual destination encounter creation must be reconciled before using the fixture's rebind in production. This candidate requires an existing ended destination encounter; unassignment, active destinations, missing-encounter creation and historical rows are not fully implemented. Owner's quiet-reassignment approval is retained, not reopened; safe production realization remains a technical gate.

## Lock/version protocol and executed evidence

The candidate discovers creature node/current projection and optional destination, acquires sorted existing `combat_enter_node:` advisory gates, sorted encounter rows, current-generation projection rows, then durable creature row. It revalidates assignment/generation/coverage; drift raises40001 without late node acquisition. Reentrant calls preserve this hierarchy. Existing production character/party and trigger composition is absent, so no global deadlock-free claim.

Passive settlement changes durable and projection HP together; HP changes bump encounter version and clear stale/expired claims. A live lease is deferred. Pre-claim settlement yields the synchronized HP/version; generation and NULL-safe token/version/tick/lease guards reject stale or incomplete commits. Damage/death result, release/blocking state and version changes share one SQL transaction. Already-committed tick replay has no second mutation. Mismatched existing HP refuses; no automatic repair.

Final run: **PostgreSQL18.6, Windows x86_64, READ COMMITTED explicitly configured and checked per connection**. Every test uses a fresh disposable database. Virtual cutoffs are fixture time, not hosted observations. Four real concurrent cases use separate backend sessions, explicit transactions and `pg_blocking_pids` plus ungranted advisory locks as barriers; polling observes locks rather than assuming sleep duration implies a race:

| Case | Observed final-run holder→waiter PID | Result |
|---|---|---|
| Regeneration first / combat entry waits |28144→21864| Entry sees6HP, synchronized projection, cleared fraction/eligibility. |
| Combat entry first / regeneration waits |3296→33192| No regeneration into active combat; original1HP retained. |
| Combat commit first / regeneration waits |28592→34116| Separately committed prior claim;30HP damage result retained, no stale restore. |
| Regeneration first / expired worker commit waits |39524→38952| Claim was committed before the competing transactions; stale result rejected, healed6HP retained. |

Statement/lock/deadlock timeouts bound failures; successful release/second completion is observed. A separate native test restores matching token/lease while leaving the newer version, demonstrating version rejection itself. This is **real local database concurrency for the candidate/doubles**, not canonical source-extracted Combat2 or hosted concurrency proof; isolation other than READ COMMITTED is untested.

Other native cases cover default/custom/zero/max and precision errors; exact microsecond/fractional partition/replay;60second reset; sleep/init/wounds; max/cap/floor; DoT/pending release; ended seed/new seed/mismatch refusal; rate guards; quiescent reassignment; damage/death/replay; zero-rate ordinary respawn separation; generation and NULL/nonfinite fences; rollback after writes; hostile admission failure rolling entry/accounting back; private fixture EXECUTE.

Development finding: the first native run had21/22 passing because postgres.js timestamp parameter serialization rounded a one-microsecond input through JS Date. The assertion was retained; the harness now adds that microsecond in SQL. Subsequent runs passed; final26/26 includes added projection/version/NULL guard coverage. This is a test transport correction, not weakening precision or a hosted failure. The unchanged earlier G4A4 suite has34 PASS as a mathematical/historical baseline; its old interruption-retains-fraction proposal is superseded by this candidate's approved discard behavior.

## Required production changes — NOT implemented

The [G4A5 matrix](legacy-001G4A5-creature-hp-transition-integration.md#2-transition-hook-matrix) remains the source-backed checklist:

1. One private exact accounting/eligibility authority and protected durable metadata, explicit intended internal/server privileges, fixed security settings and actor/lifecycle/Arena invariants. Production migration only through separately authorized forward Drizzle lane; no candidate registration now.
2. Common validated entry predecessor / `combat2_hostile_action` and `combat_intent`, relevant `combat2_change_stance`, authoritative arrival and pre-claim composition. Preserve current ownership/request/mode checks and subtransaction refusal rollback. No pure-resolver IO or new timer.
3. Newly successful composed `node_tick_commit` plus immediate solo/party departure/participation endings: derive complete post-blockers, synchronize seed/ended reactivation, generation/death state and claim/version semantics. Refused/replayed outcomes must not accidentally heal. Real source effects, retained predecessors, C2 lifecycle/arrival triggers and party locks are not replaced by the doubles.
4. Ordinary respawn due-time/generation trigger integration, accounting reset, coherent legacy `regen_creature_hp`/`heal_creatures_on_wake` retirement/delegation and bounded existing-heartbeat maintenance before conflicting character locks. Preserve schedules and G3 accepted deferral; this candidate invokes no scheduler.
5. Guarded Admin rate/maxHP/reassignment boundary and minimal CreatureManager/NodeEditor/creation-caller adaptation. Current fullHP generic saves remain unsafe G4-R2; no UI is changed here. Future control: editable0–100% up to2decimal places, default5%, calculated maxHP×rate/100 HP/minute preview, separate respawn timing and explicit refusal feedback.

Minimum next authorization: resolve floor/rate-fraction policies, then a **bounded local source-adapter and missing-boundary proof** before a production-installable artifact. Use exact retained source and explicitly enumerated dependencies for entry/claim/commit/arrival/party/stance/respawn/Admin/Arena/native lock tests; do not transplant this fixture SQL or claim its reduced guards replace canonical authority. No broad Combat2 rewrite or automatic hosted preflight.

## Remaining risks, recovery and status

OPEN: floor exception; rate-edit fractional policy; real lock/trigger/source composition and isolation contract; complete effect/intent/presence transitions; transfer history/dependencies; existing HP mismatches and fresh installed parity. Native SQL functions alone do not fence arbitrary direct table writes; production authority fences/callers remain mandatory. Unknown privileged/external helpers and accepted Combat1/delegation risks are unchanged. No full reward, scheduler, Auth or gameplay verification is claimed.

Production recovery must keep accounting/rates and unsafe independent heal writers disabled, preserve generation/reward keys, and stop/refuse on mismatches. Returning to legacy full healing or deleting accounting state reintroduces risk; no automatic repairs, reverse migration or rollback SQL is authorized. Disposable local recovery is transaction rollback/server stop; the harness performs both without deleting unrelated files.

G4-R1 OPEN, G3 deferred, G3D BLOCKED, E13/G/parent OPEN. Previous B–F/progression closures, all four OPEN progression F limitations, deferred F1 retry-UUID and accepted limitations remain unchanged. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled or verified here. Recovery stash and migration history preserved. Git push does not install SQL, deploy Edge or publish frontend.

Reproduce: `node scripts/proofs/g4a6/postgres.test.mjs "C:\Program Files\PostgreSQL\18\bin"`. Requires Node with the repository's existing postgres package and local PostgreSQL binaries; starts/stops its own temporary cluster. Focused state/link/source-preservation/whitespace checks are recorded with the final handoff. **GO for next separately authorized local source-composition work; NO-GO for hosted installation.**

## Final local validation and changed-file inventory

26 native tests PASS (including4 lock-observed independent-session cases);34 unchanged historical mathematical-baseline tests PASS;3 project-state tests PASS. State JSON/generated Markdown synchronized;262 local references/9 anchors, candidate/fixture fingerprints, harness syntax, prior-record/disposition preservation, source ancestry, unchanged G3B candidate, migration/runtime/proof preservation, recovery stash and whitespace checks PASS. All four disposable clusters used during development were independently confirmed stopped. No build/typecheck required for isolated SQL/test/docs changes with no application imports or edits.

Eleven scoped files: the four candidate/fixture/harness/native-evidence files listed above; this report; `docs/design/game-engine.md`; `docs/operations/legacy-001G1-world-creatures-quests-preparation.md`; `docs/roadmap/game-engine-roadmap.md`; `docs/roadmap/game-ideas.md`; `docs/operations/project-state.json`; generated `docs/operations/project-state.md`. The specification/register update approved design only, not implementation status. No production migration or install handoff is created. Final commit/remote equality and clean worktree are checked after normal push.
