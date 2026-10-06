# ENG-PROGRESSION-001D — Activation reconciliation and closure

**ENG-PROGRESSION-001D CLOSED** locally. Hosted status **INSTALLED / VERIFIED / ACTIVATED** is supplied operator evidence, not direct Codex Cloud observation. **NATURAL RUNTIME PATH NOT YET OBSERVED. HOSTED MULTI-SESSION BEHAVIOR UNPROVEN.** Closure changes no progression rules or world-heartbeat behavior. No 001E/F/G/H work.

## Synchronization and full incoming history

Task start 91b65a84ccdca61c22a12e1aa4572a477631b215, clean main worktree. Fetched and normally fast-forwarded to 6e4ffb1d0f21a4ed2fe8af7215365beea2b76151=origin/main; no divergence/reset/squash/history rewrite. Reviewed 001D, 001A/001C/install/type-fix ancestors verified. Named recovery stash retained, not restored. Closing commit is a normal descendant containing only local reconciliation docs/generated state and one source-test assertion alignment; final SHA is returned after push.

| SHA | Subject | Classification |
|---|---|---|
| c128e3188c27bdd699cf8152b8d1c84e2dc0b106 | Changes | Retired endpoint typecheck-only fix: remove redundant non-OPTIONS guard in both shells; source only, not deployed. |
| c966f73f9c729a443282fab47ffa2d13596b39d8 | Undersøgte pause stop | Platform merge of c128e318; no additional semantic change. |
| 8dbbb3ed1c385b09e77dcc068c5ad3f804ca4d5d | Changes | Expected project-state documentation: four deployed pauses and accepted pre-install exceptions. |
| c95ac85a5dfe3ee274f6d36d61ef9b1cdfee3f80 | Added 001D bypass exceptions | Platform merge of readiness documentation; no extra runtime change. |
| ca6f12295788e431d9856074f04142c3f6a35f26 | Changes | Expected migration/tool output: exact 0002, journal append, empty chained snapshot, one generated adapter declaration. |
| 2da416bc1c4967c9a735a996de82f0e577fc1ffc | Changes | Expected project-state documentation: installation, fences and verification. |
| 253ffb4f1b68cbb844447c298a2503a0e4864f9b | Installed EN-PRO-001D payload | Platform merge of migration/tool output and install documentation; no additional runtime change. |
| 49584e243914a693314a61837730df0e2e1ec163 | Changes | Expected project-state JSON activation evidence. |
| 1572909c54506f99324ad745f4f181e82a153ac0 | Changes | Expected generated Markdown activation view; current generator still finds drift to reconcile. |
| 6e4ffb1d0f21a4ed2fe8af7215365beea2b76151 | Activated ENG-PROGRESSION-001D | Platform merge of activation documentation; no additional runtime change. |

| Changed path since 91b65a84 | Classification |
|---|---|
| docs/operations/project-state.json | Expected pause/install/activation operator documentation; top-level prep state and next-task stale, reconciled locally |
| docs/operations/project-state.md | Expected generated documentation, out of sync; regenerated from reconciled JSON |
| drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql | Expected exact migration/tool output; unchanged by closure |
| drizzle/migrations/meta/_journal.json | Expected idx 2 append, old prefix unchanged |
| drizzle/migrations/meta/0002_snapshot.json | Expected empty chained custom-SQL snapshot, not a full production schema baseline |
| src/integrations/supabase/types.ts | Expected generated private-adapter signature only |
| supabase/functions/combat-tick/index.ts | Expected semantic-neutral retired shell typecheck fix, not deployed |
| supabase/functions/combat-catchup/index.ts | Expected same retired shell fix, not deployed |

Reviewed four-function pause sources are byte-identical to 91b65a84; no separate post-checkpoint runtime pause diff. No unrelated metadata file or unexpected file remains. Platform merge subjects do not imply additional source changes: parents and complete branch history were inspected.

## Exact payload and forward metadata

Reviewed operations SQL: SHA-256 **680915c6e25bba22c81db88b9a48ed49efad365dd38ddbc924f10fcb4c47637f**, 38,810 bytes, unchanged in working copy and Git blob. Committed 0002: identical byte-for-byte, same 38,810 bytes/hash. Windows automatically checked out 0002 as 629 CRLF lines, 39,439 bytes/hash 4bc162048a827a0a2ffefdc8b278a736eeb70dd3de7c5b123fc42e2327c6e3a7. This raw working-copy hash is explicitly different; committed bytes are exactly reviewed. No migration file was edited or normalized.

Journal 0→1→2: old entries 0/1 unchanged, unique tags/idx, strictly increasing when, idx 2 tag 0002_progression_001d_canonical_xp_cutover, when 1791299913981. All three snapshots version 7/postgresql; 0000→0001→0002 prevId linkage coherent. New snapshot id 5136ea7c-b85f-4c35-a004-85265d813ed2 points to 0001 id 87c31f4b-c1f4-40a6-a468-4c78295f2dec. Empty tables/enums/etc match existing blank declarative/custom-SQL lane; not a schema completeness assertion. No 0000/0001/historical Supabase content change.

## Installed/activated boundary and evidence attribution

Operator-reported installation and verification: reviewed payload installed exactly once through standard Lovable Drizzle as 0002_progression_001d_canonical_xp_cutover.sql; journal idx 2, when 1791299913981; hosted row id 3, hash 680915c6e25bba22c81db88b9a48ed49efad365dd38ddbc924f10fcb4c47637f. Adapter postgres / SECURITY DEFINER / pg_catalog,public / owner-only. Replacement pg_get_functiondef SHA-256 6beb54b1e2d00f9147288145e4f09f1bb58c26233cd5d7c16e8fde098b6042fe. Only outer node_tick_commit retains service EXECUTE; old apply_crafting_xp, reviewed legacy/predecessors and 001C are owner-only. Characters, inventory, reward claims and encounter fingerprints unchanged; no progression function invoked during installation verification. This is supplied hosted evidence, not a Codex Cloud inspection.

