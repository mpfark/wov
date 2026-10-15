# ENG-LEGACY-001G2D — Contract completion delegate trace and bounty-board idea

2026-10-15; source28048e42b164218685b5804f2c6650c69e166d6e. Local source/history/archived-evidence review only. [G2C](legacy-001G2C-contract-delegate-evidence-gate.md) identifies the next exact delegate; [G2](legacy-001G2-assassin-contract-authority.md) retains acceptance/re-roll/completion findings. Only this report and relevant [idea-register entries](../roadmap/game-ideas.md) change. Project-state, engine roadmap statuses, prior closures and unresolved E13 transfer are unchanged. No G3 begins.

## A — Exact delegate and historical composition

`public.node_tick_commit_without_authoritative_arrival(uuid,uuid,integer,integer,bigint,uuid[],jsonb) RETURNS jsonb`.

The complete [001D archived installed definition](progression-001D-evidence/node_tick_commit_without_authoritative_arrival.sql) is the boss-cooldown wrapper created as public.node_tick_commit by [September14 source](../../supabase/migrations/20260914110000_combat2_boss_tick_timing.sql)57–83, then renamed by [September28 arrival source](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql)354–359. Generated historical copies preserve those events, not independent capabilities.

Local extraction confirms exact LF-only body equality between archive and September14 source. The function is PL/pgSQL SECURITY DEFINER, search_path public,pg_temp. [0002](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql)13–15 guards its whole-definition hash and postgres owner/DEFINER, but replaces the deeper without_bounded_failure core, not this wrapper. No later named CREATE/REPLACE of this exact function was located; source continuity does not exclude out-of-band hosted change.

| Hash domain | Recomputed identity |
|---|---|
| Canonical Git archived export | 2269 bytes |
| Exact full-definition SHA-256 | 5c0ca87eb78a403cb615dfc0e0b4d024a66190898efc6957d87c30c2d4e0d2ac |
| LF-only prosrc SHA-256, no trim | 2c66b36b9d2f659b000a0e5f6222289f025bc87735202bdb623997bc0a86d6b4 |
| Full definition CRLF→LF / whitespace-collapse SHA-256, no trim | dfeedd22c68135c840504fabbac1bd4db15ef17f4e393b91512373a4de953572 |

The exact-file hash is the0002 prerequisite; never substitute another hash domain. No SQL executed to calculate hashes.

## Direct operations and completion relevance

| Complete recovered body behavior | Finding |
|---|---|
| Reads boss_cooldowns array; checks encounter/creature/spawn and expected cooldown state | Boss-state validation, not active_contract/contracts_completed or Assassin mark/kill validation. Invalid shape/state can refuse stale_boss_cooldown before delegation. No mechanics defect inferred. |
| Calls public.node_tick_commit_without_boss_timing with unchanged seven arguments | Sole named public function call. public.node_boss_ability_cooldown is a table/ON CONFLICT target, not another function. This wrapper produces no completion proposal or eligible Assassin recipient. |
| After ok=true/kind=committed, upserts node_boss_ability_cooldown | Direct persisted write is cooldown state, not character contract state, completion count, currency or item reward. Trigger behavior beyond this body is not globally certified. |
| Returns delegated result; EXCEPTION WHEN OTHERS returns internal_failure/P0001 | Exception boundary rolls back protected-block database work, including delegated work, on exception. Returned refusal is different from exception rollback. No independent commit or contract receipt here; no runtime test. |

No explicit active_contract, contracts_completed, apply_contract_complete, contract_complete event, Assassin comparison or contract-specific XP/RP/gold/item branch exists in this body. This is a **source/archived-body finding**, not proof the transitive chain or deployed worker cannot complete contracts.

## Bounded continuation using existing evidence

```text
node_tick_commit outer                         [Oct15 conditional supplied definition]
 → without_character_stances                   [G2C archived/guarded parity]
 → without_authoritative_arrival               [this report: boss cooldown wrapper]
 → without_boss_timing                         [archived failure envelope]
 → without_bounded_failure                     [core later replaced by0002]
 → ordinary qualified reward claim → progression adapter / additive gold / loot
```

The next [without_boss_timing archive](progression-001D-evidence/node_tick_commit_without_boss_timing.sql) is1007 bytes, exact SHA-256 e5a277313c5725d06fb2fea7272347035a703ea7058177f640d16963f7798302; LF-only body edae39ac001a198f9716d9e63af4780894b7435a9ff6560896b8b9d9d445143e. It forwards to without_bounded_failure, validates an object result with ok/kind, and wraps failures/exceptions. No explicit contract fields/helper/event/reward branch occurs there. This reuses one already named tiny wrapper, not a fresh general Combat2 investigation.

[001D archive index](progression-001D-evidence/README.md) includes the old terminal body, but0002 **subsequently replaces it**. Do not call that old export the latest core. Reuse [Progression closure](progression-001D-closure.md) and [E1 reward map](legacy-001E1-economy-rewards-writer-map.md):0002's source writes explicit resource/death metadata, creature/fighter state, qualification/reward claims, additive gold and loot, and calls combat2_apply_claim_progression_internal for ordinary canonical XP. Its explicit characters SET clauses do not set contract columns. Installation ACL loops using dynamic EXECUTE are not gameplay payload-patch writers. No explicit contract fields/helper/event/Assassin bonus identifiers were found in that bounded source continuation. No broader progression/reward audit or reward-policy decision performed.

