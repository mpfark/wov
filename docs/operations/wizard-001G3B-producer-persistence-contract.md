# ENG-ABILITY-WIZARD-001G3B — producer and persistence handoff

## Reviewed source and authority

Baseline: `e1faa06b4fbf59d723636bde74af6abd503609a2`; fetched origin/main and local HEAD match; clean starting worktree. Previous project-state baseline is an ancestor. Scope: targeted creature-owned, character-targeted periodic effects only. Roadmap ENG-ABILITY-WIZARD-001; specification sections Effects and stances, Combat resolution, Character ownership/lifecycle, Failure/verification. Approved rules, priorities/dependencies, attributes and deferred ENG-BALANCE-001 are unchanged.

This is a local **non-executable integration candidate and handoff**. No active relevant repository producer was identified, so no new gameplay producer, generic effect subsystem, SQL wrapper/trigger or pretend native fixture is added. Installed functions, privileges and producers remain unknown. Local JSON preservation does not prove database authority. All five F gates and G2 pulse coverage remain OPEN.

## Producer inventory — bounded source evidence

| Path | Observed authority and effect behavior | Classification |
|---|---|---|
| [Canonical creature phase](../../src/shared/combat2/resolver.ts) | Ordinary, opportunity, instant boss and telegraphed primary/secondary attacks call applyCreatureDamage; pending_action is direct attack state, not a periodic effect producer | Active repository path; not a qualifying producer |
| [MechanicContext/handlers](../../src/shared/combat2/mechanics.ts), resolver's player outcome effects, applied status and stack sources | actor is SnapshotFighter. Inserts are player-sourced; configured status/stance mechanics do not establish creature-source provenance | Active repository effect producers, outside qualifying source class |
| Resolver persistent stance projection | Projects character-owned supplied stance effects; does not create a creature pulse authority | Active repository projection; not a qualifying producer |
| [Canonical worker](../../src/server/combat2/process-node-tick-once.ts) | claim -> strict decode -> resolver -> proposal -> commit. Worker forwards effects_insert/update; it does not author additional effects | Active orchestration, not gameplay producer |
| [combat2-tick-once handler](../../supabase/functions/combat2-tick-once/handler.ts), [entrypoint](../../supabase/functions/combat2-tick-once/index.ts), existing Edge shared resolver | Privileged transport calls node_tick_claim/node_tick_commit and mirrored resolver. No additional creature-pulse capture found. Edge source is intentionally behind canonical D/E/F/G3A | Repository consumer paths; deployed identity unknown |
| [Continued autoattack SQL](../../supabase/migrations/20260905090000_combat2_continued_basic_attack.sql) and generated historical duplicate | Inserts player-owned autoattack control state. Config's node_creature_id/spawn_seq describe its TARGET, not the source | Historical/source SQL path, not creature-owned damage; installed wrapper reachability unknown |
| [Historical commit](../../supabase/migrations/20260828234331_d4dc13e4-60c7-40ea-9aba-df218b152660.sql) and later historical commit copies | Generic effect proposal persistence, including caller-supplied source_creature_id/config; not an independent gameplay producer | Historical authority source; installed identity unknown |
| [Retained progression commit candidate](progression-001D-cutover.sql), [retained predecessor evidence](progression-001D-evidence/node_tick_commit_without_bounded_failure.sql) | Generic persistence still present. Does not add source capture/immutability. Prior installation reports do not prove current definitions | Retained reviewed/evidence source, not fresh hosted verification |
| Historical final-ability/stance cleanup and Arena/reset/departure SQL | Rewrites config or removes selected effects; not a qualifying creature-pulse creation path | Lifecycle/config writers; must be checked only where they touch opted-in rows |

The bounded search covered canonical/shared mechanics and resolver, worker, Edge handlers/shared consumers, node_effect references and SQL INSERT/UPDATE/DELETE paths in repository migrations and retained operation candidates. No active creature-owned character-targeted periodic gameplay producer was found. No broad installed-state or security audit is claimed. No call to bindCreatureEffectSource is added to unrelated player effects merely to create a caller.

## Existing persistence contract and concrete failure points