INSTALLED / VERIFIED / ACTIVATED. Activation window 2026-10-06 15:46:49–15:47:36 UTC: only combat_config.combat_mode maintenance→open; combat_soak off; world intentionally asleep. Automatic dispatch is allowed when normal presence/world conditions permit; while asleep, world_asleep refusal is normal. No manual wake requirement. Zero schedules/claims at observation; no natural tick. NATURAL RUNTIME PATH NOT YET OBSERVED. The three crafting pauses and ordinary admin grant-xp pause remain; apply_crafting_xp is fenced owner-only. Privileged admin set-level/update-character remain noncanonical overrides deferred to 001G; train_renown_stat remains deferred to 001F. HOSTED MULTI-SESSION BEHAVIOR: UNPROVEN.

Four pause endpoints were reported deployed 14:56 UTC from reviewed 91b65a84 source. Crafting live 503 verified by platform; admin non-admin 401 observed and authenticated grant-xp 503 source-verified (not invoked live). Revision IDs unavailable; source identity plus reported behavior, not an invented deployed revision. Retired combat-tick/catchup fixes not deployed. Frontend publication unchanged/unknown as previously recorded; no new publication.

Pre-install exceptions were accepted by Mik and remain historical: manual tick technically callable/operator-prohibited; privileged overrides operator-prohibited during cutover; public old crafting XP bypass expired at atomic install. Do not rewrite the past to claim a technical tick fence existed. Post-install owner-only old crafting XP/legacy ACLs were verified by supplied operator report. This closure task performs no hosted work and invokes no hosted authority.

## Retired endpoints and generated types

Only change to each retired shell is removing redundant if(req.method!=='OPTIONS') after OPTIONS already returns. CORS preflight/body/build stamp/status 410 unchanged; no reachable legacy combat or DB/progression writer introduced. Shared http imports are unchanged. Both actual shells pass isolated strict TypeScript and executable method checks. Aligned the two retired-shell source assertions with the unconditional refusal after the existing OPTIONS return. This is the one required closure test change; no endpoint/runtime code changed. The initial closure suite (2700 pass/21 fail) exposed two stale string assertions plus the known spendable-CP baseline check; executable and strict-TypeScript verification proved the platform fixes semantic-neutral before the assertions were aligned.

Generated types diff is exactly four added lines: combat2_apply_claim_progression_internal Args (_claim: string, _encounter: string), Returns Json. No other type/schema/config surface changed; declaration grants no runtime authority and has no caller.

## Local acceptance and retained limitations

Final core progression/shared Combat2/retired-shell focused run: 320 pass / 0 fail.

Final full suite: 2702 pass / 19 fail (exit 1), versus reviewed 001D 2703/18 and synchronized baseline 2701/19. No new failure identities against the established baseline union. The spendable-CP composite/schema check fails as it did in the synchronized baseline; no fix is claimed. Focused progression/shared/server Combat2 plus retired-shell source tests: 797 pass / 2 known baseline failures. Nine existing local actual-chain SQL tests and six existing containment tests pass. Root/app TypeScript and build pass; existing large-chunk warning. Both retired shells pass isolated strict TypeScript (noImplicitReturns) and actual execution: two empty CORS preflights, twelve GET/POST/PUT/PATCH/DELETE/HEAD 410 legacy_retired/build-stamp refusals, no client/env/network/DB/progression access. No Deno or hosted deployment/typecheck claim. Prepared-generator --check, project-state consistency, whitespace, reviewed evidence, ancestry and protected-migration checks pass.

Reports/logs retained outside repo under C:\Users\mik\Documents\WoVarneth\001C-local-db-tests\D-closure-*. Baselines D-local-baseline.json and D-resume-full.json retained. Test-generated tracked snapshots/MCP artifacts restored to incoming HEAD; no unrelated artifact committed. Only closure documentation/generated-state and required stale test assertion change.

Natural successful execution is not required for closure: no players/natural tick at reported activation. No manufactured event/manual wake. Real hosted concurrency is not required under the accepted platform limit; serial PGlite remains local proof only. Future normal runtime observation and supported concurrency testing are observations still outstanding, not passed results or current task authorization. Current sleeping-world observation is timestamped, not a live assertion for later dates.

## Closure handoff

- Starting SHA: 91b65a84ccdca61c22a12e1aa4572a477631b215.
- Synchronized SHA/final pre-closure remote SHA: 6e4ffb1d0f21a4ed2fe8af7215365beea2b76151.
- Recorded-baseline ancestry: passed; published platform commits retained.
- Worktree: clean at start; closure changes only, to be committed/pushed normally; retained stash untouched.
- Files changed locally: engine spec, roadmap, project-state JSON/generated MD, cutover-plan/handoff historical notices, this closure document, edge-build-identity source test.
- Migrations authored/installed by Codex: none. Supplied installed 0002 evidence reconciled only.
- Generated types: incoming expected adapter declaration, unchanged by closure.
- Edge deployment: incoming four pauses reported; retired shell fixes not deployed; no closure deployment.
- Frontend status: no new publication; Mik alone publishes.
- Cloud/gameplay operations: none.
- Deviations: two stale source assertions aligned to already verified semantic-neutral shells; CRLF working-copy migration digest explicitly distinguished from committed bytes.
- Blockers: none to local closure; both unobserved runtime/concurrency limitations remain explicit.
- Next safe action: STOP. 001E/F/G/H not authorized.
