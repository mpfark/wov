# ENG-ABILITY-WIZARD-001G3A — local effect source identity

## Reviewed source and scope

The three G2 blocker documents were verified, committed separately as `2dc2cfd1f34ef63b49a9706761bf94b3b93a01a8` (`docs(combat2): record Wizard 001G2 source-binding blocker`) and normally pushed to origin/main. HEAD and origin/main matched; worktree was clean before G3A edits. Starting G3A source is that commit; its parent is the requested `28eb17417373e34744fff7b3badc2bc3b624e62a` baseline.

Roadmap ENG-ABILITY-WIZARD-001; affected specification sections Combat resolution, Effects and stances, Character ownership and lifecycle, Failure/verification. This prepares provenance without changing damage, modifiers or effect lifetime. All five F gates, G2 pulse coverage, fixed reservation SQL/lifecycle/publication and ENG-BALANCE-001 deferral/priority/dependencies remain open/unchanged as applicable. This is not server-integrated or deploy-ready.

## Source chain and bounded finding

The inspected canonical creature-action paths deal direct damage through `applyCreatureDamage`; they do not author creature-owned periodic effects. Canonical effect inserts set source_character_id from the player and source_creature_id to null; persistent stance projection carries existing fields. No inspected canonical/Edge producer captures a creature pulse's originating instance/generation. This is a repository finding, not a claim that no hosted producer exists.

Historical `node_effect.source_creature_id` references `creatures(id)`. Claim serializes persisted effects/config; commit stores proposal config. These carry JSON, but do not establish provenance at creation. See [G2 evidence and references](wizard-001G2-source-binding-blocker.md), [current canonical decoder](../../src/shared/combat2/decode.ts), [historical schema](../../supabase/migrations/20260828234135_aa140c12-7391-4e61-be4f-f74345668e96.sql), [historical transport](../../supabase/migrations/20260828234331_d4dc13e4-60c7-40ea-9aba-df218b152660.sql) and [retained commit candidate](progression-001D-cutover.sql). Installed contracts remain unknown.

## Local capture/read contract

`SnapshotEffect.config.creature_source` and `ProposedEffectInsert.config.creature_source` optionally contain:

```json
{ "creature_id": "original definition ID", "node_creature_id": "original node_creature.id", "spawn_seq": 7 }
```

The existing source_creature_id must equal creature_source.creature_id, source_character_id must be null, and the effect must target a character, not a creature. Generation is a nonnegative safe integer; IDs must be nonempty strings, consistent with current snapshot ID decoding. No new ID or generation is allocated.

`bindCreatureEffectSource` receives the producer's already-known claimed live SnapshotCreature and proposed effect, copies the tuple into existing config, and sets consistent source fields without mutating inputs. It refuses existing metadata rather than rebinding it, dead/invalid capture sources and conflicting ownership/targets. It does not find a source, authorize a caller, read a database or register a producer. The source's encounter membership and frozen generation must still be established by the future authoritative caller/transaction.

`readCreatureEffectSource` reports unbound, invalid or bound. Decode rejects malformed/conflicting opted-in metadata, but legacy absence stays unbound. `resolveCreatureEffectSource` matches node_creature_id exactly, then definition and generation; it never substitutes a unique current definition match. These functions are local preparation APIs, not yet a pulse damage consumer or activated producer.

## Lifecycle classification — no new pulse policy

| Source state at later inspection | Result and identity behavior |
|---|---|
| Same instance/definition/generation, living | current; captured identity unchanged |
| Same life, dead or zero HP | dead; retain original identity, do not bind a successor |
| Instance respawned at a new generation | generation_mismatch; no source returned |
| Removed/absent from claimed encounter | missing_instance; no definition fallback |
| Multiple instances share definition | select only the captured instance |
| Duplicate exact instance IDs in supplied rows | ambiguous_instance; no selection |
| Instance row has another definition | definition_mismatch; no source returned |
| No metadata | unbound; no inferred identity |

Well-formed historical metadata may remain in a claim when its source is dead, absent or respawned. Decoder checks the immutable record's shape/ownership, not whether its historical source still exists; classification handles availability separately. No expiry, cancellation, deletion or damage behavior is attached to these outcomes in G3A. Existing effect lifetime remains unchanged.

### Approved damage-modifier and lifecycle decision — owner 2026-10-27

Effects retain their existing lifetime after source death. While the original source is alive with matching instance and spawn generation, use its current outgoing modifiers at pulse resolution. After death/removal, baseline effect damage continues without new source modifiers. A replacement spawn never inherits identity or supplies modifiers. Missing/ambiguous binding never permits guessing or fallback. Existing effects without opt-in metadata retain existing behavior.

This supersedes the earlier proposal to use modifiers from dead same-life rows. The decision is documented only: G3A classifies identity but does not implement pulse reduction, modifier selection, or new lifecycle behavior. Authoritative producer capture and persistence remain open prerequisites for G2.

## Local SQL/producer/claim integration candidate — not executable SQL

1. Identify actual authorized producer(s), including any installed-only writer, or confirm no active producer. Capture the tuple at effect creation under the existing source generation/encounter claim locks; do not accept browser-authored source metadata. Reuse existing node_creature IDs and spawn_seq. Do not backfill old effects using a current creature lookup.
2. Use existing node_effect.config JSON for the tuple if affected installed contracts preserve it. No new column/table is needed by this local representation; verify that assumption against installed schema. Require consistency with source_creature_id and exclusive character ownership/target shape.
3. Ensure node_tick_commit validates a newly created creature effect's captured source against its claimed source generation, and preserves tuple immutability in effects_update. Presence in arbitrary config alone is not authority. A separate producer RPC needs equivalent locks, validation and privileges. Preserve source metadata through all relevant lifecycle/cleanup writers; never SET NULL or rewrite one identity component silently.
4. Claim must return the stored tuple unchanged and enough exact source-life/control state for the subsequently approved resolution policy. JSON source/claim roundtrip is tested locally; actual PostgreSQL persistence, concurrent capture/respawn, source deletion, rollback and installed producer/privilege behavior are OPEN gates, not tested by JSON serialization.
5. Affected SQL may be prepared later outside automatic migration history with exact signatures/security/ACL intent and native tests; no historical edits, registration or installation are authorized here. The standard Lovable/Drizzle process and migration-history gate remain binding. Any development-data cleanup requires separate bounded approval.

## Checks, artifacts and delivery

New tests cover capture immutability, conflicting owner/target, dead/malformed sources, exact instance among shared definitions, generation/definition mismatch, missing/ambiguous instance, decoder refusal, legacy absence, historical metadata roundtrip and deterministic replay. Existing effects retain behavior; the resolver and damage formulas are untouched. Final exact check counts/results are recorded in project state and the chat report.

No SQL artifact/hash or installation order is applicable to this non-executable contract candidate. Hosted inspection/install, migration registration, Edge deployment and frontend publication: not performed. No catalogue/authoring/UI/Edge mirror changes. Owner authorized one G3A commit and normal push after verification; no hosted action. To resume G2: apply the approved modifier/lifecycle decision, establish the actual producer/capture/persistence contract with the tests above, then implement the shared outgoing reduction and original G2 acceptance tests. G3A local helper tests alone do not close the blocker.
