# Combat2 live latency optimization — 2026-11-14

## Reviewed source and scope
- Mik authorized live combat query/connection optimization with a150ms round target and unchanged two-second rhythm.
- Starting/local/remote-main SHA: e7ac229bd253be58526a3d6e5ab0c8c6a71919e9. Remote checked with ls-remote; no stateful Git fetch/push performed. Recorded basis e1faa06b4fbf59d723636bde74af6abd503609a2 is an ancestor (exit0).
- Engine sections: One authoritative world heartbeat; Failure, diagnostics and verification. Roadmap ENG-HB-002 / ENG-DIAG-001. All gameplay rules preserved; no schema, scheduler, privilege or frontend changes.

## Changes and checks
- Warm-isolate privileged RPC client and explicit reusable HTTP pool: four idle connections/host,90s idle timeout. PostgreSQL/PostgREST managed pooling itself was not changed; database credentials are unavailable on Cloud.
- Session lookup starts before combat but no longer delays claim; bounded evidence persists asynchronously. Heartbeat diagnostic write no longer holds the response open. Claim/commit remain separate atomic transactions with all existing fences.
- Always-on bounded phase timing records actual rounds against150ms, without snapshots or secrets.
-127 tests passed across six suites: worker, dispatcher boundary, manual boundary, pool reuse/target reporting, Edge packaging and golden master. Preview build OK.
- Live query inspection: due-node/intent/effect/event indexes already present. Inventory contains four rows; equipped-item query0.085ms. No speculative indexes or rewritten gameplay SQL justified.
- Cloud pool healthy:9/60 database connections,1/200 pool clients,58% memory, no exhaustion alert. No instance resize justified.

## Hosted delivery and acceptance
- Both combat workers deployed successfully. Submitted bundle/config hashes:
  - combat2-dispatch-once:509ae49053844ee802b99fc95c1ef19620e42458eae81eb332431b6b7b3bc9f1
  - combat2-tick-once:19c4b91beb6f7f2b4ccea18be1b893f7c155cb4d5a38d0c15899374895bceb0a
- These are submitted source identities, not independently retrieved live bundle hashes; new live timing logs prove updated handler execution.
- Authenticated disposable Latencyprobe entered the ordinary world and fought Pasture Wolf to defeat.10 rounds, heartbeats65692–65701,12:17:08–12:17:26UTC; every consecutive heartbeat processed the encounter. Ended encounter tick1643 (pre-existing encounter sequence), character0/16HP, wolf31/39HP. Respawn read back at Hearthvale Square. Test character deletion requested through normal UI afterward.
- Claim-to-result elapsed times(ms):253.84,325.09,170.26,536.62,216.95,229.39,112.83,189.88,184.72,154.44. Median203.415ms;1/10 below150ms. No1–3s step stall in this sample; not a controlled before/after benchmark.
- Full heartbeat-start-to-diagnostic-save range231–645ms, distinct from combat-step timings; deferred diagnostic persistence remains included in that historical field.
- Residual delay is in claim/commit HTTP round trips, not engine math (~0.7–7.4ms).150ms for every round is NOT achieved. No claim of guaranteed improved tail latency or concurrent-load acceptance.

## Limits and recovery
- No direct database connection/password, managed-pool tuning or independent Edge region control available through this workflow. Further transport improvement requires a supported co-located direct/pooled transport, not broader privileges or gameplay moved back into SQL.
- Existing scheduler/world controls were not reconfigured; normal character activity woke the world and idle shutdown remains responsible for sleep. No global emergency shutdown because it could affect other players.
- No frontend publication. Changes are server-only; Mik retains sole publication authority.