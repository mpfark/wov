# ENG-PROGRESSION-001F-R2 final Edge handoff

Current closure: **ENG-PROGRESSION-001F CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED / FRONTEND NOT PUBLISHED**. [Final local closure](progression-001F-closure.md) records the operator-supplied deployment and probes at 2026-10-07T21:06:27Z, distinct from local source verification. Earlier prepared/blocked statuses below are historical. Activation, publication and001G/H remain separate.


**PREPARED ONLY. READY FOR FINAL 001F EDGE DEPLOYMENT / PAUSED VERIFICATION.** This document does not authorize deployment. Execute only after Mik separately authorizes the final progression-command deployment and bounded verification. The [Lovable/Supabase operating contract](lovable-supabase-operating-contract.md) is mandatory for this work and future hosted database/backend tasks. No schema migration, activation, frontend publication or001G/H belongs to this handoff.

## Reconciled source and hosted evidence

Local task start: `031b951408952c799d178b42e449b90caf8191e1`. Fetched/synchronized source: `cd4c109c31f7112bc9c149773a3865e6da501f87`. Platform commit `97c1437ce5f88249db19ac0d46c98bc4e290f07a` reached origin and is an ancestor of the synchronized merge. Fast-forward preserved its migration/snapshot/journal. No generated-type change occurred; existing F declarations remain unchanged. All prior executed SQL and journal entries are preserved. Recovery stash `0a5529d5227675319b166881b10f1c91edd7486b` remains unchanged.

Mik supplies Lovable installation/verification window **2026-10-07 20:06:43–20:29:13 UTC**. Attempt1 failed its precondition and fully rolled back; attempt2 committed atomically and passed verification. Installed migration `0006_progression_001f_r1_restore_unprotected_service_updates`, Drizzle row7, matches reviewed R1 SQL **04a15bf91b8f7c629db0676a20de9e4ba06804d75ac62cbd308cce8db99da54f /22309 bytes/192 LF lines**. Repository raw Git SQL independently matches that byte identity. Local journal has seven entries, idx6/tag0006/when1791404929982, with the first six unchanged; snapshot0006 prevId matches0005 id. These local checks prove source reconciliation, not independent hosted installation.

Reported hosted results: service character table UPDATE=false, protected15=false, unprotected38=true, exact53-column partition; authenticated SELECT and exactly six preference UPDATE columns preserved, no authenticated table UPDATE. Key postgres-owned/RLS/no policies/no direct nonowner/PUBLIC table or column grants; gameplay effective access absent, expected administrative inherited authority distinguished. No key material selected/hashed/prefixed/printed. Six F identities/sole8-argument command/service-only command/private and legacy Renown owner-only/browser projection authenticated-only/raw fence/receipt constraint preserved; controlfalse. Character and Renown fingerprints unchanged; four progression sidecars0; one activev1 key row with32-byte constraint/metadata, no gameplay/data mutation. This is **operator-provided hosted evidence**; Codex accessed no hosted system.

Current status: **001F INSTALLED; 001F-R1 INSTALLED / VERIFIED; SERVICE_ROLE CHARACTER ACL REGRESSION REPAIRED; F EDGE NOT DEPLOYED; COMMANDS PAUSED; FRONTEND NOT PUBLISHED**. F is not yet CLOSED: final Edge deployment and safe refusal verification remain.

## Exact deployment source closure

Deploy only `progression-command` from the eventual pushed R2 commit, which must be a descendant of synchronized checkpoint `cd4c109c31f7112bc9c149773a3865e6da501f87`. The final handoff message supplies that commit identity; re-fetch and compare the manifest hashes from the actual deployment working tree. Any changed descendant requires reviewing closure/identity before deployment. [Deterministic manifest](progression-001F-R2-edge-manifest.json) is generated/checked by `node scripts/progression-001F-R2-check.mjs`.

