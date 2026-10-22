# ENG-PROGRESSION-001E/F — selective command activation candidate

2026-10-22. LOCAL implementation only; NOT INSTALLED, NOT ACTIVATED, frontend NOT PUBLISHED by this task. Starting/reviewed source baseline and based_on_source_sha: 2053fa68269f073ec601011b433e70f78ab7d874; origin/main fetched and matched. The final publication commit is the commit containing this handoff, available through Git history; do not substitute a moving branch for the reviewed installation checkpoint.

## Scope and reused evidence

Owner approves preparation of first Class Join, Attribute Allocation and proven-investment Respec; Switching and Renown remain disabled. Preserve E/F formulas, hall/trainer eligibility, bonds, token costs, canonical provenance, resources and grants. Existing [F closure](progression-001F-closure.md), [E/F SQL source](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql), [resource synchronization evidence](legacy-001C2-resource-sync-ac-ownership.md), [Combat2 installed claim archive](legacy-001F5-party-parity-envelope.json) and [agreed sequence](roadmap-status-reconciliation-2026-10-22.md) are reused, not reopened. Affected specification sections: Progression and rewards; Resources and attributes; Effects and stances; Movement; Failure, diagnostics and verification. No balance/formula change.

## Reviewed artifact and behavior

- Forward SQL, outside migration discovery: [progression-selective-activation.sql](progression-selective-activation.sql), exact SHA-256 **cf75514d4f6d0345b7abcc6b38ca3aed4ef6a63e1d6a80b439c69658214139ff**. Reproducible with scripts/prepare-progression-selective.mjs --write. One atomic DO, no outer BEGIN/COMMIT; standard Lovable custom-SQL Drizzle tool owns transaction/history/types. Do not preregister migrations or edit historical SQL.
- Adds only join_enabled, allocation_enabled and respec_enabled boolean NOT NULL DEFAULT false to the existing private control singleton. Existing enabled master value must be false and is preserved. No new table, primitive, grants, jobs, XP writer or RPC overload.
- Replaces the bodies of existing public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text) and public.progression_command_projection(uuid), preserving OID, owner, SECURITY DEFINER, search_path, arguments, defaults, volatility and all ACL metadata. Existing service-only command/authenticated-owner projection authority remains. Definition drift aborts; private validator/apply-F bodies are checked. Existing private primitives and Renown key are not changed or exposed.
- Exact receipt replay/conflict stays ahead of master/selective availability. Fresh switch/renown returns operation_disabled when master is open; a closed master may return commands_paused. Only an already committed matching historical receipt can replay. Unknown operations remain invalid_request.
- Projection adds top-level availability booleans. These describe controls, not a promise of character eligibility; SQL still validates current state, ownership, version, trainer/hall, combat/movement/stance and proof. Old/missing projection availability fails closed in the new UI.
- The rest of the command body is unchanged except the selective check and early sorted encounter row locks for the initially observed acting node. Order: acting node advisory → encounter rows ordered by ID → character → sidecar/delegates. Initial location is revalidated; never acquire late nodes/encounters after the character. Entry shares the node lock; claim/commit serialize at the encounter. No new combat/refund/bond formula.
- First Join retains existing classless/active selectable class/hall checks and zero-bond behavior; no switching. Allocation spends proven discretionary points. Respec refunds only recorded investment, consumes one token for a nonempty refund, and does not reconstruct historical investment. Clamp-only synchronization preserves wounded current resources; class growth/Renown/gear are not refunded.

## Frontend and Edge

Recruiter reads availability on open, refuses fresh switching and displays first-join unavailability. Trainer selects no unavailable command, disables Renown and uses separate allocation/respec controls. No new polling. Pending receipt reconciliation remains explicitly retryable even if controls later close. Account/character-keyed same-tab sessionStorage persists immutable UUID/version/payload before dispatch; auth account is checked before reads, sends and response acceptance. Another account cannot adopt or clear that request; changed choices cannot replace it. No auth material is stored.

Legacy unscoped request keys are left inert, never adopted into another account. Before activation, reconcile any actually unresolved legacy request for the current test character using its original UUID; do not silently discard uncertain outcomes or mint replacement requests. Session-storage clearing, closed tabs and cross-tab coordination are not durable recovery guarantees. No automatic replay on reload.