- [node_effect schema](../../supabase/migrations/20260828234135_aa140c12-7391-4e61-be4f-f74345668e96.sql): source_creature_id references creatures(id), ON DELETE SET NULL; config is JSONB. The tuple can physically fit in config without a new table/column, but no source provenance follows from storage alone.
- Historical claim serializes persisted node_effect rows with to_jsonb(ne), including config. It does not reconstruct or authenticate a source tuple. Claims of historical effects must retain their original tuple even when the source is no longer available.
- Retained commit takes the encounter lock and validates token/candidate/state_version before mutations. Its creature proposals validate instance/definition/generation; that validation is not automatically a source fence for effects_insert.
- effects_insert persists source_creature_id and arbitrary config. The inspected retained core contains no creature_source-specific provenance check. Referential integrity only proves a definition exists, not which source life created the effect.
- effects_update checks effect ID/encounter membership, then replaces config wholesale when supplied. That can remove, replace, or add creature_source. Neither decoder shape validation nor the TypeScript helper prevents a database caller doing this.
- A well-shaped forged tuple passes the local decoder: the decoder intentionally distinguishes metadata validity from creation provenance. It is not a trusted producer validator.
- Physical deletion of the creature-definition can SET NULL source_creature_id while config still contains its original definition, causing opted-in decoding to refuse. Removing a node_creature instance is different: the JSON tuple can remain historical. Definition deletion needs an explicit preservation/refusal contract; never silently reinterpret it as ordinary source death.
- [Immediate departure](../../supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql) removes character-targeted encounter effects when their TARGET departs. Arena/reset and encounter cleanup also remove state. Preserve these existing boundaries: continuing after SOURCE death does not mean following a departed target or surviving an encounter reset. Source death/removal alone must not trigger effect deletion.

## Smallest integration candidate — insertion points, not installable SQL

### A. Trusted capture and proposal

For a verified future/installed producer, use its exact claimed/locked source row and existing encounter lock/generation fences. Capture once with bindCreatureEffectSource or equivalent database-side construction from that row:

`source_creature_id = source.creature_id; config.creature_source = { creature_id, node_creature_id: source.id, spawn_seq }`.

Require character target, null source_character_id and null target_creature_id. Do not accept browser-authored tuples. Do not find the source through a definition lookup. A supplied SnapshotCreature is not proof by itself: the caller must establish membership in the accepted claim and generation. No source modifier is frozen in this tuple. No new gameplay producer is authorized by this contract.

### B. Commit pre-mutation checks

Place checks inside the existing authoritative transaction after its replay/claim/state fences and BEFORE economic, HP, effect or event mutations. Do not install an outer wrapper which checks source without holding the same locks through the inner commit.

1. For opted-in inserts validate JSON object/types, UUID identifiers, nonnegative safe generation, owner/target consistency, source instance/definition/generation and encounter membership. SQL may enforce real UUID types even though local snapshot decoding accepts nonempty IDs. Validate the target against the exact accepted fighter/entry contract; do not invent target readiness from a browser field.
2. Match capture against the immutable claim source, not only a current row supplied at commit. Verify existing claim state or introduce only the smallest reviewed fence within the current claim/commit authority if the actual installed claim does not retain enough information. **OPEN:** current source/claim persistence and concurrency behavior must be inspected before choosing this implementation. No parallel claim ledger is proposed.
3. Source must have been living at capture. A valid effect may be created and its source killed in one proposal; validate original claimed life before applying proposed death, not final HP after creature writes. Conversely a concurrent respawn/removal before settlement must fail the established source/claim fence; never attach the insert to the successor.
4. Lock/update serialization must follow the actual existing encounter -> creature lock order. All competing respawn/removal writers must use compatible locks and invalidate stale claims/state. If that cannot be proven, STOP rather than adding an isolated row lock which other writers ignore.
5. For effects_update, absence of config preserves config. If config is supplied and the stored effect is opted in, require its creature_source JSON value to remain exactly equal and all original source/target ownership fields to remain consistent. Reject tuple removal/rebinding. A legacy row must not acquire a tuple through update; only a separately reviewed trusted creation may introduce opt-in provenance. Other config keys and supported pulse scheduling updates retain existing behavior. Decide byte/semantic JSON comparison consistently (JSONB equality preserves value, not text formatting).
6. Examine effects_delete + effects_insert together. Delete/reinsert may represent legitimate new application, but must not launder an existing effect into a guessed generation; every new opted-in insert must independently satisfy capture. Do not add a new ID/replay subsystem.
7. Validate all affected rows before mutations; failures must leave HP/resources, effects, events and tick markers unchanged. Keep existing already_committed/token/state_version replay behavior. Native tests must verify exactly-once insertion; JSON serialization is not idempotency proof.

### C. Storage, claim and other writers

