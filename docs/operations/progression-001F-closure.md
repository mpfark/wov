# ENG-PROGRESSION-001F — Final local closure

```text
ENG-PROGRESSION-001F CLOSED
INSTALLED / VERIFIED / EDGE DEPLOYED
COMMANDS PAUSED
FRONTEND NOT PUBLISHED
```

Local closure reconciles checkpoint `a4bd4e923dcdd86d73cdf550cbdc7bba65b3718c` and the operator evidence supplied by Mik. Local deterministic source verification independently confirms repository identities; it does not independently prove hosted installation, deployment or HTTP behavior. The reported hosted result satisfies the [R2 acceptance requirements](progression-001F-R2-edge-handoff.md). Earlier failed/prepared statuses remain historical, including fully rolled-back R1 attempt1. No runtime, migration or gameplay source changes accompany this closure.

## Deployment and refusal evidence

Operator-reported deployment timestamp: `2026-10-07T21:06:27Z`. Function: `progression-command`. Exact tool result: `Successfully deployed edge functions: progression-command`.

| Working-tree source | SHA-256 |
|---|---|
| supabase/functions/progression-command/index.ts | 88819cab31e7a2f9695a6f8cc391fe310dd632b55caf825bf6f68b89c3e978d7 |
| supabase/functions/_shared/progression-command.ts | 845401a78e02da379345e808e5aced143a9802f4f3bcefa9eba5d95013c6e178 |
| supabase/config.toml | a470ef6c53518ff4159bac8a0d47d43bb28beb09f59b11aa5f49e7bb59e624a9 |

Operator-observed mandatory HTTP probes all passed: OPTIONS HTTP200, empty body, expected CORS headers; unauthenticated POST HTTP401 `{"kind":"refused","reason":"unauthorized"}`; GET HTTP405 `{"kind":"refused","reason":"method_not_allowed"}`. Handler-owned unauthenticated refusal confirms effective verify_jwt=false per operator evidence. Authenticated probes intentionally skipped; no authenticated gameplay or paused-command runtime proof is inferred. No revision ID or retrieved live bundle is claimed.

## Authority and data preservation

Operator reports seven unchanged Drizzle entries, verified0005/0006 identities, control enabled=false, service_role characters table UPDATE=false/protected15 UPDATE=false/unprotected38 UPDATE=true. Authenticated UPDATE remains limited to six preference columns. Command remains service_role-only, projection authenticated-only, private Renown/XP functions owner-only, and six progression tables owner-only with RLS enabled and no policies. Function identities unchanged; no key material exposed.

Before/after characters fingerprint `f672ddcb4c0e4d88f21f7bc585159646`, count21; progression sidecars0/0/0/0, Renown keyrows1 and Drizzlerows7 unchanged. No gameplay mutations, receipts, backfill or key rotation. This supplied observation is not a freshly inspected current operating window. The earlier R1 attempt2 installation evidence and unchanged repository0006 remain preserved.

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

## Next boundary

ENG-PROGRESSION-001G is next planned: reconciliation/admin/creation safety. The roadmap requires D and explicit exceptional policy approval. D closure is recorded; exceptional override, repair and creation policy approval remains genuinely unresolved. Separate task authorization and evidence sufficient for each bounded repair are required. Opaque historical materialized stats, class growth and Renown are not reconstructible from the current class; contradictions must be scoped rather than normalized or repaired without authority. Admin reset-stats/set-level/update-character/grant-respec remain fenced; creation INSERT safety remains001G scope. No blanket history reconstruction, RP earning redesign, combat redesign or frontend publication is implied. No001G/H implementation begins here. Activation and Mik's manual publication remain separate decisions.

## Local validation

R2 deterministic source/config/dependency closure, reviewed installed0006 bytes, seven-entry journal prefix/snapshot chain, preserved platform ancestry and unchanged runtime checks pass. Focused Edge/progression-command27, F browser21 and project-state3 tests pass (51 total); F authority/containment39, R1 ACL14 and pure HTTP probe6 pass. Root/app/node/strict Edge TypeScript checks and production build pass. No new focused failures. A full-suite rerun is not required for this documentation/state-only closure; historical full-suite results are not represented as fresh closure tests.

Normal commit/push follows validation; the source checkpoint remains the evidence anchor rather than a self-referential closure commit. Recovery stash is preserved. No hosted access, deployment, activation, publication, schema change or001G/H work is performed by this task. STOP after local closure commit/push verification.