**Edge code/deployment: N/A for this candidate.** The existing progression-command handler already verifies the JWT actor and calls this exact eight-argument service RPC, returns canonical JSON unchanged and uses no legacy writer. Verify its reviewed installed identity and argument mapping; deploy only if a later separately reviewed mismatch is found. No new credentials/settings.

## Local validation and fidelity

- 54 focused caller/Edge/frontend tests plus 3 project-state tests PASS. Includes original E/F boundary/retry tests with account scope, unavailable controls, pending remount, immutable choices and account changes.
- 13 native PostgreSQL **18.6** tests PASS on a fresh loopback-only disposable cluster; 2 SQL/source contracts PASS. Native cases cover default-off/master/operation controls, all three successful paths, ownership/trainer/movement/stance/claim refusals, resources, missing token/empty refund, exact replay after pause, conflicts, rollback, privileges and reapplication drift.
- Five independent-session scenarios: four observe pg_blocking_pids barriers (claim-first boundary, command-first encounter boundary, duplicate request, actual leased-claim body); one actual SKIP LOCKED claim returns locked_or_absent while a command holds the encounter. No timing-only assertion. Complete archived node_tick_claim_without_canary_gate body is loaded unchanged; only lock/refusal branches execute, NOT complete snapshot/worker/resolver/commit/reward processing. Other boundary cases explicitly use fixture-held encounter locks/claim rows, not a claim that hosted gameplay ran.
- Reuses E/F reduced schema and auth.uid fixture plus canonical SQL bodies; native pgcrypto pinned1.3 is installed only in the disposable cluster. Full C2 lifecycle triggers, complete current 0024 outer claim/commit chain, raw privileged writers, scheduler and hosted concurrency are not established by this fixture. Existing G4 and E/F composition evidence is reused, not relabelled fresh.
- First sandboxed initdb failed temporary WAL permissions; identical local harness ran successfully outside the filesystem sandbox. Early harness dispatch/fixture and candidate syntax errors were corrected before the passing results. Typecheck/build results are recorded with final project-state validation; existing Vitest deprecation/build chunk advisories are not gameplay defects.

## Minimal installation prerequisites and release order

1. Separately authorize a permitted transactionally read-only metadata preflight, never sandbox_exec/read_only=off. Verify exact command/projection/private-validator/apply-F source hashes in candidate; postgres owner, definer/settings and direct/effective ACLs; control owner/RLS/private access/singleton/enabled=false and absence of the three new columns. Verify unchanged permanent-delta/derived helper/lifecycle trigger identities using existing evidence plus only fresh drift checks. Read no Renown secrets/player rows. Stop on masked authority or divergent definition, do not weaken guards.
2. Verify current canonical entry/claim/commit encounter-before-character composition against the early node/encounter locks; identify the progression RPC caller's actual isolation contract. Local contention coverage is READ COMMITTED; one unrelated metadata session does not prove caller isolation. Unknown fresh composition/isolation requires evidence or explicit owner disposition before production activation. Existing G3D BLOCKED stays separate, not silently resolved.
3. Install this exact candidate only after separate approval through standard Drizzle; append one forward migration, verify all existing history, generated SQL/hash, two changed bodies/unchanged metadata/ACLs, private control columns/defaults and master=false. No gameplay calls or enablement as part of installation. Existing frontend remains safely paused; new frontend also fails closed against old backend.
4. Existing Edge compatibility verification only; no automatic Edge deployment. Mik manually Publishes the matching frontend after DB verification. Do not enable controls before the compatible UI is ready.
5. Separately authorize owner-only control activation: first join/allocation/respec flags and master may be enabled together after prerequisites. No switch/Renown flags exist. This handoff supplies no live activation SQL authorization. Then bounded owner/test-character acceptance: first Join, exact allocation/resource effects, nonempty one-token refund, replay/conflict and representative refusals. Keep client evidence distinct from authoritative row evidence.
6. Recovery: close the master (and optionally three flags) under separately authorized operational control; committed matching receipts still replay. Never regrant legacy writers or replay migrations. Any function rollback is a separately reviewed forward change preserving receipts/control data, not destructive history repair. STOP on drift, ACL expansion, missing lifecycle dependency, lock inversion, uncertain migration outcome or unintended resource change.

