# Handoff: merged due-fights + first lock (ENG-PERF, prepared 2026-11-14)

Status: prepared only. SQL not installed, workers not changed or deployed, frontend unaffected.

## Why
A fight round makes three database trips: `combat2_due_nodes`, `node_tick_claim`, `node_tick_commit` (~70 ms each; median round ~200 ms, see combat2-latency-2026-11-14.md). Definitions are already bundled in the worker, so caching cannot remove a trip. Merging discovery with the first claim removes one trip for the common single-fight heartbeat (expected median ~130 ms).

## Rules preserved
- One authoritative world heartbeat; SQL still owns claim, lease and atomic commit. No engine rule change.
- Existing `combat2_due_nodes` and `node_tick_claim` are called unchanged inside the new function; their grants (postgres, service_role) are mirrored.
- Only the first candidate is claimed inline, so later candidates' 5 s leases do not start early. A failed inline claim falls back to the current separate claim.

## Artifacts
- `docs/operations/combat2-due-and-claim-first.sql` (sha256 in project state / below).

## Steps needing Mik's authorization, in order
1. Install the SQL; verify with: function exists, `proacl` = postgres + service_role only, and a call while the world sleeps returns `kind=world_asleep` with no `first_claim`.
2. Worker change (both workers' dispatch path): call `combat2_due_nodes_claim_first`; when `first_claim.node_id` matches the node being processed, `claimNode` returns that claim instead of a new RPC; otherwise unchanged. Tests: reuse of inline claim, fallback when absent, golden master unchanged. Deploy `combat2-dispatch-once` (and `combat2-tick-once` unaffected).
3. One live test fight; report per-round times against the 200 ms median.

Rollback: redeploy the previous worker; the new function is unused and harmless.
