# ENG-LEGACY-001G4A24 — G4A21 installation plan (prepared, not executed)

Plan prepared 2026-10-17; local artifacts prepared 2026-10-18 under the current owner request. **Preparation only: nothing installed, deployed, migrated or published.** G4/ENG-LEGACY-001 remain OPEN.

## Finding: G4A9-R1 party ambiguity is NOT resolved by G4A21

Verified against the candidate bytes and G4A22 readiness record:

- The ambiguous unqualified `cost` aggregate lives in `public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)`.
- G4A21 replaces only the wrapper `combat2_party_depart(uuid,uuid,uuid)` (drift-guarded body patch). It does **not** touch `combat2_party_depart_without_canary_gate`.
- The supplied Lovable plan reports that G4A23 confirmed the installed trio matches the historical-original (unqualified) hashes, so its report identifies installed ambiguity. No raw hosted export was obtained or independently verified by Codex in this preparation.
- G4A22 already classifies this as a release blocker: "G4A9-R1's ambiguous cost aggregate is not corrected by G4A21… Unqualified/divergent installed source or unestablished compilation semantics is a release blocker, not owner-accepted safety."

**Smallest necessary correction (per G4A22):** a separately reviewed qualification of that exact predecessor — member-result column qualification only, matching G4A10's locally verified qualified body (public-body SHA-256 `e01ed3c1d24627771f40a95960eecd1b39eed7d089c371b2eb5abdf0884de7b1`). No party redesign, no `variable_conflict` workaround, no wrapper/finalizer/trigger changes; locks, ordering, frozen movers, request/replay semantics, return/error shapes and F6 serialization preserved.

## Installation sequence (standard Drizzle custom-SQL lane only)

1. **Correction artifact prepared (separate review required).** [Party cost qualification](legacy-001G4A24-party-cost-qualification.sql), SHA-256 `af206f9fdf0d12de1f3d2b4a0b2acf71a0c45e71449a498f74c8fe010b0525e9`. Author the qualification-only replacement of `combat2_party_depart_without_canary_gate` as its own small migration SQL, with the same drift guards (exact historical-original body fingerprint) and owner/security/settings/ACL preservation. Owner reviews and approves this artifact separately before any execution.
2. **G4A21 candidate updated locally.** [Consolidated candidate](legacy-001G4A21-shared-hp-candidate.sql), SHA-256 `a126ae28bc4767bd02b065af1d475a6804fedb9c9c599b3b3e82285830b96523` (previous `91092a0013fb325f2100797fa1d07d655b8d0a793400b959be382aa882857e3f`). Add `REVOKE EXECUTE ON FUNCTION public.heal_creatures_on_wake() FROM anon, authenticated, PUBLIC;` to the candidate, per owner clarification. Re-fingerprint and record the updated candidate SHA-256 in the G4A22 readiness doc. No other candidate changes.
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

## G4A24 prepared artifacts and review boundaries

The party operation copies pg_get_functiondef of the exact signature, guards original body SHA-256 `4b7f16cfd9da168704831ebf641740e9ce69cd206272a39244b076855adb1ea5`, replaces the single terminal member-result aggregate with G4A10 alias/column qualification and requires corrected body SHA-256 `e01ed3c1d24627771f40a95960eecd1b39eed7d089c371b2eb5abdf0884de7b1`. All pg_proc metadata except prosrc (including OID/owner/security/settings/ACL) must remain identical. No grants, movement calculations, locks, behavior contracts or F6 changes. It is one atomic DO operation. Reapplication or drift refuses atomically.

The consolidated HP candidate differs from its previous approved bytes only by the commented EXECUTE revocation immediately before its existing COMMIT. Existing owner/service grants and all other bodies/settings/ACL behavior are retained; effective service authority must be checked against actual hosted grants/inheritance. No new server grant is invented. Deterministic assembly includes the same tail. G4A19/G4A20 remain superseded, not separate install steps.

Both artifacts stay under docs/operations, outside automatic migrations. Preparation is complete; execution approval remains withheld. Fresh parity, supported read-only route and quiet-window/containment controls remain mandatory. The plan's reported caller-isolation acceptance is owner-supplied historical evidence, not independently observed caller isolation or a broader acceptance of other gates. Future two standard Drizzle forward events append to the23-entry prefix only after fresh reconciliation; never precreate files, repair history or auto-retry uncertain outcomes. Stop before Edge/frontend.

See [G4A24 local preparation evidence](legacy-001G4A24-artifact-preparation.md) for executed tests, fidelity and remaining limitations. No G4A9-R1/G4-R1/G4-R2/E13/G closure. Engine rules unchanged; prior accepted risks, G3 deferral/G3D BLOCKED, four OPEN progression limitations, F1 retry issue and administrative XP grant pause preserved.