Stop at that existing documented reward boundary rather than opening another report for each unrelated function. Later C2 exclusions/targeted patches and current installed/deployed identity remain their own dated evidence concerns, not newly proved by0002. G2's retired Combat1 completion producer and trusted helper do not prove ordinary Combat2 executes them. [G2B](legacy-001G2B-contract-hosted-parity.md) reports the exact six-argument legacy commit absent/unresolved in its supplied metadata, not global absence of completion.

## Evidence strength and disposition recommendation

| Layer | Established / unresolved |
|---|---|
| Current repository reconstruction | Exact boss wrapper/source equality, named failure wrapper and later0002 ordinary-reward continuation. No direct contract completion in inspected bodies. |
| Historical installed evidence | 001D README records operator exports2026-10-06 12:17:05–12:17:15UTC, owner postgres/DEFINER/settings/hashes.0002 guards and recorded successful installation support parity then, not fresh current metadata. |
| Execution provenance | README identifies historical sandbox_exec inspection. Reuse as existing approved Progression evidence, not compliance with later G2A or permission to repeat that role. |
| Fresh hosted parity | No new observation of these delegates. G2B Oct15 outputs include outer commit only; sandbox_exec/off deviation remains conditionally accepted, procedurally noncompliant. No new query requested/executed. |
| Deployed/runtime/external callers | No live bundle, successful Assassin completion/payout, independent-session behavior or external/dynamic caller exclusion established. Known completion helper still trusts supplied character/count. |

**Recommendation: offer owner disposition of this bounded G2 source/delegate investigation with explicit limitations, rather than continue indefinitely through unrelated Combat2 functions.** The inspected wrappers are not direct contract-completion authorities. No newly demonstrated material unauthorized authority conflict or corrective implementation follows. Non-atomic re-roll, unbound trusted completion helper, missing located current producer, unproved fresh/deployed parity and unknown callers remain unresolved.

Owner may accept the **bounded investigation as finished** while retaining those gaps, without claiming contract gameplay works or resolving E13. This report does not supply acceptance, close E13/ENG-LEGACY-001 or change status. If actual fulfillment provenance is required before disposition, authorize one narrow **deployed completion-producer provenance** investigation: reconcile known canonical worker/resolver source/artifact identity and specifically known external completion callers, reusing evidence first. Stop if unavailable; establish a named current caller before proposing a gameplay probe/correction. No blanket function/ACL scan or automatic metadata request. Do not begin G3 automatically.

## B — Owner-provided future idea, separately recorded

G2D owner request supplied2026-10-15 authorizes recording **Regional Bounty Boards & Shared Contract Framework**, status **IDEA**. Town boards available to any class should offer meaningful local adventures, avoiding repetitive “Kill5 Wolves” objectives. Dangerous-creature hunts, traveler-attack investigations, rare/named targets and local NPC/location/event bounties are examples, not approved mechanics or content.

Register IDs: **WOV-IDEA-031** records the new bounty idea; **WOV-IDEA-032** minimally keys the previously documented [G1 creature-generalization proposal](legacy-001G1-world-creatures-quests-preparation.md#ownership-boundaries-and-exclusions), which had no standalone register ID. Both remain IDEA. This avoids inventing an existing ID or treating distinct shared persistent HP as a generalization alias. They link each other, WOV-IDEA-019 and G2 evidence.

Assassin contracts might later specialize a shared framework; no current feature is removed/redesigned. Common creatures may share names with unique technical IDs; exact targets (instance/archetype/region/unique rare/boss/event), respawn/replacement continuity, multiplayer qualification, rewards, availability/expiry and Assassin differences remain undecided. No creature_type_id or other schema field is approved. No new quest, reward balance, creature-name or miniature implementation follows registration.

## Preservation and validation boundary

Only this report and relevant register entries/count/cross-reference notes change. Project-state/generated view, engine roadmap statuses and previous closures remain unchanged. Preserve privileged v3→v2/Combat1 uncertainty, four OPEN progression F limitations, metadata/runtime gaps and OPEN deferred ENG-LEGACY-001F-R3-RETRY. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled or runtime-established here.

Validate exact archive/source hashes/bodies, references, function-versus-table dependencies, register IDs/anchors, project-state synchronization/tests and whitespace. No hosted calls, SQL execution, gameplay, migrations/grants, world wake, deployment or frontend publication. Recovery stash preserved. Publish only these two files; await owner review.

Executed validation:117 repository links and7 anchors valid across the report/register;67 unique register records, including new031/032; exact archived2269/1007-byte hashes, wrapper source-body equality and hash domains verified;3 project-state tests PASS; JSON/Markdown synchronized unchanged; whitespace passed. Source checks only, no SQL/runtime execution. Only the two authorized documentation files differ; recovery stash unchanged.
