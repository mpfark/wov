# ENG-LEGACY-001G4A — Creature regeneration and Combat2 HP ownership

2026-10-15; starting/fetched source `a30927db8d57a4c5e955711d3dfab91b643bf19d`. Bounded source investigation recorded; G4-R1 remains OPEN, no correction/acceptance inferred. No runtime code, SQL candidate, migration, schema, hosted operation or gameplay execution. G/ENG-LEGACY-001 remain OPEN.

## Conclusion

**Confirmed source conflict between representations:** legacy regen/wake healing mutates only creatures.hp using Combat1 guards, while Combat2 claims consume node_creature.hp and later mirror its proposal to creatures.hp. The helpers neither synchronize the current-generation runtime row nor invalidate its claimed version. The mismatch can occur without concurrency; a claim already in flight introduces another overwrite window. No hosted occurrence, effective caller access or current installed composition is demonstrated.

An active-encounter-only exclusion is insufficient: an ended encounter can retain a current-generation runtime row; reactivation/seed does not refresh that row's HP. A row lock on creatures alone, a PUBLIC revoke alone, or removing the entire creature tick is not a complete minimal solution. The last also removes ordinary respawn, outside a healing-only correction.

**Recommended next step:** owner review of a narrow temporary containment policy for the two legacy healing writers, preserving respawn. If the owner requires retained OOC healing, separately authorize a coherent current-generation maintenance design instead. Neither implementation is authorized or prepared here; both have behavior/compatibility tradeoffs requiring an explicit decision.

## 1 — Source-defined helpers and callers

| Exact identity / source | Reads / eligibility | Writes / return |
|---|---|---|
| regen_creature_hp(), [July17 replacement](../../supabase/migrations/20260717123612_8f687cfb-1b50-4ad5-9ea0-d1f78b5122db.sql), lines126–203 | creatures.id/node_id/hp/max_hp/is_alive/last_damaged_at; living wounded; last damage NULL or older than5minutes; no active old encounters joined through encounter_creatures; no same-node combat_session engaged ID; no unexpired active_effects target. Same guards appear in early EXISTS and UPDATE. | Only creatures.hp explicitly set to capped hp + max(ceil(max_hp*0.10),1); RETURNS void. No node_creature/node_effect/node_encounter access or writes. |
| heal_creatures_on_wake(), [August5 source](../../supabase/migrations/20260805185103_b8924e02-7328-4878-a630-d1d490bfa791.sql), lines1–34 | Same living/wounded and old combat/session/effect exclusions, **without** last_damaged_at5minute gate. Uses current epoch milliseconds for active_effects expiry. | Only creatures.hp explicitly set to max_hp; returns affected-row count. No generation, damage-time, alive/death, runtime HP or encounter-version update. |

Both are SECURITY DEFINER, search_path=public; no explicit auth/character/node entitlement or shared Combat2 lock in those bodies. Existing restrictions and caller authority are reused from [G4](legacy-001G4-creature-authority-lifecycle.md), not newly verified or changed. UPDATE takes normal row locks, but the early EXISTS is not a lock on absent Combat2 state. Old active_effects exclusion is broader than DoTs within that old table, and says nothing about node_effect.

Latest named source definitions above supersede older regen implementations; bounded source references locate no later replacement for either helper. Source trigger review found generation changes only on UPDATE OF is_alive and reward validation on its specific config columns; no HP-only healing→Combat2 projection/version synchronization trigger was established. Temporary old fault triggers were subsequently removed in source. Installed trigger bindings remain unverified; absence of a located source trigger is not a fresh hosted catalog claim.

```text
wake_world / world_watchdog → schedule_tick_creatures → cron tick-creatures
 → tick_creatures → record_world_state / world_is_awake gate
                 → sim_note_progress → regen_creature_hp → respawn_creatures

owned active-character session access → production-activation lock
 → mode open → wake_world → heal_creatures_on_wake → scheduler enable / presence
```

Exact caller anchors:

