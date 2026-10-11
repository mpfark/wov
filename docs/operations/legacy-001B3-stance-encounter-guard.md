# ENG-LEGACY-001B3 — local stance encounter guard handoff

Status: locally implemented and tested; owner-authorized source publication checkpoint. **Not installed or deployed.** Source checkpoint `6d108344d5988bbaef0a7e45fd0ffa2f47ab9172`. Follows [B2](legacy-001B2-stance-target-scope.md); preserves engine stance mechanics, progression closure and all four open F limitations.

Reviewed forward SQL: [legacy-001B3-stance-encounter-guard.sql](legacy-001B3-stance-encounter-guard.sql).

SHA-256: `cd170a15d6d69415cd0787de5050b1d3f79723bb5e7f70ff6296792ca0ef5f06`.

B3A supersedes the never-installed B3 input fingerprint `abc00b5a9340970e0de87c9d86d17fc99ef3752b8560deb3b17bc825069a63e0`. No executed migration or history is changed.

## Exact change and invariant

Patch only `public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)`. No new objects, grants, predecessor changes, worker proposal changes or stance storage changes.

B3A correction: before existing stance version fences and the inner commit, acquire the exact direct predecessor node-lock set in UUID order, then lock `node_encounter` by the same `_encounter_id` passed to the inner authority. The set is the captured encounter origin plus distinct moved-departure destinations, using the existing `combat_enter_node:` transaction advisory-lock key. Refuse if the encounter node changed after capture; do not acquire a new node while holding the encounter. Collect distinct UUIDs from all three stance arrays in UUID order. For each, lock authoritative `node_fighter` membership rows for that encounter in fighter-ID order (`FOR SHARE`). Reject null IDs, malformed UUIDs/arrays, or targets without membership before any delegated or stance mutation. Exceptions abort the statement/transaction; mixed proposals cannot partially apply.

The inner authority still validates the claim token, tick, expiry and state version under the same encounter lock. The new guard does not replace those checks. Membership rows are locked until transaction end, protecting the checked relationship from concurrent update/delete. It deliberately does not require post-commit presence or survival: death and departure may clear stances after changing presence. Existing historical encounter members remain valid scope; this guard does not invent a new eligibility rule.

The rest of the original normalized function body is byte-identical after removing the inserted declaration/guard. Version checks, stale-update rollback and request acknowledgement remain intact. `already_committed` still skips mutations; the existing stale version-fence refusal on a retried old fence remains unchanged. Membership is validated on retries too; an invalid foreign proposal is not legitimized by an already-committed tick.

The patch additionally guards the direct predecessor normalized body fingerprint and owner/definer/search_path/volatility/result type; it does not modify that function. The patch guards exact normalized original `prosrc` SHA-256 (`CRLF → LF` only), owner, SECURITY DEFINER, volatility, return type, search path and browser/service EXECUTE expectations. `CREATE OR REPLACE` uses the installed function definition, preserving identity/security/ACLs; an explicit ACL equality assertion fails atomically on change. Unexpected source/security/ACL drift stops installation rather than patching an unknown body.

## Local validation

- 13 isolated PGlite SQL tests pass: valid update; death/departure clear; foreign fence/update/clear with mixed-target atomic refusal; invalid target; departed member; late stale-update rollback; already-committed no-op; unchanged stale-fence refusal; exact remaining body and ACL preservation; reapplication drift refusal.
- 50 existing focused tests pass across worker orchestration, stance persistence, original stance migration and project-state.
- Typecheck and production build pass. Build retains the existing large-chunk warning. Windows sandbox dependency access initially required retry outside the sandbox. Build-generated unrelated MCP rewrite restored to its pre-build source.
- Project-state synchronization, 17-entry journal/snapshot chain, documentation links and whitespace pass. Migration/history files are untouched.

SQL test command: `node scripts/legacy-001B3-stance-guard.test.mjs ../001C-local-db-tests/node_modules/@electric-sql/pglite/dist/index.js` (existing local test dependency).

