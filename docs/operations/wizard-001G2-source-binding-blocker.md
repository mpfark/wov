# ENG-ABILITY-WIZARD-001G2 — source-binding blocker

## Reviewed source and scope

Baseline HEAD and fetched origin/main: `28eb17417373e34744fff7b3badc2bc3b624e62a`. The previous project-state baseline `43b9aabd785ccc8f0f34c319667ba565a5204088` is an ancestor. Owner authorized local implementation but explicitly required stopping at the smallest blocker if necessary source authority is missing. No gameplay implementation, typed future source contract or fixture-only authority was introduced.

Affected roadmap: ENG-ABILITY-WIZARD-001; specification sections Combat resolution, Effects and stances, Character ownership and lifecycle, Failure/verification. Approved rules are preserved. No balance, attribute, priority or dependency change. ENG-BALANCE-001 remains deferred.

## Verified blocker — OPEN

- [SnapshotEffect](../../src/shared/combat2/types.ts) contains `source_creature_id`, but no typed source runtime-instance or source generation. [decodeEffect](../../src/shared/combat2/decode.ts) reads that ID and passes config through; it establishes no creature-source generation contract.
- [Historical node_effect schema](../../supabase/migrations/20260828234135_aa140c12-7391-4e61-be4f-f74345668e96.sql) references `creatures(id)` for `source_creature_id`, not `node_creature(id)`. Definition identity cannot establish originating life identity.
- [Historical claim/commit](../../supabase/migrations/20260828234331_d4dc13e4-60c7-40ea-9aba-df218b152660.sql) serializes node_effect rows/config and persists effect proposals. The retained [progression commit candidate](progression-001D-cutover.sql) likewise carries the definition ID/config. Transporting arbitrary JSON does not establish trusted producer provenance.
- Bounded source search across canonical Combat2, server worker and Edge consumers found no creature pulse producer assigning an authoritative source-instance/spawn tuple. Canonical effect creation sets creature source to null or projects existing effect metadata. Hosted producers/installed definitions were not inspected and remain unknown.
- [Character-targeted pulse resolution](../../src/shared/combat2/resolver.ts) applies magnitude times stacks without outgoing reduction. Direct creature damage reads source control effects against its already-known working creature. That known source is precisely what a generic pulse lacks.

Even one matching current creature row is insufficient: the effect may originate from an earlier spawn. Matching a definition, inferring the current spawn, or adding fixture metadata without a producer would invent authority. Refusing all previously unbound pulses would instead introduce an unapproved behavior change. Consequently the shared helper extraction and new pulse consumer are not implemented as a partial fix.

## Smallest prerequisite for 001G3

1. Identify the actual authorized creature-effect producer(s), their persisted effect shape and intended lifetime when the source dies, departs or respawns. If no production producer exists, record that explicitly and define the contract for its future activation. No broad audit is required.
2. Capture source `node_creature.id`, `creature_id` and `spawn_seq` at effect creation under existing authoritative transaction/claim fences. Proposed naming/shape is a design input, not an implemented contract. Existing effect config may carry the tuple if producer, validation and persistence can prove it; no new table or column is assumed necessary.
3. Verify claim/commit preserve and validate that tuple, ownership and encounter membership. Define stale/missing/ambiguous source handling, including effects that outlive their source. Never backfill generation by looking up the current definition. Any development-only removal/reset requires separate exact approval.
4. After that contract is established locally, resume 001G2: extract the existing outgoing reduction unchanged, apply it once to the pulse's aggregate integer damage before HP clamp, retain pulse phase and existing non-contact semantics, and add the authorized deterministic acceptance cases. Do not route pulses through direct contact/hit/ward resolution.

No SQL candidate, historical migration edit, registration, installation or Cloud probe is included. The migration-history gate and standard Lovable/Drizzle process remain binding. Future local contracts are not hosted integration evidence.

## Checks and delivery boundary

No new gameplay tests: implementation stopped before source changes. Existing Fire/Frost/Arcane, creature-damage and all-class formula regression suites are run as baseline evidence; exact counts/results are recorded in project state and the chat report. Application TypeScript, publication (36 records), project-state and whitespace checks passed. A passing baseline does not prove the missing source-binding or pulse-reduction acceptance cases.

Production catalogue remains 36 records; authoring, runtime, SQL/history, Edge mirrors, UI and other classes are unchanged. All five 001F integration gates remain open, particularly fixed reservation server/lifecycle parity and Weakened pulse coverage. No deployment, frontend Publish, commit or push. SQL/install artifacts/hashes and hosted acceptance are N/A. Next safe action: separately authorize the narrow local producer/claim-contract prerequisite in 001G3, then resume 001G2 acceptance. This blocker is not automatic authority to change SQL or hosted state.