Keep tuple in existing node_effect.config if installed schema/transport confirms preservation; no automatic schema migration is warranted from the local finding alone. Claim must carry stored tuple unchanged, with original source IDs independent of current source existence. No generation backfill on claim/reconnect. Retain baseline magnitude, timing, stacks and source attribution.

Review only authorized effect writers actually reachable in the affected installed chain: generic commit/predecessors, direct insert/update RPCs if any, definition deletion, relevant config cleanup, encounter/Arena/departure cleanup. Preserve other classes and legacy rows. Prevent direct untrusted creation of metadata through table/RPC access; document exact owner, SECURITY DEFINER/invoker, fixed search_path and effective PUBLIC/anon/authenticated/service_role/private-caller privileges for any candidate SQL. No ACL change or new private helper is proposed without verified caller evidence.

For physical definition deletion, select a reviewed minimal protection that preserves the original tuple AND consistent source attribution, or refuse that specific deletion while affected effects exist. A broad FK change, unconditional source-null acceptance or destructive cleanup is not authorized here. This remains an explicit gate, not a reason to block ordinary same-row death/respawn semantics.

## Approved lifecycle — unchanged

Effects retain existing lifetime after source death. Current outgoing modifiers are eligible only while the ORIGINAL matching instance/generation is alive. Dead, removed or replaced sources supply no new modifiers; baseline damage continues. Never use a successor or guess an ambiguous/missing binding. Legacy effects without metadata keep their current behavior. G3B implements no pulse damage, Weakened, source-dependent expiry or baseline damage change.

## Acceptance matrix and proof limits

| Case | Existing local evidence | Required additional proof |
|---|---|---|
| Capture tuple, refuse rebinding/conflicts, exact instance among same definition | G3A TypeScript helper tests | Trusted producer/claim membership and SQL validation |
| JSON decode and historical tuple roundtrip | TypeScript fixtures | Native INSERT -> commit -> persisted row -> actual claim; all fields/lifetime unchanged |
| Tuple removal/replacement/addition through effects_update | Identified source-level hole | Native refusal before any mutation, unchanged config/HP/tick/event fingerprints |
| Stale token/state or generation mismatch | Existing worker/refusal fixtures; identity classifier | Actual changed commit/native claim chain and source fences |
| Concurrent capture/respawn/removal | NOT TESTED | Independent PostgreSQL sessions with controlled overlap in both orders, no successor binding, no deadlock/partial state |
| Same-tick creation and source death | NOT TESTED end-to-end | Captured living source accepted; later source death keeps effect lifetime |
| Rollback/idempotency | Existing transport/replay fixtures only | Injected failure after validation/before completion, then retry; once-only effect persistence |
| Missing/malformed metadata and legacy absence | G3A decoder tests | Installed producer/SQL guards; no invented backfill |
| Definition deletion SET NULL and lifecycle writers | Source contracts inspected | Native/hosted preservation/refusal test, no decoder-breaking half identity |

No native SQL, independent-session concurrency, rollback installation or hosted tests were run in G3B. No TypeScript simulation is represented as that proof. Existing 426-test G3A regression evidence is reused; 102 fresh source/roundtrip/transport/worker tests passed across four files. Publication verified 36 unchanged records; project-state and tracked/untracked whitespace checks passed. No new implementation tests are added for an unimplemented producer.

## Handoff, gates and next action

Local changes are this integration candidate plus project-state evidence only; no runtime or schema change. No executable SQL artifact/hash, migration registration or installation order exists yet. A full replacement against guessed installed wrapper bodies would be unsafe and unnecessary. Migration-history gate, unchanged historical files and standard Lovable/Drizzle process remain binding; no direct runner, legacy replay or tool probe.

**001G2 is not unblocked as an authoritative end-to-end implementation.** Its source consumer could be exercised with fixtures, but that would still not establish creation provenance. Next separately scoped action: authorized read-only verification of the affected installed producer/writer and claim/commit chain (or trusted supplied exact definitions), then a minimal pinned local patch and native SQL/concurrency tests against those definitions. If there is no active installed producer either, record the coverage as a dormant consumer gap and obtain owner scope for fixture-only G2 preparation; do not invent a gameplay producer.

Stop on source/installed drift, unknown caller/lock authority, missing frozen source provenance or undecided definition-deletion preservation. Any later SQL installation needs reviewed bytes/hash, exact signatures/privilege intent, rollback/native tests and explicit approval through standard Drizzle. Required SQL verification precedes matching Edge deployment; frontend publication remains Mik-only. G3B performed no Cloud access, SQL mutation/registration, deployment, Publish, commit or push.
