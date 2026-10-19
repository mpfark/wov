# Combat2 resource diagnostics — frontend handoff

Reviewed source baseline: 830c9cdecf94428dd140654e46bdb4f1080c0122; based_on_source_sha ancestry from9db3d227a5a309b0a21d90e4e9ce5532a3f16370 verified. Source change only: **ready for Mik's manual frontend publication**, not live-verified. No SQL/migration, Edge deployment, extra RPC/polling, scheduler control or gameplay mutation. Engine sections Resources and attributes, Client authority, Failure/diagnostics preserved; ENG-DIAG-001 remains a measurement work item, not closed.

## Use

After **Mik manually Publishes** the updated frontend, open the administrator-only radio/status button at bottom-right in the game. Keep Start → reproduce briefly → Stop → Export. Start/Stop retain their existing diagnostic-metadata writes; this extension adds no server writes. Start immediately samples existing mounted UI values; later observations use existing delivery/render flows only. Export the combat2-diagnostic-<session-id>.json file before Clear. Stopped/expired recordings survive same-tab reload for export, including the new samples. Server-export failure still offers client-only export.

## Evidence labels

| Layer / source | Meaning |
|---|---|
| client_received / combat2_sync | Character/creature resource values received through the existing sync hook. Snapshot encounter tick/stateVersion and paged delivery cursor are distinct. Creature technical ID, projection ID and spawn sequence retained. |
| client_received / character_initial, character_realtime, character_poll, character_focus/reconnect | Character row values before optimistic/held-field merges; source updated_at/read-start time retained where available. Allows comparison of a late older read with state that correctly refused it. |
| client_received / node_creature_roster, creature_realtime | Existing roster response / realtime values; roster is recorded before node-scope validation, explicitly labelled received_before_scope_validation. Receipt alone does not prove application. |
| client_received / combat2_character_stances, combat2_change_stance | CP, maxCP, reservations/spendable CP; successful change includes its existing request UUID/result label. No extra stance reads. |
| client_state / game_page_character | Merged character props held by GamePage, before Combat2 presentation and UI maximum calculations. Not a raw row or server snapshot. |
| ui_displayed / status_bars, node_view | Values supplied by the actual rendering components: calculated maxima, raw CP plus displayed/spendable CP, stance reservation and queued cost; creature HP after the actual override and displayed max HP. Encounter/tick/version where supplied, otherwise null. Component render values, not pixel/animation interpolation measurements. |

All resource samples have **side=client**. None is an independent authoritative server observation, even when received from a server RPC. Existing server events remain separate phase/outcome evidence and do not contain server resource snapshots. To prove a durable HP write when browser evidence is insufficient, request a separately authorized narrow Lovable read for the recorded identities/time window; do not add a diagnostic polling loop or infer historical state from a later current row.

## Bounds and interpretation

- Existing five-minute capture and500 client-event/2000 server-event limits unchanged. Resource samples use a **separate200-snapshot ring**, up to16 creatures/sample; drop/omission counts exported. Resource samples cannot evict the existing combat-event buffer.
- Repeated unchanged samples from a source/layer are suppressed; a new updated_at/read timestamp alone does not produce a duplicate. Changed resources, scope, tick/version/request or status remain visible. Numeric allowlist only: no complete rows, names, credentials, effect JSON or arbitrary payloads. Missing/nonfinite values are null; anomalous negative/over-max observations are preserved, not corrected.
- Export includes resourceSnapshots and their entries in correlatedTimeline alongside existing events. Client wall-clock and monotonic observation times, source timestamps/read-start, request IDs and encounter/tick/version/cursor help compare deliveries; clocks are independent. Monotonic clocks reset across page reloads. The timeline is descriptive, not proof of cross-server causality.
- Client samples follow the recorded character through nodes; other characters are ignored. The existing server diagnostic scope remains its starting node/optional encounter and may have gaps during movement. No automatic server-session retargeting was added.
- Capture is opt-in and best effort; inactive factories do no resource-copy work. No timer or React state update per resource sample; storage/observer errors cannot interrupt gameplay. Existing diagnostic change events are reused for initial capture without recursive resource notifications.

## Validation and delivery

Validation:66 focused cases across the existing diagnostics/delivery/stance/resource/UI suites (including9 resource-specific cases) and3 project-state tests passed. Focused coverage: bounds/allowlists/scope/expiry, deduplication, stale-value sequence, storage failure, Stop/export recovery, actual rendered player/creature values, node transitions, sync tick versus cursor and stance reservations with unchanged RPC counts. Existing delivery/readiness tests retained. App typecheck and production build pass; build has existing >500kB chunk warning; diagnostic download test retains jsdom's unsupported-navigation warning without failure. No live runtime/resource-causality verification claimed.

SQL/Edge stages: N/A. Next operator action is Mik's manual Publish of this compatible frontend after reviewing the pushed commit; Git push/preview build does not publish. Then one short recorded Calikon session can capture the reported symptoms. Do not change scheduler/world state, resource formulas, creature HP rules or admin XP policy to collect evidence. All prior OPEN limitations and accepted dispositions remain unchanged; recovery stash preserved. No hosted operations performed by Codex.
