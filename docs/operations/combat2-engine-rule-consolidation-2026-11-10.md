# Combat2 engine rule consolidation — release handoff

## Reviewed source and scope
- Mik authorized moving remaining worker combat rules into the engine; only `combat2-dispatch-once` and `combat2-tick-once` deployed.
- Reviewed source checkpoint at release: `ae11c2fae5534067547de7c597f8d548b0e263ea`; locally observed origin/main: `1f7e96b7d03f2b1e5aa5b62812d8321983cc5067`. Source is managed by the harness; no Git push or fetch performed, so remote freshness/publication is not established. Baseline `e1faa06b4fbf59d723636bde74af6abd503609a2` and observed origin/main are ancestors of HEAD.
- ENG-MODERNIZE-002; specification sections Engine principles and authority, Combat resolution, Effects and stances. All gameplay rules, heartbeat, RPC contracts and transactional authority preserved.
- Status validation was the last external combat policy module reached by the worker graph. It now lives in the engine; old source/Edge config paths are compatibility exports. Player/boss catalog preparation now belongs to engine.prepareTick; worker transport delegates to it and engine.step. Decoder/types are imported through the engine entry point.
- Changed source: the four hashed modules below, status compatibility exports, generated engine/worker modules, both worker index/handler type imports, engine-preparation and full graph tests, AGENTS.md and roadmaps/specification/state. Unrelated work preserved.

## Artifacts and checks
| Canonical artifact | SHA-256 |
|---|---|
| `src/shared/combat2/engine.ts` | `6c82fe59d971189b2afd1fadd028ba1ff21f241e690aec71e03c4a6c491186a6` |
| `src/shared/combat2/status-contract.ts` | `2cb853646f889c61d8455c4c2c9e9f46b1df75ec1bb6d1c7afb563dc9562fcea` |
| `src/shared/combat2/catalog.ts` | `e00481a7aa22fac34b2cc85f61456f177953d4ce2c7a6d532021920c77b6f39e` |
| `src/server/combat2/process-node-tick-once.ts` | `b1eb2ae8cf1739bd9a3f8968fbd17fdfdcd981db3c3c3d66250cd624a841f0f0` |

- 31 focused files / 672 tests passed: engine rules, both recorded-fight sets, preparation equivalence/refusals, worker claim/commit and HTTP handlers. Snapshot files were not updated.
- Full transitive Edge graph test allows engine code and HTTP/auth infrastructure only; no external status-contract exception remains. Exact generated engine and worker parity passed.
- Automatic preview build: build OK at 2026-11-10T22:44:21Z.
- SQL/migration/ACL/type changes: N/A. Existing RPC arguments/results unchanged. JWT configuration and secrets unchanged; required environment names remain SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COMBAT2_WORKER_SECRET; no values read or exposed.

## Hosted deployment and minimal verification
- Supported deployment tool reported success for only both named workers at 2026-11-10T22:45:09Z (recording time).
- Submitted source/settings SHA-256: dispatcher `e5199e62ab42c5a698fd0cd96593ee12de67d9cfdcb41aba546826d137ed4b5e`; tick `a1c9d7a5bbc38f30d147e271dc14937b5b20ff335e0a84bb5c6cf11a813b97c8`.
- Fresh deployed GET:405; POST with explicitly empty Authorization:401, both workers. No authenticated worker/gameplay invocation, world wake, controls, scheduler, SQL, data mutation or frontend publication.
- Deployment success and submitted fingerprints do not independently prove live bundle identity: no live revision/bundle retrieval returned. Live full-fight verification after this release was not performed; local production-path claim/prepare/step/commit checks passed.

## Next safe action and limitations
- No frontend change or publication needed for this worker-only release. Mik retains manual publication authority.
- SQL-owned lifecycle, entry/departure, progression commits and settlement remain installed transactional authority; this task does not migrate their rules or claim the entire game is pure TypeScript. Generic command pipeline and later modernization phases remain open.
- Separate authorized controlled gameplay acceptance can follow; no test-character or world-control changes made here.