## Publication and retained limitations

Candidate GO for separately authorized metadata preflight; **NO-GO for immediate installation/activation** without the above gates. No unresolved gameplay-policy decision was invented. Full deployed composition/isolation/runtime evidence remains a release dependency, not a demand to repeat completed audits. All four OPEN F limitations, administrative-only XP grant pause, G3 deferred/G3D BLOCKED, G4-R1/R2/E13/G/parent OPEN, privileged delegation, accepted Combat1 risk and F1 retry deferral remain unchanged. Source push is not installation, Edge deployment, manual Publish or live acceptance.

## Scoped source fingerprints

Fingerprints below use canonical Git-source UTF-8/LF bytes; SQL is an exact UTF-8/LF artifact. Body fingerprints and full-file hashes are separate domains. Verify these against the final reviewed commit before delivery.

| Path | SHA-256 |
|---|---|
| src/features/character/progression-command.ts | 56b5f6e735b7be2a1a07cae7b0bad8d19c8625ea787f8850bd3c9103bf5f1634 |
| src/features/character/useProgressionAvailability.ts | 0c890788c985f2d9d2a9c19849f79ba0c344924c328890c1ddf46884359c42dd |
| src/features/character/components/OrderRecruiterDialog.tsx | 2912ce8ea6dea5bb97d96e7b792a9855b100206508f665b7c4fa8e9b078998dc |
| src/features/character/components/TrainerPanel.tsx | 9a9717ccb7d2ac1200332f52a3a57a07d55706bf6af5ba88d90d4b5390fa7942 |
| src/features/character/components/StatPlannerDialog.tsx | 47d7f84ade45932498108e2f34d0af31e33be0d0fe06ef8c110f558d0c99b8ba |
| src/features/character/hooks/useStatAllocation.ts | 6c2bfad861f37983546b3f1e5783375563a81715eb39fd9fd0f1bb3c755f455a |
| src/features/character/progression-messages.ts | e4ca3dfe0beca58aa435ed93976a12f701c528d44645c4f8647a3a50339dbb8f |
| src/pages/GamePage.tsx | 5196ed84c5a2af88d1e1fa7370a5d03d90962ddbd02ddb81ed4289159f1510a4 |
| scripts/prepare-progression-selective.mjs | ea3f4578c75923b12290190da7273d8c6060e1841cfb9bb8de2321a1aa800d9f |
| scripts/progression-selective-postgres.test.mjs | 001656088cf0ddb94b51a345d8fe342c42f939df4415662f5f08c7b930a53b76 |
| scripts/progression-selective-static.test.mjs | ea6b6a559f4a08b1ccf9035d9ad15cd2c8d38ec95dc05f88d3884480ba37864c |
| src/features/character/__tests__/progression-command.test.tsx | 8330871d97d6b91fddfedcc45c2a71131d8e8bed369adcae15e48311c8a64332 |
| src/features/character/__tests__/progression-f.test.tsx | a79c9ec8e957c95e01c3e195f64c51848146896c760db42d363c37e6560c5e4e |
| src/features/character/__tests__/progression-selective.test.tsx | 0440ac14968003a9c8d84fc2697914666139b519451d80b016c543aed6d8317d |

## Final local integrity result

Typecheck and production build PASS; existing chunk-size advisory only. Project-state valid/generated view synchronized; 28-entry journal and all SQL/snapshots unchanged; 283 local documentation paths verified; no production SQL, Edge, config or history edits. Three state tests are included in the 57 Vitest cases. Earlier failed fixture runs left two temporary loopback clusters; both were stopped, and the harness now stops its cluster on setup failure as well as normal completion. Recovery stash preserved.

Expected post-install LF-only prosrc SHA-256: command **b7d72fc3a5b210cad6bd8d1dcd0da01cc900627a1c349d488e19c60de5042560**; projection **e521d5b2f89b71a1760878848099ffccabee9a94c61e3b3aca4395e69911b5e2**. Compare exact bodies as well as the preserved metadata, not only a hash prefix.