| Repository deployment file | SHA-256 | Bytes /LF |
|---|---|---|
| supabase/functions/progression-command/index.ts | 88819cab31e7a2f9695a6f8cc391fe310dd632b55caf825bf6f68b89c3e978d7 | 1334 /21 |
| supabase/functions/_shared/progression-command.ts | 845401a78e02da379345e808e5aced143a9802f4f3bcefa9eba5d95013c6e178 | 4241 /56 |

These two UTF-8/LF files are the complete recursive **repository-local** import closure. Their bytes, plus config, match the reviewed original F implementation at `b8c18c90b1b5a5532244b76c41568a15986a0cfe`. R1/R1A/platform reconciliation changed no Edge runtime semantics. No formulas, browser files, MCP bundle or other shared code is imported by this function.

External dependency is exactly `https://esm.sh/@supabase/supabase-js@2.116.0`; its transitive dependencies are provider-resolved external SDK dependencies, not extra repository files to submit. Runtime provides Deno.serve and Request/Response. Use provisioned Supabase configuration; never select/print Deno.env or any credential value. Entry verifies claims with the anon client and derives actor from verified sub; service client sends the sole8-argument RPC without forwarding owner JWT or body actor.

Deployment configuration is `supabase/config.toml`: SHA-256 **a470ef6c53518ff4159bac8a0d47d43bb28beb09f59b11aa5f49e7bb59e624a9**,869bytes/36LF. `functions.progression-command.verify_jwt=false` is intentional because the handler verifies JWT claims. Preserve that setting and confirm the effective function configuration without revealing secrets. The complete config file is identity evidence, not permission to deploy any other function.

## Hosted-only preflight and bounded verification

Before separately authorized deployment, Lovable must verify current source/hash identity, actual installed0005/0006 ledger/SQL identity, current F prosrc/security/ACL/fence identities, service15/38 partition and browser preferences, private/key containment using actual role memberships/default privileges, and exactly one command-control singleton with enabled=false. Use metadata/ACL/RLS and non-revealing evidence only; no key material query/hash/prefix. Stop on drift; do not replay/install a migration or change roles/control to make checks pass. Confirm compatible hosted SDK/config/platform behavior during deployment without claiming a locally proven provider bundle.

Deploy only the named function with both reviewed local source files. Record the deployment tool result and timestamp plus **working-tree source hashes**. No Edge revision ID or live bundle download is available; do not invent or request either. Tool deployment plus bounded handler probes support this release claim; they do not prove a downloadable live bundle hash.

Run this smallest mandatory probe set against the configured function endpoint (record UTC timing and sanitized responses; no credentials in output):

| Probe | Method/auth/request | Exact expected response | Why no gameplay write is reachable |
|---|---|---|---|
| CORS | OPTIONS, no Authorization, no body | HTTP200, empty body; Access-Control-Allow-Origin `*`, Methods `POST, OPTIONS`, Headers `authorization, x-client-info, apikey, content-type` | Returns before JWT verification, parsing or service RPC |
| Unauthenticated | POST, no Authorization, Content-Type application/json, body `{}` | HTTP401, `{"kind":"refused","reason":"unauthorized"}` | Missing bearer returns before JWT verification, body parsing or service RPC |
| Method refusal | GET, no Authorization/body | HTTP405, `{"kind":"refused","reason":"method_not_allowed"}` | Method gate returns before JWT verification or service RPC |

Do not use invented or malformed JWTs as a required probe: SDK error/throw behavior is a different boundary from the guaranteed missing-bearer path. A malformed body without Authorization still yields401, not400. Gateway-generated or different envelopes/statuses do not satisfy the handler evidence; stop and investigate configuration rather than accepting them as equivalent.

Authenticated testing is **not required to close F**. If no safely established identity is available, retain the exact limitation and skip both optional probes. Do not create accounts/characters, retrieve or print session tokens, manufacture an authenticated fixture or mutate player data to obtain proof. The following definitions are for a separately approved existing safe session only:

