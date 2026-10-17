# ENG-LEGACY-001G4A24 — G4A21 installation plan (prepared, not executed)

Prepared 2026-10-17 under owner authorization of 22:45 UTC. **Preparation only: nothing installed, deployed, migrated or published.** G4/ENG-LEGACY-001 remain OPEN.

## Finding: G4A9-R1 party ambiguity is NOT resolved by G4A21

Verified against the candidate bytes and G4A22 readiness record:

- The ambiguous unqualified `cost` aggregate lives in `public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)`.
- G4A21 replaces only the wrapper `combat2_party_depart(uuid,uuid,uuid)` (drift-guarded body patch). It does **not** touch `combat2_party_depart_without_canary_gate`.
- G4A23 confirmed the installed trio matches the historical-original (unqualified) hashes, so the ambiguity is present in the hosted database.
- G4A22 already classifies this as a release blocker: "G4A9-R1's ambiguous cost aggregate is not corrected by G4A21… Unqualified/divergent installed source or unestablished compilation semantics is a release blocker, not owner-accepted safety."

**Smallest necessary correction (per G4A22):** a separately reviewed qualification of that exact predecessor — member-result column qualification only, matching G4A10's locally verified qualified body (public-body SHA-256 `e01ed3c1d24627771f40a95960eecd1b39eed7d089c371b2eb5abdf0884de7b1`). No party redesign, no `variable_conflict` workaround, no wrapper/finalizer/trigger changes; locks, ordering, frozen movers, request/replay semantics, return/error shapes and F6 serialization preserved.

## Installation sequence (standard Drizzle custom-SQL lane only)

1. **Prepare correction artifact (separate review).** Author the qualification-only replacement of `combat2_party_depart_without_canary_gate` as its own small migration SQL, with the same drift guards (exact historical-original body fingerprint) and owner/security/settings/ACL preservation. Owner reviews and approves this artifact separately before any execution.
2. **Update G4A21 candidate.** Add `REVOKE EXECUTE ON FUNCTION public.heal_creatures_on_wake() FROM anon, authenticated, PUBLIC;` to the candidate, per owner clarification. Re-fingerprint and record the updated candidate SHA-256 in the G4A22 readiness doc. No other candidate changes.
3. **Pre-install reconciliation (SELECT-only tool, previously authorized route).** Re-run the G4A23 fingerprint checks only: eleven replacement functions, party trio, schema prerequisites, Drizzle hosted ledger prefix (23 entries). STOP on any drift since 2026-10-17 22:40 UTC. No new audit.
4. **Install correction migration** (step 1 artifact) via `lov_database--migration`. Verify appended journal entry and installed body hash equals `e01ed3c1…`.
5. **Install updated G4A21 candidate** via `lov_database--migration` as one atomic migration. Verify: generated SQL bytes/hash, one appended migration/journal/snapshot, regenerated types, untouched prior entries, ten new function identities with helper EXECUTE denied to PUBLIC/anon/authenticated/service_role, five new creatures columns, revoked heal_creatures_on_wake grants, unchanged trigger bindings, no new jobs.
6. **STOP before Edge.** Deployment of combat2-dispatch-once and combat2-tick-once from the reviewed checkpoint requires separate owner authorization (G4A22 gate 5). Old Edge plus new SQL is conservative after departure, not an acceptance result.
7. **Project state.** Update project-state JSON/Markdown and run `npm run project-state:check`. Record accepted limitations: worker/caller isolation (owner-accepted 22:45 UTC), live Edge bundle identity, sequential-smoke-only concurrency evidence.

## Preserved constraints

- All existing data and migration history preserved; additive/zero-downtime route only; no legacy Supabase runner, ledger repair or CLI lifecycle.
- No Edge deployment, frontend gate change or publication in this plan. Mik alone publishes the frontend.
- Calikon and Canaryone remain protected; no gameplay calls, world wake or fixture creation.
- Admin creature-mutation outage window (old direct-write clients lose rights at cutover) is coordinated per G4A22 gate 7; no raw-DML regrant as fallback.

## Awaiting owner decision

- Approval of this sequence.
- Separate review/approval of the step-1 correction artifact once authored.
- Execution authorization remains explicitly withheld.