- [tick/watchdog](../../supabase/migrations/20260817152132_f0017999-4605-4a17-a2a5-1ac6404f2ef9.sql), lines406–436. Tick uses activity-derived world_is_awake, not canonical world_state_is_awake. It calls regen then respawn; preserve their separation.
- [schedule/unschedule](../../supabase/migrations/20260710214800_f6826731-75e8-40cb-a609-b4a2c938c7ff.sql), lines24–42: tick-creatures `*/2 * * * *` means2minutes, not Combat2's2second heartbeat. Existing job existence check is not proof of current installed command/enabled state.
- [latest wake/shutdown](../../supabase/migrations/20260824010343_58a2d74d-8e2d-41e2-adb0-a3e2576785ec.sql), wake170–263, heal call248; shutdown removes named jobs. Wake calls healing without requiring a true asleep→awake transition first; direct retained callers can invoke wake while already awake.
- [session-access replacement](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines326–357: validated active ownership/node/Arena, activation advisory lock, mode/wake/scheduler/presence sequence. Its activation lock is not the node/encounter claim gate and is not acquired by regen.

The legacy path is **source-reachable through retained callers**, not proven currently scheduled or deployed. Reuse [G3E](legacy-001G3E-owner-disposition-g4-handoff.md): idle/activation correction remains deferred, G3D route/isolation verification remains BLOCKED. No fresh scheduler/access investigation or SQL query is requested here.

## 2 — Canonical HP sequence and protections

| Transition | Authority and protections | What protection does not cover |
|---|---|---|
| Seed current living spawn | [combat2_seed_spawns(uuid,uuid)](../../supabase/migrations/20260902194101_e3b1caf6-58cf-4028-b292-49cc3c283914.sql), lines3–53, validates encounter/node and inserts current creature UUID/generation into node_creature. HP seeds from authored hp, with alive-zero fallback; UNIQUE(creature_id,spawn_seq), ON CONFLICT DO NOTHING. | It does not overwrite a retained same-generation runtime row after external authored-row healing, regardless of encounter status. Helper relies on callers for broader node/encounter serialization. |
| Entry / reactivation | [entry source](../../supabase/migrations/20260902123413_f5e0f14f-b91d-451a-a267-fbe6fea9665c.sql), lines25–55: node advisory lock, encounter lock, new/reactivated state, stale claim/intents/events fenced, living runtime engagement/tank reset, then seed. [Arrival](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql), lines188–257, reuses this ownership pattern. | Reactivation version fencing rejects old encounter work but does not copy creatures.hp into an existing node_creature row. |
| Claim | [Claim body](../../supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql), lines29–81: encounter FOR UPDATE SKIP LOCKED, due/live-lease checks, token/candidate/cutoff; snapshot nc.hp/alive/generation, authored max_hp/stats. Existing wrappers reused from [B](legacy-001B-combat2-writer-chain.md). | No shared healing protocol; helper changes only creatures.hp, not the selected nc.hp or encounter state_version. Claim and later commit are separate transactions with pure resolution between them. |
| Resolve | [Resolver](../../src/shared/combat2/resolver.ts), initialization195–208, creature DoT591–618, damage1047–1059/reactive1540–1570, proposal1702–1713. Uses snapshot HP, marks damaged/dirty, proposes HP/alive/current runtime identity. | No general positive creature HP-regeneration loop or automatic reconciliation with later creatures.hp. An unchanged creature need not be proposed; a later dirty proposal may mirror its runtime HP. |
| Commit | [Drizzle0002 core](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql), lines104–130 encounter/token/expiry/tick/version,148–157 identity;383–414 runtime update and authored mirror;603 onward version increment/claim release. | Healing does not change the fields tested by the claim/version fence. A still-valid snapshot is not rejected merely because external authored HP changed. |
| Death / respawn generation | Commit liveness AND existing prevents revival; mirror requires matching spawn_seq and runtime membership. [Generation trigger](../../supabase/migrations/20260813091924_37c97e14-37a5-4719-bfd8-eaa03442e179.sql), lines5–28, increments only dead→alive; [respawn](../../supabase/migrations/20260629060824_a75ddfbf-a2d4-4e53-b368-b3f47ef8ebbe.sql), lines52 onward, restores due dead rows. | Generation fencing protects a new spawn from an old death mirror; it does not detect same-generation healing. Neither healing helper changes spawn_seq. |

The mirror writes creatures.hp, is_alive, died_at and last_damaged_at for the matching generation; HP is an absolute resolver proposal, not an additive merge with a separately healed authored value. Source touch/validation delegation and rewards remain as in G4/B; this task does not modify them or claim newly verified installed metadata.

## 3 — Field-ownership and state-transition matrix

| Field / state | Legacy regen / wake heal | Combat2 path | Source-implied result |
|---|---|---|---|
| creatures.hp | Increment capped at max / full max | Mirrored from current-generation runtime proposal | Two source writers with different eligibility/state surfaces. Row locks order writes, not ownership. |
| node_creature.hp | Neither reads nor writes | Seed once per generation; claim source of truth; commit writes | Healing authored HP is invisible to an existing runtime row and its claimed snapshot. |
| max_hp / stats | Read max only; not changed | Authored values included in claim | No new formula, balance or stat change proposed. |
| is_alive / died_at / spawn_seq | Both heal only living wounded; do not revive/reset generation | Monotonic death, due respawn/new generation, matching-generation mirror | This is a same-generation conflict, not an extra legitimate respawn. |
| last_damaged_at | Regen reads5minute cooldown; wake ignores it; neither refreshes it | Dirty damage updates timestamp in commit | Repeated canonical damage may incidentally delay regen; no explicit canonical DoT guard. |
| Combat1 encounter/session/effects | Both use them as exclusions | Not the current canonical encounter/effect tables | Old exclusions cannot stand in for active node_encounter/node_effect state. |
| Combat2 status/claim/version/engaged/actions/effects | Neither checks/locks/invalidates them | Gate and persistence owned by encounter transaction | Zero present fighters does not release ownership; status='ended' alone does not remove retained runtime state. |

| Scenario | Exact source implication, conditional on helper invocation/eligibility |
|---|---|
| Active encounter, quiet wounded creature | Regen can pass if last damage is old enough and old guards empty; wake healing has no damage cooldown. Both can heal only authored HP despite live canonical runtime/claim. No assertion this happened hosted. |
| Canonical DoT remains | Periodic damage updates last_damaged_at, which can postpone ordinary regen if pulses are recent. node_effect itself is not examined by either helper; the old active_effects predicate is not the canonical DoT contract. Wake healing can still pass. No target/source-present requirement makes offscreen DoTs automatically disappear. |
| Pending creature action remains | Helpers do not read pending_action or claimed work. Canonical resolver can continue it; row healing does not cancel, version-fence or synchronize that work. |
| Players leave | Neither helper's canonical eligibility is based on node_fighter presence; old guards may cease to reflect combat. Resolver can retain living engaged creatures/effects without players. No-player is not equivalent to no outstanding canonical ownership. |
| Encounter ended, same generation retained | Heal may change authored row, but entry reactivation resets engagement/action context without HP refresh; seed conflicts with retained runtime row. A guard excluding only active encounters would miss this divergence. |
| World asleep then wakes | Scheduling may stop with encounter/runtime rows preserved. Wake calls full-heal before setting singleton awake; retained runtime HP can disagree on next entry/claim. No elapsed-sleep creature-regen settlement algorithm is established. F10's separate sleep behavior remains compatible, not a defect inferred from an empty active encounter. |

### Minimal counterexample — source reasoning, not an executed test

1. Same-generation authored/runtime HP are20 with max100; old combat/effects guards are empty. A valid Combat2 claim snapshots runtime20.
2. Wake healing sets authored HP100, leaving runtime20 and encounter token/version unchanged.
3. A valid dirty proposal reduces runtime to15 and commits; the mirror writes authored15. The later mirror does not preserve the independent heal.

Even without step1's in-flight claim, a new claim after healing still reads runtime20. For ordinary regen the same example requires its existing5minute cooldown to pass and would apply its existing increment rather than full heal. These values illustrate the existing source expressions; they are not new regeneration/balance settings. No hosted incident or independent-session result is claimed.

## 4 — Smallest authority boundary and correction options

**Required invariant:** an outside HP writer must not independently alter authored HP while a same-generation Combat2 projection or valid claimed proposal remains authoritative. When no projection exists, eligibility must be serialized with projection creation so a concurrent seed cannot copy a pre-heal snapshot and retain it. Encounter status or player presence alone is not a sufficient ownership token.

| Option | Scope / benefit | Risk and prerequisite |
|---|---|---|
| **A — Temporary containment of the two legacy healing writers** | Suspend their HP mutations (or their specifically identified healing delegations) while keeping respawn and other tick/lifecycle work. Removes this pair of competing HP writes without adding new encounter locks inside wake. | Temporarily loses existing OOC increment/full-heal behavior, including unprojected creatures. Explicit owner acceptance of that behavior tradeoff required; signatures/returns/callers need compatibility review. Removing tick_creatures wholesale is not this option. No candidate authored. |
| **B — Exclude current-generation Combat2-managed rows** | Retain legacy healing only for rows with no retained same-generation projection, not merely no active encounter. | A naked NOT EXISTS is racy with seed. Must serialize/revalidate at the shared node/encounter boundary, include ended rows and binding/generation changes. Retained runtime rows could suppress OOC healing indefinitely. Not behavior-neutral; requires owner policy and lock-order design, especially wake's existing DDL. |
| **C — Coherent HP maintenance across both representations** | Retain agreed existing heal amounts/guards at one authoritative boundary; update matching current-generation runtime and authored state together when maintenance is permitted. | Bigger change: define what constitutes maintenance eligibility with actions/effects/no-player/ended state without silently implementing future ideas. Must either refuse/skip live claims or invalidate their versions/tokens atomically, and serialize with seeding/reactivation. Updating both rows alone lets an old valid claim overwrite both later. Needs explicit design/implementation authorization and local concurrency coverage. |

**Recommendation:** prefer A as the smallest *temporary containment option for owner decision* if losing these legacy heals is acceptable; preserve respawn and do not alter the approved G3B candidate. If OOC healing must continue for Combat2-managed creatures, do not pretend B is a one-predicate fix: choose/design C's narrow coherent boundary separately. No option is implementation-ready or installed merely because described here. This task cannot select a changed gameplay policy for the owner.

Insufficient partial changes: client EXECUTE revocation alone leaves owner-internal wake/tick delegation;5minute cooldown/DoT-only predicates do not cover wake or retained ended state; true-transition-only wake healing still sees retained runtime after sleep; creatures row locks alone do not serialize seed/claim; encounter locks held only during maintenance do not invalidate a claim released before resolution; discarding runtime rows/new generations to heal changes identity/reward semantics and is not a minimal authorized correction.

### Lock-order prerequisites if B/C is chosen

Use existing node-entry advisory ownership before discovering/locking an encounter (including the absent-encounter case), then encounter before dependent runtime/authored rows, deterministic ordering for multiple nodes/generations. Revalidate exact node/creature/generation after locks; no late unbounded node locks after dependent row locks. This is a design constraint, not a newly proved complete hierarchy for bulk maintenance.

Wake already does trigger/publication DDL and other work **before** its healing call; commit holds encounter ownership before character/creature writes. Adding encounter waits deep inside that wake helper may introduce lock inversions with existing relation/row locks. Inspect that specific composition before implementation; no freedom-from-deadlocks claim is made. Claim/commit operate in different transactions: a row lock during healing cannot retroactively invalidate an earlier claimed snapshot. Actual supported transaction isolation and installed trigger composition remain evidence prerequisites, not reasons to reopen G3D now.

## 5 — Existing mechanics versus future directions

The [idea register](../roadmap/game-ideas.md) marks WOV-IDEA-007 shared-world persistent HP,008 DoT suppression and010 sleep-consistent OOC regeneration as **DESIGN AGREED future directions**, with no F11/F12 implementation approval or completed runtime proof. Existing shared authored rows and partial mirror persistence are not completion of007. The last-damaged cooldown is not the explicit canonical DoT rule008. Wake full-heal plus due wall-clock respawn is not a chosen sleep-regeneration/catch-up algorithm010. No formula, regeneration rate, combat balance, elapsed-time settlement, respawn identity, encounter completion or creature redesign is selected here.

## 6 — Minimal local compatibility/concurrency plan — not executed

After separate authorization and the owner policy choice, use disposable local PostgreSQL with exact helper/seed/claim/commit body extraction where feasible; dependency doubles must be explicit. Two worker sessions plus an observer, barriers and pg_blocking_pids/pg_locks evidence, bounded timeouts/rollback; no timing-only pass criteria. Do not assume direct PostgreSQL access through Codex or borrow G3B's test results for creature semantics. A future local harness needs its own environment/access authorization and must never accept a hosted URL or real identities.

1. Sequential original reproduction: authored/runtime same generation wounded; run exact eligible regen or wake helper; verify authored HP changes but existing runtime/next claim does not. Include retained ended row→reactivation→conflicting seed, and absent runtime→seed after healing.
2. Claim-first: hold a valid claimed proposal across helper completion; verify original body can mirror pre-heal runtime HP later. For chosen correction assert either no external mutation, safe refusal, or version/claim rejection—never silent overwriting of accepted maintenance.
3. Maintenance/seed-first and reverse order: pause before eligibility/seed commit, verify both orderings preserve chosen current-generation authority or explicitly refuse/retry. Include no encounter yet, ended retained projection, node reassignment and new generation; no resurrecting an old runtime row.
4. Eligibility compatibility: original cooldown and old encounter/session/effect exclusions, canonical DoT/pending action/no-player state and sleep/wake invocation. Assert the **chosen** policy; do not rewrite expected results to implement007/008/010 accidentally. Keep respawn/tick job identity unchanged.
5. Failure: injected second-write/maintenance failure rolls back both surfaces and fences; timeout/deadlock releases locks; stale generation cannot heal/kill a new spawn; no duplicate rewards/sidecar mutation. Verify exact signatures/returns/security/ACL preservation for affected routines only.

Existing source/pure tests are useful but do not cover this dual-write concurrency boundary. This task ran93 tests (resolver75, seed7, respawn8, state3), not PostgreSQL helper execution. Existing respawn-test deployed-chain wording remains historical source-contract language, not fresh hosted evidence.

## 7 — Remaining evidence and next authorization

Source establishes the mismatch; unknown current helper definitions, bindings, scheduler enablement, actual effect/table residue and external callers determine hosted occurrence. Fresh installed parity and effective caller authority would be required before any installation, but **no hosted request, SQL preflight, direct database access assumption or G3D route/isolation reopening is made here**. G4-R2 admin overlap and G4-R3 helper ACL question retain their separate pending dispositions; this focused investigation does not resolve them.

Next separately authorized step should first record the owner's choice: temporary suppression of these two healing writers with respawn retained, or a narrow coherent OOC maintenance design. If A is selected, authorize only exact caller/return compatibility and local regression preparation before any production proposal. If existing OOC behavior must be preserved, authorize B/C policy/lock design and the test plan first. No implementation, SQL candidate, migration or gameplay change follows automatically. Continuing the remaining audit can also be explicitly accepted without treating R1 as fixed.

G3 investigation remains COMPLETE WITH ACCEPTED LIMITATIONS, its race correction deferred and G3D BLOCKED; G2 accepted limitations, OPEN E13, all B–F/progression closures, privileged v3→v2/Combat1 uncertainties and OPEN ENG-LEGACY-001F-R3-RETRY remain unchanged. All four progression F limitations stay OPEN. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled or runtime-established here. Overall G/ENG-LEGACY-001 OPEN. Relevant [engine authority/heartbeat specification](../design/game-engine.md) and [ENG-LEGACY-001 roadmap](../roadmap/game-engine-roadmap.md) are preserved.

## Validation / handoff

Only this report, G audit index/roadmap note and project-state JSON/generated Markdown change.93 existing focused tests PASS;3 state tests rerun after generation PASS. JSON/Markdown synchronization,126 repository links/2 anchors, exact helper/seed source assertions and documentation-only scope PASS. Structural comparison preserves every prior state/history/backlog record and unrelated field; G3B candidate SHA-256 unchanged. Staged whitespace checked before commit. No independent-session creature test, hosted call, SQL execution, candidate/migration/runtime edit or frontend publication. Recovery stash preserved; no future test result or owner policy choice fabricated.