Tests execute the actual outer source wrapper, actual authoritative-arrival direct predecessor and patch in an isolated database, with only the deeper commit modeled to change presence. New coverage checks node → encounter → membership/fence → delegate source order, actual transaction advisory-lock keys (origin plus moved destinations only), reentrant retry, and direct predecessor drift refusal. Existing worker tests supply separate production proposal coverage. This does not prove the full installed inner/trigger graph, independent hosted sessions, scheduler execution or live lock interleavings.

## Installation gates — separate authorization required

Before installation, inspect only the installed outer/direct predecessor function definitions and security/EXECUTE metadata, plus relevant stance lifecycle trigger definitions. Confirm the expected body fingerprint, encounter/fighter schema and effective service-only access; review any mismatch instead of replacing the guard hash. Existing uncertainty is installed parity and concurrent hosted behavior, not a missing owner gameplay decision.

Keep SQL outside automatic migrations. After source publication and separate installation authorization, Lovable's standard Drizzle workflow creates the numbered migration/journal/snapshot from these exact bytes; no hand registration, historical migration edit or alternate runner. Execute the complete package transactionally. Verify generated SQL hash, installed history, body/security/ACL and guard presence afterward. No gameplay mutation probe or Edge deployment is required by this handoff.

**GO for local source review; installation remains gated on metadata parity and explicit authorization.** Existing B1/B2 evidence remains a pre-patch source observation; live scope enforcement is not yet claimed. Recovery stash and prior audit evidence are preserved. Administrative XP grants remain paused; normal gameplay XP policy and runtime evidence are unchanged.

## B3A lock-order analysis

| Path | Authoritative source and relevant order | Compatibility |
|---|---|---|
| Outer stance commit | October stance migration:418–444 retains version fences → direct predecessor → successful stance mutations. Corrected insertion precedes these fences. | Node locks must move ahead of these row locks, not merely ahead of the encounter lock. |
| Direct predecessor | September authoritative-arrival migration:361–385 (renamed by October to without_character_stances): distinct origin/moved destinations, UUID-sorted node advisory locks → deeper commit. | Guard takes the identical set/order first. Predecessor reacquisition is transaction-reentrant; captured origin is rechecked under encounter lock. Exact body fingerprint is an installation guard. |
| Core commit | Drizzle 0002:89–137, node_tick_commit_without_bounded_failure: encounter FOR UPDATE → claim/retry/state validation, followed by existing domain writes. | Same encounter ID and claim validation retained. No node locks newly requested after the encounter. |
| Claim | August snapshot migration:12–58: encounter FOR UPDATE SKIP LOCKED → lease/snapshot. September arrival migration:528–589 preserves the composed claim bodies; October:390–415 adds stance snapshot reads without node acquisition. | Claim is a separate transaction; it does not hold an encounter then request node locks in this traced chain. No new claim locking introduced. |
| Entry / intent | September arrival:175–202: node advisory → character recheck → encounter/fighter; intent:403–414: node advisory → encounter → existing delegate. | Common required invariant is node locks before domain row locks. This is not an invented universal character-versus-encounter hierarchy. Node serialization protects same-node entry. |
| Ordinary / party movement | September arrival:305–349 takes sorted origin/destination node locks before existing row locks. September immediate-departure migration:129–172 adds ordered encounter/mover locks; finalization:217–267 locks encounter/character/fighter and marks departure. | Moved destinations must be included up front, avoiding opposing node-pair order. Existing row-lock conventions are not refactored. |

Source filenames: `supabase/migrations/20261001130000_combat2_character_persistent_stances.sql`, `supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql`, `supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql`, `supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql`, and `drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql`.

The specific B4 inversion is resolved locally. Node locks are the existing required locks, acquired earlier; no new namespace, broader target set, or grants. Fighter share locks stabilize the membership evidence before inner presence/departure changes. Existing downstream character/stance locking is retained, not declared universally deadlock-free. Static order checks and isolated single-session lock inspection do not prove hosted multi-session behavior. B4 metadata parity and separate publication/installation authorization remain required. No type or frontend code changed in B3A; earlier typecheck/build remain applicable.