| Optional probe | Method/auth/request | Exact expected response | Safety boundary |
|---|---|---|---|
| Malformed/schema refusal | POST with an already valid verified user session; body `{` (invalid JSON) or `{}` | HTTP400, `{"kind":"refused","reason":"invalid_request"}` | Successful claims verification precedes parsing; parser refusal precedes service RPC |
| Commands paused | POST with approved existing character owner's valid session; `{"characterId":"<existing-owned-uuid>","requestId":"<fresh-uuid>","expectedVersion":0,"operation":"respec"}` | HTTP200, `{"kind":"refused","reason":"commands_paused"}` | Fresh approved preflight must show controlfalse, matching ownership/stable node, no prior receipt for UUID and no versioned state (otherwise use observed version). Public SQL performs validation/locks/read-only replay checks, then pause refusal before fresh validator/application or any data write |

The paused probe may acquire transient locks. If these optional safety preconditions cannot be proven, defer it; no activation to obtain a response. Unexpected replay/refusal does not prove the specified paused branch; document it and keep the probe limitation. Post-deployment verify control stillfalse and relevant character/Renown/sidecar fingerprints unchanged with non-secret metadata; no command activation, receipts, key rotation, backfill or gameplay writes.

## Final acceptance and STOP

F can legitimately close after reconciled0005/0006 and hosted installed object/ACL evidence, final Edge deployment from the reviewed working-tree closure, successful mandatory safe refusal probes, paused-control/data-preservation verification and an operator handoff recording the actual source/deployment evidence. A subsequent authorized local closure reconciliation records that evidence; R2 itself does not mark F closed or claim deployment. Activation is a separate later authorization; frontend publication is Mik's separate manual decision.

Retain exactly:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

Concurrent-write proof, natural-runtime observation, unavailable authenticated probe and RP earning redesign are not closure prerequisites under the accepted F staged contract. Source preparation, installed SQL, Edge deployment and frontend publication stay distinct.

STOP on source/ledger/object/ACL/control drift, secret-revealing output requirements, missing source dependency, deployment failure, unexpected mandatory probe or gameplay/data change. Do not activate, publish, change schema/roles, deploy other functions or begin001G/H. No native dry run, disposable hosted DB, concurrent-write fixture, revision ID or live bundle retrieval is requested.

Only after all authorized deployment/verification acceptance succeeds may Lovable justify:

```text
ENG-PROGRESSION-001F INSTALLED / VERIFIED / EDGE DEPLOYED
ENG-PROGRESSION-001F-R1 INSTALLED / VERIFIED
SERVICE_ROLE CHARACTER ACL REGRESSION REPAIRED
READY FOR LOCAL 001F CLOSURE RECONCILIATION
COMMANDS PAUSED
FRONTEND NOT PUBLISHED
```

Current local result remains **ENG-PROGRESSION-001F-R2 PREPARED / READY FOR FINAL 001F EDGE DEPLOYMENT / PAUSED VERIFICATION**, not that future success statement.

## Local validation

R2 changes documentation/evidence/check tooling only; no Edge, browser, gameplay or executed SQL changed. Affected spec sections: Engine principles and authority; Progression and rewards; Failure, diagnostics and verification. Roadmap ENG-PROGRESSION-001F (R2). All gameplay rules/protected fields and the single world heartbeat are preserved.

The post-install checker supersedes archival R1's pre-0006 prefix assumption; R1 regression wrapper substitutes only that checker and runs all original14 ACL/DML/administrative tests unchanged. Historical F/R1 generators, manifests and reviewed/installed SQL remain frozen. Local logs use `../001C-local-db-tests/F-R2-*`.

Acceptance: Edge/browser/state51 passed (Edge/progression-command27, F browser21, state3); pure HTTP probe6; F authority/containment39; actual F Combat2 chain12; unchanged R1 ACL14: all pass with no focused failure. Four TypeScript checks (root/app/node/strict Edge) and production build pass. Deterministic closure/0006 identity/journal/snapshot/history/runtime preservation checks pass. Full-suite rerun is unnecessary for documentation/source reconciliation with unchanged runtime; the established full acceptance baseline remains2751pass/18 existing failure identities, not a new R2 full-suite result.
